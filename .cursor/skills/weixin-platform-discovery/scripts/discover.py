#!/usr/bin/env python3
"""微信公众号平台发现层 — 多账号共用，账号参数来自 platform_accounts 上下文。"""

from __future__ import annotations

import argparse
import json
import sys

import weixin_common as w
from http_client import fetch_text  # noqa: F401
from platform_account_ctx import require_account

PLATFORM = "weixin"
DEFAULT_COVER = "https://res.wx.qq.com/a/wx_fed/assets/res/NTI4MWU5.ico"
# 占位：实际 FEED_ID/META 由 BoundPlatformAdapter 覆盖
FEED_ID = "website:weixin:__platform__"
FEED_META = {
    "id": FEED_ID,
    "mpName": "微信公众号",
    "mpCover": DEFAULT_COVER,
    "mpIntro": "微信公众号（多账号）",
    "status": 1,
    "source": "website",
    "entryUrl": "https://mp.weixin.qq.com/",
}
REFRESH_DEFAULTS = {"max_pages": 3, "per": 20}


def _fakeid() -> str:
    return str(require_account().get("account_key") or "").strip()


def fetch_list_page(page: int = 1, per: int = 10) -> dict:
    return w.fetch_list_page(_fakeid(), page=page, per=per)


def list_items(payload: dict) -> list[dict]:
    return w.list_items(payload)


def has_next_page(payload: dict) -> bool:
    return w.has_next_page(payload)


def normalize_list_item(item: dict) -> dict:
    return w.normalize_list_item(item)


def fetch_article_detail(article_id: str, **hints) -> dict:
    return w.fetch_article_detail(_fakeid(), article_id, **hints)


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    return w.normalize_article_body(raw_html, article_id=article_id)


def main() -> int:
    parser = argparse.ArgumentParser(description="发现微信公众号文章（需绑定账号上下文）")
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
