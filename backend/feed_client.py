from __future__ import annotations

from typing import Any

from article_body_store import ArticleBodyStore
from feed_errors import FeedError
from feed_registry import feed_registry
from skill_registry import load_skill_adapters, reload_skill_adapters
from website_article_store import WebsiteArticleStore
from website_feed import WebsiteFeed


class FeedClient:
    """统一网站数据源：通用逻辑在此，站点差异由各 skill 适配器提供。"""

    def __init__(
        self,
        store: WebsiteArticleStore | None = None,
        body_store: ArticleBodyStore | None = None,
        feeds: dict[str, WebsiteFeed] | None = None,
    ):
        self.store = store or WebsiteArticleStore()
        self.body_store = body_store or ArticleBodyStore()
        if feeds is not None:
            self._feeds = feeds
        else:
            self._feeds = {
                adapter.FEED_ID: WebsiteFeed(adapter, self.store)
                for adapter in load_skill_adapters()
            }

    def reload_skills(self) -> int:
        self._feeds = {
            adapter.FEED_ID: WebsiteFeed(adapter, self.store)
            for adapter in reload_skill_adapters()
        }
        return len(self._feeds)

    def _get_feed(self, feed_id: str, *, allow_hidden: bool = False) -> WebsiteFeed:
        if not allow_hidden and feed_registry.is_hidden(feed_id):
            raise FeedError(f"数据源已移除: {feed_id}", status_code=404)
        feed = self._feeds.get(feed_id)
        if feed is None:
            raise FeedError(f"未知数据源: {feed_id}", status_code=404)
        return feed

    def hide_feed(self, feed_id: str) -> None:
        if feed_id not in self._feeds:
            raise FeedError(f"未知数据源: {feed_id}", status_code=404)
        feed_registry.hide_feed(feed_id)

    def ensure_feed_visible(self, feed_id: str) -> None:
        """重新接入后恢复可见性，并确保 skill 已装载。"""
        if feed_registry.is_hidden(feed_id):
            feed_registry.unhide_feed(feed_id)
        if feed_id not in self._feeds:
            self.reload_skills()
        if feed_id not in self._feeds:
            raise FeedError(f"skill 未装载: {feed_id}", status_code=404)

    def rename_feed(self, feed_id: str, name: str) -> str:
        if feed_id not in self._feeds:
            raise FeedError(f"未知数据源: {feed_id}", status_code=404)
        return feed_registry.set_feed_display_name(feed_id, name)

    def list_groups(self) -> list[dict[str, Any]]:
        return feed_registry.list_groups()

    def list_group_order(self) -> list[str]:
        return feed_registry.list_group_order()

    def set_groups(self, groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
        groups_result, _ = self.set_layout(groups, feed_registry.list_group_order())
        return groups_result

    def set_layout(
        self,
        groups: list[dict[str, Any]],
        group_order: list[str] | None = None,
    ) -> tuple[list[dict[str, Any]], list[str]]:
        visible_ids = set(self._feeds.keys()) - feed_registry.hidden_feed_ids
        cleaned = [
            {
                "id": str(group.get("id", "")).strip(),
                "name": str(group.get("name", "")).strip(),
                "feed_ids": [
                    fid
                    for fid in (group.get("feed_ids") or [])
                    if fid in visible_ids
                ],
                "digest_skill_id": str(group.get("digest_skill_id") or "").strip() or None,
            }
            for group in groups
            if str(group.get("name", "")).strip()
        ]
        return feed_registry.set_layout(cleaned, group_order)

    async def list_feeds(self) -> list[dict]:
        feeds: list[dict] = []
        for feed in self._feeds.values():
            meta = feed.get_feed_meta()
            feed_id = meta.get("id", "")
            if feed_id and feed_registry.is_hidden(feed_id):
                continue
            group_id = feed_registry.group_id_for_feed(feed_id)
            if group_id:
                meta = {**meta, "groupId": group_id}
            display_name = feed_registry.display_name_for_feed(feed_id)
            if display_name:
                meta = {**meta, "mpName": display_name}
            feeds.append(meta)
        return feeds

    def invalidate_article_cache(
        self,
        feed_id: str | None = None,
        article_ids: list[str] | None = None,
    ) -> None:
        if feed_id is None:
            return
        if article_ids:
            for article_id in article_ids:
                self.body_store.delete(feed_id, article_id)
            return
        self.body_store.delete_feed(feed_id)

    async def refresh_feed(self, feed_id: str, *, days: int = 1) -> dict[str, Any]:
        try:
            return await self._get_feed(feed_id).refresh_feed(days=days)
        except Exception as exc:
            if isinstance(exc, FeedError):
                raise
            raise FeedError(str(exc) or "刷新失败") from exc

    async def get_articles(
        self,
        feed_id: str,
        limit: int | None = None,
        refresh: bool = False,
        fresh: bool = False,
        include_content: bool = False,
        *,
        days: int = 1,
    ) -> list[dict]:
        if refresh:
            await self.refresh_feed(feed_id, days=days)
        articles = self._get_feed(feed_id).get_articles(limit=limit)
        enriched: list[dict] = []
        for article in articles:
            article_id = article.get("id", "")
            body = self.body_store.get(feed_id, article_id) if article_id else None
            has_body = bool(body and body.get("plain_text", "").strip())
            item = {**article, "has_body": has_body}
            if include_content and has_body and body:
                item["content_html"] = body.get("content_html", "")
                item["plain_text"] = body.get("plain_text", "")
            enriched.append(item)
        return enriched

    async def fetch_article_detail(
        self,
        feed_id: str,
        article_id: str,
        *,
        hints: dict | None = None,
    ) -> dict[str, Any]:
        try:
            return await self._get_feed(feed_id).fetch_article_detail_normalized(
                article_id,
                hints=hints,
            )
        except Exception as exc:
            if isinstance(exc, FeedError):
                raise
            raise FeedError(str(exc) or "获取正文失败") from exc

    async def get_article_content(self, feed_id: str, article_id: str) -> dict:
        detail = await self.fetch_article_detail(feed_id, article_id)
        return {
            "id": detail["id"],
            "title": detail["title"],
            "url": detail["url"],
            "content_html": detail["content_html"],
            "body_status": detail.get("body_status", "ok"),
            "body_detail": detail.get("body_detail", ""),
            "image": detail.get("image", ""),
            "published_at": detail.get("published_at", ""),
            "author": detail.get("author", ""),
        }

    async def fetch_article_body(self, feed_id: str, article_id: str) -> str:
        detail = await self.fetch_article_detail(feed_id, article_id)
        return detail.get("content_html", "")

    async def fetch_and_persist_body(
        self,
        feed_id: str,
        article_id: str,
        *,
        title: str = "",
        url: str = "",
        published_at: str = "",
        feed_name: str = "",
        hints: dict | None = None,
    ) -> dict[str, Any]:
        merged_hints = dict(hints or {})
        if url and not merged_hints.get("url"):
            merged_hints["url"] = url
        if title and not merged_hints.get("title"):
            merged_hints["title"] = title
        if published_at and not merged_hints.get("published_at"):
            merged_hints["published_at"] = published_at
        detail = await self.fetch_article_detail(feed_id, article_id, hints=merged_hints)
        content_html = detail.get("content_html", "")
        plain_text = detail.get("plain_text", "")
        if plain_text.strip():
            self.body_store.save(
                feed_id,
                article_id,
                content_html=content_html,
                plain_text=plain_text,
                body_status=detail.get("body_status", "ok"),
                body_detail=detail.get("body_detail", ""),
                title=title or detail.get("title", ""),
                url=url or detail.get("url", ""),
                published_at=published_at or detail.get("published_at", ""),
                feed_name=feed_name,
            )
        else:
            self.body_store.save(
                feed_id,
                article_id,
                content_html=content_html,
                plain_text=plain_text,
                body_status=detail.get("body_status", "parse_failed"),
                body_detail=detail.get("body_detail", ""),
                title=title or detail.get("title", ""),
                url=url or detail.get("url", ""),
                published_at=published_at or detail.get("published_at", ""),
                feed_name=feed_name,
            )
        return detail

    def get_cached_body(self, feed_id: str, article_id: str) -> dict[str, Any] | None:
        stored = self.body_store.get(feed_id, article_id)
        if not stored or not stored.get("plain_text", "").strip():
            return None
        feed = self._feeds.get(feed_id)
        raw_html = stored.get("content_html", "")
        content_html = feed.normalize_body(raw_html, article_id=article_id) if feed else raw_html
        return {
            "id": article_id,
            "feed_id": feed_id,
            "title": stored.get("title", ""),
            "url": stored.get("url", ""),
            "published_at": stored.get("published_at", ""),
            "feed_name": stored.get("feed_name", ""),
            "content_html": content_html,
            "plain_text": stored.get("plain_text", ""),
            "body_status": stored.get("body_status", "ok"),
            "body_detail": stored.get("body_detail", ""),
        }

    async def get_or_fetch_body(
        self,
        feed_id: str,
        article_id: str,
        *,
        fetch: bool = True,
        title: str = "",
        url: str = "",
        published_at: str = "",
        feed_name: str = "",
    ) -> dict[str, Any] | None:
        cached = self.get_cached_body(feed_id, article_id)
        if cached:
            return cached
        if not fetch:
            stored = self.body_store.get(feed_id, article_id)
            if not stored:
                return None
            status = stored.get("body_status", "")
            if status and status != "ok":
                return {
                    "id": article_id,
                    "feed_id": feed_id,
                    "title": stored.get("title", title),
                    "url": stored.get("url", url),
                    "published_at": stored.get("published_at", published_at),
                    "feed_name": stored.get("feed_name", feed_name),
                    "content_html": stored.get("content_html", ""),
                    "plain_text": stored.get("plain_text", ""),
                    "body_status": status,
                    "body_detail": stored.get("body_detail", ""),
                }
            return None
        detail = await self.fetch_and_persist_body(
            feed_id,
            article_id,
            title=title,
            url=url,
            published_at=published_at,
            feed_name=feed_name,
        )
        if not detail.get("plain_text", "").strip():
            return {
                "id": article_id,
                "feed_id": feed_id,
                "title": title or detail.get("title", ""),
                "url": url or detail.get("url", ""),
                "published_at": published_at or detail.get("published_at", ""),
                "feed_name": feed_name,
                "content_html": detail.get("content_html", ""),
                "plain_text": detail.get("plain_text", ""),
                "body_status": detail.get("body_status", "parse_failed"),
                "body_detail": detail.get("body_detail", ""),
            }
        return {
            "id": article_id,
            "feed_id": feed_id,
            "title": title or detail.get("title", ""),
            "url": url or detail.get("url", ""),
            "published_at": published_at or detail.get("published_at", ""),
            "feed_name": feed_name,
            "content_html": detail.get("content_html", ""),
            "plain_text": detail.get("plain_text", ""),
            "body_status": detail.get("body_status", "ok"),
            "body_detail": detail.get("body_detail", ""),
        }
