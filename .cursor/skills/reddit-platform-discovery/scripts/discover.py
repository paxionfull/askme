#!/usr/bin/env python3
"""Reddit 平台发现层 — 多 subreddit 共用。"""

from __future__ import annotations

import argparse
import json
import sys

import reddit_common as r
from http_client import fetch_text  # noqa: F401
from platform_account_ctx import require_account

PLATFORM = "reddit"
DEFAULT_COVER = (
    "https://www.redditstatic.com/desktop2x/img/favicon/android-icon-192x192.png"
)
FEED_ID = "website:reddit:__platform__"
FEED_META = {
    "id": FEED_ID,
    "mpName": "Reddit",
    "mpCover": DEFAULT_COVER,
    "mpIntro": "Reddit（多社区）",
    "status": 1,
    "source": "website",
    "entryUrl": r.BASE_URL,
}
REFRESH_DEFAULTS = {"max_pages": 3, "per": 25}


def _sub() -> str:
    return str(require_account().get("account_key") or "").strip()


def fetch_list_page(page: int = 1, per: int = 25) -> dict:
    return r.fetch_list_page(_sub(), page=page, per=per)


def list_items(payload: dict) -> list[dict]:
    return r.list_items(payload)


def has_next_page(payload: dict) -> bool:
    return r.has_next_page(payload)


def normalize_list_item(item: dict) -> dict:
    return r.normalize_list_item(item)


def fetch_article_detail(article_id: str, **hints) -> dict:
    return r.fetch_article_detail(_sub(), article_id, **hints)


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    normalize = getattr(r, "normalize_article_body", None)
    if callable(normalize):
        return normalize(raw_html, article_id=article_id)
    return raw_html


def main() -> int:
    parser = argparse.ArgumentParser(description="发现 Reddit 帖子（需绑定账号上下文）")
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--per", type=int, default=25)
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
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, **output}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
