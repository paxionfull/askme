"""按分组与 digest skill 生成概览。"""

from __future__ import annotations

from typing import Any

from skill_runtime import get_digest_input_mode, get_digest_system_prompt
from feed_registry import UNGROUPED_GROUP_ID, feed_registry
from skill_config import get_default_digest_skill, get_fallback_digest_prompt


def resolve_digest_skill_for_group(group: dict[str, Any] | None) -> str:
    if group:
        skill_id = str(group.get("digest_skill_id") or "").strip()
        if skill_id:
            return skill_id
    return get_default_digest_skill()


def partition_articles_by_groups(
    articles: list[dict],
    *,
    selected_group_ids: list[str],
    groups: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    group_map = {str(group["id"]): group for group in groups}
    selected = set(selected_group_ids)
    partitions: list[dict[str, Any]] = []

    for group_id in selected_group_ids:
        if group_id == UNGROUPED_GROUP_ID:
            continue
        group = group_map.get(group_id)
        if not group:
            continue
        feed_ids = set(group.get("feed_ids") or [])
        group_articles = [article for article in articles if article.get("feed_id") in feed_ids]
        if not group_articles:
            continue
        partitions.append(
            {
                "group_id": group_id,
                "group_name": str(group.get("name") or group_id),
                "digest_skill_id": resolve_digest_skill_for_group(group),
                "articles": group_articles,
            }
        )

    if UNGROUPED_GROUP_ID in selected:
        assigned = {fid for group in groups for fid in (group.get("feed_ids") or [])}
        ungrouped = [article for article in articles if article.get("feed_id") not in assigned]
        if ungrouped:
            partitions.append(
                {
                    "group_id": UNGROUPED_GROUP_ID,
                    "group_name": "未分组",
                    "digest_skill_id": get_default_digest_skill(),
                    "articles": ungrouped,
                }
            )

    return partitions


def build_partition_context(
    article_service,
    articles: list[dict],
    *,
    days: int,
    input_mode: str = "full",
) -> tuple[str, bool]:
    if input_mode == "titles":
        return article_service._build_title_index_context(articles, days=days)
    return article_service._build_context(articles, days=days)


def build_summary_messages_for_partition(
    article_service,
    *,
    system_prompt: str,
    articles: list[dict],
    days: int,
    digest_skill_id: str | None = None,
) -> tuple[list[dict[str, str]], bool]:
    input_mode = get_digest_input_mode(digest_skill_id) if digest_skill_id else "full"
    context_text, truncated = build_partition_context(
        article_service,
        articles,
        days=days,
        input_mode=input_mode,
    )
    prompt = system_prompt.strip() or get_fallback_digest_prompt()
    return article_service.build_summary_messages(prompt, context_text), truncated


def build_article_refs(partitions: list[dict[str, Any]]) -> list[dict[str, str]]:
    refs: list[dict[str, str]] = []
    seen: set[str] = set()
    for partition in partitions:
        for article in partition.get("articles") or []:
            feed_id = str(article.get("feed_id") or "").strip()
            article_id = str(article.get("id") or "").strip()
            if not feed_id or not article_id:
                continue
            key = f"{feed_id}:{article_id}"
            if key in seen:
                continue
            seen.add(key)
            refs.append(
                {
                    "feed_id": feed_id,
                    "article_id": article_id,
                    "title": str(article.get("title") or ""),
                    "url": str(article.get("url") or ""),
                }
            )
    return refs


def stitch_summaries(sections: list[dict[str, Any]]) -> str:
    blocks: list[str] = []
    for section in sections:
        title = str(section.get("group_name") or "").strip()
        summary = str(section.get("summary") or "").strip()
        if not summary:
            continue
        blocks.append(f"## {title}\n\n{summary}")
    return "\n\n".join(blocks).strip()


def resolve_selected_feed_ids(
    selected_group_ids: list[str],
    groups: list[dict[str, Any]],
) -> list[str]:
    feed_ids: list[str] = []
    group_map = {str(group["id"]): group for group in groups}
    if UNGROUPED_GROUP_ID in selected_group_ids:
        assigned = {fid for group in groups for fid in (group.get("feed_ids") or [])}
        # ungrouped feeds resolved at article collection time via feed list
        del assigned
    for group_id in selected_group_ids:
        if group_id == UNGROUPED_GROUP_ID:
            continue
        group = group_map.get(group_id)
        if group:
            feed_ids.extend(group.get("feed_ids") or [])
    return sorted(set(feed_ids))


def get_system_prompt_for_skill(skill_id: str) -> str:
    return get_digest_system_prompt(skill_id)


async def resolve_feed_ids_for_groups(
    feed_client,
    group_ids: list[str],
) -> list[str]:
    groups = feed_registry.list_groups()
    all_feeds = await feed_client.list_feeds()
    assigned = {fid for group in groups for fid in (group.get("feed_ids") or [])}
    result: list[str] = []
    for group_id in group_ids:
        if group_id == UNGROUPED_GROUP_ID:
            result.extend(
                [
                    str(feed.get("id", ""))
                    for feed in all_feeds
                    if feed.get("id") and feed.get("id") not in assigned
                ]
            )
            continue
        group = next((item for item in groups if item.get("id") == group_id), None)
        if group:
            result.extend(str(fid) for fid in (group.get("feed_ids") or []))
    return sorted({fid for fid in result if fid})
