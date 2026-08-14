"""结构化概览流水线：分类 → 类内聚类(+全局 focus 0/1) → 选头条 → 渲染。"""

from __future__ import annotations

import json
import re
from collections.abc import Awaitable, Callable
from typing import Any

from digest.digest_profile import (
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
                "published_at": str(article.get("published_at") or "").strip(),
            }
        )
    # 稳定顺序：新→旧，同时间按 id/title，保证同输入同顺序
    items.sort(
        key=lambda item: (
            -_published_sort_key(item.get("published_at") or ""),
            item["id"],
            item["title"],
        )
    )
    return [
        {"id": item["id"], "title": item["title"], "url": item["url"]}
        for item in items
    ]


def _published_sort_key(published_at: str) -> float:
    """把发布时间转成可比较数值；无法解析则 0。"""
    text = (published_at or "").strip()
    if not text:
        return 0.0
    try:
        from datetime import datetime

        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return dt.timestamp()
    except ValueError:
        return 0.0


def _cluster_fallback_payload(buckets: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "groups": [
            {
                "category_id": bucket["category_id"],
                "events": [
                    {"title": "", "article_ids": [item["id"]], "focus_score": 0}
                    for item in (bucket.get("articles") or [])
                ],
            }
            for bucket in buckets
        ]
    }


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
    from prompts import load_prompt

    labels = classification_labels(profile)
    system = load_prompt("digest_classify")
    user_payload = {
        "categories": labels,
        "articles": articles,
        "output_schema": {
            "assignments": [{"id": "feed::article", "category_id": "model"}]
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
    *,
    focus_enabled: bool,
    focus_criteria: str,
) -> list[dict[str, str]]:
    from prompts import load_prompt

    system = load_prompt("digest_cluster")
    event_schema: dict[str, Any] = {
        "title": "事件名",
        "article_ids": ["a", "b"],
    }
    if focus_enabled:
        system = f"{system}\n{load_prompt('digest_cluster_focus')}"
        event_schema["focus_score"] = 1

    user_payload: dict[str, Any] = {
        "groups": buckets,
        "output_schema": {
            "groups": [
                {
                    "category_id": "model",
                    "events": [event_schema, {"title": "", "article_ids": ["c"], "focus_score": 0}],
                }
            ]
        },
    }
    if focus_enabled:
        user_payload["focus"] = {
            "criteria": focus_criteria or "当日最值得关注的头条事件",
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
        mapped[ref_id] = {
            "id": ref_id,
            "category_id": category_id,
            "title": by_id[ref_id]["title"],
            "url": by_id[ref_id]["url"],
        }

    for item in articles:
        ref_id = item["id"]
        if ref_id not in mapped:
            mapped[ref_id] = {
                "id": ref_id,
                "category_id": OTHER_CATEGORY_ID,
                "title": item["title"],
                "url": item["url"],
            }
    return [mapped[item["id"]] for item in articles]


def _parse_focus_flag(value: Any) -> int:
    """只接受 0/1；其它数值一律视为 0。"""
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, (int, float)):
        return 1 if float(value) == 1.0 else 0
    text = str(value or "").strip().lower()
    if text in {"1", "true", "yes"}:
        return 1
    return 0


def _fallback_cluster_events(articles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {"title": "", "article_ids": [item["id"]], "focus_score": 0}
        for item in articles
    ]


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
                    "focus_score": _parse_focus_flag(event.get("focus_score")),
                }
            )

        if not valid or used != set(allowed.keys()):
            continue
        result[category_id] = events

    return result


def _event_key(event: dict[str, Any]) -> frozenset[str]:
    return frozenset(str(item) for item in (event.get("article_ids") or []) if str(item))


