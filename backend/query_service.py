import json
import re

from llm import complete

QUERY_SYSTEM_PROMPT = """你是检索 query 生成器。根据用户问题、日报摘要和文章标题列表，生成用于向量检索的 query。

输出必须是 JSON，格式：
{"queries": ["query1", "query2"], "need_rag": true}

规则：
1. queries 1-3 条，中文关键词 + 实体 + 主题，适合语义检索
2. 默认 need_rag 为 true。仅当用户只问摘要本身的元信息（如「有几篇文章」）且摘要已直接包含答案时，才可设 need_rag 为 false
3. 涉及具体内容、细节、观点、比较、原因、推荐时，必须 need_rag=true 并生成 queries
4. 不要编造摘要和标题中不存在的主题
5. 只输出 JSON，不要 markdown"""


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


async def generate_queries(
    question: str,
    summary: str,
    titles: list[str],
    llm_config: dict | None = None,
) -> tuple[list[str], bool]:
    title_block = "\n".join(f"- {title}" for title in titles[:30]) or "（无）"
    user_content = f"""用户问题：
{question}

日报摘要：
{summary or "（暂无摘要）"}

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
        return [question], True

    need_rag = bool(parsed.get("need_rag", True))
    queries = parsed.get("queries") or []
    if isinstance(queries, str):
        queries = [queries]
    queries = [str(q).strip() for q in queries if str(q).strip()]

    if not need_rag:
        return [], False
    if not queries:
        return [question], True
    return queries[:3], True
