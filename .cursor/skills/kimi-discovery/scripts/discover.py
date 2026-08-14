#!/usr/bin/env python3
"""Kimi Blog 发现层适配器 — sitemap 列表 + 文章页 HTML 正文。"""

from __future__ import annotations

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime
from html import unescape
from zoneinfo import ZoneInfo

from http_client import fetch_bytes, fetch_json, fetch_text, sleep_between_pages
from list_index import ListByIdIndex

SHANGHAI = ZoneInfo("Asia/Shanghai")
BASE_URL = "https://www.kimi.com"
ENTRY_URL = f"{BASE_URL}/blog/"
BLOG_SITEMAP_URL = f"{BASE_URL}/sitemap/sitemap-ug-blog.xml"
LOGO_URL = "https://statics.moonshot.cn/kimi-web-seo/assets/kimi-logo-CegIMkbU.png"

FEED_ID = "website:kimi"
FEED_META = {
    "id": FEED_ID,
    "mpName": "Kimi",
    "mpCover": LOGO_URL,
    "mpIntro": "Kimi（月之暗面）官方技术博客",
    "status": 1,
    "source": "website",
    "entryUrl": ENTRY_URL,
}
REFRESH_DEFAULTS = {"max_pages": 1, "per": 50}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "application/xml,text/xml,text/html,*/*",
    "Referer": ENTRY_URL,
}

NS_SM = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}

_CACHE_ITEMS: list[dict] | None = None
_LIST_INDEX = ListByIdIndex()


def _request_text(url: str, *, accept_html: bool = False) -> str:
    headers = dict(HEADERS)
    if accept_html:
        headers["Accept"] = "text/html,application/xhtml+xml,*/*"
    return fetch_text(url, headers=headers)


def _to_iso_shanghai(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        return datetime.strptime(raw, "%Y-%m-%d").replace(tzinfo=SHANGHAI).isoformat()
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(SHANGHAI).isoformat()
    except ValueError:
        return raw


def _slug_from_url(url: str) -> str:
    path = re.sub(r"^https?://[^/]+", "", (url or "").strip()).rstrip("/")
    if not path.startswith("/blog/"):
        return ""
    slug = path[len("/blog/") :].strip("/")
    if not slug or "/" in slug:
        return ""
    return slug


def _title_from_slug(slug: str) -> str:
    cleaned = re.sub(r"[-_]+", " ", (slug or "").strip()).strip()
    if not cleaned:
        return ""
    return cleaned.title()


def _wanted_loc(loc: str) -> bool:
    if not loc.startswith(f"{BASE_URL}/blog/"):
        return False
    return bool(_slug_from_url(loc))


def _enrich_titles_from_blog_index(rows: list[dict]) -> None:
    """从 /blog/ 入口页侧栏/卡片链接补全标题。"""
    try:
        html = _request_text(ENTRY_URL, accept_html=True)
    except Exception:
        return
    by_slug = {str(r.get("id", "")): r for r in rows}
    pattern = re.compile(
        r'href="(?:https://www\.kimi\.com)?/blog/([a-zA-Z0-9][\w-]*)"[^>]*>'
        r'(?P<body>.*?)</a>',
        re.S,
    )
    for match in pattern.finditer(html):
        slug = match.group(1)
        row = by_slug.get(slug)
        if not row:
            continue
        spans = re.findall(r"<span[^>]*>(.*?)</span>", match.group("body"), re.S)
        texts = [unescape(re.sub(r"<[^>]+>", "", s)).strip() for s in spans]
        texts = [t for t in texts if t]
        if not texts:
            continue
        title = texts[0]
        if len(texts) >= 2 and texts[1] and texts[1] not in title:
            title = f"{texts[0]}: {texts[1]}"
        if title and (not row.get("title") or row.get("title") == _title_from_slug(slug)):
            row["title"] = title
            if len(texts) >= 2:
                row["summary"] = texts[1]


def _collect_items(*, force: bool = False) -> list[dict]:
    global _CACHE_ITEMS
    if _CACHE_ITEMS is not None and not force:
        return _CACHE_ITEMS

    xml_text = _request_text(BLOG_SITEMAP_URL)
    root = ET.fromstring(xml_text)
    rows: list[dict] = []
    for node in root.findall("sm:url", NS_SM):
        loc = (node.findtext("sm:loc", "", NS_SM) or "").strip()
        if not loc or not _wanted_loc(loc):
            continue
        slug = _slug_from_url(loc)
        lastmod = (node.findtext("sm:lastmod", "", NS_SM) or "").strip()
        rows.append(
            {
                "id": slug,
                "url": loc.rstrip("/") if loc.endswith("/") else loc,
                "title": _title_from_slug(slug),
                "published_at": _to_iso_shanghai(lastmod),
                "author": "Kimi",
                "image": "",
                "summary": "",
                "lastmod": lastmod,
            }
        )
    rows.sort(key=lambda x: x.get("published_at", ""), reverse=True)
    _enrich_titles_from_blog_index(rows)
    _LIST_INDEX.rebuild(rows)
    _CACHE_ITEMS = rows
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
    slug = str(item.get("id", "")).strip()
    url = str(item.get("url", "")).strip() or (f"{BASE_URL}/blog/{slug}" if slug else "")
    return {
        "id": slug,
        "title": str(item.get("title", "")).strip() or _title_from_slug(slug),
        "url": url,
        "published_at": str(item.get("published_at", "")).strip(),
        "author": str(item.get("author", "")).strip() or "Kimi",
        "image": str(item.get("image", "")).strip(),
        "summary": str(item.get("summary", "")).strip(),
    }


def _extract_meta(html: str, key: str) -> str:
    pattern = (
        rf'<meta[^>]+(?:property|name)=["\']{re.escape(key)}["\'][^>]+content=["\']([^"\']*)["\']'
    )
    match = re.search(pattern, html, re.IGNORECASE)
    if not match:
        pattern = (
            rf'<meta[^>]+content=["\']([^"\']*)["\'][^>]+(?:property|name)=["\']{re.escape(key)}["\']'
        )
        match = re.search(pattern, html, re.IGNORECASE)
    return unescape(match.group(1).strip()) if match else ""


def _extract_h1(html: str) -> str:
    match = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.IGNORECASE | re.DOTALL)
    if not match:
        return ""
    return unescape(re.sub(r"<[^>]+>", "", match.group(1))).strip()


