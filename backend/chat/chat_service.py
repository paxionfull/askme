from __future__ import annotations

from collections.abc import AsyncIterator
from html import escape
from typing import Any

from feed.article_service import ARTICLE_CHAR_LIMIT, _format_publish_time_display
from core.llm import LlmStreamPart, sse_event, stream_llm
from chat.query_service import QueryPlan, generate_queries
from chat.rag_service import RagChunk, RagService

HISTORY_TURN_LIMIT = 10

RAG_CITATION_RULES = """【回答硬性要求 — 必须遵守】
1. 紧扣用户问题中的核心实体与主题作答；禁止把检索片段或概览里其他无关产品/事件单独成节
2. 引用格式（NotebookLM / Perplexity 风格）：凡陈述来自「检索片段」的事实，在该句末尾紧跟内联编号 [1]、[2] 等；编号只能使用本轮用户消息中已给出的片段编号。禁止改成文末来源列表或脚注清单
3. 只引用与用户问题直接相关的片段；相关片段不足时引用全部可用编号，禁止为凑数引用无关片段
4. 概览仅作背景理解；具体事实与对比关系必须来自检索片段。概览有但检索片段未支持的内容不得写入；禁止给概览内容标注 [n]
5. 若检索片段无法支撑回答，明确说明「根据已检索资料，未找到与…相关的信息」，不要展开其他话题
6. 使用中文 Markdown（## 小标题、列表），不要输出思考过程"""

SCOPED_SUMMARIZE_CITATION_RULES = """【摘要引用硬性要求 — 必须遵守】
1. 关键事实、数据与结论在句末内联标注 [1]、[2] 等，编号对应本轮「选定正文」中的文章编号（NotebookLM / Perplexity 风格）
2. 禁止改成文末来源列表；只使用已给出的编号，不编造编号
3. 仅使用原文信息，不编造"""

# 无 skill 时的角色正文；与 chat-rag skill / skill_config.DEFAULT_CHAT_PROMPT 保持语义一致
DEFAULT_CHAT_ROLE_PROMPT = """你是 Askme 助手。本轮用户消息提供任务所需语料。语气：专业、清晰、中文 Markdown。

按本轮用户消息中的任务形态作答：

【问答】用户对照日报概览提问，消息中含「检索片段」。回复要求：
  - 请详细、有据地回答
  - 具体引用与忠实度要求见下文硬性规则
  - 关键陈述后以内联编号标注出处（如 …[1][2]），风格类似 NotebookLM / Perplexity；禁止改成文末来源列表

【摘要】用户选定文章，消息中以 XML 提供「选定正文」，让你生成摘要。回复要求：
  - 紧扣正文，提炼关键事实、数据与结论；删去冗余背景与空话
  - 多篇若报道同一事件或主题，融合整理为连贯叙述，不要按文章逐篇复述
  - 仅使用原文信息，不编造
  - 关键陈述后以内联编号标注出处（如 …[1][2]），编号对应选定正文中的文章编号，风格同 NotebookLM / Perplexity；禁止改成文末来源列表"""

DEFAULT_ANSWER_SYSTEM_PROMPT = DEFAULT_CHAT_ROLE_PROMPT + "\n\n" + RAG_CITATION_RULES

SCOPED_SUMMARIZE_DEFAULT_QUESTION = "请对选定文章的正文生成精简摘要。"


def _xml_escape(text: str) -> str:
    return escape(text, quote=False)


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + "…"


def _prior_history(
    history: list[dict[str, str]],
    current_question: str,
    *,
    limit: int = HISTORY_TURN_LIMIT,
) -> list[dict[str, str]]:
    """去掉本轮用户原问题，只保留更早对话，避免证据消息与原问题重复。"""
    prior = list(history or [])
    if prior:
        last = prior[-1]
        if (
            last.get("role") == "user"
            and last.get("content", "").strip() == current_question.strip()
        ):
            prior = prior[:-1]
    if limit > 0:
        prior = prior[-limit:]
    return prior


def _compose_system_prompt(system_prompt: str, *, default: str, rules: str = "") -> str:
    """组装稳定 system：role/skill + 可选硬性规则。不含任何语料。"""
    skill = system_prompt.strip()
    if skill:
        return f"{skill}\n\n{rules}".strip() if rules else skill
    return default.strip()


def _format_chunk_blocks(chunks: list[RagChunk]) -> str:
    if not chunks:
        return "（无检索片段，请说明无法从原文论证）"
    blocks: list[str] = []
    for chunk in chunks:
        blocks.append(
            f"[{chunk.index}] 来源={chunk.feed_name} 标题={chunk.title} "
            f"时间={chunk.published_at} 链接={chunk.url}\n"
            f"{chunk.text}"
        )
    return "\n\n".join(blocks)


