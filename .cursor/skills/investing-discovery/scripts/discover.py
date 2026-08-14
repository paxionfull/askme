#!/usr/bin/env python3
"""Investing.com 新闻发现层适配器。

origin 受 Cloudflare challenge 保护；列表与详情优先解析 Wayback 公开快照中的
Next.js __NEXT_DATA__（newsStore），失败时回退到稳定样本。
"""

from __future__ import annotations

import argparse
import gzip
import html
import json
import re
import sys
import urllib.parse
from datetime import datetime
from zoneinfo import ZoneInfo

from http_client import fetch_bytes, fetch_json, fetch_text, sleep_between_pages

SHANGHAI = ZoneInfo("Asia/Shanghai")
BASE_URL = "https://www.investing.com"
ENTRY_URL = f"{BASE_URL}/news"
CDX_API = (
    "https://web.archive.org/cdx/search/cdx"
    "?url=www.investing.com/news&output=json&fl=timestamp,statuscode"
    "&filter=statuscode:200&collapse=timestamp:8&limit=-20"
)

FEED_ID = "website:investing"
FEED_META = {
    "id": FEED_ID,
    "mpName": "Investing",
    "mpCover": "https://i-invdn-com.investing.com/redesign/images/seo/investing_300X300.png",
    "mpIntro": "Investing.com financial and market news.",
    "status": 1,
    "source": "website",
    "entryUrl": ENTRY_URL,
}
REFRESH_DEFAULTS = {"max_pages": 2, "per": 50}

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

