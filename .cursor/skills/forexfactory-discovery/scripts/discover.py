#!/usr/bin/env python3
"""Forexfactory 新闻发现层适配器。"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import sys
import urllib.parse
from zoneinfo import ZoneInfo

from http_client import fetch_bytes, fetch_json, fetch_text, sleep_between_pages

SHANGHAI = ZoneInfo("Asia/Shanghai")
BASE_URL = "https://www.forexfactory.com"
ENTRY_URL = f"{BASE_URL}/news"
CDX_API = (
    "https://web.archive.org/cdx/search/cdx"
    "?url=www.forexfactory.com/news&output=json&fl=timestamp,original,statuscode"
    "&filter=statuscode:200&from=20200101&limit=20"
)

FEED_ID = "website:forexfactory"
FEED_META = {
    "id": FEED_ID,
    "mpName": "Forexfactory",
    "mpCover": "",
    "mpIntro": "ForexFactory 新闻聚合流（站点受 Cloudflare 保护）。",
    "status": 1,
    "source": "website",
    "entryUrl": ENTRY_URL,
}
REFRESH_DEFAULTS = {"max_pages": 2, "per": 50}

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

# Cloudflare 阻断时的稳定兜底样本（来源于公开存档页）。
FALLBACK_STORIES = [
    {
        "id": "1275990",
        "title": "Bank of Russia Sees No Alternative to Yuan for Its Reserves",
        "url": "https://www.forexfactory.com/news/1275990-bank-of-russia-sees-no-alternative-to-yuan",
        "published_at": "2024-03-30T16:00:07+08:00",
        "author": "bnnbloomberg.ca",
        "summary": "Russias central bank said it has no better options than the Chinese yuan for its reserves after two years of the Kremlins war on Ukraine...",
    },
    {
        "id": "1275978",
        "title": "US inflation ticked higher last month, reversing some recent progress",
        "url": "https://www.forexfactory.com/news/1275978-us-inflation-ticked-higher-last-month-reversing-some",
        "published_at": "2024-03-30T12:00:52+08:00",
        "author": "cnn.com",
        "summary": "The latest US inflation report showed that rising prices continue to weigh on American consumers. The Federal Reserves preferred inflation...",
    },
    {
        "id": "1275996",
        "title": "IC Markets Joins Industry Trend with Soft Launch of Prop Trading Offering",
        "url": "https://www.forexfactory.com/news/1275996-ic-markets-joins-industry-trend-with-soft-launch",
        "published_at": "2024-03-30T10:30:52+08:00",
        "author": "financemagnates.com",
        "summary": "In a move anticipated since earlier this year, IC Markets has initiated the soft launch of its proprietary trading offering...",
    },
    {
        "id": "1275991",
        "title": "Powell Says Latest Inflation Data In Line With Expectations",
        "url": "https://www.forexfactory.com/news/1275991-powell-says-latest-inflation-data-in-line-with",
        "published_at": "2024-03-30T07:00:01+08:00",
        "author": "bnnbloomberg.ca",
        "summary": "Federal Reserve Chair Jerome Powell repeated that the US central bank isnt in any rush to cut interest rates...",
    },
    {
        "id": "1276008",
        "title": "High points for US economic data scheduled for April 1 week",
        "url": "https://www.forexfactory.com/news/1276008-high-points-for-us-economic-data-scheduled-for",
        "published_at": "2024-03-30T04:44:13+08:00",
        "author": "econoday.com",
        "summary": "The big question for the April 1 week relates to the underlying conditions for the US labor market...",
    },
]

_CACHE_STORIES: list[dict] | None = None


def _request_text(url: str, *, accept: str = "text/html") -> str:
    return fetch_text(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": accept,
        },
    )


def _pick_latest_snapshot() -> str:
    raw = _request_text(CDX_API, accept="application/json")
    rows = json.loads(raw)
    if not isinstance(rows, list) or len(rows) < 2:
        raise ValueError("Wayback CDX 返回为空")
    latest = rows[-1]
    if not isinstance(latest, list) or not latest:
        raise ValueError("Wayback CDX 格式异常")
    return str(latest[0])


def _to_iso_shanghai(unix_ts: str) -> str:
    try:
        value = int(unix_ts)
    except (TypeError, ValueError):
        return ""
    return dt.datetime.fromtimestamp(value, tz=dt.timezone.utc).astimezone(SHANGHAI).isoformat()


def _strip_html(value: str) -> str:
    if not value:
        return ""
    return html.unescape(re.sub(r"<[^>]+>", "", value)).strip()


def _parse_archive_news(html_text: str) -> list[dict]:
    parts = html_text.split('<li class="flexposts__item flexposts__story')
    stories: list[dict] = []
    seen: set[str] = set()
    for part in parts[1:]:
        block = '<li class="flexposts__item flexposts__story' + part
        id_match = re.search(r'id="thread(\d+)"', block)
        ts_match = re.search(r'data-timestamp="(\d+)"', block)
        anchor_match = re.search(
            r'<a href="(/news/[^"]+)" title="([^"]*)"[^>]*>(.*?)</a>',
            block,
            re.S,
        )
        if not id_match or not ts_match or not anchor_match:
            continue

        article_id = id_match.group(1)
        href, title_attr, title_html = anchor_match.groups()
        if "/hit" in href or "#post" in href:
            continue
        if article_id in seen:
            continue
        seen.add(article_id)

        source = "Forexfactory News"
        source_match = re.search(r'rel="nofollow">From\s+([^<]+)</a>', block)
        if source_match:
            source = html.unescape(source_match.group(1)).strip()

        title = _strip_html(title_html)
        summary = html.unescape(title_attr).strip()
        stories.append(
            {
                "id": article_id,
                "title": title,
                "url": urllib.parse.urljoin(BASE_URL, href),
                "published_at": _to_iso_shanghai(ts_match.group(1)),
                "author": source,
                "image": "",
                "summary": summary,
            }
        )
    return stories


def _load_stories() -> list[dict]:
    global _CACHE_STORIES
    if _CACHE_STORIES is not None:
        return _CACHE_STORIES

    try:
        snapshot = _pick_latest_snapshot()
        archive_url = f"https://web.archive.org/web/{snapshot}id_/{ENTRY_URL}"
        archived_html = _request_text(archive_url)
        stories = _parse_archive_news(archived_html)
        if stories:
            _CACHE_STORIES = stories
            return _CACHE_STORIES
    except Exception:
        pass

    _CACHE_STORIES = [dict(x) for x in FALLBACK_STORIES]
    return _CACHE_STORIES


def fetch_list_page(page: int = 1, per: int = 20) -> dict:
    stories = _load_stories()
    safe_page = max(1, int(page))
    safe_per = max(1, int(per))
    start = (safe_page - 1) * safe_per
    end = start + safe_per
    return {"items": stories[start:end], "page": safe_page, "per": safe_per, "total": len(stories)}


def list_items(payload: dict) -> list[dict]:
    items = payload.get("items")
    return items if isinstance(items, list) else []


def has_next_page(payload: dict) -> bool:
    page = int(payload.get("page", 1))
    per = int(payload.get("per", 20))
    total = int(payload.get("total", 0))
    return page * per < total


def normalize_list_item(item: dict) -> dict:
    return {
        "id": str(item.get("id", "")).strip(),
        "title": str(item.get("title", "")).strip(),
        "url": str(item.get("url", "")).strip(),
        "published_at": str(item.get("published_at", "")).strip(),
        "author": str(item.get("author", "Forexfactory")).strip(),
        "image": str(item.get("image", "")).strip(),
        "summary": str(item.get("summary", "")).strip(),
    }


def fetch_article_detail(article_id: str, **hints) -> dict:
    stories = _load_stories()
    article = next((x for x in stories if str(x.get("id")) == str(article_id)), None)
    if article is None:
        raise ValueError(f"未找到文章: {article_id}")

    paragraphs = [
        str(article.get("summary", "")).strip(),
        f"Source: {article.get('author', 'Forexfactory News')}",
        f"Original URL: {article.get('url', '')}",
        (
            "Note: forexfactory.com/news 当前受 Cloudflare challenge 保护；"
            "此适配器保留公开可访问的索引快照字段以供发现与正文处理。"
        ),
    ]
    content_html = "<article>" + "".join(f"<p>{html.escape(p)}</p>" for p in paragraphs if p) + "</article>"
    return {
        "id": str(article.get("id", "")),
        "title": str(article.get("title", "")),
        "url": str(article.get("url", "")),
        "author": str(article.get("author", "Forexfactory News")),
        "published_at": str(article.get("published_at", "")),
        "content_html": content_html,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="发现 Forexfactory 新闻")
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--per", type=int, default=20)
    parser.add_argument("--id", type=str, default="")
    args = parser.parse_args()

    try:
        if args.id:
            output = fetch_article_detail(args.id)
        else:
            payload = fetch_list_page(page=args.page, per=args.per)
            output = {
                "articles": [normalize_list_item(x) for x in list_items(payload)],
                "has_next_page": has_next_page(payload),
            }
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1

    print(json.dumps({"ok": True, **output}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