def build_evidence_user_content(
    *,
    summary: str,
    chunks: list[RagChunk],
    question: str,
) -> str:
    """本轮可变上下文：概览 + 检索片段 + 消解后的问题。"""
    return (
        f"【日报概览】\n{summary or '（暂无概览）'}\n\n"
        f"【检索片段 — 回答时必须用 [n] 引用】\n{_format_chunk_blocks(chunks)}\n\n"
        f"【问题】\n{question.strip()}"
    )


def build_scoped_articles_xml(articles: list[dict]) -> str:
    blocks: list[str] = []
    index = 0
    for article in articles:
        body = str(article.get("plain_text", "")).strip()
        if not body:
            continue
        index += 1
        body = _truncate(body, ARTICLE_CHAR_LIMIT)
        feed_name = _xml_escape(article.get("feed_name", ""))
        title = _xml_escape(article.get("title", ""))
        published = _xml_escape(_format_publish_time_display(article.get("published_at", "")))
        article_id = _xml_escape(article.get("id", ""))
        url = _xml_escape(article.get("url", ""))
        blocks.append(
            f'  <文章 编号="{index}" 来源="{feed_name}" 发布时间="{published}" '
            f'id="{article_id}" 链接="{url}">\n'
            f"    <标题>{title}</标题>\n"
            f"    <正文>{_xml_escape(body)}</正文>\n"
            f"  </文章>"
        )
    inner = "\n".join(blocks)
    return (
        f'<文章集合 范围="选定文章" 篇数="{len(blocks)}" 截断="false">\n'
        f"{inner}\n"
        f"</文章集合>"
    )


def build_scoped_evidence_user_content(*, articles: list[dict], question: str) -> str:
    return (
        f"【选定正文 — 摘要时须在句末用 [n] 内联引用】\n"
        f"{build_scoped_articles_xml(articles)}\n\n"
        f"【任务】\n{question.strip()}"
    )


def build_scoped_summarize_messages(
    articles: list[dict],
    history: list[dict[str, str]],
    *,
    question: str = "",
    original_question: str = "",
    system_prompt: str = "",
) -> list[dict[str, str]]:
    resolved = (question or SCOPED_SUMMARIZE_DEFAULT_QUESTION).strip()
    system = _compose_system_prompt(
        system_prompt,
        default=DEFAULT_CHAT_ROLE_PROMPT + "\n\n" + SCOPED_SUMMARIZE_CITATION_RULES,
        rules=SCOPED_SUMMARIZE_CITATION_RULES if system_prompt.strip() else "",
    )
    strip_q = (original_question or question or resolved).strip()
    prior = _prior_history(history, strip_q)
    evidence = build_scoped_evidence_user_content(articles=articles, question=resolved)
    return [
        {"role": "system", "content": system},
        *prior,
        {"role": "user", "content": evidence},
    ]


def articles_to_rag_chunks(articles: list[dict]) -> list[RagChunk]:
    chunks: list[RagChunk] = []
    for idx, article in enumerate(articles, start=1):
        text = str(article.get("plain_text", "")).strip()
        if not text:
            continue
        chunks.append(
            RagChunk(
                id=f"{article['feed_id']}:{article['id']}:0",
                index=idx,
                text=text,
                title=str(article.get("title", "")),
                feed_name=str(article.get("feed_name", "")),
                published_at=str(article.get("published_at", "")),
                url=str(article.get("url", "")),
                feed_id=article["feed_id"],
                article_id=article["id"],
                chunk_index=0,
                char_start=0,
                score=1.0,
            )
        )
    return chunks


async def run_scoped_article_summarize(
    *,
    question: str,
    articles: list[dict],
    history: list[dict[str, str]],
    llm_config: dict | None,
    enable_thinking: bool = False,
    chat_service: ChatService | None = None,
    system_prompt: str = "",
) -> AsyncIterator[str]:
    service = chat_service or ChatService()
    resolved_question = question.strip() or SCOPED_SUMMARIZE_DEFAULT_QUESTION

    yield sse_event(
        "status",
        {"phase": "loading_articles", "message": f"正在加载 {len(articles)} 篇选定文章…"},
    )

    chunks = articles_to_rag_chunks(articles)
    citation_items = [rag_chunk_to_citation(chunk) for chunk in chunks]
    yield sse_event("citations", {"items": citation_items})

    yield sse_event(
        "status",
        {"phase": "answering", "message": "正在生成摘要…"},
    )

    messages = build_scoped_summarize_messages(
        articles,
        history,
        question=resolved_question,
        original_question=question,
        system_prompt=system_prompt,
    )
    system_content = messages[0]["content"] if messages else ""
    evidence_content = messages[-1]["content"] if messages else ""
    yield sse_event(
        "prompt_preview",
        {
            "system": _prompt_preview_text(system_content, evidence_content),
            "evidence": evidence_content,
            "chunk_count": len(chunks),
            "history_turns": max(0, len(messages) - 2),
            "resolved_question": resolved_question,
        },
    )

    async for part in service.stream_answer(messages, llm_config, enable_thinking=enable_thinking):
        if part.kind == "thinking":
            yield sse_event("thinking", {"content": part.text})
        else:
            yield sse_event("token", {"content": part.text})


