#!/usr/bin/env python3
"""Reddit 脚手架模板（占位符替换）；运行时以 reddit-platform-discovery 为准。

占位：__ASKME_SUBREDDIT__ / __ASKME_FEED_ID__ / __ASKME_DISPLAY_NAME__
"""

from __future__ import annotations

import argparse
import json
import sys

import reddit_common as r
from http_client import fetch_text  # noqa: F401 — 静态校验要求 discover 直接引用 http_client

SUBREDDIT = "__ASKME_SUBREDDIT__"
ENTRY_URL = f"{r.BASE_URL}/r/{SUBREDDIT}/"

FEED_ID = "__ASKME_FEED_ID__"
FEED_META = {
    "id": FEED_ID,
    "mpName": "__ASKME_DISPLAY_NAME__",
    "mpCover": "https://www.redditstatic.com/desktop2x/img/favicon/android-icon-192x192.png",
    "mpIntro": "__ASKME_DISPLAY_NAME__",
    "status": 1,
    "source": "website",
    "entryUrl": ENTRY_URL,
}
REFRESH_DEFAULTS = {"max_pages": 3, "per": 25}


def fetch_list_page(page: int = 1, per: int = 25) -> dict:
    return r.fetch_list_page(SUBREDDIT, page=page, per=per)


def list_items(payload: dict) -> list[dict]:
    return r.list_items(payload)


def has_next_page(payload: dict) -> bool:
    return r.has_next_page(payload)


def normalize_list_item(item: dict) -> dict:
    return r.normalize_list_item(item)


def fetch_article_detail(article_id: str, **hints) -> dict:
    return r.fetch_article_detail(SUBREDDIT, article_id, **hints)


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    return r.normalize_article_body(raw_html, article_id=article_id)


def main() -> int:
    parser = argparse.ArgumentParser(description=f"发现 Reddit r/{SUBREDDIT} 帖子")
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--per", type=int, default=25)
    parser.add_argument("--id", type=str, default="")
    parser.add_argument("--url", type=str, default="")
    args = parser.parse_args()
    try:
        if args.id:
            hints = {"url": args.url} if args.url else {}
            output = fetch_article_detail(args.id, **hints)
        else:
            payload = fetch_list_page(page=args.page, per=args.per)
            output = {
                "articles": [normalize_list_item(item) for item in list_items(payload)],
                "has_next_page": has_next_page(payload),
            }
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, **output}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
