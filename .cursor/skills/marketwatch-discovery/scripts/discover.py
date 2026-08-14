#!/usr/bin/env python3
"""MarketWatch 发现层适配器（基于 news sitemap，含 DataDome 反爬降级）。"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import urllib.error
import xml.etree.ElementTree as ET
from datetime import datetime
from zoneinfo import ZoneInfo

from http_client import fetch_bytes, fetch_json, fetch_text, sleep_between_pages
from list_index import ListByIdIndex

SHANGHAI = ZoneInfo("Asia/Shanghai")
BASE_URL = "https://www.marketwatch.com"
LIST_SITEMAP_INDEX = f"{BASE_URL}/mw_news_sitemap.xml"
LIVE_SITEMAP_URL = f"{BASE_URL}/mw_live_news_sitemap.xml"

FEED_ID = "website:marketwatch"
FEED_META = {
    "id": FEED_ID,
    "mpName": "Marketwatch",
    "mpCover": "https://mw3.wsj.net/mw5/content/logos/mw_logo_social.png",
    "mpIntro": "MarketWatch business and financial news.",
    "status": 1,
    "source": "website",
    "entryUrl": BASE_URL + "/",
}
REFRESH_DEFAULTS = {"max_pages": 3, "per": 50}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "application/xml,text/xml,text/html,*/*",
    "Referer": BASE_URL + "/",
}

NS = {
    "sm": "http://www.sitemaps.org/schemas/sitemap/0.9",
    "news": "http://www.google.com/schemas/sitemap-news/0.9",
    "image": "http://www.google.com/schemas/sitemap-image/1.1",
}

_PATH_BLACKLIST_PREFIXES = (
    "/author/",
    "/column/",
    "/topic/",
    "/site/",
    "/tools/",
    "/welcome-",
    "/investing/",
    "/games/",
)


def _request_text(url: str, *, accept_html: bool = False) -> str:
    headers = dict(HEADERS)
    if accept_html:
        headers["Accept"] = "text/html,application/xhtml+xml,*/*"
    return fetch_text(url, headers=headers)


def _to_iso_shanghai(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(SHANGHAI).isoformat()
    except ValueError:
        return raw


def _path_id(url: str) -> str:
    path = re.sub(r"^https?://[^/]+", "", (url or "").strip())
    return path.lstrip("/")


def _title_from_url(url: str) -> str:
    tail = re.sub(r"^https?://[^/]+", "", (url or "").strip("/")).split("/")[-1]
    tail = re.sub(r"\?.*$", "", tail)
    # strip trailing hex-ish id suffix like -4a0baee3
    tail = re.sub(r"-[0-9a-f]{6,}$", "", tail, flags=re.IGNORECASE)
    if not tail:
        return "MarketWatch"
    cleaned = re.sub(r"[-_]+", " ", tail).strip()
    return cleaned[:1].upper() + cleaned[1:] if cleaned else "MarketWatch"


def _wanted_url(loc: str) -> bool:
    if not loc.startswith(BASE_URL):
        return False
    path = re.sub(r"^https?://[^/]+", "", loc)
    if not path or path == "/":
        return False
    if any(path.startswith(prefix) for prefix in _PATH_BLACKLIST_PREFIXES):
        return False
    # 优先文章与直播报道路径
    if path.startswith("/story/") or path.startswith("/livecoverage/") or path.startswith("/data-news/"):
        return True
    # 其它带 slug 的深度路径也保留
    return path.count("/") >= 1 and len(path) > 8


def _is_datadome_challenge(text: str) -> bool:
    lowered = (text or "").lower()
    return (
        "captcha-delivery.com" in lowered
        or "datadome" in lowered
        or "please enable js and disable any ad blocker" in lowered
    )


def _parse_urlset(xml_text: str) -> list[dict]:
    root = ET.fromstring(xml_text)
    rows: list[dict] = []
    for node in root.findall("sm:url", NS):
        loc = (node.findtext("sm:loc", "", NS) or "").strip()
        if not loc or not _wanted_url(loc):
            continue

        lastmod = (node.findtext("sm:lastmod", "", NS) or "").strip()
        news_node = node.find("news:news", NS)
        title = ""
        publication_date = ""
        publication_name = "MarketWatch"
        keywords = ""
        if news_node is not None:
            title = (news_node.findtext("news:title", "", NS) or "").strip()
            publication_date = (news_node.findtext("news:publication_date", "", NS) or "").strip()
            publication_name = (
                news_node.findtext("news:publication/news:name", "", NS) or "MarketWatch"
            ).strip() or "MarketWatch"
            keywords = (news_node.findtext("news:keywords", "", NS) or "").strip()

        image = (node.findtext("image:image/image:loc", "", NS) or "").strip()
        published_raw = publication_date or lastmod
        rows.append(
            {
                "id": _path_id(loc),
                "url": loc,
                "title": title or _title_from_url(loc),
                "published_at": _to_iso_shanghai(published_raw),
                "author": publication_name,
                "image": image,
                "keywords": keywords,
                "lastmod": lastmod,
            }
        )
    return rows


def _child_sitemap_urls(index_xml: str) -> list[str]:
    root = ET.fromstring(index_xml)
    locs: list[str] = []
    for node in root.findall("sm:sitemap", NS):
        loc = (node.findtext("sm:loc", "", NS) or "").strip()
        if loc:
            locs.append(loc)
    return locs


_CACHE_ITEMS: list[dict] | None = None
_LIST_INDEX = ListByIdIndex()


def _collect_items(*, force: bool = False) -> list[dict]:
    global _CACHE_ITEMS
    if _CACHE_ITEMS is not None and not force:
        return _CACHE_ITEMS

    rows: list[dict] = []
    seen: set[str] = set()

    index_xml = _request_text(LIST_SITEMAP_INDEX)
    child_urls = _child_sitemap_urls(index_xml)
    if not child_urls:
        # 偶发直接返回 urlset
        rows.extend(_parse_urlset(index_xml))
    else:
        for child in child_urls:
            rows.extend(_parse_urlset(_request_text(child)))

    try:
        rows.extend(_parse_urlset(_request_text(LIVE_SITEMAP_URL)))
    except Exception:
        pass

    deduped: list[dict] = []
    for item in rows:
        key = str(item.get("id", "")).strip()
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(item)

    deduped.sort(key=lambda x: x.get("published_at", ""), reverse=True)
    _LIST_INDEX.rebuild(deduped)
    _CACHE_ITEMS = deduped
    return _CACHE_ITEMS


def fetch_list_page(page: int = 1, per: int = 20) -> dict:
    all_items = _collect_items(force=(page <= 1))
    page = max(1, int(page))
    per = max(1, int(per))
    start = (page - 1) * per
    end = start + per
    return {"items": all_items[start:end], "page": page, "per": per, "total": len(all_items)}


def list_items(payload: dict) -> list[dict]:
    items = payload.get("items")
    return items if isinstance(items, list) else []


def has_next_page(payload: dict) -> bool:
    page = int(payload.get("page", 1))
    per = int(payload.get("per", 20))
    total = int(payload.get("total", 0))
    return page * per < total


def normalize_list_item(item: dict) -> dict:
    keywords = str(item.get("keywords", "") or "").strip()
    summary = "MarketWatch news sitemap item."
    if keywords:
        summary = f"MarketWatch sitemap item. Keywords: {keywords}"
    return {
        "id": str(item.get("id", "")).strip(),
        "title": str(item.get("title", "")).strip(),
        "url": str(item.get("url", "")).strip(),
        "published_at": str(item.get("published_at", "")).strip(),
        "author": str(item.get("author", "")).strip() or "MarketWatch",
        "image": str(item.get("image", "")).strip(),
        "summary": summary,
    }


def _lookup_item(article_id: str) -> dict:
    _collect_items()
    return _LIST_INDEX.get(article_id)


def _fallback_html(
    *,
    title: str,
    url: str,
    published_at: str,
    author: str,
    image: str,
    keywords: str,
) -> str:
    image_line = f"<p><strong>image:</strong> {html.escape(image)}</p>" if image else ""
    keywords_line = (
        f"<p><strong>keywords:</strong> {html.escape(keywords)}</p>" if keywords else ""
    )
    return (
        f"<article><h1>{html.escape(title)}</h1>"
        f"<p><strong>url:</strong> {html.escape(url)}</p>"
        f"<p><strong>published_at:</strong> {html.escape(published_at)}</p>"
        f"<p><strong>author:</strong> {html.escape(author)}</p>"
        f"{image_line}"
        f"{keywords_line}"
        "<p>MarketWatch article page is protected by DataDome anti-bot challenge in current environment. "
        "This fallback body preserves news-sitemap metadata for downstream pipeline processing.</p>"
        "</article>"
    )


def fetch_article_detail(article_id: str, **hints) -> dict:
    from detail_hints import pick_hints

    meta = pick_hints(**hints)
    item: dict = {}
    if not meta.get("url"):
        item = _lookup_item(article_id)
    url = meta.get("url") or str(item.get("url", "")).strip() or f"{BASE_URL}/{article_id.lstrip('/')}"
    title = meta.get("title") or str(item.get("title", "")).strip() or _title_from_url(url)
    published_at = meta.get("published_at") or str(item.get("published_at", "")).strip()
    author = meta.get("author") or str(item.get("author", "")).strip() or "MarketWatch"
    image = str(item.get("image", "")).strip()
    keywords = str(item.get("keywords", "")).strip()

    content_html = ""
    try:
        raw_html = _request_text(url, accept_html=True)
        if _is_datadome_challenge(raw_html) or len(raw_html.strip()) < 80:
            raise urllib.error.HTTPError(url, 401, "MarketWatch DataDome challenge", {}, None)
        content_html = raw_html
        title_match = re.search(r"<title[^>]*>(.*?)</title>", raw_html, re.IGNORECASE | re.DOTALL)
        if title_match:
            page_title = html.unescape(re.sub(r"\s+", " ", title_match.group(1))).strip()
            if page_title:
                title = page_title
    except urllib.error.HTTPError as exc:
        body = ""
        if hasattr(exc, "read"):
            try:
                body = exc.read().decode("utf-8", "ignore")
            except Exception:
                body = ""
        if len(body.strip()) >= 120 and not _is_datadome_challenge(body):
            content_html = body
        else:
            content_html = _fallback_html(
                title=title,
                url=url,
                published_at=published_at,
                author=author,
                image=image,
                keywords=keywords,
            )
    except Exception:
        content_html = _fallback_html(
            title=title,
            url=url,
            published_at=published_at,
            author=author,
            image=image,
            keywords=keywords,
        )

    return {
        "id": article_id,
        "title": title,
        "url": url,
        "published_at": published_at,
        "author": author,
        "image": image,
        "content_html": content_html,
    }


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    _ = article_id
    return str(raw_html or "").strip()


def main() -> int:
    parser = argparse.ArgumentParser(description="发现 MarketWatch 网站新闻")
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
                "articles": [normalize_list_item(item) for item in list_items(payload)],
                "has_next_page": has_next_page(payload),
            }
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, **output}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
