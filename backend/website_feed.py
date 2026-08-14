from __future__ import annotations

import asyncio
from typing import Any

from html_utils import extract_article_html, html_to_text
from website_article_store import WebsiteArticleStore
from website_feed_adapter import WebsiteFeedAdapter


class WebsiteFeed:
    """单个网站源的通用逻辑：刷新、列表、详情、元数据。"""

    def __init__(
        self,
        adapter: WebsiteFeedAdapter,
        store: WebsiteArticleStore,
    ):
        self.adapter = adapter
        self.store = store
        self.feed_id = adapter.FEED_ID

    def normalize_body(self, raw_html: str, *, article_id: str = "") -> str:
        normalize = getattr(self.adapter, "normalize_article_body", None)
        if callable(normalize):
            return normalize(raw_html, article_id=article_id)
        return extract_article_html(raw_html)

    async def refresh_feed(self, **overrides: Any) -> dict[str, Any]:
        defaults = getattr(self.adapter, "REFRESH_DEFAULTS", {}) or {}
        max_pages = int(overrides.get("max_pages", defaults.get("max_pages", 3)))
        per = int(overrides.get("per", defaults.get("per", 20)))

        before_count = self.store.count_articles(self.feed_id)
        before_latest = self.store.latest_published_at(self.feed_id)
        seen: set[str] = set()

        for page in range(1, max_pages + 1):
            payload = await asyncio.to_thread(self.adapter.fetch_list_page, page, per)
            items = self.adapter.list_items(payload)
            if not items:
                break
            for item in items:
                normalized = self.adapter.normalize_list_item(item)
                article_id = normalized.get("id", "")
                if not article_id or article_id in seen:
                    continue
                seen.add(article_id)
                self.store.upsert_article(
                    self.feed_id,
                    article_id,
                    title=normalized.get("title", ""),
                    url=normalized.get("url", ""),
                    published_at=normalized.get("published_at", ""),
                    author=normalized.get("author", ""),
                    image=normalized.get("image", ""),
                    summary=normalized.get("summary", ""),
                )
            if not self.adapter.has_next_page(payload):
                break

        self.store.set_last_sync(self.feed_id)
        article_count = self.store.count_articles(self.feed_id)
        latest = self.store.latest_published_at(self.feed_id)
        new_count = max(article_count - before_count, 0)
        has_new_content = new_count > 0 or (latest and latest > before_latest)

        if has_new_content:
            message = f"已更新，新增 {new_count} 篇文章，共 {article_count} 篇"
        else:
            message = (
                f"刷新完成，未发现新文章（共 {article_count} 篇）。"
                "可能是该站点暂无更新。"
            )

        return {
            "ok": True,
            "article_count": article_count,
            "new_article_count": new_count,
            "has_new_content": has_new_content,
            "fetching_history": False,
            "message": message,
        }

    def get_articles(self, limit: int = 20) -> list[dict]:
        rows = self.store.list_articles(self.feed_id, limit=limit)
        return [
            {
                "id": row["article_id"],
                "title": row["title"],
                "url": row["url"],
                "content_html": "",
                "image": row["image"],
                "published_at": row["published_at"],
                "author": row["author"],
            }
            for row in rows
        ]

    async def fetch_article_detail_normalized(self, article_id: str) -> dict[str, Any]:
        detail = await asyncio.to_thread(self.adapter.fetch_article_detail, article_id)
        raw_html = detail.get("content_html", "") or ""
        content_html = self.normalize_body(raw_html, article_id=article_id)
        plain_text = html_to_text(content_html or raw_html)
        return {
            "id": detail.get("id", article_id),
            "title": detail.get("title", ""),
            "url": detail.get("url", ""),
            "content_html": content_html,
            "plain_text": plain_text,
            "image": detail.get("image", ""),
            "published_at": detail.get("published_at", ""),
            "author": detail.get("author", ""),
        }

    async def get_article_content(self, article_id: str) -> dict:
        detail = await self.fetch_article_detail_normalized(article_id)
        return {
            "id": detail["id"],
            "title": detail["title"],
            "url": detail["url"],
            "content_html": detail["content_html"],
            "image": detail["image"],
            "published_at": detail["published_at"],
            "author": detail["author"],
        }

    def get_feed_meta(self) -> dict:
        sync_at = self.store.get_last_sync(self.feed_id)
        return {
            **self.adapter.FEED_META,
            "syncTime": int(sync_at) if sync_at else None,
        }