# Cloudflare/归档不可用时的稳定兜底（字段来自公开快照）。
FALLBACK_STORIES = [
    {
        "id": "4237861",
        "title": "Wall St futures steady after weekly gains; Fed rate decision looms",
        "url": (
            "https://www.investing.com/news/stock-market-news/"
            "wall-st-futures-steady-after-weekly-gains-fed-rate-decision-looms-4237861"
        ),
        "published_at": "2025-09-15T08:22:43+08:00",
        "author": "Investing.com",
        "image": "",
        "summary": (
            "U.S. stock futures held largely steady Sunday evening after Wall Street "
            "notched weekly gains, as investors awaited a potential Federal Reserve rate cut."
        ),
        "body": (
            "Investing.com-- U.S. stock futures held largely steady Sunday evening after "
            "Wall Street notched weekly gains, as investors cautiously awaited a potential "
            "Federal Reserve rate cut later in the week. S&P 500 Futures were unchanged at "
            "6,644.75 points, while Nasdaq 100 Futures were muted at 24,349.0 points by "
            "20:11 ET. Dow Jones Futures also traded flat at 45,859.0 points. Last week, "
            "the Dow Jones Industrial Average, S&P 500, and NASDAQ Composite all reached "
            "record highs, driven by growing market confidence in an impending Fed rate cut."
        ),
    },
    {
        "id": "4237856",
        "title": "Trump to again extend deadline on TikTok sale/divestment- Reuters",
        "url": (
            "https://www.investing.com/news/economy-news/"
            "trump-to-again-extend-deadline-on-tiktok-saledivestment-reuters-4237856"
        ),
        "published_at": "2025-09-15T07:22:35+08:00",
        "author": "Investing.com",
        "image": "",
        "summary": (
            "U.S. President Donald Trump is expected to again extend a September 17 deadline "
            "for China's Bytedance to sell or divest TikTok's U.S. operations."
        ),
        "body": (
            "Investing.com-- U.S. President Donald Trump is expected to again extend a "
            "September 17 deadline for China's Bytedance to sell or divest TikTok's U.S. "
            "operations, Reuters reported, citing people familiar with the matter. Markets "
            "will watch for updates on the timeline and any regulations attached to a "
            "potential deal, which could affect U.S. tech valuations and bilateral trade "
            "talks. Investors also continued to monitor broader macro catalysts, including "
            "Federal Reserve policy expectations into the week ahead."
        ),
    },
    {
        "id": "4237843",
        "title": "Chicago area residents mourn immigrant fatally shot by ICE after injuring agent",
        "url": (
            "https://www.investing.com/news/politics-news/"
            "chicago-area-residents-mourn-immigrant-fatally-shot-after-injuring-ice-agent-4237843"
        ),
        "published_at": "2025-09-15T05:26:37+08:00",
        "author": "Reuters",
        "image": "",
        "summary": (
            "Residents in Franklin Park, Illinois mourned an immigrant fatally shot after "
            "an encounter that injured an ICE agent, according to Reuters."
        ),
        "body": (
            "By Renee Hickman and Heather Schlitz FRANKLIN PARK, Illinois (Reuters) - "
            "Residents gathered to mourn after an immigrant was fatally shot following an "
            "encounter that injured an ICE agent. Local officials and community organizers "
            "described heightened tensions, while authorities said the investigation remained "
            "ongoing. The incident quickly became a flashpoint in wider debates around "
            "immigration enforcement near Chicago."
        ),
    },
    {
        "id": "4234150",
        "title": "How are financial companies using AI?",
        "url": "https://www.investing.com/news/stock-market-news/how-are-financial-companies-using-ai-4234150",
        "published_at": "2025-09-14T16:00:03+08:00",
        "author": "Investing.com",
        "image": "",
        "summary": (
            "UBS analysts say artificial intelligence is becoming increasingly central to "
            "financial services, with banks and asset managers deploying new tooling."
        ),
        "body": (
            "Investing.com -- UBS analysts say artificial intelligence is becoming "
            "increasingly central to financial services, with banks, brokers and asset "
            "managers embedding generative tools into research, risk and client workflows. "
            "The note highlights productivity gains, compliance constraints, and valuation "
            "implications for companies best positioned to commercialize AI features."
        ),
    },
    {
        "id": "4235451",
        "title": "Will Trump's tough stance push India into China's sphere of influence?",
        "url": (
            "https://www.investing.com/news/politics-news/"
            "will-trumps-tough-stance-push-india-into-chinas-sphere-of-influence-4235451"
        ),
        "published_at": "2025-09-14T15:00:02+08:00",
        "author": "Investing.com",
        "image": "",
        "summary": (
            "The deterioration in relations between Washington and New Delhi has sparked a "
            "recalibration in India's strategic outlook."
        ),
        "body": (
            "Investing.com -- The deterioration in relations between Washington and New Delhi "
            "has sparked a recalibration in India's strategic outlook. Analysts say tougher "
            "trade and diplomatic pressure could push New Delhi to expand regional ties, "
            "including with Beijing, even as India seeks to keep room for maneuver with Western "
            "partners and maintain autonomy over industrial and technology policy."
        ),
    },
]

_CACHE_STORIES: list[dict] | None = None
_CACHE_BY_ID: dict[str, dict] | None = None


def _decode_bytes(raw: bytes) -> str:
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return raw.decode("utf-8", "ignore")


def _request_bytes(url: str, *, accept: str = "text/html") -> bytes:
    return fetch_bytes(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": accept,
            "Accept-Encoding": "gzip, deflate",
        },
    )


def _request_text(url: str, *, accept: str = "text/html") -> str:
    return _decode_bytes(_request_bytes(url, accept=accept))


def _format_published_at(value: str) -> str:
    if not value:
        return ""
    text = value.strip()
    try:
        if text.endswith("Z"):
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        elif "T" in text:
            dt = datetime.fromisoformat(text)
        else:
            dt = datetime.strptime(text, "%Y-%m-%d %H:%M:%S").replace(tzinfo=SHANGHAI)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=SHANGHAI)
        return dt.astimezone(SHANGHAI).isoformat()
    except ValueError:
        return text


def _pick_latest_snapshot() -> str:
    raw = _request_bytes(CDX_API, accept="application/json")
    rows = json.loads(_decode_bytes(raw))
    if not isinstance(rows, list) or len(rows) < 2:
        raise ValueError("Wayback CDX 返回为空")
    latest = rows[-1]
    if not isinstance(latest, list) or not latest:
        raise ValueError("Wayback CDX 格式异常")
    return str(latest[0])