def _extract_jsonld_article(html: str) -> dict:
    for match in re.finditer(
        r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html,
        re.IGNORECASE | re.DOTALL,
    ):
        raw = match.group(1).strip()
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        nodes: list = []
        if isinstance(data, dict) and "@graph" in data:
            graph = data.get("@graph")
            if isinstance(graph, list):
                nodes = graph
        elif isinstance(data, dict):
            nodes = [data]
        elif isinstance(data, list):
            nodes = data
        for node in nodes:
            if isinstance(node, dict) and node.get("@type") == "Article":
                return node
    return {}


def _extract_hero_image(html: str) -> str:
    match = re.search(
        r'BlogV2Hero-module__[A-Za-z0-9_-]+__media[^>]*>.*?<img[^>]+src=["\']([^"\']+)["\']',
        html,
        re.IGNORECASE | re.DOTALL,
    )
    return match.group(1).strip() if match else ""


def _extract_article_body(html: str) -> str:
    start = html.find('<div class="max-w-none markdown">')
    if start < 0:
        start = html.find('class="max-w-none markdown"')
        if start >= 0:
            start = html.rfind("<div", 0, start)
    if start < 0:
        return ""
    end_markers = (
        'class="BlogV2MiniNav-module',
        'class="blog-v2-mini-nav',
        'BlogV2MiniNav-module',
    )
    end = -1
    for marker in end_markers:
        pos = html.find(marker, start + 10)
        if pos >= 0 and (end < 0 or pos < end):
            end = pos
    if end < 0:
        # fallback: take a large chunk after markdown start
        chunk = html[start : start + 400_000]
    else:
        # rewind to nearest opening tag before mini-nav wrapper
        chunk = html[start:end]
        close = chunk.rfind("</div>")
        if close > 0:
            chunk = chunk[:close]
    return chunk.strip()


def _lookup_item(article_id: str) -> dict:
    _collect_items()
    return _LIST_INDEX.get(article_id)


def fetch_article_detail(article_id: str, **hints) -> dict:
    from detail_hints import pick_hints, resolve_detail_url

    meta = pick_hints(**hints)
    slug = str(article_id or "").strip().strip("/")
    url = resolve_detail_url(article_id, **hints) or meta.get("url", "")
    item: dict = {}
    if not url:
        item = _lookup_item(slug)
        url = str(item.get("url", "")).strip()
    if not url and slug:
        url = f"{BASE_URL}/blog/{slug}"

    html = _request_text(url, accept_html=True)
    ld = _extract_jsonld_article(html)
    title = (
        meta.get("title")
        or _extract_h1(html)
        or str(ld.get("headline", "")).strip()
        or str(item.get("title", "")).strip()
        or _title_from_slug(slug)
    )
    published_at = meta.get("published_at") or str(item.get("published_at", "")).strip()
    author_obj = ld.get("author")
    author = meta.get("author") or "Kimi"
    if isinstance(author_obj, dict) and author_obj.get("name"):
        author = str(author_obj.get("name")).strip() or author
    image = meta.get("image") or _extract_hero_image(html) or str(item.get("image", "")).strip()
    summary = meta.get("summary") or _extract_meta(html, "description") or str(item.get("summary", "")).strip()
    content_html = _extract_article_body(html)
    if not content_html:
        content_html = html

    return {
        "id": slug,
        "title": title,
        "url": url,
        "published_at": published_at,
        "author": author,
        "image": image,
        "summary": summary,
        "content_html": content_html,
    }


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    from content_utils import clean_html_fragment

    _ = article_id
    return clean_html_fragment(raw_html)


def main() -> int:
    parser = argparse.ArgumentParser(description="发现 Kimi Blog 文章")
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--per", type=int, default=20)
    parser.add_argument("--id", type=str, default="", help="文章 slug")
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
