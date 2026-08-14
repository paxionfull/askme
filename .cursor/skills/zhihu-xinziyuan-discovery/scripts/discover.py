#!/usr/bin/env python3
"""知乎 新智元 发现层适配器。"""

from __future__ import annotations

import argparse
import json
import sys

import zhihu_common as z

from http_client import fetch_bytes, fetch_json, fetch_text, sleep_between_pages

USER_ID = "xin-zhi-yuan-88-3"
USER_TYPE = "people"
PAGE_URL = f"https://www.zhihu.com/{USER_TYPE}/{USER_ID}/posts"

FEED_ID = "website:zhihu:xinziyuan"
FEED_META = {
    "id": FEED_ID,
    "mpName": "新智元",
    "mpCover": "",
    "mpIntro": "知乎机构号 · 新智元",
    "status": 1,
    "source": "website",
    "entryUrl": PAGE_URL,
}
REFRESH_DEFAULTS = {"max_pages": 3, "per": 20}


def fetch_list_page(page: int = 1, per: int = 20) -> dict:
    return z.fetch_articles_page(usertype=USER_TYPE, user_id=USER_ID, page=page, per=per)


def list_items(payload: dict) -> list[dict]:
    items = payload.get("data")
    return items if isinstance(items, list) else []


def has_next_page(payload: dict) -> bool:
    paging = payload.get("paging") or {}
    return not bool(paging.get("is_end"))


def normalize_list_item(item: dict) -> dict:
    data = z.normalize_article(item)
    return {
        "id": data["id"],
        "title": data["title"],
        "url": data["url"],
        "published_at": data["published_at"],
        "author": data["author"],
        "image": data["image"],
        "summary": data["summary"],
    }


def fetch_article_detail(article_id: str, **hints) -> dict:
    return z.fetch_article_by_id(article_id, page_url=PAGE_URL)


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    return z.normalize_article_body(raw_html, article_id=article_id)


def main() -> int:
    parser = argparse.ArgumentParser(description="发现知乎 新智元 文章")
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
