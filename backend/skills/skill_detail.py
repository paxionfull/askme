"""调用 discovery skill 的 fetch_article_detail，并传入列表元数据 hints。"""

from __future__ import annotations

import inspect
from typing import Any

_HINT_KEYS = ("url", "title", "published_at", "author", "image", "summary")


def _pick_hints_from_mapping(mapping: dict[str, Any] | None) -> dict[str, str]:
    if not mapping:
        return {}
    out: dict[str, str] = {}
    for key in _HINT_KEYS:
        value = str(mapping.get(key) or "").strip()
        if value:
            out[key] = value
    return out


def call_fetch_article_detail(
    adapter: Any,
    article_id: str,
    hints: dict[str, Any] | None = None,
) -> dict[str, Any]:
    fn = adapter.fetch_article_detail
    cleaned = _pick_hints_from_mapping(hints)
    if not cleaned:
        return fn(article_id)
    try:
        params = inspect.signature(fn).parameters
        if any(p.kind == inspect.Parameter.VAR_KEYWORD for p in params.values()):
            return fn(article_id, **cleaned)
    except (TypeError, ValueError):
        pass
    return fn(article_id)
