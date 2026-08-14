from collections.abc import AsyncIterator
from typing import Any

from llm import LlmStreamPart, sse_event, stream_llm
from query_service import generate_queries
from rag_service import RagChunk, RagService

RAG_CITATION_RULES = """【回答硬性要求 — 必须遵守】
1. 详细展开回答：按主题分小节，每点 2–4 句，全文通常 200–400 字，禁止只给一两句敷衍
2. 引用格式：凡陈述来自「检索片段」的事实，句末必须标注 [1]、[2] 等编号，编号只能使用下方已给出的片段编号
3. 至少引用 3 个不同编号（若片段不足则引用全部可用编号）；摘要仅作背景，具体细节必须引用检索片段
4. 仅使用提供的摘要与检索片段，无依据时明确说明「资料中未提及」
5. 使用中文 Markdown（## 小标题、列表），不要输出思考过程"""

DEFAULT_ANSWER_SYSTEM_PROMPT = """你是 Askme 助手。请基于「日报摘要」和「检索片段」详细回答用户问题。

""" + RAG_CITATION_RULES


def build_answer_messages(
    system_prompt: str,
    summary: str,
    chunks: list[RagChunk],
    history: list[dict[str, str]],
) -> list[dict[str, str]]:
    user_prompt = system_prompt.strip()
    if user_prompt:
        system = f"{user_prompt}\n\n{RAG_CITATION_RULES}"
    else:
        system = DEFAULT_ANSWER_SYSTEM_PROMPT

    chunk_blocks: list[str] = []
    for chunk in chunks:
        block = (
            f"[{chunk.index}] 来源={chunk.feed_name} 标题={chunk.title} 时间={chunk.published_at}\n"
            f"{chunk.text}"
        )
        chunk_blocks.append(block)

    reference = "\n\n".join(chunk_blocks) if chunk_blocks else "（无检索片段，请说明无法从原文论证）"
    system_content = (
        f"{system}\n\n"
        f"【日报摘要】\n{summary or '（暂无摘要）'}\n\n"
        f"【检索片段 — 回答时必须用 [n] 引用】\n{reference}"
    )

    trimmed = history[-10:]
    return [{"role": "system", "content": system_content}, *trimmed]


def rag_chunk_to_citation(chunk: RagChunk, excerpt_limit: int = 240) -> dict[str, Any]:
    excerpt = chunk.text.strip()
    if len(excerpt) > excerpt_limit:
        excerpt = excerpt[:excerpt_limit] + "…"
    return {
        "index": chunk.index,
        "id": chunk.id,
        "title": chunk.title,
        "feed_name": chunk.feed_name,
        "published_at": chunk.published_at,
        "url": chunk.url,
        "feed_id": chunk.feed_id,
        "article_id": chunk.article_id,
        "chunk_index": chunk.chunk_index,
        "char_start": chunk.char_start,
        "excerpt": excerpt,
        "text": chunk.text,
        "score": round(chunk.score, 4),
    }


class ChatService:
    def __init__(self, rag_service: RagService | None = None):
        self.rag = rag_service or RagService()

    async def plan_queries(
        self,
        question: str,
        summary: str,
        titles: list[str],
        llm_config: dict | None,
    ) -> tuple[list[str], bool]:
        return await generate_queries(question, summary, titles, llm_config)

    async def retrieve(
        self,
        queries: list[str],
        cutoff_iso: str,
        feed_ids: list[str] | None,
        llm_config: dict | None,
    ) -> list[RagChunk]:
        return await self.rag.retrieve(queries, cutoff_iso, feed_ids, llm_config=llm_config)

    def build_messages(
        self,
        system_prompt: str,
        summary: str,
        chunks: list[RagChunk],
        history: list[dict[str, str]],
    ) -> list[dict[str, str]]:
        return build_answer_messages(system_prompt, summary, chunks, history)

    async def stream_answer(
        self,
        messages: list[dict[str, str]],
        llm_config: dict | None,
        *,
        enable_thinking: bool = False,
    ) -> AsyncIterator[LlmStreamPart]:
        async for part in stream_llm(messages, llm_config, enable_thinking=enable_thinking):
            yield part

    def count_chunks(self, cutoff_iso: str, feed_ids: list[str] | None) -> int:
        return self.rag.count_in_scope(cutoff_iso, feed_ids)


PHASE_MESSAGES = {
    "planning_queries": "正在分析问题…",
    "retrieving": "正在检索…",
    "answering": "正在回答…",
}


async def run_rag_chat(
    *,
    question: str,
    summary: str,
    titles: list[str],
    system_prompt: str,
    history: list[dict[str, str]],
    cutoff_iso: str,
    feed_ids: list[str] | None,
    llm_config: dict | None,
    use_rag: bool,
    enable_thinking: bool = False,
    chat_service: ChatService | None = None,
) -> AsyncIterator[str]:
    service = chat_service or ChatService()
    llm_cfg = llm_config

    yield sse_event(
        "status",
        {"phase": "planning_queries", "message": PHASE_MESSAGES["planning_queries"]},
    )

    chunks: list[RagChunk] = []
    if use_rag:
        queries, need_rag = await service.plan_queries(question, summary, titles, llm_cfg)
        if need_rag and queries:
            yield sse_event(
                "status",
                {"phase": "retrieving", "message": PHASE_MESSAGES["retrieving"]},
            )
            chunks = await service.retrieve(queries, cutoff_iso, feed_ids, llm_cfg)
        elif need_rag and not queries:
            chunks = await service.retrieve([question], cutoff_iso, feed_ids, llm_cfg)

    citation_items = [rag_chunk_to_citation(chunk) for chunk in chunks]
    yield sse_event("citations", {"items": citation_items})

    yield sse_event(
        "status",
        {"phase": "answering", "message": PHASE_MESSAGES["answering"]},
    )

    messages = service.build_messages(system_prompt, summary, chunks, history)
    system_content = messages[0]["content"] if messages else ""
    yield sse_event(
        "prompt_preview",
        {
            "system": system_content,
            "chunk_count": len(chunks),
            "history_turns": len(history),
        },
    )

    async for part in service.stream_answer(messages, llm_cfg, enable_thinking=enable_thinking):
        if part.kind == "thinking":
            yield sse_event("thinking", {"content": part.text})
        else:
            yield sse_event("token", {"content": part.text})
