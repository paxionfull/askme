"""结构化概览流水线：分类(+is_focus) → 拎出重点 → 类内聚类 → 渲染。"""

from __future__ import annotations

import json
import re
from collections.abc import Awaitable, Callable
from typing import Any

from digest_profile import (
    FOCUS_BUCKET_ID,
    IGNORED_CATEGORY_ID,
    OTHER_CATEGORY_ID,
    article_ref_id,
    classification_labels,
    normalize_profile,
    split_article_ref_id,
)
# Lazy import inside functions that need LLM to keep module importable without litellm.

StatusCallback = Callable[[str, str], Awaitable[None] | None]

_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.I)


def _extract_json_object(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    if not raw:
        raise ValueError("模型返回为空")
    fence = _JSON_FENCE_RE.search(raw)
    if fence:
        raw = fence.group(1).strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")
        if start < 0 or end <= start:
            raise ValueError(f"无法解析 JSON: {raw[:200]}")
        data = json.loads(raw[start : end + 1])
    if not isinstance(data, dict):
        raise ValueError("JSON 根节点必须是对象")
    return data


def _articles_payload(articles: list[dict[str, Any]]) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for article in articles:
        feed_id = str(article.get("feed_id") or "").strip()
        article_id = str(article.get("id") or "").strip()
        title = str(article.get("title") or "").strip()
        if not feed_id or not article_id or not title:
            continue
        items.append(
            {
                "id": article_ref_id(feed_id, article_id),
                "title": title,
                "url": str(article.get("url") or "").strip(),
            }
        )
    return items


def _index_by_ref(articles: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for article in articles:
        feed_id = str(article.get("feed_id") or "").strip()
        article_id = str(article.get("id") or "").strip()
        if not feed_id or not article_id:
            continue
        out[article_ref_id(feed_id, article_id)] = article
    return out


async def _maybe_status(on_status: StatusCallback | None, phase: str, message: str) -> None:
    if not on_status:
        return
    result = on_status(phase, message)
    if result is not None:
        await result


def _build_classify_messages(
    profile: dict[str, Any],
    articles: list[dict[str, str]],
) -> list[dict[str, str]]:
    labels = classification_labels(profile)
    focus = profile.get("focus") or {}
    focus_enabled = bool(focus.get("enabled"))
    focus_criteria = str(focus.get("criteria") or "").strip()
    system = (
        "你是资讯目录分类器。只根据标题把每篇文章分到一个类别，并判断是否重点关注。\n"
        "必须只输出一个 JSON 对象，不要 Markdown 说明。\n"
        "规则：\n"
        "1. 每个输入 id 恰好出现一次\n"
        "2. category_id 必须来自给定类别列表\n"
        "3. 不要合并事件、不要改写标题、不要丢文\n"
        "4. is_focus 仅在重点关注启用时有意义；未启用时一律 false\n"
        "5. 标为不重要(ignored)的文章 is_focus 必须为 false\n"
    )
    user_payload = {
        "categories": labels,
        "focus": {
            "enabled": focus_enabled,
            "criteria": focus_criteria,
        },
        "articles": articles,
        "output_schema": {
            "assignments": [
                {"id": "feed::article", "category_id": "model", "is_focus": False}
            ]
        },
    }
    return [
        {"role": "system", "content": system},
        {
            "role": "user",
            "content": json.dumps(user_payload, ensure_ascii=False),
        },
    ]


def _build_cluster_messages(
    buckets: list[dict[str, Any]],
) -> list[dict[str, str]]:
    system = (
        "你是资讯事件聚类器。在每个类别内部，把报道同一新闻事件的文章合并为一组。\n"
        "必须只输出一个 JSON 对象，不要 Markdown 说明。\n"
        "规则：\n"
        "1. 每个类别独立聚类，禁止跨类合并\n"
        "2. 该类输入的每个 id 必须恰好出现在该类某一个 event.article_ids 中一次\n"
        "3. 单篇文章也要放进 events（article_ids 长度为 1，title 可空字符串）\n"
        "4. 多篇同事件时 title 为 5-15 字事件名；不要改写各条原标题\n"
        "5. 不要虚构 id\n"
    )
    user_payload = {
        "groups": buckets,
        "output_schema": {
            "groups": [
                {
                    "category_id": "model",
                    "events": [
                        {"title": "事件名", "article_ids": ["a", "b"]},
                        {"title": "", "article_ids": ["c"]},
                    ],
                }
            ]
        },
    }
    return [
        {"role": "system", "content": system},
        {
            "role": "user",
            "content": json.dumps(user_payload, ensure_ascii=False),
        },
    ]


def _normalize_assignments(
    raw: dict[str, Any],
    *,
    articles: list[dict[str, str]],
    valid_category_ids: set[str],
    focus_enabled: bool,
) -> list[dict[str, Any]]:
    by_id = {item["id"]: item for item in articles}
    rows = raw.get("assignments")
    if not isinstance(rows, list):
        rows = []

    mapped: dict[str, dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        ref_id = str(row.get("id") or "").strip()
        if ref_id not in by_id:
            continue
        category_id = str(row.get("category_id") or "").strip()
        if category_id not in valid_category_ids:
            category_id = OTHER_CATEGORY_ID
        is_focus = bool(row.get("is_focus")) and focus_enabled
        if category_id == IGNORED_CATEGORY_ID:
            is_focus = False
        mapped[ref_id] = {
            "id": ref_id,
            "category_id": category_id,
            "is_focus": is_focus,
            "title": by_id[ref_id]["title"],
            "url": by_id[ref_id]["url"],
        }

    for item in articles:
        ref_id = item["id"]
        if ref_id not in mapped:
            mapped[ref_id] = {
                "id": ref_id,
                "category_id": OTHER_CATEGORY_ID,
                "is_focus": False,
                "title": item["title"],
                "url": item["url"],
            }
    return [mapped[item["id"]] for item in articles]


def _fallback_cluster_events(articles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{"title": "", "article_ids": [item["id"]]} for item in articles]


def _normalize_cluster_groups(
    raw: dict[str, Any],
    *,
    buckets: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    expected = {
        str(bucket["category_id"]): {
            item["id"]: item for item in bucket.get("articles") or []
        }
        for bucket in buckets
    }
    result: dict[str, list[dict[str, Any]]] = {
        category_id: _fallback_cluster_events(list(items.values()))
        for category_id, items in expected.items()
    }

    groups = raw.get("groups")
    if not isinstance(groups, list):
        return result

    for group in groups:
        if not isinstance(group, dict):
            continue
        category_id = str(group.get("category_id") or "").strip()
        if category_id not in expected:
            continue
        allowed = expected[category_id]
        events_raw = group.get("events")
        if not isinstance(events_raw, list):
            continue

        used: set[str] = set()
        events: list[dict[str, Any]] = []
        valid = True
        for event in events_raw:
            if not isinstance(event, dict):
                valid = False
                break
            ids_raw = event.get("article_ids")
            if not isinstance(ids_raw, list) or not ids_raw:
                valid = False
                break
            article_ids: list[str] = []
            for value in ids_raw:
                ref_id = str(value or "").strip()
                if ref_id not in allowed or ref_id in used:
                    valid = False
                    break
                used.add(ref_id)
                article_ids.append(ref_id)
            if not valid:
                break
            events.append(
                {
                    "title": str(event.get("title") or "").strip(),
                    "article_ids": article_ids,
                }
            )

        if not valid or used != set(allowed.keys()):
            continue
        result[category_id] = events

    return result


def _md_link(title: str, url: str) -> str:
    safe_title = (title or "").replace("[", "\\[").replace("]", "\\]")
    if url:
        return f"- [{safe_title}]({url})"
    return f"- {safe_title}"


def _render_events(
    events: list[dict[str, Any]],
    *,
    by_ref: dict[str, dict[str, Any]],
) -> list[str]:
    lines: list[str] = []
    for event in events:
        ids = [str(item) for item in (event.get("article_ids") or []) if str(item)]
        if not ids:
            continue
        if len(ids) == 1:
            article = by_ref.get(ids[0]) or {}
            lines.append(
                _md_link(
                    str(article.get("title") or ids[0]),
                    str(article.get("url") or ""),
                )
            )
            continue
        event_title = str(event.get("title") or "").strip() or "相关报道"
        lines.append(f"- **{event_title}（{len(ids)} 篇）**")
        for ref_id in ids:
            article = by_ref.get(ref_id) or {}
            title = str(article.get("title") or ref_id)
            url = str(article.get("url") or "")
            safe_title = title.replace("[", "\\[").replace("]", "\\]")
            if url:
                lines.append(f"  - [{safe_title}]({url})")
            else:
                lines.append(f"  - {safe_title}")
    return lines


def _events_to_tree(
    events: list[dict[str, Any]],
    *,
    by_ref: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for event in events:
        ids = [str(item) for item in (event.get("article_ids") or []) if str(item)]
        if not ids:
            continue
        articles: list[dict[str, str]] = []
        for ref_id in ids:
            article = by_ref.get(ref_id) or {}
            feed_id, article_id = split_article_ref_id(ref_id)
            articles.append(
                {
                    "feed_id": feed_id,
                    "article_id": article_id,
                    "title": str(article.get("title") or article_id or ref_id),
                    "url": str(article.get("url") or ""),
                }
            )
        if not articles:
            continue
        title = str(event.get("title") or "").strip()
        if len(articles) == 1:
            title = ""
        out.append({"title": title, "articles": articles})
    return out


def build_digest_tree(
    profile: dict[str, Any],
    *,
    focus_events: list[dict[str, Any]],
    category_events: dict[str, list[dict[str, Any]]],
    by_ref: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """结构化概览树，供前端直接渲染。"""
    sections: list[dict[str, Any]] = []
    focus = profile.get("focus") or {}
    if focus.get("enabled"):
        sections.append(
            {
                "id": FOCUS_BUCKET_ID,
                "name": "重点关注",
                "kind": "focus",
                "events": _events_to_tree(focus_events, by_ref=by_ref),
            }
        )

    for category in profile.get("categories") or []:
        cat_id = str(category["id"])
        sections.append(
            {
                "id": cat_id,
                "name": str(category["name"]),
                "kind": "category",
                "events": _events_to_tree(
                    category_events.get(cat_id) or [],
                    by_ref=by_ref,
                ),
            }
        )

    sections.append(
        {
            "id": OTHER_CATEGORY_ID,
            "name": "其他",
            "kind": "other",
            "events": _events_to_tree(
                category_events.get(OTHER_CATEGORY_ID) or [],
                by_ref=by_ref,
            ),
        }
    )
    return {"version": 1, "sections": sections}


def render_digest_markdown(
    profile: dict[str, Any],
    *,
    focus_events: list[dict[str, Any]],
    category_events: dict[str, list[dict[str, Any]]],
    by_ref: dict[str, dict[str, Any]],
) -> str:
    blocks: list[str] = []
    focus = profile.get("focus") or {}
    if focus.get("enabled"):
        blocks.append("### 重点关注")
        focus_lines = _render_events(focus_events, by_ref=by_ref)
        if focus_lines:
            blocks.extend(focus_lines)
        blocks.append("")

    for category in profile.get("categories") or []:
        cat_id = str(category["id"])
        blocks.append(f"### {category['name']}")
        lines = _render_events(category_events.get(cat_id) or [], by_ref=by_ref)
        if lines:
            blocks.extend(lines)
        blocks.append("")

    blocks.append("### 其他")
    other_lines = _render_events(category_events.get(OTHER_CATEGORY_ID) or [], by_ref=by_ref)
    if other_lines:
        blocks.extend(other_lines)

    # 紧凑列表：去掉多余空行但保留章节间距
    text = "\n".join(blocks).strip()
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text


async def generate_structured_digest(
    articles: list[dict[str, Any]],
    profile: dict[str, Any],
    *,
    llm_config: dict[str, Any] | None = None,
    on_status: StatusCallback | None = None,
) -> tuple[str, dict[str, Any]]:
    profile = normalize_profile(profile)
    payload = _articles_payload(articles)
    by_ref = {
        item["id"]: {"title": item["title"], "url": item["url"]} for item in payload
    }
    if not payload:
        empty_tree = build_digest_tree(
            profile,
            focus_events=[],
            category_events={},
            by_ref={},
        )
        return render_digest_markdown(
            profile,
            focus_events=[],
            category_events={},
            by_ref={},
        ), empty_tree

    labels = classification_labels(profile)
    valid_ids = {item["id"] for item in labels}
    focus_enabled = bool((profile.get("focus") or {}).get("enabled"))
    max_events = int((profile.get("focus") or {}).get("max_events") or 10)
    exclusive = bool((profile.get("focus") or {}).get("exclusive", True))
    cluster_enabled = bool((profile.get("cluster") or {}).get("enabled", True))

    await _maybe_status(on_status, "classify", f"正在分类（{len(payload)} 篇）…")
    from llm import LLMError, complete

    classify_raw = _extract_json_object(
        await complete(
            _build_classify_messages(profile, payload),
            llm_config,
            temperature=0,
        )
    )
    assignments = _normalize_assignments(
        classify_raw,
        articles=payload,
        valid_category_ids=valid_ids,
        focus_enabled=focus_enabled,
    )

    visible = [row for row in assignments if row["category_id"] != IGNORED_CATEGORY_ID]
    focus_articles = [row for row in visible if row.get("is_focus")]
    if exclusive:
        focus_ids = {row["id"] for row in focus_articles}
        category_articles = [row for row in visible if row["id"] not in focus_ids]
    else:
        category_articles = list(visible)

    # 组装聚类桶：重点单独一类 + 各展示类
    buckets: list[dict[str, Any]] = []
    if focus_enabled and focus_articles:
        buckets.append(
            {
                "category_id": FOCUS_BUCKET_ID,
                "category_name": "重点关注",
                "articles": [
                    {"id": row["id"], "title": row["title"], "url": row["url"]}
                    for row in focus_articles
                ],
            }
        )

    by_category: dict[str, list[dict[str, Any]]] = {}
    for row in category_articles:
        by_category.setdefault(row["category_id"], []).append(row)

    ordered_category_ids = [str(item["id"]) for item in (profile.get("categories") or [])]
    ordered_category_ids.append(OTHER_CATEGORY_ID)
    name_by_id = {
        str(item["id"]): str(item["name"]) for item in (profile.get("categories") or [])
    }
    name_by_id[OTHER_CATEGORY_ID] = "其他"

    for cat_id in ordered_category_ids:
        rows = by_category.get(cat_id) or []
        if not rows:
            continue
        buckets.append(
            {
                "category_id": cat_id,
                "category_name": name_by_id.get(cat_id, cat_id),
                "articles": [
                    {"id": row["id"], "title": row["title"], "url": row["url"]}
                    for row in rows
                ],
            }
        )

    clustered: dict[str, list[dict[str, Any]]] = {
        bucket["category_id"]: _fallback_cluster_events(bucket["articles"])
        for bucket in buckets
    }

    if cluster_enabled and buckets:
        await _maybe_status(on_status, "cluster", f"正在类内聚类（{len(buckets)} 组）…")
        try:
            cluster_raw = _extract_json_object(
                await complete(
                    _build_cluster_messages(buckets),
                    llm_config,
                    temperature=0,
                )
            )
            clustered = _normalize_cluster_groups(cluster_raw, buckets=buckets)
        except Exception:
            # 降级：全部单条（含 LLMError / 解析失败）
            pass

    focus_events = clustered.get(FOCUS_BUCKET_ID) or []
    if focus_enabled and focus_events and len(focus_events) > max_events:
        # 保序截断
        focus_events = focus_events[:max_events]

    category_events = {
        cat_id: clustered.get(cat_id) or []
        for cat_id in ordered_category_ids
    }

    await _maybe_status(on_status, "render", "正在渲染概览…")
    tree = build_digest_tree(
        profile,
        focus_events=focus_events,
        category_events=category_events,
        by_ref=by_ref,
    )
    markdown = render_digest_markdown(
        profile,
        focus_events=focus_events,
        category_events=category_events,
        by_ref=by_ref,
    )
    return markdown, tree
