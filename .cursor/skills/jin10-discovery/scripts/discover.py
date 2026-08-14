#!/usr/bin/env python3
"""金十数据快讯发现层适配器。"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

SHANGHAI = ZoneInfo("Asia/Shanghai")
BASE_URL = "https://www.jin10.com"
FLASH_API = "https://flash-api.jin10.com/get_flash_list"
APP_ID = "bVBF4FyRTn5NJF5n"
APP_VERSION = "1.0.0"

FEED_ID = "website:jin10"
FEED_META = {
    "id": FEED_ID,
    "mpName": "金十数据",
    "mpCover": "https://cdn.jin10.com/assets/img/commons/logo_v3_s.jpg",
    "mpIntro": "金十数据 · 财经快讯",
    "status": 1,
    "source": "website",
    "entryUrl": "https://www.jin10.com/",
}
REFRESH_DEFAULTS = {"max_pages": 3, "per": 20}

_HEADERS = {
    "x-app-id": APP_ID,
    "x-version": APP_VERSION,
    "Accept": "application/json",
    "Referer": f"{BASE_URL}/",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
}


def _request_list(*, max_time: str = "") -> list[dict]:
    params = {"channel": "-8200", "vip": "1"}
    if max_time:
        params["max_time"] = max_time
    url = f"{FLASH_API}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers=_HEADERS)
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    items = payload.get("data") if isinstance(payload, dict) else None
    return items if isinstance(items, list) else []


def _format_time(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=SHANGHAI).isoformat()
        except ValueError:
            continue
    return text


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").strip()


def _item_content(item: dict) -> str:
    data = item.get("data") if isinstance(item.get("data"), dict) else {}
    return str(data.get("content") or "")


def _item_title(item: dict) -> str:
    content = _strip_html(_item_content(item))
    match_bracket = re.match(r"^【([^】]+)】", content)
    if match_bracket:
        return match_bracket.group(1)
    return content[:60]


def fetch_list_page(page: int = 1, per: int = 20) -> dict:
    items = _request_list()
    if page > 1 and items:
        max_time = str(items[-1].get("time") or "")
        items = _request_list(max_time=max_time) if max_time else []
    return {"data": items, "page": page, "per": per}


def list_items(payload: dict) -> list[dict]:
    items = payload.get("data")
    return items if isinstance(items, list) else []


def has_next_page(payload: dict) -> bool:
    items = list_items(payload)
    page = int(payload.get("page") or 1)
    per = int(payload.get("per") or 20)
    return len(items) >= per and page < 50


def normalize_list_item(item: dict) -> dict:
    article_id = str(item.get("id", ""))
    content_html = _item_content(item)
    title = _item_title(item)
    return {
        "id": article_id,
        "title": title,
        "url": f"{BASE_URL}/flash/{article_id}.html",
        "published_at": _format_time(item.get("time")),
        "author": "金十数据",
        "image": "",
        "summary": _strip_html(content_html)[:200],
    }


def fetch_article_detail(article_id: str) -> dict:
    for item in _request_list():
        if str(item.get("id", "")) == str(article_id):
            normalized = normalize_list_item(item)
            normalized["content_html"] = _item_content(item)
            return normalized
    return {
        "id": str(article_id),
        "title": "",
        "url": f"{BASE_URL}/flash/{article_id}.html",
        "published_at": "",
        "author": "金十数据",
        "image": "",
        "content_html": "",
    }


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    from content_utils import clean_html_fragment
    return clean_html_fragment(raw_html)


def main() -> int:
    parser = argparse.ArgumentParser(description="金十数据发现层 CLI")
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
