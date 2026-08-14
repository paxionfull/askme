from __future__ import annotations

import asyncio
import time
from typing import Any

from feed.feed_http_policy import page_delay_seconds
from core.html_utils import extract_article_html, html_to_text
from core.time_scope import calendar_scope_cutoff, days_range_label, format_duration_zh, parse_publish_time
from skills.skill_detail import call_fetch_article_detail
from feed.website_article_store import WebsiteArticleStore
from feed.website_feed_adapter import WebsiteFeedAdapter


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
        # per = 每页条数（page size）。越大则翻页次数越少。
        # 默认读 REFRESH_DEFAULTS.per，否则 50。勿对「用 len>=per 判断翻页」的固定页长源盲目加大。
        # 仍保留一个很高的硬上限，避免适配器分页逻辑异常导致死循环。
        per = int(overrides.get("per", defaults.get("per", 50)))
        # max_pages：显式传入优先；其它源保持 0=不限制（由时间 cutoff / has_next 停），
        # 避免历史 skill 里写的 REFRESH_DEFAULTS.max_pages 误伤。
        if "max_pages" in overrides:
            max_pages = int(overrides["max_pages"])
        else:
            max_pages = 0
        hard_max_pages = int(overrides.get("hard_max_pages", 500))
        # 只入库「今天 / 近 N 天」范围内文章；翻到更早内容即停（假定列表时间倒序）
        days = max(1, int(overrides.get("days", 1)))
        cutoff = calendar_scope_cutoff(days)
        range_label = days_range_label(days)

        before_count = self.store.count_articles(self.feed_id)
        before_latest = self.store.latest_published_at(self.feed_id)
        # 一次加载已有 id，避免逐条 has_article / 对已有文章反复 upsert
        known_ids = self.store.article_ids(self.feed_id)
        seen: set[str] = set()
        scoped_upserts = 0
        refresh_started = time.monotonic()

        page = 1
        while True:
            if page > hard_max_pages:
                break
            if max_pages > 0 and page > max_pages:
                break
            started = time.monotonic()
            payload = await asyncio.to_thread(self.adapter.fetch_list_page, page, per)
            fetch_elapsed = time.monotonic() - started
            items = self.adapter.list_items(payload)
            if not items:
                break
            added = 0
            already_known = 0
            too_old = 0
            in_scope = 0
            pending_rows: list[dict[str, str]] = []
            for item in items:
                normalized = self.adapter.normalize_list_item(item)
                article_id = str(normalized.get("id", "") or "")
                if not article_id or article_id in seen:
                    continue
                seen.add(article_id)
                published = parse_publish_time(str(normalized.get("published_at") or ""))
                if published is None or published < cutoff:
                    too_old += 1
                    continue
                in_scope += 1
                if article_id in known_ids:
                    already_known += 1
                    continue
                added += 1
                pending_rows.append(
                    {
                        "article_id": article_id,
                        "title": str(normalized.get("title") or ""),
                        "url": str(normalized.get("url") or ""),
                        "published_at": str(normalized.get("published_at") or ""),
                        "author": str(normalized.get("author") or ""),
                        "image": str(normalized.get("image") or ""),
                        "summary": str(normalized.get("summary") or ""),
                    }
                )
                known_ids.add(article_id)
            if pending_rows:
                scoped_upserts += self.store.upsert_articles(self.feed_id, pending_rows)
            # 本页已进入时间范围外（且假定倒序）→ 停止翻页
            if too_old > 0 and in_scope == 0:
                break
            if too_old > 0 and in_scope > 0:
                # 本页后半段已出范围，不必再翻
                break
            # 按时间倒序：本页范围内全是库里已有 → 已追上最新
            if already_known > 0 and added == 0 and before_count > 0:
                break
            if not self.adapter.has_next_page(payload):
                break
            # 内存切片分页（sitemap 缓存）通常极快，可跳过页间 sleep；
            # 真网络分页、近 N 天多页：一律限速，降低频控。
            if fetch_elapsed >= 0.15 or days > 1:
                await asyncio.sleep(page_delay_seconds())
            page += 1

        self.store.set_last_sync(self.feed_id)
        article_count = self.store.count_articles(self.feed_id)
        latest = self.store.latest_published_at(self.feed_id)
        new_count = max(article_count - before_count, 0)
        has_new_content = new_count > 0 or (latest and latest > before_latest)
        elapsed_seconds = time.monotonic() - refresh_started
        duration = format_duration_zh(elapsed_seconds)

        if has_new_content:
            message = (
                f"已更新（{range_label}），新增 {new_count} 篇，"
                f"本范围新入库 {scoped_upserts} 篇，库内共 {article_count} 篇"
                f"（耗时 {duration}）"
            )
        else:
            message = (
                f"刷新完成（{range_label}），未发现新文章"
                f"（本范围新入库 {scoped_upserts} 篇，库内共 {article_count} 篇，耗时 {duration}）。"
                "可能是该站点暂无更新。"
            )

        return {
            "ok": True,
            "article_count": article_count,
            "new_article_count": new_count,
            "scoped_upserts": scoped_upserts,
            "days": days,
            "elapsed_seconds": round(elapsed_seconds, 2),
            "has_new_content": has_new_content,
            "fetching_history": False,
            "message": message,
        }

    def get_articles(self, limit: int | None = None) -> list[dict]:
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
                "summary": row.get("summary", ""),
            }
            for row in rows
        ]

    async def fetch_article_detail_normalized(
        self,
        article_id: str,
        *,
        hints: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        detail = await asyncio.to_thread(
            call_fetch_article_detail,
            self.adapter,
            article_id,
            hints,
        )
        raw_html = detail.get("content_html", "") or ""
        content_html = self.normalize_body(raw_html, article_id=article_id)
        plain_text = html_to_text(content_html or raw_html)
        body_status = str(detail.get("body_status") or "").strip()
        body_detail = str(detail.get("body_detail") or "").strip()
        if not body_status:
            if plain_text.strip():
                body_status = "ok"
            else:
                body_status, body_detail = _classify_empty_body(raw_html, detail)
        return {
            "id": detail.get("id", article_id),
            "title": detail.get("title", ""),
            "url": detail.get("url", ""),
            "content_html": content_html,
            "plain_text": plain_text,
            "body_status": body_status,
            "body_detail": body_detail,
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
            "body_status": detail.get("body_status", "ok"),
            "body_detail": detail.get("body_detail", ""),
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


def _classify_empty_body(raw_html: str, detail: dict[str, Any]) -> tuple[str, str]:
    text = f"{raw_html}\n{detail.get('title', '')}\n{detail.get('url', '')}".lower()
    anti_bot_markers = (
        "cloudflare",
        "perimeterx",
        "captcha",
        "are you a robot",
        "security check",
        "attention required",
        "bot",
        "challenge",
    )
    auth_markers = (
        "sign in",
        "log in",
        "login",
        "unauthorized",
        "for subscribers",
        "subscription",
        "paywall",
        "会员",
        "请先登录",
        "需要登录",
    )
    if any(marker in text for marker in anti_bot_markers):
        return "anti_bot", "检测到反爬/机器人挑战页面"
    if any(marker in text for marker in auth_markers):
        return "auth_required", "页面需要登录或订阅权限"
    return "parse_failed", "页面可访问但未解析到正文"
