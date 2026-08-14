#!/usr/bin/env python3
"""知乎用户发现层脚手架模板（占位符替换）；运行时以 zhihu-platform-discovery 为准。

占位：__ASKME_USER_ID__ / __ASKME_USER_TYPE__ / __ASKME_PAGE_URL__ /
__ASKME_FEED_ID__ / __ASKME_DISPLAY_NAME__
"""

from __future__ import annotations

import argparse
import json
import sys

import zhihu_common as z

USER_ID = "__ASKME_USER_ID__"
USER_TYPE = "__ASKME_USER_TYPE__"
PAGE_URL = "__ASKME_PAGE_URL__"

FEED_ID = "__ASKME_FEED_ID__"
FEED_META = {
    "id": FEED_ID,
    "mpName": "__ASKME_DISPLAY_NAME__",
    "mpCover": "",
    "mpIntro": "__ASKME_DISPLAY_NAME__",
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
    from detail_hints import pick_hints

    _ = pick_hints(**hints)
    return z.fetch_article_by_id(article_id, page_url=PAGE_URL)


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    return z.normalize_article_body(raw_html, article_id=article_id)


def main() -> int:
    parser = argparse.ArgumentParser(description="发现知乎文章")
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