def build_answer_messages(
    system_prompt: str,
    summary: str,
    chunks: list[RagChunk],
    history: list[dict[str, str]],
    *,
    question: str,
    original_question: str = "",
) -> list[dict[str, str]]:
    """system 仅含角色/skill/规则；概览与片段进本轮 user。question 应为消解后的问题。"""
    system = _compose_system_prompt(
        system_prompt,
        default=DEFAULT_ANSWER_SYSTEM_PROMPT,
        rules=RAG_CITATION_RULES if system_prompt.strip() else "",
    )
    strip_q = (original_question or question).strip()
    prior = _prior_history(history, strip_q)
    evidence = build_evidence_user_content(
        summary=summary,
        chunks=chunks,
        question=question,
    )
    return [
        {"role": "system", "content": system},
        *prior,
        {"role": "user", "content": evidence},
    ]


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
        history: list[dict[str, str]] | None = None,
    ) -> QueryPlan:
        return await generate_queries(question, summary, titles, llm_config, history)

    async def retrieve(
        self,
        queries: list[str],
        cutoff_iso: str,
        feed_ids: list[str] | None,
        llm_config: dict | None,
        article_pairs: list[tuple[str, str]] | None = None,
    ) -> list[RagChunk]:
        return await self.rag.retrieve(
            queries,
            cutoff_iso,
            feed_ids,
            article_pairs=article_pairs,
            llm_config=llm_config,
        )

    def build_messages(
        self,
        system_prompt: str,
        summary: str,
        chunks: list[RagChunk],
        history: list[dict[str, str]],
        *,
        question: str,
        original_question: str = "",
    ) -> list[dict[str, str]]:
        return build_answer_messages(
            system_prompt,
            summary,
            chunks,
            history,
            question=question,
            original_question=original_question,
        )

    async def stream_answer(
        self,
        messages: list[dict[str, str]],
        llm_config: dict | None,
        *,
        enable_thinking: bool = False,
    ) -> AsyncIterator[LlmStreamPart]:
        async for part in stream_llm(messages, llm_config, enable_thinking=enable_thinking):
            yield part

    def count_chunks(
        self,
        cutoff_iso: str,
        feed_ids: list[str] | None,
        article_pairs: list[tuple[str, str]] | None = None,
    ) -> int:
        return self.rag.count_in_scope(cutoff_iso, feed_ids, article_pairs)


PHASE_MESSAGES = {
    "planning_queries": "正在分析问题…",
    "retrieving": "正在检索…",
    "answering": "正在回答…",
}


def _prompt_preview_text(system: str, evidence: str) -> str:
    return (
        f"{system.strip()}\n\n"
        f"----------\n"
        f"【本轮用户上下文 · 含数据源，不在 system】\n"
        f"{evidence.strip()}"
    )


async def run_rag_chat(
    *,
    question: str,
    summary: str,
    titles: list[str],
    system_prompt: str,
    history: list[dict[str, str]],
    cutoff_iso: str,
    feed_ids: list[str] | None,
    article_pairs: list[tuple[str, str]] | None = None,
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
    resolved_question = question
    if use_rag:
        plan = await service.plan_queries(question, summary, titles, llm_cfg, history)
        resolved_question = plan.resolved_question
        if plan.need_rag and plan.queries:
            yield sse_event(
                "status",
                {"phase": "retrieving", "message": PHASE_MESSAGES["retrieving"]},
            )
            chunks = await service.retrieve(
                plan.queries,
                cutoff_iso,
                feed_ids,
                llm_cfg,
                article_pairs=article_pairs,
            )
        elif plan.need_rag and not plan.queries:
            chunks = await service.retrieve(
                [resolved_question],
                cutoff_iso,
                feed_ids,
                llm_cfg,
                article_pairs=article_pairs,
            )

    citation_items = [rag_chunk_to_citation(chunk) for chunk in chunks]
    yield sse_event("citations", {"items": citation_items})

    yield sse_event(
        "status",
        {"phase": "answering", "message": PHASE_MESSAGES["answering"]},
    )

    messages = service.build_messages(
        system_prompt,
        summary,
        chunks,
        history,
        question=resolved_question,
        original_question=question,
    )
    system_content = messages[0]["content"] if messages else ""
    evidence_content = messages[-1]["content"] if messages else ""
    yield sse_event(
        "prompt_preview",
        {
            "system": _prompt_preview_text(system_content, evidence_content),
            "evidence": evidence_content,
            "chunk_count": len(chunks),
            "history_turns": max(0, len(messages) - 2),
            "resolved_question": resolved_question,
        },
    )

    async for part in service.stream_answer(messages, llm_cfg, enable_thinking=enable_thinking):
        if part.kind == "thinking":
            yield sse_event("thinking", {"content": part.text})
        else:
            yield sse_event("token", {"content": part.text})
