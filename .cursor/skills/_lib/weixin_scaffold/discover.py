#!/usr/bin/env python3
"""微信公众号发现层适配器（脚手架模板）。

占位符由 scaffold_weixin_files 替换：
  __ASKME_FAKEID__ / __ASKME_FEED_ID__ / __ASKME_DISPLAY_NAME__ / __ASKME_ENTRY_URL__
"""

from __future__ import annotations

import argparse
import json
import sys

import weixin_common as w
from http_client import fetch_text  # noqa: F401 — 静态校验要求 discover 直接引用 http_client

FAKEID = "__ASKME_FAKEID__"
ENTRY_URL = "__ASKME_ENTRY_URL__"

FEED_ID = "__ASKME_FEED_ID__"
FEED_META = {
    "id": FEED_ID,
    "mpName": "__ASKME_DISPLAY_NAME__",
    "mpCover": "https://res.wx.qq.com/a/wx_fed/assets/res/NTI4MWU5.ico",
    "mpIntro": "__ASKME_DISPLAY_NAME__",
    "status": 1,
    "source": "website",
    "entryUrl": ENTRY_URL,
}
REFRESH_DEFAULTS = {"max_pages": 3, "per": 20}


def fetch_list_page(page: int = 1, per: int = 10) -> dict:
    return w.fetch_list_page(FAKEID, page=page, per=per)


def list_items(payload: dict) -> list[dict]:
    return w.list_items(payload)


def has_next_page(payload: dict) -> bool:
    return w.has_next_page(payload)


def normalize_list_item(item: dict) -> dict:
    return w.normalize_list_item(item)


def fetch_article_detail(article_id: str, **hints) -> dict:
    return w.fetch_article_detail(FAKEID, article_id, **hints)


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    return w.normalize_article_body(raw_html, article_id=article_id)


def main() -> int:
    parser = argparse.ArgumentParser(description="发现微信公众号文章")
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--per", type=int, default=10)
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