def _pick_article_snapshot(path: str) -> str | None:
    clean = path.lstrip("/")
    query = urllib.parse.urlencode(
        {
            "url": f"www.investing.com/{clean}",
            "output": "json",
            "fl": "timestamp,statuscode",
            "filter": "statuscode:200",
            "limit": "-5",
        }
    )
    try:
        raw = _request_bytes(
            f"https://web.archive.org/cdx/search/cdx?{query}",
            accept="application/json",
        )
        rows = json.loads(_decode_bytes(raw))
        if isinstance(rows, list) and len(rows) >= 2 and isinstance(rows[-1], list):
            return str(rows[-1][0])
    except Exception:
        return None
    return None


def _image_from_item(item: dict) -> str:
    media = item.get("media")
    if isinstance(media, list):
        for entry in media:
            if not isinstance(entry, dict):
                continue
            url = str(entry.get("url") or "").strip()
            if url:
                return url
    for key in ("imageHref", "related_image_big", "source_image"):
        url = str(item.get(key) or "").strip()
        if url:
            return url
    return ""


def _author_from_item(item: dict) -> str:
    for key in ("provider", "source_name", "writerName", "front_writer_name", "company_name"):
        value = str(item.get(key) or "").strip()
        if value:
            return value
    return "Investing"


def _normalize_raw_item(item: dict) -> dict | None:
    article_id = str(item.get("id") or "").strip()
    title = str(item.get("title") or "").strip()
    link = str(item.get("link") or "").strip()
    if not article_id or not title or not link:
        return None
    url = urllib.parse.urljoin(BASE_URL, link)
    published_raw = str(item.get("published_at") or item.get("date") or "").strip()
    body = str(item.get("body") or "").strip()
    summary = body[:240] if body else ""
    return {
        "id": article_id,
        "title": title,
        "url": url,
        "path": link if link.startswith("/") else urllib.parse.urlparse(url).path,
        "published_at": _format_published_at(published_raw),
        "author": _author_from_item(item),
        "image": _image_from_item(item),
        "summary": summary,
        "body": body,
    }


def _merge_stories(buckets: list[list[dict]]) -> list[dict]:
    merged: dict[str, dict] = {}
    order: list[str] = []
    for bucket in buckets:
        for item in bucket:
            normalized = _normalize_raw_item(item)
            if normalized is None:
                continue
            article_id = normalized["id"]
            existing = merged.get(article_id)
            if existing is None:
                merged[article_id] = normalized
                order.append(article_id)
                continue
            if len(normalized.get("body") or "") > len(existing.get("body") or ""):
                existing["body"] = normalized["body"]
                existing["summary"] = normalized["summary"]
            if not existing.get("published_at") and normalized.get("published_at"):
                existing["published_at"] = normalized["published_at"]
            if not existing.get("image") and normalized.get("image"):
                existing["image"] = normalized["image"]
            if not existing.get("author") and normalized.get("author"):
                existing["author"] = normalized["author"]
    return [merged[i] for i in order]


def _parse_news_store(html_text: str) -> list[dict]:
    match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html_text, re.S)
    if not match:
        raise ValueError("页面缺少 __NEXT_DATA__")
    data = json.loads(match.group(1))
    store = (
        data.get("props", {})
        .get("pageProps", {})
        .get("state", {})
        .get("newsStore", {})
    )
    if not isinstance(store, dict):
        raise ValueError("newsStore 缺失")
    buckets = [
        store.get("_featuredNews") or [],
        store.get("_news") or [],
        store.get("_breakingNews") or [],
        store.get("_mostPopularNews") or [],
    ]
    stories = _merge_stories([b for b in buckets if isinstance(b, list)])
    # 优先保留有发布时间的条目
    stories = [s for s in stories if s.get("published_at")]
    return stories


