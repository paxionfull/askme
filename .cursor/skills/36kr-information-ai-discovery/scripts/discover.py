#!/usr/bin/env python3
"""36氪 AI 频道发现层适配器 — gateway subNav/flow 列表 + 文章页 initialState 正文。"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from detail_hints import pick_hints, resolve_detail_url
from http_client import fetch_bytes, fetch_text, sleep_between_pages

SHANGHAI = ZoneInfo("Asia/Shanghai")
BASE_URL = "https://36kr.com"
GATEWAY = "https://gateway.36kr.com"
LIST_API = f"{GATEWAY}/api/mis/nav/ifm/subNav/flow"
SUBNAV_NICK = "AI"
ENTRY_URL = f"{BASE_URL}/information/AI/"

FEED_ID = "website:36kr-information-ai"
FEED_META = {
    "id": FEED_ID,
    "mpName": "36Kr · AI",
    "mpCover": "https://img.36krcdn.com/20191024/v2_1571894049839_img_jpg",
    "mpIntro": "36氪 AI 频道 · 人工智能产业与技术资讯",
    "status": 1,
    "source": "website",
    "entryUrl": ENTRY_URL,
}
REFRESH_DEFAULTS = {"max_pages": 3, "per": 50}

DEFAULT_HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Origin": BASE_URL,
    "Referer": ENTRY_URL,
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
}


def _request_json(url: str, *, data: dict | None = None, referer: str | None = None) -> dict:
    headers = dict(DEFAULT_HEADERS)
    if referer:
        headers["Referer"] = referer
    body = json.dumps(data).encode("utf-8") if data is not None else None
    raw = fetch_bytes(
        url,
        headers=headers,
        data=body,
        method="POST" if body else "GET",
    ).decode("utf-8")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("响应不是 JSON 对象")
    if payload.get("code") not in (0, None):
        raise ValueError(payload.get("msg") or f"API 错误 code={payload.get('code')}")
    return payload


def _request_html(url: str, *, referer: str | None = None) -> str:
    headers = {
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
        "Accept": "text/html,application/xhtml+xml",
    }
    if referer:
        headers["Referer"] = referer
    return fetch_text(url, headers=headers)


def _format_published_at(value: int | str | None) -> str:
    if value is None or value == "":
        return ""
    try:
        ts = int(value)
    except (TypeError, ValueError):
        text = str(value).strip()
        if not text:
            return ""
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(SHANGHAI).isoformat()
        except ValueError:
            return text
    if ts > 1_000_000_000_000:
        ts = ts / 1000.0
    return datetime.fromtimestamp(ts, tz=timezone.utc).astimezone(SHANGHAI).isoformat()


def _article_url(item_id: str | int) -> str:
    return f"{BASE_URL}/p/{item_id}"


def _flow_body(*, per: int, page_event: int, page_callback: str) -> dict:
    return {
        "partner_id": "web",
        "timestamp": int(time.time() * 1000),
        "param": {
            "subnavType": 1,
            "subnavNick": SUBNAV_NICK,
            "pageSize": per,
            "pageEvent": page_event,
            "pageCallback": page_callback,
            "siteId": 1,
            "platformId": 2,
        },
    }


def _fetch_flow_page(*, per: int, page_event: int, page_callback: str) -> dict:
    payload = _request_json(
        LIST_API,
        data=_flow_body(per=per, page_event=page_event, page_callback=page_callback),
    )
    data = payload.get("data")
    if not isinstance(data, dict):
        raise ValueError("列表响应缺少 data")
    return {
        "items": data.get("itemList") if isinstance(data.get("itemList"), list) else [],
        "page": page_event,
        "page_callback": str(data.get("pageCallback") or ""),
        "has_next_page": bool(data.get("hasNextPage")),
        "per": per,
    }


def _parse_initial_state(html: str) -> dict:
    marker = "window.initialState="
    start = html.find(marker)
    if start < 0:
        raise ValueError("文章页缺少 window.initialState")
    text = html[start + len(marker) :]
    depth = 0
    end = 0
    for idx, ch in enumerate(text):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = idx + 1
                break
    if end <= 0:
        raise ValueError("无法解析 window.initialState JSON")
    state = json.loads(text[:end])
    if not isinstance(state, dict):
        raise ValueError("initialState 不是对象")
    return state


def _extract_article_detail_data(state: dict) -> dict:
    article_detail = state.get("articleDetail") or {}
    detail_data = article_detail.get("articleDetailData") or {}
    if detail_data.get("code") not in (0, None):
        raise ValueError(detail_data.get("msg") or "文章详情 API 返回错误")
    data = detail_data.get("data")
    if not isinstance(data, dict):
        raise ValueError("文章详情 data 缺失")
    return data


# --- WebsiteFeedAdapter 接口 ---


def fetch_list_page(page: int = 1, per: int = 20) -> dict:
    if page < 1:
        page = 1
    page_event = 0
    page_callback = ""
    result: dict = {
        "items": [],
        "page": page,
        "page_callback": "",
        "has_next_page": False,
        "per": per,
    }
    for current in range(1, page + 1):
        result = _fetch_flow_page(per=per, page_event=page_event, page_callback=page_callback)
        result["page"] = current
        if current < page:
            page_event = 1
            page_callback = result.get("page_callback", "")
            sleep_between_pages()
    return result


def list_items(payload: dict) -> list[dict]:
    items = payload.get("items")
    return items if isinstance(items, list) else []


def has_next_page(payload: dict) -> bool:
    return bool(payload.get("has_next_page"))


def normalize_list_item(item: dict) -> dict:
    item_id = str(item.get("itemId", ""))
    material = item.get("templateMaterial") or {}
    if not isinstance(material, dict):
        material = {}
    published_raw = material.get("publishTime") or item.get("publishTime")
    summary = str(material.get("widgetContent") or material.get("summary") or "")
    if summary.startswith("<"):
        summary = re.sub(r"<[^>]+>", "", summary).strip()
    return {
        "id": item_id,
        "title": str(material.get("widgetTitle") or ""),
        "url": _article_url(item_id) if item_id else "",
        "published_at": _format_published_at(published_raw),
        "author": str(material.get("authorName") or material.get("author") or ""),
        "image": str(material.get("widgetImage") or ""),
        "summary": summary,
    }


def fetch_article_detail(article_id: str, **hints) -> dict:
    meta = pick_hints(**hints)
    item_id = str(article_id).strip()
    page_url = resolve_detail_url(article_id, **hints) or meta.get("url") or _article_url(item_id)
    html = _request_html(page_url, referer=ENTRY_URL)
    data = _extract_article_detail_data(_parse_initial_state(html))
    return {
        "id": str(data.get("itemId") or item_id),
        "title": str(data.get("widgetTitle") or meta.get("title") or ""),
        "url": page_url,
        "published_at": _format_published_at(data.get("publishTime")) or meta.get("published_at", ""),
        "author": str(data.get("author") or meta.get("author") or ""),
        "image": str(data.get("coverImageUrl") or data.get("widgetImage") or meta.get("image") or ""),
        "content_html": str(data.get("widgetContent") or ""),
    }


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    from content_utils import clean_html_fragment

    _ = article_id
    return clean_html_fragment(raw_html)


def main() -> int:
    parser = argparse.ArgumentParser(description="发现 36氪 AI 频道最新资讯")
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--per", type=int, default=20)
    parser.add_argument("--id", type=str, default="", help="文章 itemId")
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
