#!/usr/bin/env python3
"""知乎平台发现层 — 多用户共用，账号参数来自 platform_accounts 上下文。"""

from __future__ import annotations

import argparse
import json
import sys

import zhihu_common as z
from http_client import fetch_text  # noqa: F401
from platform_account_ctx import require_account

PLATFORM = "zhihu"
DEFAULT_COVER = "https://static.zhihu.com/heifetz/favicon.ico"
FEED_ID = "website:zhihu:__platform__"
FEED_META = {
    "id": FEED_ID,
    "mpName": "知乎",
    "mpCover": DEFAULT_COVER,
    "mpIntro": "知乎（多用户）",
    "status": 1,
    "source": "website",
    "entryUrl": "https://www.zhihu.com/",
}
REFRESH_DEFAULTS = {"max_pages": 3, "per": 20}


def _acc() -> dict:
    return require_account()


def fetch_list_page(page: int = 1, per: int = 20) -> dict:
    acc = _acc()
    user_type = str(acc.get("user_type") or "people").strip() or "people"
    user_id = str(acc.get("account_key") or "").strip()
    return z.fetch_articles_page(usertype=user_type, user_id=user_id, page=page, per=per)


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
    _ = hints
    acc = _acc()
    page_url = str(acc.get("posts_url") or acc.get("entry_url") or "").strip()
    return z.fetch_article_by_id(article_id, page_url=page_url)


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    return z.normalize_article_body(raw_html, article_id=article_id)


def main() -> int:
    parser = argparse.ArgumentParser(description="发现知乎文章（需绑定账号上下文）")
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
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, **output}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