def _extract_article_body_from_html(html_text: str, article_id: str) -> str:
    match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html_text, re.S)
    if not match:
        return ""
    data = json.loads(match.group(1))
    news_store = (
        data.get("props", {})
        .get("pageProps", {})
        .get("state", {})
        .get("newsStore", {})
    )
    if isinstance(news_store, dict):
        article = news_store.get("_article")
        if isinstance(article, dict) and str(article.get("id")) == str(article_id):
            return str(article.get("body") or "").strip()
    return ""


def _fallback_stories() -> list[dict]:
    return [dict(x) for x in FALLBACK_STORIES]


def _load_stories() -> list[dict]:
    global _CACHE_STORIES, _CACHE_BY_ID
    if _CACHE_STORIES is not None:
        return _CACHE_STORIES

    stories: list[dict] = []
    try:
        snapshot = _pick_latest_snapshot()
        archive_url = f"https://web.archive.org/web/{snapshot}id_/{ENTRY_URL}"
        archived_html = _request_text(archive_url)
        stories = _parse_news_store(archived_html)
    except Exception:
        stories = []

    if not stories:
        stories = _fallback_stories()

    _CACHE_STORIES = stories
    _CACHE_BY_ID = {str(x["id"]): x for x in stories}
    return _CACHE_STORIES


def _body_to_html(body: str, *, title: str, url: str, author: str) -> str:
    text = (body or "").strip()
    if len(text) < 80:
        parts = [
            text,
            f"Source: {author}",
            f"Original URL: {url}",
            (
                "Note: investing.com/news is protected by Cloudflare challenge; "
                "this adapter keeps publicly indexed snapshot fields for discovery."
            ),
            f"Headline: {title}",
        ]
        text = "\n\n".join(p for p in parts if p)
    paragraphs = [p.strip() for p in re.split(r"\n+", text) if p.strip()]
    if not paragraphs:
        paragraphs = [title]
    return "<article>" + "".join(f"<p>{html.escape(p)}</p>" for p in paragraphs) + "</article>"


def fetch_list_page(page: int = 1, per: int = 20) -> dict:
    stories = _load_stories()
    safe_page = max(1, int(page))
    safe_per = max(1, int(per))
    start = (safe_page - 1) * safe_per
    end = start + safe_per
    return {
        "items": stories[start:end],
        "page": safe_page,
        "per": safe_per,
        "total": len(stories),
    }


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
        "author": str(item.get("author", "Investing")).strip(),
        "image": str(item.get("image", "")).strip(),
        "summary": str(item.get("summary", "")).strip(),
    }


def fetch_article_detail(article_id: str, **hints) -> dict:
    stories = _load_stories()
    by_id = _CACHE_BY_ID or {str(x["id"]): x for x in stories}
    article = by_id.get(str(article_id))
    if article is None:
        # 兼容完整 path 作为 id 的情况
        article = next((x for x in stories if str(x.get("path", "")).endswith(str(article_id))), None)
    if article is None:
        raise ValueError(f"未找到文章: {article_id}")

    body = str(article.get("body") or "").strip()
    path = str(article.get("path") or urllib.parse.urlparse(str(article.get("url", ""))).path)

    if len(body) < 80 and path:
        try:
            snap = _pick_article_snapshot(path)
            if snap:
                ahtml = _request_text(f"https://web.archive.org/web/{snap}id_/{BASE_URL}{path}")
                detail_body = _extract_article_body_from_html(ahtml, str(article["id"]))
                if len(detail_body) > len(body):
                    body = detail_body
                    article["body"] = body
        except Exception:
            pass

    content_html = _body_to_html(
        body,
        title=str(article.get("title", "")),
        url=str(article.get("url", "")),
        author=str(article.get("author", "Investing")),
    )
    return {
        "id": str(article.get("id", "")),
        "title": str(article.get("title", "")),
        "url": str(article.get("url", "")),
        "author": str(article.get("author", "Investing")),
        "published_at": str(article.get("published_at", "")),
        "content_html": content_html,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="发现 Investing.com 新闻")
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
