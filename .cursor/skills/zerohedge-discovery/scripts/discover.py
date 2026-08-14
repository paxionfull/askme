#!/usr/bin/env python3
"""ZeroHedge 发现层适配器（zerohedge.com）。"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from http_client import fetch_bytes, fetch_json, fetch_text, sleep_between_pages

SHANGHAI = ZoneInfo("Asia/Shanghai")
BASE_URL = "https://www.zerohedge.com"
ENTRY_URL = f"{BASE_URL}/"

FEED_ID = "website:zerohedge"
FEED_META = {
    "id": FEED_ID,
    "mpName": "Zerohedge",
    "mpCover": "https://www.zerohedge.com/favicons/favicon.png",
    "mpIntro": "ZeroHedge macro, markets and geopolitics news",
    "status": 1,
    "source": "website",
    "entryUrl": ENTRY_URL,
}
REFRESH_DEFAULTS = {"max_pages": 3, "per": 50}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": ENTRY_URL,
}

NEXT_DATA_RE = re.compile(r'<script id="__NEXT_DATA__" type="application/json">([\s\S]*?)</script>')


def _request_text(url: str) -> str:
    return fetch_text(url, headers=HEADERS)


def _extract_next_data(page_html: str) -> dict:
    match = NEXT_DATA_RE.search(page_html)
    if not match:
        raise ValueError("页面缺少 __NEXT_DATA__")
    data = json.loads(match.group(1))
    if not isinstance(data, dict):
        raise ValueError("__NEXT_DATA__ 不是 JSON 对象")
    return data


def _to_iso8601_shanghai(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S.%f%z"):
        try:
            return datetime.strptime(raw, fmt).astimezone(SHANGHAI).isoformat()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(SHANGHAI).isoformat()
    except ValueError:
        return raw


def _clean_text(text: str) -> str:
    no_tag = re.sub(r"<[^>]+>", "", text or "")
    return html.unescape(no_tag).strip()


def _list_url_for_page(page: int) -> str:
    page = max(1, int(page))
    return ENTRY_URL if page == 1 else f"{BASE_URL}/page/{page}"


def fetch_list_page(page: int = 1, per: int = 20) -> dict:
    list_url = _list_url_for_page(page)
    page_html = _request_text(list_url)
    data = _extract_next_data(page_html)
    page_props = data.get("props", {}).get("pageProps", {})
    rows = page_props.get("results")
    items = rows if isinstance(rows, list) else []
    items = items[: max(1, int(per))]

    return {
        "items": items,
        "page": max(1, int(page)),
        "per": max(1, int(per)),
        "page_number": page_props.get("pageNumber"),
    }


def list_items(payload: dict) -> list[dict]:
    items = payload.get("items")
    return items if isinstance(items, list) else []


def has_next_page(payload: dict) -> bool:
    page = int(payload.get("page", 1))
    next_url = _list_url_for_page(page + 1)
    try:
        next_html = _request_text(next_url)
        next_data = _extract_next_data(next_html)
        next_props = next_data.get("props", {}).get("pageProps", {})
        next_items = next_props.get("results")
        return bool(isinstance(next_items, list) and len(next_items) > 0)
    except Exception:
        return False


def normalize_list_item(item: dict) -> dict:
    article_path = str(item.get("path", "")).strip()
    url = f"{BASE_URL}{article_path}" if article_path.startswith("/") else article_path
    image = str(item.get("teaserImageUrl", "")).strip() or str(item.get("mobileTeaserImageUrl", "")).strip()
    return {
        "id": str(item.get("nid", "")),
        "title": str(item.get("title", "")).strip(),
        "url": url,
        "published_at": _to_iso8601_shanghai(str(item.get("created", ""))),
        "author": str(item.get("name", "")).strip() or "ZeroHedge",
        "image": image,
        "summary": _clean_text(str(item.get("body", ""))),
    }


def _extract_article_node(page_html: str) -> dict:
    data = _extract_next_data(page_html)
    page_props = data.get("props", {}).get("pageProps", {})
    node = page_props.get("node")
    if not isinstance(node, dict):
        raise ValueError("详情页缺少 node 数据")
    return node


_LIST_INDEX = None  # lazy import ListByIdIndex


def _list_index():
    global _LIST_INDEX
    if _LIST_INDEX is None:
        from list_index import ListByIdIndex

        _LIST_INDEX = ListByIdIndex()
    return _LIST_INDEX


def _url_from_row(row: dict) -> str:
    path = str(row.get("path", "")).strip()
    if path.startswith("/"):
        return f"{BASE_URL}{path}"
    return path


def _resolve_article_url(article_id: str, **hints) -> str:
    from detail_hints import resolve_detail_url

    article_url = resolve_detail_url(article_id, **hints)
    if article_url:
        return article_url

    wanted = str(article_id).strip()
    page = 1
    hard_max_pages = 20
    while page <= hard_max_pages:
        payload = fetch_list_page(page=page, per=50)
        items = list_items(payload)
        if not items:
            break
        _list_index().rebuild(items, id_key="nid")
        hit = _list_index().get(wanted)
        if hit:
            url = _url_from_row(hit)
            if url:
                return url
        for row in items:
            if str(row.get("nid", "")) == wanted:
                url = _url_from_row(row)
                if url:
                    return url
        if not has_next_page(payload):
            break
        page += 1
    return ""


def fetch_article_detail(article_id: str, **hints) -> dict:
    article_id = str(article_id).strip()
    if not article_id:
        raise ValueError("article_id 不能为空")

    from detail_hints import pick_hints

    meta = pick_hints(**hints)
    article_url = _resolve_article_url(article_id, **hints)
    if not article_url:
        raise ValueError(f"无法定位文章 URL（nid={article_id}）；请确保列表已入库 url 或文章仍在可翻页列表内")

    page_html = _request_text(article_url)
    node = _extract_article_node(page_html)
    content_html = str(node.get("body", "")).strip()
    if not content_html:
        raise ValueError(f"正文为空: {article_url}")

    return {
        "id": str(node.get("nid", article_id)),
        "title": meta.get("title") or str(node.get("title", "")).strip(),
        "url": article_url,
        "published_at": meta.get("published_at")
        or _to_iso8601_shanghai(str(node.get("created", ""))),
        "author": meta.get("author") or str(node.get("authorName", "")).strip() or "ZeroHedge",
        "image": meta.get("image") or str(node.get("teaserImageUrl", "")).strip(),
        "content_html": content_html,
    }


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    _ = article_id
    return str(raw_html or "").strip()


def main() -> int:
    parser = argparse.ArgumentParser(description="发现 ZeroHedge 文章")
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
