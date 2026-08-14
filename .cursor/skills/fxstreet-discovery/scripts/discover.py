#!/usr/bin/env python3
"""FXStreet 发现层适配器 — Google News Sitemap + 文章 HTML。"""

from __future__ import annotations

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime
from html import unescape
from zoneinfo import ZoneInfo

from content_utils import clean_html_fragment

from http_client import fetch_bytes, fetch_json, fetch_text, sleep_between_pages

SHANGHAI = ZoneInfo("Asia/Shanghai")
BASE_URL = "https://www.fxstreet.com"
ENTRY_URL = f"{BASE_URL}/news"
NEWS_SITEMAP_URL = f"{BASE_URL}/google-sitemap-news.xml"

FEED_ID = "website:fxstreet"
FEED_META = {
    "id": FEED_ID,
    "mpName": "Fxstreet",
    "mpCover": "https://staticcontent.fxsstatic.com/website/img/favicon.ico",
    "mpIntro": "FXStreet forex & crypto news",
    "status": 1,
    "source": "website",
    "entryUrl": ENTRY_URL,
}
REFRESH_DEFAULTS = {"max_pages": 3, "per": 50}

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

NS = {
    "sm": "http://www.sitemaps.org/schemas/sitemap/0.9",
    "news": "http://www.google.com/schemas/sitemap-news/0.9",
}


def _request_text(url: str, *, accept: str = "text/html,*/*") -> str:
    return fetch_text(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": accept,
            "Referer": ENTRY_URL,
        },
    )


def _parse_published_at(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    # Google News sitemap uses 7 fractional digits: 2026-07-08T09:55:10.0660000Z
    if re.match(r".*\.\d+Z$", raw):
        raw = re.sub(r"\.(\d+?)0*Z$", lambda m: f".{m.group(1)[:6].ljust(6, '0')}+00:00", raw)
    elif raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(raw).astimezone(SHANGHAI).isoformat()
    except ValueError:
        pass
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(raw, fmt).astimezone(SHANGHAI).isoformat()
        except ValueError:
            continue
    return value


def _id_from_url(url: str) -> str:
    path = url.replace(BASE_URL, "").strip("/")
    return path


def _url_from_id(article_id: str) -> str:
    path = str(article_id or "").strip("/")
    if not path:
        return ""
    if path.startswith("http"):
        return path
    return f"{BASE_URL}/{path}"


def _strip_tags(text: str) -> str:
    cleaned = re.sub(r"<[^>]+>", " ", text or "")
    cleaned = unescape(cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def _collect_sitemap_items() -> list[dict]:
    xml_text = _request_text(NEWS_SITEMAP_URL, accept="application/xml,text/xml,*/*")
    root = ET.fromstring(xml_text)
    items: list[dict] = []
    for node in root.findall("sm:url", NS):
        loc = (node.findtext("sm:loc", "", NS) or "").strip()
        if not loc or "/news/" not in loc:
            continue
        news = node.find("news:news", NS)
        title = ""
        published = ""
        keywords = ""
        if news is not None:
            title = (news.findtext("news:title", "", NS) or "").strip()
            published = (news.findtext("news:publication_date", "", NS) or "").strip()
            keywords = (news.findtext("news:keywords", "", NS) or "").strip()
        items.append(
            {
                "id": _id_from_url(loc),
                "url": loc,
                "title": title,
                "published_at": published,
                "keywords": keywords,
            }
        )
    # Sitemap is newest-first; keep that order and fall back to date sort.
    items.sort(key=lambda x: x.get("published_at", ""), reverse=True)
    return items


def fetch_list_page(page: int = 1, per: int = 20) -> dict:
    all_items = _collect_sitemap_items()
    page = max(1, int(page))
    per = max(1, int(per))
    start = (page - 1) * per
    end = start + per
    return {
        "items": all_items[start:end],
        "page": page,
        "per": per,
        "total": len(all_items),
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
    article_id = str(item.get("id", "")).strip("/")
    url = item.get("url") or _url_from_id(article_id)
    title = (item.get("title") or "").strip()
    if not title and article_id:
        slug = article_id.rsplit("/", 1)[-1]
        # drop trailing YYYYMMDDHHMM stamp if present
        slug = re.sub(r"-\d{12}$", "", slug)
        title = slug.replace("-", " ").strip().title()
    return {
        "id": article_id,
        "title": title,
        "url": url,
        "published_at": _parse_published_at(str(item.get("published_at", ""))),
        "author": "FXStreet",
        "image": "",
        "summary": "",
    }


def _extract_json_ld_news(html: str) -> dict:
    for match in re.finditer(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html,
        re.IGNORECASE | re.DOTALL,
    ):
        raw = match.group(1).strip()
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict) and data.get("@type") == "NewsArticle":
            return data
        if isinstance(data, list):
            for entry in data:
                if isinstance(entry, dict) and entry.get("@type") == "NewsArticle":
                    return entry
    return {}


def _extract_article_html(html: str) -> str:
    match = re.search(
        r'(<article\b[^>]*class="[^"]*flex flex-col gap-8[^"]*"[^>]*>[\s\S]*?</article>)',
        html,
        re.IGNORECASE,
    )
    if match:
        return match.group(1).strip()
    match = re.search(r"(<article\b[^>]*>[\s\S]*?</article>)", html, re.IGNORECASE)
    return match.group(1).strip() if match else ""


def _author_from_ld(data: dict) -> str:
    author = data.get("author")
    if isinstance(author, dict):
        return str(author.get("name", "") or "").strip()
    if isinstance(author, list) and author:
        first = author[0]
        if isinstance(first, dict):
            return str(first.get("name", "") or "").strip()
        return str(first).strip()
    if isinstance(author, str):
        return author.strip()
    return "FXStreet"


def _image_from_ld(data: dict) -> str:
    image = data.get("image")
    if isinstance(image, list) and image:
        return str(image[0] or "").strip()
    if isinstance(image, dict):
        return str(image.get("url", "") or "").strip()
    if isinstance(image, str):
        return image.strip()
    return ""


def fetch_article_detail(article_id: str, **hints) -> dict:
    article_url = _url_from_id(article_id)
    html = _request_text(article_url)
    ld = _extract_json_ld_news(html)
    title = str(ld.get("headline") or ld.get("name") or "").strip()
    if not title:
        title_match = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.IGNORECASE | re.DOTALL)
        title = _strip_tags(title_match.group(1)) if title_match else article_id
    published_at = _parse_published_at(str(ld.get("datePublished", "") or ""))
    content_html = _extract_article_html(html)
    if not content_html and ld.get("articleBody"):
        body = unescape(str(ld["articleBody"]))
        content_html = "".join(f"<p>{unescape(p.strip())}</p>" for p in body.split("\n") if p.strip())
        if not content_html:
            content_html = f"<p>{body}</p>"
    return {
        "id": str(article_id).strip("/"),
        "title": title,
        "url": article_url,
        "published_at": published_at,
        "author": _author_from_ld(ld) or "FXStreet",
        "image": _image_from_ld(ld),
        "summary": "",
        "content_html": content_html,
    }


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    _ = article_id
    return clean_html_fragment(str(raw_html or ""))


def main() -> int:
    parser = argparse.ArgumentParser(description="发现 FXStreet 文章")
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
