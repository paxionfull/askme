from __future__ import annotations

from typing import Any, Protocol


class WebsiteFeedAdapter(Protocol):
    """各 skill/scripts/discover.py 需实现的适配器接口。"""

    FEED_ID: str
    FEED_META: dict[str, Any]
    REFRESH_DEFAULTS: dict[str, Any]

    def fetch_list_page(self, page: int, per: int) -> dict[str, Any]: ...

    def list_items(self, payload: dict[str, Any]) -> list[dict[str, Any]]: ...

    def has_next_page(self, payload: dict[str, Any]) -> bool: ...

    def normalize_list_item(self, item: dict[str, Any]) -> dict[str, Any]: ...

    def fetch_article_detail(self, article_id: str, **hints: Any) -> dict[str, Any]: ...

    # 可选：站点特定的 HTML 正文清洗；缺省时 backend 使用 html_utils.extract_article_html
    # def normalize_article_body(self, raw_html: str, *, article_id: str = "") -> str: ...
