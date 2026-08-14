import asyncio
import os
import time
from collections.abc import Awaitable, Callable
from datetime import datetime
from html import escape
from urllib.parse import urlparse, urlunparse

from chunk_service import ChunkService
from feed_client import FeedClient
from time_scope import calendar_scope_cutoff, filter_articles_by_days, parse_publish_time

ARTICLE_CHAR_LIMIT = 3000
TOTAL_CHAR_LIMIT = 80_000
CONTEXT_CACHE_TTL = 86400.0
DEFAULT_BODY_FETCH_CONCURRENCY = 4
DEFAULT_FEED_LIST_LIMIT = 20

DEFAULT_SUMMARY_SYSTEM_PROMPT = """你是 Askme 资讯编辑。用户消息中包含 XML 格式的 <文章集合>，每篇含来源、发布时间、标题和正文。

请根据这些文章生成中文 Markdown 日报概览，要求：
1. 开头用「## 今日要点」列出 3–5 条 bullet 总览
2. 正文按主题分组（## 主题名），每组注明来源（来源名 + 发布时间）和要点
3. 合并不同文章中的重复信息
4. 仅使用文中已有信息，不要臆测或编造
5. 全文控制在 800 字以内
6. 输出纯 Markdown，不要使用 XML"""


def _xml_escape(text: str) -> str:
    return escape(text, quote=False)


def _format_publish_time_display(published_at: str) -> str:
    parsed = parse_publish_time(published_at)
    if parsed is None:
        return published_at or ""
    return parsed.strftime("%Y-%m-%d %H:%M")


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + "…"


