import json
import re
from dataclasses import dataclass

from llm import complete

QUERY_SYSTEM_PROMPT = """你是检索 query 生成器。根据本轮用户消息中的问题、近期对话、日报概览和文章标题列表，生成用于向量检索的 query。

输出必须是 JSON，格式：
{"resolved_question": "完整、可独立理解的问题", "queries": ["query1", "query2"], "need_rag": true}

规则：
1. resolved_question：若当前问题含指代（其/这/那/上面/刚才/该模型等）或省略主语，结合对话历史补全为独立问题；否则与当前问题相同
2. queries 1-3 条，必须围绕 resolved_question 的核心实体与主题，适合语义检索；禁止泛化 query（如仅「大模型对比」）
3. 默认 need_rag 为 true。仅当用户只问概览本身的元信息（如「有几篇文章」）且概览已直接包含答案时，才可设 need_rag 为 false
4. 涉及具体内容、细节、观点、比较、原因、推荐时，必须 need_rag=true 并生成 queries
5. 不要编造概览和标题中不存在的主题
6. 只输出 JSON，不要 markdown"""


@dataclass
class QueryPlan:
    queries: list[str]
    need_rag: bool
    resolved_question: str


def _extract_json(text: str) -> dict | None:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                return None
    return None


def _prior_history(history: list[dict[str, str]], current_question: str) -> list[dict[str, str]]:
    if not history:
        return []
    last = history[-1]
    if (
        last.get("role") == "user"
        and last.get("content", "").strip() == current_question.strip()
    ):
        return history[:-1]
    return history


def _format_history(history: list[dict[str, str]], limit: int = 6) -> str:
    if not history:
        return "（无）"
    lines: list[str] = []
    for msg in history[-limit:]:
        role = "用户" if msg.get("role") == "user" else "助手"
        content = str(msg.get("content") or "").strip()
        if content:
            lines.append(f"{role}：{content}")
    return "\n".join(lines) if lines else "（无）"


async def generate_queries(
    question: str,
    summary: str,
    titles: list[str],
    llm_config: dict | None = None,
    history: list[dict[str, str]] | None = None,
) -> QueryPlan:
    question = question.strip()
    prior = _prior_history(history or [], question)
    title_block = "\n".join(f"- {title}" for title in titles[:30]) or "（无）"
    user_content = f"""近期对话（供指代消解）：
{_format_history(prior)}

当前用户问题：
{question}

日报概览：
{summary or "（暂无概览）"}

文章标题列表：
{title_block}
"""

    raw = await complete(
        [
            {"role": "system", "content": QUERY_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        llm_config,
        temperature=0,
    )

    parsed = _extract_json(raw)
    if not parsed:
        return QueryPlan(queries=[question], need_rag=True, resolved_question=question)

    resolved = str(parsed.get("resolved_question") or question).strip() or question
    need_rag = bool(parsed.get("need_rag", True))
    queries = parsed.get("queries") or []
    if isinstance(queries, str):
        queries = [queries]
    queries = [str(q).strip() for q in queries if str(q).strip()]

    if not need_rag:
        return QueryPlan(queries=[], need_rag=False, resolved_question=resolved)
    if not queries:
        return QueryPlan(queries=[resolved], need_rag=True, resolved_question=resolved)
    return QueryPlan(queries=queries[:3], need_rag=True, resolved_question=resolved)