def _pick_global_focus_events(
    clustered: dict[str, list[dict[str, Any]]],
    *,
    ordered_category_ids: list[str],
    max_events: int,
    exclusive: bool,
) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    """取 focus_score=1 的事件作头条，按类别顺序截断到 max_events。"""
    focus_events: list[dict[str, Any]] = []
    for cat_id in ordered_category_ids:
        for event in clustered.get(cat_id) or []:
            if _parse_focus_flag(event.get("focus_score")) != 1:
                continue
            focus_events.append(event)
            if len(focus_events) >= max_events:
                break
        if len(focus_events) >= max_events:
            break

    if not exclusive:
        return focus_events, {
            cat_id: list(clustered.get(cat_id) or []) for cat_id in ordered_category_ids
        }

    promoted = {_event_key(event) for event in focus_events if _event_key(event)}
    category_events: dict[str, list[dict[str, Any]]] = {}
    for cat_id in ordered_category_ids:
        category_events[cat_id] = [
            event
            for event in clustered.get(cat_id) or []
            if _event_key(event) not in promoted
        ]
    return focus_events, category_events


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
    from digest.digest_profile import FOCUS_BUCKET_ID

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
    focus_cfg = profile.get("focus") or {}
    focus_enabled = bool(focus_cfg.get("enabled"))
    focus_criteria = str(focus_cfg.get("criteria") or "").strip()
    max_events = int(focus_cfg.get("max_events") or 10)
    exclusive = bool(focus_cfg.get("exclusive", True))
    cluster_enabled = bool((profile.get("cluster") or {}).get("enabled", True))

    await _maybe_status(on_status, "classify", f"正在分类（{len(payload)} 篇）…")
    from digest.digest_step_cache import (
        STEP_CLASSIFY,
        STEP_CLUSTER,
        fingerprint_digest_input,
        get_step,
        set_step,
    )
    from core.llm import complete_digest

    classify_fp = fingerprint_digest_input(profile, payload, step=STEP_CLASSIFY)
    cached_classify = get_step(classify_fp)
    if cached_classify is not None:
        classify_raw = cached_classify
    else:
        classify_raw = _extract_json_object(
            await complete_digest(
                _build_classify_messages(profile, payload),
                llm_config,
            )
        )
        set_step(classify_fp, STEP_CLASSIFY, classify_raw)

    assignments = _normalize_assignments(
        classify_raw,
        articles=payload,
        valid_category_ids=valid_ids,
    )

    visible = [row for row in assignments if row["category_id"] != IGNORED_CATEGORY_ID]

    by_category: dict[str, list[dict[str, Any]]] = {}
    for row in visible:
        by_category.setdefault(row["category_id"], []).append(row)

    ordered_category_ids = [str(item["id"]) for item in (profile.get("categories") or [])]
    ordered_category_ids.append(OTHER_CATEGORY_ID)
    name_by_id = {
        str(item["id"]): str(item["name"]) for item in (profile.get("categories") or [])
    }
    name_by_id[OTHER_CATEGORY_ID] = "其他"

    buckets: list[dict[str, Any]] = []
    for cat_id in ordered_category_ids:
        rows = by_category.get(cat_id) or []
        if not rows:
            continue
        # 桶内文章也保持稳定顺序
        rows_sorted = sorted(rows, key=lambda row: (row["id"], row["title"]))
        buckets.append(
            {
                "category_id": cat_id,
                "category_name": name_by_id.get(cat_id, cat_id),
                "articles": [
                    {"id": row["id"], "title": row["title"], "url": row["url"]}
                    for row in rows_sorted
                ],
            }
        )

    clustered: dict[str, list[dict[str, Any]]] = {
        bucket["category_id"]: _fallback_cluster_events(bucket["articles"])
        for bucket in buckets
    }

    if cluster_enabled and buckets:
        phase_msg = (
            f"正在类内聚类并标记头条（{len(buckets)} 组）…"
            if focus_enabled
            else f"正在类内聚类（{len(buckets)} 组）…"
        )
        await _maybe_status(on_status, "cluster", phase_msg)
        cluster_articles = [
            article
            for bucket in buckets
            for article in (bucket.get("articles") or [])
        ]
        cluster_fp = fingerprint_digest_input(
            profile,
            cluster_articles,
            step=STEP_CLUSTER,
            extra={
                "buckets": [
                    {
                        "category_id": bucket["category_id"],
                        "article_ids": [a["id"] for a in (bucket.get("articles") or [])],
                    }
                    for bucket in buckets
                ],
                "focus_enabled": focus_enabled,
                "focus_criteria": focus_criteria,
            },
        )
        cached_cluster = get_step(cluster_fp)
        if cached_cluster is not None:
            clustered = _normalize_cluster_groups(cached_cluster, buckets=buckets)
        else:
            cluster_raw: dict[str, Any] | None = None
            try:
                cluster_raw = _extract_json_object(
                    await complete_digest(
                        _build_cluster_messages(
                            buckets,
                            focus_enabled=focus_enabled,
                            focus_criteria=focus_criteria,
                        ),
                        llm_config,
                    )
                )
                clustered = _normalize_cluster_groups(cluster_raw, buckets=buckets)
            except Exception:
                cluster_raw = _cluster_fallback_payload(buckets)
                clustered = _normalize_cluster_groups(cluster_raw, buckets=buckets)
            # 成功或确定性 fallback 都写入缓存，保证同指纹下次一致
            set_step(cluster_fp, STEP_CLUSTER, cluster_raw)

    if focus_enabled:
        focus_events, category_events = _pick_global_focus_events(
            clustered,
            ordered_category_ids=ordered_category_ids,
            max_events=max_events,
            exclusive=exclusive,
        )
    else:
        focus_events = []
        category_events = {
            cat_id: clustered.get(cat_id) or [] for cat_id in ordered_category_ids
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