def _normalize_article_url(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        return ""
    try:
        parsed = urlparse(raw)
        if not parsed.netloc:
            return raw
        scheme = parsed.scheme.lower()
        netloc = parsed.netloc.lower()
        path = parsed.path.rstrip("/") or "/"
        query = parsed.query or ""
        # 微信公众号列表链身份在 query（__biz/mid/idx/sn），去掉 query 会把全部收成 /s
        if "mp.weixin.qq.com" in netloc and path == "/s" and query:
            return urlunparse((scheme, netloc, path, "", query, ""))
        return urlunparse((scheme, netloc, path, "", "", ""))
    except ValueError:
        return raw


def _normalize_title(title: str) -> str:
    return " ".join((title or "").split())


def _dedupe_articles(articles: list[dict]) -> list[dict]:
    """按 URL、标题去重，保留发布时间最新的一篇。"""
    seen_urls: set[str] = set()
    seen_titles: set[str] = set()
    result: list[dict] = []
    for article in articles:
        norm_url = _normalize_article_url(str(article.get("url") or ""))
        norm_title = _normalize_title(str(article.get("title") or ""))

        if norm_url and norm_url in seen_urls:
            continue
        if norm_title and norm_title in seen_titles:
            continue

        if norm_url:
            seen_urls.add(norm_url)
        if norm_title:
            seen_titles.add(norm_title)
        result.append(article)
    return result


def _articles_with_body(articles: list[dict]) -> list[dict]:
    return [article for article in articles if article.get("plain_text", "").strip()]


def _detail_hints_from_article(article: dict) -> dict[str, str]:
    return {
        key: str(article.get(key) or "").strip()
        for key in ("url", "title", "published_at", "author", "image", "summary")
        if str(article.get(key) or "").strip()
    }


class ArticleService:
    def __init__(self, client: FeedClient):
        self.client = client
        self.chunk_service = ChunkService()
        self._context_cache: dict[str, tuple[float, dict]] = {}

    def scope_cutoff_iso(self, days: int) -> str:
        return calendar_scope_cutoff(days).isoformat()

    def _indexable_articles(self, articles: list[dict]) -> list[dict]:
        return [article for article in articles if article.get("plain_text", "").strip()]

    async def index_articles_batch(
        self,
        articles: list[dict],
        llm_config: dict | None = None,
        *,
        on_progress: Callable[[int, int, str], Awaitable[None]] | None = None,
    ) -> int:
        indexable = self._indexable_articles(articles)
        total = len(indexable)
        if total == 0:
            return 0

        concurrency = max(1, int(os.getenv("INDEX_CONCURRENCY", "6")))
        sem = asyncio.Semaphore(min(concurrency, total))
        completed = 0
        new_chunks = 0
        progress_lock = asyncio.Lock()

        async def index_one(article: dict) -> int:
            nonlocal completed, new_chunks
            async with sem:
                count = await self.chunk_service.index_article(
                    feed_id=article["feed_id"],
                    article_id=article["id"],
                    plain_text=article["plain_text"],
                    title=article.get("title", ""),
                    feed_name=article.get("feed_name", ""),
                    published_at=article.get("published_at", ""),
                    url=article.get("url", ""),
                    llm_config=llm_config,
                )
            async with progress_lock:
                completed += 1
                new_chunks += count
                if on_progress:
                    await on_progress(completed, total, article.get("title", ""))
            return count

        await asyncio.gather(*(index_one(article) for article in indexable))
        return new_chunks

    async def build_rag_index(
        self,
        days: int,
        feed_ids: list[str] | None = None,
        llm_config: dict | None = None,
        *,
        on_progress: Callable[[int, int, str], Awaitable[None]] | None = None,
    ) -> dict:
        data = await self.get_cached_context_for_llm(days, feed_ids)
        articles = data.get("articles") or []
        indexable = self._indexable_articles(articles)
        if not indexable:
            return {
                "article_count": 0,
                "chunk_count": 0,
                "new_chunks": 0,
            }

        new_chunks = await self.index_articles_batch(
            articles,
            llm_config,
            on_progress=on_progress,
        )
        chunk_count = self.chunk_service.store.count_in_scope(
            self.scope_cutoff_iso(days),
            feed_ids,
        )
        return {
            "article_count": len(indexable),
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

    def resolve_article_scope(
        self,
        article_scope: list,
    ) -> list[tuple[str, str]]:
        pairs: list[tuple[str, str]] = []
        seen: set[str] = set()
        store = self.chunk_service.store

        for item in article_scope:
            located = self._locate_scoped_article(item, store)
            if not located:
                continue
            feed_id, article_id = located
            if not store.article_has_chunks(feed_id, article_id):
                continue
            key = f"{feed_id}:{article_id}"
            if key in seen:
                continue
            seen.add(key)
            pairs.append((feed_id, article_id))
        return pairs

    def _scope_item_fields(self, item) -> tuple[str, str, str, str]:
        feed_id = str(getattr(item, "feed_id", "") or item.get("feed_id", "")).strip()
        article_id = str(getattr(item, "article_id", "") or item.get("article_id", "")).strip()
        url = str(getattr(item, "url", "") or item.get("url", "")).strip()
        title = str(getattr(item, "title", "") or item.get("title", "")).strip()
        return feed_id, article_id, url, title

    def _locate_scoped_article(self, item, store) -> tuple[str, str] | None:
        feed_id, article_id, url, title = self._scope_item_fields(item)
        body_store = self.client.body_store

        if feed_id and article_id and body_store.has_body(feed_id, article_id):
            return feed_id, article_id
        if feed_id and article_id and store.article_has_chunks(feed_id, article_id):
            return feed_id, article_id

        if url:
            from_chunk = store.find_article_pair_by_url(url)
            if from_chunk:
                return from_chunk
            from_body = body_store.find_by_url(url)
            if from_body:
                return from_body["feed_id"], from_body["article_id"]

        if title:
            from_body = body_store.find_by_title(title)
            if from_body:
                return from_body["feed_id"], from_body["article_id"]

        return None

    async def resolve_and_index_article_scope(
        self,
        article_scope: list,
        llm_config: dict | None = None,
    ) -> list[tuple[str, str]]:
        pairs: list[tuple[str, str]] = []
        seen: set[str] = set()
        store = self.chunk_service.store
        body_store = self.client.body_store

        for item in article_scope:
            located = self._locate_scoped_article(item, store)
            if not located:
                continue
            feed_id, article_id = located
            key = f"{feed_id}:{article_id}"

            if not store.article_has_chunks(feed_id, article_id):
                body = body_store.get(feed_id, article_id)
                plain_text = str(body.get("plain_text", "") if body else "").strip()
                if plain_text:
                    await self.chunk_service.index_article(
                        feed_id=feed_id,
                        article_id=article_id,
                        plain_text=plain_text,
                        title=str(body.get("title", "") if body else ""),
                        feed_name=str(body.get("feed_name", "") if body else ""),
                        published_at=str(body.get("published_at", "") if body else ""),
                        url=str(body.get("url", "") if body else ""),
                        llm_config=llm_config,
                    )

            if not store.article_has_chunks(feed_id, article_id):
                continue
            if key in seen:
                continue
            seen.add(key)
            pairs.append((feed_id, article_id))
        return pairs

    async def collect_scoped_article_bodies(self, article_scope: list) -> list[dict]:
        """Load plain-text bodies for scoped articles (fetch on demand)."""
        articles: list[dict] = []
        seen: set[str] = set()
        store = self.chunk_service.store

        for item in article_scope:
            located = self._locate_scoped_article(item, store)
            if not located:
                feed_id, article_id, _, _ = self._scope_item_fields(item)
                if feed_id and article_id:
                    located = (feed_id, article_id)
                else:
                    continue

            feed_id, article_id = located
            key = f"{feed_id}:{article_id}"
            if key in seen:
                continue
            seen.add(key)

            _, _, url_field, title_field = self._scope_item_fields(item)
            stored = await self.client.get_or_fetch_body(feed_id, article_id, fetch=True)
            if not stored or not str(stored.get("plain_text", "")).strip():
                continue

            articles.append(
                {
                    "feed_id": feed_id,
                    "id": article_id,
                    "title": str(stored.get("title", "") or title_field or ""),
                    "url": str(stored.get("url", "") or url_field or ""),
                    "published_at": str(stored.get("published_at", "") or ""),
                    "feed_name": str(stored.get("feed_name", "") or ""),
                    "plain_text": str(stored.get("plain_text", "")).strip(),
                }
            )

        articles.sort(key=lambda item: item.get("published_at", ""), reverse=True)
        return articles

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
            hints=_detail_hints_from_article(article),
        )
        return detail.get("content_html", ""), detail.get("plain_text", "")

    async def _collect_recent_meta(
        self,
        days: int,
        feed_ids: list[str] | None = None,
        *,
        dedupe: bool = True,
    ) -> list[dict]:
        feeds = await self.client.list_feeds()
        if feed_ids:
            feed_id_set = set(feed_ids)
            feeds = [feed for feed in feeds if feed.get("id") in feed_id_set]

        cutoff = calendar_scope_cutoff(days)

        async def _articles_for_feed(feed: dict) -> list[dict]:
            feed_id = feed.get("id", "")
            feed_name = feed.get("mpName", "")
            if not feed_id:
                return []

            articles = await self.client.get_articles(feed_id, limit=None, include_content=False)
            recent: list[dict] = []
            for article in articles:
                published = parse_publish_time(article.get("published_at", ""))
                if published is None or published < cutoff:
                    continue
                recent.append(
                    {
                        **article,
                        "feed_id": feed_id,
                        "feed_name": feed_name,
                    }
                )
            return recent

        batches = await asyncio.gather(*[_articles_for_feed(feed) for feed in feeds])
        all_articles = [article for batch in batches for article in batch]
        all_articles.sort(key=lambda item: item.get("published_at", ""), reverse=True)
        # 拉正文时不要跨源去重：否则同题转载/微信 query URL 会被丢掉，侧栏仍显示无正文
        return _dedupe_articles(all_articles) if dedupe else all_articles

    async def _collect_list_meta(
        self,
        feed_ids: list[str] | None = None,
        *,
        limit: int | None = DEFAULT_FEED_LIST_LIMIT,
        days: int | None = None,
        dedupe: bool = True,
    ) -> list[dict]:
        """Collect articles shown in the feed sidebar list, optionally filtered by days."""
        feeds = await self.client.list_feeds()
        if feed_ids:
            feed_id_set = set(feed_ids)
            feeds = [feed for feed in feeds if feed.get("id") in feed_id_set]

        # 有时间范围时取该源全部再过滤；否则按 limit 截断
        fetch_limit = None if days is not None else limit

        async def _articles_for_feed(feed: dict) -> list[dict]:
            feed_id = feed.get("id", "")
            feed_name = feed.get("mpName", "")
            if not feed_id:
                return []

            articles = await self.client.get_articles(feed_id, limit=fetch_limit, include_content=False)
            if days is not None:
                articles = filter_articles_by_days(articles, days)
            elif limit is not None and limit > 0:
                articles = articles[:limit]
            return [
                {
                    **article,
                    "feed_id": feed_id,
                    "feed_name": feed_name,
                }
                for article in articles
            ]

        batches = await asyncio.gather(*[_articles_for_feed(feed) for feed in feeds])
        all_articles = [article for batch in batches for article in batch]
        all_articles.sort(key=lambda item: item.get("published_at", ""), reverse=True)
        return _dedupe_articles(all_articles) if dedupe else all_articles

    async def _enrich_feed_articles(
        self,
        feed_id: str,
        feed_articles: list[dict],
        *,
        sem: asyncio.Semaphore,
    ) -> tuple[list[dict], int, int]:
        enriched: list[dict] = []
        need_network: list[dict] = []
        cached_count = 0
        known_body_ids = self.client.body_store.body_ids_with_text(feed_id)

        for article in feed_articles:
            article_id = article.get("id", "")
            if article_id and article_id in known_body_ids:
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
                    continue
            need_network.append(article)

        async def _fetch_one(article: dict) -> dict:
            async with sem:
                content_html = ""
                plain_text = ""
                last_error = ""
                last_raised = False
                # 偶发超时/空正文：最多再试 1 次；异常失败写入 fetch_error，避免看起来像「从未拉取」
                for attempt in range(2):
                    last_raised = False
                    try:
                        content_html, plain_text = await self._fetch_and_persist_body(
                            feed_id, article
                        )
                        if str(plain_text).strip():
                            break
                        last_error = "正文为空"
                    except Exception as exc:
                        last_raised = True
                        content_html = ""
                        plain_text = ""
                        last_error = str(exc) or type(exc).__name__
                    if attempt == 0 and (last_raised or not str(plain_text).strip()):
                        await asyncio.sleep(0.8)
                if last_raised and not str(plain_text).strip():
                    article_id = str(article.get("id") or "")
                    if article_id:
                        try:
                            self.client.body_store.save(
                                feed_id,
                                article_id,
                                content_html="",
                                plain_text="",
                                body_status="fetch_error",
                                body_detail=(last_error or "获取正文失败")[:500],
                                title=str(article.get("title") or ""),
                                url=str(article.get("url") or ""),
                                published_at=str(article.get("published_at") or ""),
                                feed_name=str(article.get("feed_name") or ""),
                            )
                        except Exception:
                            pass
                # 正文逐篇限速，降低同站连刷触发 429
                await asyncio.sleep(0.35)
                return {
                    **article,
                    "content_html": content_html,
                    "plain_text": plain_text,
                }

        fetched_results = await asyncio.gather(*[_fetch_one(article) for article in need_network])
        fetched_count = sum(
            1 for item in fetched_results if str(item.get("plain_text", "")).strip()
        )
        enriched.extend(fetched_results)

        enriched.sort(key=lambda item: item.get("published_at", ""), reverse=True)
        return enriched, cached_count, fetched_count

    def _body_fetch_concurrency(self) -> int:
        raw = os.getenv("BODY_FETCH_CONCURRENCY", str(DEFAULT_BODY_FETCH_CONCURRENCY)).strip()
        try:
            value = int(raw)
        except ValueError:
            return DEFAULT_BODY_FETCH_CONCURRENCY
        return min(32, max(1, value))

    async def _enrich_with_content(self, articles: list[dict]) -> tuple[list[dict], int, int]:
        return await self._enrich_with_content_progress(articles)

    async def _enrich_with_content_progress(
        self,
        articles: list[dict],
        on_progress: Callable[[int, int, int, int, str], Awaitable[None]] | None = None,
    ) -> tuple[list[dict], int, int]:
        if not articles:
            return [], 0, 0

        by_feed: dict[str, list[dict]] = {}
        for article in articles:
            by_feed.setdefault(article["feed_id"], []).append(article)

        sem = asyncio.Semaphore(self._body_fetch_concurrency())

        async def _enrich_one(feed_id: str, feed_articles: list[dict]):
            return await self._enrich_feed_articles(feed_id, feed_articles, sem=sem)

        enriched: list[dict] = []
        cached_total = 0
        fetched_total = 0

        tasks = [
            asyncio.create_task(_enrich_one(feed_id, feed_articles))
            for feed_id, feed_articles in by_feed.items()
        ]
        total_feeds = len(tasks)
        completed_feeds = 0

        for done in asyncio.as_completed(tasks):
            completed_feeds += 1
            feed_name = ""
            try:
                feed_enriched, cached_count, fetched_count = await done
            except Exception:
                if on_progress:
                    await on_progress(
                        completed_feeds,
                        total_feeds,
                        cached_total,
                        fetched_total,
                        feed_name,
                    )
                continue

            enriched.extend(feed_enriched)
            cached_total += cached_count
            fetched_total += fetched_count
            if feed_enriched:
                feed_name = str(feed_enriched[0].get("feed_name", ""))
            if on_progress:
                await on_progress(
                    completed_feeds,
                    total_feeds,
                    cached_total,
                    fetched_total,
                    feed_name,
                )

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
        list_limit: int | None = None,
        on_progress: Callable[[int, int, int, int, str], Awaitable[None]] | None = None,
    ) -> dict:
        if list_limit and list_limit > 0:
            meta = await self._collect_list_meta(
                feed_ids, limit=list_limit, days=days, dedupe=not enrich
            )
        else:
            meta = await self._collect_recent_meta(days, feed_ids, dedupe=not enrich)
        meta_count = len(meta)

        if enrich:
            enriched, cached_count, fetched_count = await self._enrich_with_content_progress(
                meta,
                on_progress=on_progress,
            )
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

    def _build_title_index_context(self, articles: list[dict], days: int = 1) -> tuple[str, bool]:
        blocks: list[str] = []
        total_chars = 0
        truncated = False

        for article in articles:
            title = str(article.get("title") or "").strip()
            if not title:
                continue

            url = str(article.get("url") or "").strip()
            article_id = _xml_escape(article.get("id", ""))
            title_xml = _xml_escape(title)
            url_xml = _xml_escape(url)
            block = (
                f'  <文章 id="{article_id}" 链接="{url_xml}">\n'
                f"    <标题>{title_xml}</标题>\n"
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
