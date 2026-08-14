"""批量拉正文时 backend 传入的列表元数据 hints。

discover.fetch_article_detail(article_id, **hints) 应优先使用 hints 中的 url/title 等，
避免为查元数据重复拉列表或线性扫描整表。
"""

from __future__ import annotations

HINT_KEYS = ("url", "title", "published_at", "author", "image", "summary")


def pick_hints(**kwargs: object) -> dict[str, str]:
    """从 fetch_article_detail 的 **hints 提取非空字符串字段。"""
    out: dict[str, str] = {}
    for key in HINT_KEYS:
        value = str(kwargs.get(key) or "").strip()
        if value:
            out[key] = value
    return out


def pick_hints_from_mapping(mapping: dict | None) -> dict[str, str]:
    if not mapping:
        return {}
    return pick_hints(**mapping)


def resolve_detail_url(article_id: str, **hints: object) -> str:
    """批量拉正文时优先使用 hints 中的 url；无则返回空字符串供 skill 走 fallback。"""
    _ = article_id
    return pick_hints(**hints).get("url", "")


def hints_from_list_item(item: dict) -> dict[str, str]:
    """从 normalize_list_item 结果构造 fetch_article_detail 的 hints。"""
    return pick_hints_from_mapping(item)
