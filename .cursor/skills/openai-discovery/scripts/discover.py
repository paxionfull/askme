#!/usr/bin/env python3
"""OpenAI News discovery adapter via OpenAI sitemap."""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import xml.etree.ElementTree as ET
from datetime import datetime
from zoneinfo import ZoneInfo

from http_client import fetch_bytes, fetch_json, fetch_text, sleep_between_pages

SHANGHAI = ZoneInfo("Asia/Shanghai")
BASE_URL = "https://openai.com"
ENTRY_URL = "https://openai.com/zh-Hans-CN/news/"
SITEMAP_INDEX_URL = f"{BASE_URL}/sitemap.xml"
DEFAULT_NEWS_SITEMAPS = [f"{BASE_URL}/sitemap.xml/global-affairs-news-listed/"]

FEED_ID = "website:openai"
FEED_META = {
    "id": FEED_ID,
    "mpName": "Openai",
    "mpCover": "",
    "mpIntro": "OpenAI 官网 News 更新",
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
NS_SM = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
NS_XHTML = {"xhtml": "http://www.w3.org/1999/xhtml"}


def _request_text(url: str) -> str:
    try:
        return fetch_text(url, headers=HEADERS)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "ignore")
        if body:
            return body
        raise


def _extract_title(html: str) -> str:
    match = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    if not match:
        return ""
    return re.sub(r"\s+", " ", match.group(1)).strip()


def _parse_time(value: str) -> str:
    if not value:
        return ""
    raw = value.strip()
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(SHANGHAI).isoformat()
    except ValueError:
        return raw


def _path_id_from_url(url: str) -> str:
    if not url:
        return ""
    path = url.replace(BASE_URL, "").strip("/")
    return path


def _url_from_path_id(path_id: str) -> str:
    if not path_id:
        return ""
    return f"{BASE_URL}/{path_id.strip('/')}/"


def _discover_news_sitemaps() -> list[str]:
    text = _request_text(SITEMAP_INDEX_URL)
    root = ET.fromstring(text)
    urls: list[str] = []
    for node in root.findall("sm:sitemap", NS_SM):
        loc = (node.findtext("sm:loc", "", NS_SM) or "").strip()
        if not loc:
            continue
        if "news-listed" in loc:
            urls.append(loc)
    return urls or DEFAULT_NEWS_SITEMAPS


def _pick_zh_hans_link(url_node: ET.Element, fallback_loc: str) -> str:
    for link in url_node.findall("xhtml:link", NS_XHTML):
        hreflang = (link.attrib.get("hreflang") or "").strip()
        href = (link.attrib.get("href") or "").strip()
        if hreflang == "zh-Hans-CN" and href:
            return href
    return fallback_loc


_CACHE_ITEMS: list[dict] | None = None


def _collect_items(*, force: bool = False) -> list[dict]:
    global _CACHE_ITEMS
    if _CACHE_ITEMS is not None and not force:
        return _CACHE_ITEMS

    rows: list[dict] = []
    for sitemap_url in _discover_news_sitemaps():
        xml_text = _request_text(sitemap_url)
        root = ET.fromstring(xml_text)
        for node in root.findall("sm:url", NS_SM):
            loc = (node.findtext("sm:loc", "", NS_SM) or "").strip()
            if not loc:
                continue
            url = _pick_zh_hans_link(node, fallback_loc=loc)
            rows.append(
                {
                    "id": _path_id_from_url(loc),
                    "url": url,
                    "loc": loc,
                    "lastmod": (node.findtext("sm:lastmod", "", NS_SM) or "").strip(),
                }
            )
    rows.sort(key=lambda x: x.get("lastmod", ""), reverse=True)
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
    article_url = item.get("url") or _url_from_path_id(str(item.get("id", "")))
    article_id = str(item.get("id", "")).strip("/")
    slug = article_id.rsplit("/", 1)[-1] if article_id else ""
    title = slug.replace("-", " ").strip().title() if slug else article_id
    return {
        "id": article_id,
        "title": title or article_id,
        "url": article_url,
        "published_at": _parse_time(str(item.get("lastmod", ""))),
        "author": "OpenAI",
        "image": "",
        "summary": "",
    }


def fetch_article_detail(article_id: str, **hints) -> dict:
    from detail_hints import pick_hints

    meta = pick_hints(**hints)
    article_url = meta.get("url") or _url_from_path_id(article_id)
    html = _request_text(article_url)
    title = meta.get("title") or _extract_title(html) or article_id.rsplit("/", 1)[-1].replace("-", " ").title()
    if len(html.strip()) < 80:
        html = (
            f"<p>OpenAI 页面：{article_url}</p>"
            "<p>页面正文受 Cloudflare 挑战保护，当前环境无法直接抓取完整 HTML。</p>"
        )
    return {
        "id": article_id,
        "title": title,
        "url": article_url,
        "published_at": "",
        "author": "OpenAI",
        "image": "",
        "content_html": html,
    }


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    return str(raw_html or "").strip()


def main() -> int:
    parser = argparse.ArgumentParser(description="发现 OpenAI News 文章")
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
