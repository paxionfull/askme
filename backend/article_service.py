import asyncio
import time
from datetime import datetime, timedelta
from html import escape
from zoneinfo import ZoneInfo

from chunk_service import ChunkService
from feed_client import FeedClient

SHANGHAI = ZoneInfo("Asia/Shanghai")
ARTICLE_CHAR_LIMIT = 3000
TOTAL_CHAR_LIMIT = 80_000
CONTEXT_CACHE_TTL = 86400.0

DEFAULT_SUMMARY_SYSTEM_PROMPT = """你是 Askme 资讯编辑。用户消息中包含 XML 格式的 <文章集合>，每篇含来源、发布时间、标题和正文。

请根据这些文章生成中文 Markdown 日报摘要，要求：
1. 开头用「## 今日要点」列出 3–5 条 bullet 总览
2. 正文按主题分组（## 主题名），每组注明来源（来源名 + 发布时间）和要点
3. 合并不同文章中的重复信息
4. 仅使用文中已有信息，不要臆测或编造
5. 全文控制在 800 字以内
6. 输出纯 Markdown，不要使用 XML"""


def _xml_escape(text: str) -> str:
    return escape(text, quote=False)


def _parse_publish_time(published_at: str) -> datetime | None:
    if not published_at:
        return None
    try:
        dt = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
        return dt.astimezone(SHANGHAI)
    except ValueError:
        return None


def _format_publish_time_display(published_at: str) -> str:
    parsed = _parse_publish_time(published_at)
    if parsed is None:
        return published_at or ""
    return parsed.strftime("%Y-%m-%d %H:%M")


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + "…"


def _articles_with_body(articles: list[dict]) -> list[dict]:
    return [article for article in articles if article.get("plain_text", "").strip()]


