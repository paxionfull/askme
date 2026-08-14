#!/usr/bin/env python3
"""x 平台 skill 占位（运行时按账号编译 _lib/x_scaffold）。"""
from __future__ import annotations
from http_client import fetch_text  # noqa: F401

PLATFORM = "x"
FEED_ID = "website:x:__platform__"
FEED_META = {
    "id": FEED_ID,
    "mpName": "x",
    "mpCover": "",
    "mpIntro": "x platform",
    "status": 1,
    "source": "website",
    "entryUrl": "",
}
REFRESH_DEFAULTS = {"max_pages": 3, "per": 20}


def fetch_list_page(page: int = 1, per: int = 20) -> dict:
    raise RuntimeError("请通过 FeedClient 绑定 platform_accounts 后访问")


def list_items(payload: dict) -> list:
    return []


def has_next_page(payload: dict) -> bool:
    return False


def normalize_list_item(item: dict) -> dict:
    return item


def fetch_article_detail(article_id: str, **hints) -> dict:
    raise RuntimeError("请通过 FeedClient 绑定 platform_accounts 后访问")
