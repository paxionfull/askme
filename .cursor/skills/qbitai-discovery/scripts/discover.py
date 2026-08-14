#!/usr/bin/env python3
"""量子位发现层适配器 — WordPress REST API。"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import urllib.parse
from datetime import datetime
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo

from http_client import fetch_bytes, fetch_json, fetch_text, fetch_with_headers, sleep_between_pages

SHANGHAI = ZoneInfo("Asia/Shanghai")
BASE_URL = "https://www.qbitai.com"
API_URL = f"{BASE_URL}/wp-json/wp/v2/posts"

FEED_ID = "website:qbitai"
FEED_META = {
    "id": FEED_ID,
    "mpName": "量子位",
    "mpCover": "https://www.qbitai.com/wp-content/themes/liangziwei/imgnew/favicon.ico",
    "mpIntro": "追踪人工智能新趋势，报道科技行业新突破",
    "status": 1,
    "source": "website",
    "entryUrl": BASE_URL,
}
REFRESH_DEFAULTS = {"max_pages": 3, "per": 50}

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def _request(url: str) -> tuple[bytes, dict[str, str]]:
    return fetch_with_headers(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )


def _strip_html(text: str) -> str:
    if not text:
        return ""
    cleaned = re.sub(r"<[^>]+>", "", text)
    return html.unescape(cleaned).strip()


def _format_published_at(value: str) -> str:
    if not value:
        return ""
    try:
        return datetime.fromisoformat(value).astimezone(SHANGHAI).isoformat()
    except ValueError:
        pass
    try:
        return parsedate_to_datetime(value).astimezone(SHANGHAI).isoformat()
    except (TypeError, ValueError):
        return value


def fetch_list_page(page: int = 1, per: int = 20) -> dict:
    query = urllib.parse.urlencode(
        {
            "page": page,
            "per_page": per,
            "_fields": "id,link,title,date,excerpt,content",
        }
    )
    body, headers = _request(f"{API_URL}?{query}")
    items = json.loads(body.decode("utf-8"))
    if not isinstance(items, list):
        raise ValueError("量子位 API 返回格式异常")
    total_pages = int(headers.get("x-wp-totalpages", "1") or 1)
    return {"items": items, "page": page, "total_pages": total_pages}


def list_items(payload: dict) -> list[dict]:
    items = payload.get("items")
    return items if isinstance(items, list) else []


def has_next_page(payload: dict) -> bool:
    page = int(payload.get("page", 1))
    total_pages = int(payload.get("total_pages", 1))
    return page < total_pages


def normalize_list_item(item: dict) -> dict:
    post_id = str(item.get("id", ""))
    title = item.get("title") or {}
    title_text = title.get("rendered", "") if isinstance(title, dict) else str(title)
    excerpt = item.get("excerpt") or {}
    excerpt_html = excerpt.get("rendered", "") if isinstance(excerpt, dict) else str(excerpt)
    return {
        "id": post_id,
        "title": _strip_html(title_text),
        "url": item.get("link", ""),
        "published_at": _format_published_at(item.get("date", "")),
        "author": "量子位",
        "image": "",
        "summary": _strip_html(excerpt_html),
    }


def fetch_article_detail(article_id: str, **hints) -> dict:
    body, _ = _request(f"{API_URL}/{article_id}?_fields=id,link,title,date,content,excerpt")
    item = json.loads(body.decode("utf-8"))
    if not isinstance(item, dict):
        raise ValueError("量子位文章详情格式异常")
    normalized = normalize_list_item(item)
    content = item.get("content") or {}
    content_html = content.get("rendered", "") if isinstance(content, dict) else str(content)
    return {
        **normalized,
        "content_html": content_html,
    }


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    from content_utils import clean_html_fragment

    return clean_html_fragment(raw_html)


def main() -> int:
    parser = argparse.ArgumentParser(description="发现量子位文章")
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--per", type=int, default=20)
    parser.add_argument("--id", type=str, default="", help="文章 ID")
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