class ArticleService:
    def __init__(self, client: FeedClient):
        self.client = client
        self.chunk_service = ChunkService()
        self._context_cache: dict[str, tuple[float, dict]] = {}

    def scope_cutoff_iso(self, days: int) -> str:
        cutoff = datetime.now(SHANGHAI) - timedelta(days=days)
        return cutoff.isoformat()

    async def index_articles_batch(
        self,
        articles: list[dict],
        llm_config: dict | None = None,
    ) -> int:
        total = 0
        for article in articles:
            plain_text = article.get("plain_text", "").strip()
            if not plain_text:
                continue
            count = await self.chunk_service.index_article(
                feed_id=article["feed_id"],
                article_id=article["id"],
                plain_text=plain_text,
                title=article.get("title", ""),
                feed_name=article.get("feed_name", ""),
                published_at=article.get("published_at", ""),
                url=article.get("url", ""),
                llm_config=llm_config,
            )
            total += count
        return total

    async def build_rag_index(
        self,
        days: int,
        feed_ids: list[str] | None = None,
        llm_config: dict | None = None,
    ) -> dict:
        data = await self.get_cached_context_for_llm(days, feed_ids)
        articles = data.get("articles") or []
        if not articles:
            return {
                "article_count": 0,
                "chunk_count": 0,
                "new_chunks": 0,
            }

        new_chunks = await self.index_articles_batch(articles, llm_config)
        chunk_count = self.chunk_service.store.count_in_scope(
            self.scope_cutoff_iso(days),
            feed_ids,
        )
        return {
            "article_count": len(articles),
            "chunk_count": chunk_count,
            "new_chunks": new_chunks,
        }

    async def get_scope_titles(
        self,
        days: int,
        feed_ids: list[str] | None = None,
    ) -> list[str]:
        meta = await self._collect_recent_meta(days, feed_ids)
        return [item.get("title", "") for item in meta if item.get("title")]

    def _cache_key(self, days: int, feed_ids: list[str] | None) -> str:
        ids = ",".join(sorted(feed_ids or []))
        return f"{days}:{ids}"

    def _get_cached_context(self, days: int, feed_ids: list[str] | None) -> dict | None:
        key = self._cache_key(days, feed_ids)
        entry = self._context_cache.get(key)
        if not entry:
            return None
        cached_at, data = entry
        if time.monotonic() - cached_at > CONTEXT_CACHE_TTL:
            del self._context_cache[key]
            return None
        return data

    def _set_cached_context(self, days: int, feed_ids: list[str] | None, data: dict) -> None:
        key = self._cache_key(days, feed_ids)
        self._context_cache[key] = (time.monotonic(), data)

    async def _fetch_and_persist_body(
        self,
        feed_id: str,
        article: dict,
    ) -> tuple[str, str]:
        detail = await self.client.fetch_and_persist_body(
            feed_id,
            article.get("id", ""),
            title=article.get("title", ""),
            url=article.get("url", ""),
            published_at=article.get("published_at", ""),
            feed_name=article.get("feed_name", ""),
        )
        return detail.get("content_html", ""), detail.get("plain_text", "")

    async def _collect_recent_meta(
        self,
        days: int,
        feed_ids: list[str] | None = None,
    ) -> list[dict]:
        feeds = await self.client.list_feeds()
        if feed_ids:
            feed_id_set = set(feed_ids)
            feeds = [feed for feed in feeds if feed.get("id") in feed_id_set]

        cutoff = datetime.now(SHANGHAI) - timedelta(days=days)
        all_articles: list[dict] = []

        for feed in feeds:
            feed_id = feed.get("id", "")
            feed_name = feed.get("mpName", "")
            if not feed_id:
                continue

            articles = await self.client.get_articles(feed_id, limit=100, include_content=False)
            for article in articles:
                published = _parse_publish_time(article.get("published_at", ""))
                if published is None or published < cutoff:
                    continue
                all_articles.append(
                    {
                        **article,
                        "feed_id": feed_id,
                        "feed_name": feed_name,
                    }
                )

        all_articles.sort(key=lambda item: item.get("published_at", ""), reverse=True)
        return all_articles

    async def _enrich_feed_articles(
        self,
        feed_id: str,
        feed_articles: list[dict],
    ) -> tuple[list[dict], int, int]:
        enriched: list[dict] = []
        need_network: list[dict] = []
        cached_count = 0

        for article in feed_articles:
            article_id = article.get("id", "")
            cached = self.client.get_cached_body(feed_id, article_id)
            if cached:
                enriched.append(
                    {
                        **article,
                        "content_html": cached.get("content_html", ""),
                        "plain_text": cached.get("plain_text", ""),
                    }
                )
                cached_count += 1
            else:
                need_network.append(article)

        fetched_count = 0
        for article in need_network:
            content_html = ""
            plain_text = ""
            try:
                content_html, plain_text = await self._fetch_and_persist_body(feed_id, article)
                if plain_text.strip():
                    fetched_count += 1
            except Exception:
                content_html = ""
                plain_text = ""

            enriched.append(
                {
                    **article,
                    "content_html": content_html,
                    "plain_text": plain_text,
                }
            )

        enriched.sort(key=lambda item: item.get("published_at", ""), reverse=True)
        return enriched, cached_count, fetched_count

    async def _enrich_with_content(self, articles: list[dict]) -> tuple[list[dict], int, int]:
        if not articles:
            return [], 0, 0

        by_feed: dict[str, list[dict]] = {}
        for article in articles:
            by_feed.setdefault(article["feed_id"], []).append(article)

        results = await asyncio.gather(
            *[self._enrich_feed_articles(feed_id, feed_articles) for feed_id, feed_articles in by_feed.items()],
            return_exceptions=True,
        )

        enriched: list[dict] = []
        cached_total = 0
        fetched_total = 0
        for result in results:
            if isinstance(result, Exception):
                continue
            feed_enriched, cached_count, fetched_count = result
            enriched.extend(feed_enriched)
            cached_total += cached_count
            fetched_total += fetched_count

        enriched.sort(key=lambda item: item.get("published_at", ""), reverse=True)
        return enriched, cached_total, fetched_total

    def _article_list_item(self, item: dict) -> dict:
        feed_id = item["feed_id"]
        article_id = item["id"]
        has_body = bool(item.get("plain_text", "").strip())
        if not has_body:
            has_body = self.client.body_store.has_body(feed_id, article_id)
        return {
            "id": article_id,
            "title": item["title"],
            "url": item["url"],
            "published_at": item["published_at"],
            "author": item.get("author", ""),
            "feed_id": feed_id,
            "feed_name": item["feed_name"],
            "has_body": has_body,
        }

    def get_stored_body(self, feed_id: str, article_id: str) -> dict | None:
        return self.client.get_cached_body(feed_id, article_id)

    async def get_or_fetch_stored_body(
        self,
        feed_id: str,
        article_id: str,
        *,
        fetch: bool = True,
    ) -> dict | None:
        return await self.client.get_or_fetch_body(feed_id, article_id, fetch=fetch)

    async def get_recent_articles(
        self,
        days: int = 1,
        feed_ids: list[str] | None = None,
        enrich: bool = False,
    ) -> dict:
        meta = await self._collect_recent_meta(days, feed_ids)
        meta_count = len(meta)

        if enrich:
            enriched, cached_count, fetched_count = await self._enrich_with_content(meta)
            articles = _articles_with_body(enriched)
            context_text, truncated = self._build_context(articles, days=days)
            result = {
                "articles": [self._article_list_item(item) for item in enriched],
                "context_text": context_text,
                "truncated": truncated,
                "article_count": len(articles),
                "meta_count": meta_count,
                "cached_count": cached_count,
                "fetched_count": fetched_count,
            }
            if articles:
                self._set_cached_context(
                    days,
                    feed_ids,
                    {
                        "articles": articles,
                        "context_text": context_text,
                        "truncated": truncated,
                        "article_count": len(articles),
                        "meta_count": meta_count,
                    },
                )
            return result

        return {
            "articles": [self._article_list_item(item) for item in meta],
            "context_text": "",
            "truncated": False,
            "article_count": len(meta),
            "meta_count": meta_count,
        }

    async def get_context_for_llm(
        self,
        days: int = 1,
        feed_ids: list[str] | None = None,
    ) -> dict:
        cached = self._get_cached_context(days, feed_ids)
        if cached:
            return cached

        meta = await self._collect_recent_meta(days, feed_ids)
        if not meta:
            return {"articles": [], "context_text": "", "truncated": False, "article_count": 0, "meta_count": 0}

        articles = _articles_with_body((await self._enrich_with_content(meta))[0])
        if not articles:
            return {
                "articles": [],
                "context_text": "",
                "truncated": False,
                "article_count": 0,
                "meta_count": len(meta),
            }

        context_text, truncated = self._build_context(articles, days=days)
        result = {
            "articles": articles,
            "context_text": context_text,
            "truncated": truncated,
            "article_count": len(articles),
            "meta_count": len(meta),
        }
        self._set_cached_context(days, feed_ids, result)
        return result

    async def get_cached_context_for_llm(
        self,
        days: int = 1,
        feed_ids: list[str] | None = None,
    ) -> dict:
        cached = self._get_cached_context(days, feed_ids)
        if cached and cached.get("context_text"):
            return cached

        meta = await self._collect_recent_meta(days, feed_ids)
        meta_count = len(meta)
        if not meta:
            return {
                "articles": [],
                "context_text": "",
                "truncated": False,
                "article_count": 0,
                "meta_count": 0,
            }

        enriched: list[dict] = []
        for item in meta:
            cached = self.client.get_cached_body(item["feed_id"], item["id"])
            if cached:
                enriched.append(
                    {
                        **item,
                        "content_html": cached.get("content_html", ""),
                        "plain_text": cached.get("plain_text", ""),
                    }
                )

        articles = _articles_with_body(enriched)
        if not articles:
            return {
                "articles": [],
                "context_text": "",
                "truncated": False,
                "article_count": 0,
                "meta_count": meta_count,
            }

        context_text, truncated = self._build_context(articles, days=days)
        result = {
            "articles": articles,
            "context_text": context_text,
            "truncated": truncated,
            "article_count": len(articles),
            "meta_count": meta_count,
        }
        self._set_cached_context(days, feed_ids, result)
        return result

    def _build_context(self, articles: list[dict], days: int = 1) -> tuple[str, bool]:
        blocks: list[str] = []
        total_chars = 0
        truncated = False

        for article in articles:
            body = article.get("plain_text", "").strip()
            if not body:
                continue

            body = _truncate(body, ARTICLE_CHAR_LIMIT)
            feed_name = _xml_escape(article.get("feed_name", ""))
            title = _xml_escape(article.get("title", ""))
            published = _xml_escape(_format_publish_time_display(article.get("published_at", "")))
            article_id = _xml_escape(article.get("id", ""))
            block = (
                f'  <文章 来源="{feed_name}" 发布时间="{published}" id="{article_id}">\n'
                f"    <标题>{title}</标题>\n"
                f"    <正文>{_xml_escape(body)}</正文>\n"
                f"  </文章>"
            )
            if total_chars + len(block) > TOTAL_CHAR_LIMIT:
                truncated = True
                break
            blocks.append(block)
            total_chars += len(block)

        range_label = f"近{days}天"
        truncated_attr = "true" if truncated else "false"
        inner = "\n".join(blocks)
        xml = (
            f'<文章集合 范围="{range_label}" 篇数="{len(blocks)}" 截断="{truncated_attr}">\n'
            f"{inner}\n"
            f"</文章集合>"
        )
        return xml, truncated

    def build_summary_messages(
        self,
        system_prompt: str,
        articles_xml: str,
    ) -> list[dict[str, str]]:
        system = system_prompt.strip() or DEFAULT_SUMMARY_SYSTEM_PROMPT
        return [
            {"role": "system", "content": system},
            {"role": "user", "content": articles_xml},
        ]

    def build_chat_messages(
        self,
        system_prompt: str,
        context_text: str,
        history: list[dict[str, str]],
    ) -> list[dict[str, str]]:
        system_content = system_prompt.strip() or "你是 Askme 助手，仅根据提供的文章回答。"
        system_content = f"{system_content}\n\n参考资料：\n{context_text}"

        trimmed = history[-10:]
        return [{"role": "system", "content": system_content}, *trimmed]
