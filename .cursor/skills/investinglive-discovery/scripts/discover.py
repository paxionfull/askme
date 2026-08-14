#!/usr/bin/env python3
"""Investinglive 发现层适配器（stocks 频道）。"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime
from zoneinfo import ZoneInfo

from http_client import fetch_bytes, fetch_json, fetch_text, sleep_between_pages

SHANGHAI = ZoneInfo("Asia/Shanghai")
BASE_URL = "https://investinglive.com"
ENTRY_URL = f"{BASE_URL}/stocks/"
LATEST_SITEMAP_URL = f"{BASE_URL}/latest.xml"

FEED_ID = "website:investinglive"
FEED_META = {
    "id": FEED_ID,
    "mpName": "Investinglive",
    "mpCover": "",
    "mpIntro": "InvestingLive stocks updates and analysis.",
    "status": 1,
    "source": "website",
    "entryUrl": ENTRY_URL,
}
REFRESH_DEFAULTS = {"max_pages": 3, "per": 50}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "application/xml,text/xml,text/html,*/*",
}
NS = {
    "sm": "http://www.sitemaps.org/schemas/sitemap/0.9",
    "news": "http://www.google.com/schemas/sitemap-news/0.9",
}


def _request_text(url: str, *, referer: str | None = None) -> str:
    headers = dict(HEADERS)
    if referer:
        headers["Referer"] = referer
    return fetch_text(url, headers=headers)


def _to_iso_shanghai(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=SHANGHAI)
        return parsed.astimezone(SHANGHAI).isoformat()
    except ValueError:
        return raw


def _path_id(url: str) -> str:
    path = urllib.parse.urlparse(url).path
    return path.lstrip("/")


def _article_url(article_id: str) -> str:
    cleaned = article_id.strip().lstrip("/")
    return f"{BASE_URL}/{cleaned}"


_CACHE_ITEMS: list[dict] | None = None


def _collect_items(*, force: bool = False) -> list[dict]:
    global _CACHE_ITEMS
    if _CACHE_ITEMS is not None and not force:
        return _CACHE_ITEMS

    xml_text = _request_text(LATEST_SITEMAP_URL, referer=ENTRY_URL)
    root = ET.fromstring(xml_text)
    rows: list[dict] = []
    for node in root.findall("sm:url", NS):
        loc = (node.findtext("sm:loc", "", NS) or "").strip()
        if not loc.startswith(f"{ENTRY_URL}"):
            continue
        title = (node.findtext("news:news/news:title", "", NS) or "").strip()
        published_at = (node.findtext("news:news/news:publication_date", "", NS) or "").strip()
        rows.append(
            {
                "id": _path_id(loc),
                "url": loc,
                "title": html.unescape(title),
                "published_at": _to_iso_shanghai(published_at),
            }
        )
    rows.sort(key=lambda x: x.get("published_at", ""), reverse=True)
    _CACHE_ITEMS = rows
    return _CACHE_ITEMS


def fetch_list_page(page: int = 1, per: int = 20) -> dict:
    all_items = _collect_items(force=(page <= 1))
    page = max(1, int(page))
    per = max(1, int(per))
    start = (page - 1) * per
    end = start + per
    return {"items": all_items[start:end], "page": page, "per": per, "total": len(all_items)}


def _extract_json_ld(raw_html: str) -> dict:
    scripts = re.findall(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        raw_html,
        re.IGNORECASE | re.DOTALL,
    )
    for raw in scripts:
        text = raw.strip()
        if not text:
            continue
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            continue
        items = data if isinstance(data, list) else [data]
        for item in items:
            if isinstance(item, dict) and item.get("@type") in {"NewsArticle", "Article"}:
                return item
    return {}


def _html_from_article_body(article_body: str) -> str:
    clean = html.unescape(str(article_body or "")).strip()
    if not clean:
        return ""
    parts = [p.strip() for p in re.split(r"\n{2,}", clean) if p.strip()]
    if not parts:
        return f"<article><p>{html.escape(clean)}</p></article>"
    paras = "".join(f"<p>{html.escape(part)}</p>" for part in parts)
    return f"<article>{paras}</article>"


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
        "author": "Investinglive",
        "image": "",
        "summary": "Investinglive stocks article.",
    }


def fetch_article_detail(article_id: str, **hints) -> dict:
    from detail_hints import pick_hints

    meta = pick_hints(**hints)
    url = meta.get("url") or _article_url(article_id)
    raw_html = _request_text(url, referer=ENTRY_URL)
    json_ld = _extract_json_ld(raw_html)

    title = meta.get("title") or str(json_ld.get("headline", "")).strip()
    if not title:
        title_match = re.search(r"<title[^>]*>(.*?)</title>", raw_html, re.IGNORECASE | re.DOTALL)
        if title_match:
            title = html.unescape(re.sub(r"\s+", " ", title_match.group(1))).strip()

    published_at = meta.get("published_at") or _to_iso_shanghai(str(json_ld.get("datePublished", "")).strip())

    author = "Investinglive"
    author_obj = json_ld.get("author")
    if isinstance(author_obj, dict):
        author = str(author_obj.get("name", "")).strip() or author
    elif isinstance(author_obj, list) and author_obj:
        first = author_obj[0]
        if isinstance(first, dict):
            author = str(first.get("name", "")).strip() or author
        else:
            author = str(first).strip() or author
    elif isinstance(author_obj, str):
        author = author_obj.strip() or author

    image = ""
    image_obj = json_ld.get("image")
    if isinstance(image_obj, list) and image_obj:
        image = str(image_obj[0]).strip()
    elif isinstance(image_obj, str):
        image = image_obj.strip()

    body_html = _html_from_article_body(str(json_ld.get("articleBody", "")).strip())
    if not body_html:
        body_html = raw_html

    return {
        "id": article_id,
        "title": title,
        "url": url,
        "published_at": published_at,
        "author": author,
        "image": image,
        "content_html": body_html,
    }


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    return str(raw_html or "").strip()


def main() -> int:
    parser = argparse.ArgumentParser(description="发现 Investinglive stocks 文章")
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
