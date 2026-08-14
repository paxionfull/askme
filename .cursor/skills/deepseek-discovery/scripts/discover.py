#!/usr/bin/env python3
"""Deepseek 博客发现层适配器（Supabase REST）。"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
from datetime import datetime
from zoneinfo import ZoneInfo

from http_client import fetch_bytes, fetch_json, fetch_text, sleep_between_pages

SHANGHAI = ZoneInfo("Asia/Shanghai")
BASE_URL = "https://deepseek.ai"
ENTRY_URL = f"{BASE_URL}/blog"
SUPABASE_URL = "https://fnlfrdinxtwkhzbmyawv.supabase.co"
LIST_API = f"{SUPABASE_URL}/rest/v1/blog_posts"
ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZubGZyZGlueHR3a2h6Ym15YXd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc3OTE1MDgsImV4cCI6MjA1MzM2NzUwOH0."
    "tm49bNkTr2x0Q9esdnfcv2y-gpylp18b2w2GC0oEm7w"
)

FEED_ID = "website:deepseek"
FEED_META = {
    "id": FEED_ID,
    "mpName": "Deepseek",
    "mpCover": "https://deepseek.ai/favicon-ai.png?v=3",
    "mpIntro": "Deepseek 博客内容聚合（来源 deepseek.ai/blog）",
    "status": 1,
    "source": "website",
    "entryUrl": ENTRY_URL,
}
REFRESH_DEFAULTS = {"max_pages": 3, "per": 50}

DEFAULT_HEADERS = {
    "Accept": "application/json",
    "apikey": ANON_KEY,
    "Authorization": f"Bearer {ANON_KEY}",
    "Referer": ENTRY_URL,
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
}


def _request_json(url: str) -> list[dict]:
    raw = fetch_bytes(url, headers=DEFAULT_HEADERS).decode("utf-8")
    data = json.loads(raw)
    if not isinstance(data, list):
        raise ValueError("Deepseek API 返回格式异常（期望数组）")
    return data


def _to_iso_shanghai(value: str) -> str:
    if not value:
        return ""
    normalized = value.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError:
        return value
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=SHANGHAI)
    return dt.astimezone(SHANGHAI).isoformat()


def fetch_list_page(page: int = 1, per: int = 20) -> dict:
    page = max(1, page)
    per = max(1, min(per, 50))
    offset = (page - 1) * per
    query = urllib.parse.urlencode(
        {
            "select": "id,title,slug,excerpt,category,published_at,hero_image_url",
            "status": "eq.published",
            "order": "published_at.desc",
            "limit": str(per),
            "offset": str(offset),
        }
    )
    items = _request_json(f"{LIST_API}?{query}")
    return {"items": items, "page": page, "per": per}


def list_items(payload: dict) -> list[dict]:
    items = payload.get("items")
    return items if isinstance(items, list) else []


def has_next_page(payload: dict) -> bool:
    items = list_items(payload)
    per = int(payload.get("per", 20) or 20)
    return len(items) >= per


def normalize_list_item(item: dict) -> dict:
    slug = str(item.get("slug", "") or "")
    return {
        "id": slug,
        "title": str(item.get("title", "") or ""),
        "url": f"{BASE_URL}/blog/{slug}" if slug else "",
        "published_at": _to_iso_shanghai(str(item.get("published_at", "") or "")),
        "author": "Deepseek",
        "image": str(item.get("hero_image_url", "") or ""),
        "summary": str(item.get("excerpt", "") or ""),
    }


def fetch_article_detail(article_id: str, **hints) -> dict:
    slug = str(article_id).strip()
    if not slug:
        raise ValueError("article_id 不能为空")
    query = urllib.parse.urlencode(
        {
            "select": "id,title,slug,excerpt,category,published_at,content,hero_image_url,meta_description",
            "slug": f"eq.{slug}",
            "status": "eq.published",
            "limit": "1",
        }
    )
    items = _request_json(f"{LIST_API}?{query}")
    if not items:
        raise ValueError(f"未找到文章: {slug}")
    item = items[0]
    normalized = normalize_list_item(item)
    content_html = str(item.get("content", "") or "")
    return {
        **normalized,
        "content_html": content_html,
    }


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    from content_utils import clean_html_fragment

    return clean_html_fragment(raw_html)


def main() -> int:
    parser = argparse.ArgumentParser(description="发现 Deepseek 博客文章")
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
