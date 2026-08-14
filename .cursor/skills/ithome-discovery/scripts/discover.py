#!/usr/bin/env python3
"""IT之家（ithome.com）发现层适配器 — JSON 列表 API + getmorenews 分页 + 详情 content API。"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from html import unescape
from zoneinfo import ZoneInfo

from http_client import fetch_bytes, fetch_json, fetch_text, sleep_between_pages

SHANGHAI = ZoneInfo("Asia/Shanghai")
BASE_URL = "https://www.ithome.com"
API_BASE = "https://api.ithome.com"
LIST_API = f"{API_BASE}/json/newslist/news"
DETAIL_API = f"{API_BASE}/json/newscontent"
MORE_API = f"{BASE_URL}/getmorenews"

FEED_ID = "website:ithome"
FEED_META = {
    "id": FEED_ID,
    "mpName": "IT之家",
    "mpCover": "https://www.ithome.com/favicon.ico",
    "mpIntro": "前沿科技门户 · 科技资讯与数码评测",
    "status": 1,
    "source": "website",
    "entryUrl": BASE_URL,
}
REFRESH_DEFAULTS = {"max_pages": 3, "per": 50}

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

_NEWS_ID_RE = re.compile(r"/0/(\d+)/(\d+)\.htm")
_LI_RE = re.compile(r"<li\b[^>]*>(.*?)</li>", re.I | re.S)
_A_RE = re.compile(r'<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>', re.I | re.S)
_TIME_RE = re.compile(r"<(?:b|i)\b[^>]*>(.*?)</(?:b|i)>", re.I | re.S)
_TAG_RE = re.compile(r"<[^>]+>")


def _request(url: str, *, method: str = "GET", data: bytes | None = None, accept: str = "*/*") -> bytes:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": accept,
        "Referer": f"{BASE_URL}/",
    }
    if method == "POST":
        headers["X-Requested-With"] = "XMLHttpRequest"
    return fetch_bytes(url, headers=headers, data=data, method=method)


def _request_json(url: str, *, method: str = "GET", data: bytes | None = None) -> dict:
    raw = _request(url, method=method, data=data, accept="application/json")
    payload = json.loads(raw.decode("utf-8", errors="replace"))
    if not isinstance(payload, dict):
        raise ValueError("响应不是 JSON 对象")
    return payload


def _pad_fraction(value: str) -> str:
    text = value.strip()
    if "." not in text:
        return text
    main, frac = text.split(".", 1)
    frac = re.sub(r"\D.*$", "", frac)
    frac = (frac + "000000")[:6]
    return f"{main}.{frac}"


def _parse_datetime(value: str) -> datetime | None:
    if not value:
        return None
    text = _pad_fraction(str(value).strip())
    for candidate in (text, text.replace("Z", "+00:00")):
        try:
            dt = datetime.fromisoformat(candidate)
            if dt.tzinfo is None:
                return dt.replace(tzinfo=SHANGHAI)
            return dt.astimezone(SHANGHAI)
        except ValueError:
            continue
    for fmt in ("%Y/%m/%d %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=SHANGHAI)
        except ValueError:
            continue
    return None


def _format_published_at(value: str | int | float | None) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, (int, float)):
        ts = float(value)
        if ts > 1e12:
            ts /= 1000.0
        return datetime.fromtimestamp(ts, tz=SHANGHAI).isoformat()
    parsed = _parse_datetime(str(value))
    if parsed is None:
        return str(value)
    return parsed.isoformat()


def _orderdate_to_ms(value: str) -> int | None:
    parsed = _parse_datetime(value)
    if parsed is None:
        return None
    return int(parsed.timestamp() * 1000)


def _article_url(newsid: int | str) -> str:
    nid = int(newsid)
    return f"{BASE_URL}/0/{nid // 1000}/{nid % 1000:03d}.htm"


def _parse_newsid_from_url(url: str) -> str:
    match = _NEWS_ID_RE.search(url or "")
    if not match:
        return ""
    return f"{int(match.group(1))}{int(match.group(2)):03d}"


def _strip_tags(text: str) -> str:
    if not text:
        return ""
    cleaned = _TAG_RE.sub("", text)
    cleaned = cleaned.replace("&thinsp;", "").replace("&hairsp;", "")
    return unescape(cleaned).strip()


def _absolute_url(url: str) -> str:
    if not url:
        return ""
    if url.startswith("//"):
        return f"https:{url}"
    if url.startswith("/"):
        return f"{BASE_URL}{url}"
    return url


def _parse_more_html(html: str) -> list[dict]:
    items: list[dict] = []
    for block in _LI_RE.findall(html or ""):
        link = _A_RE.search(block)
        if not link:
            continue
        href, title_html = link.group(1), link.group(2)
        newsid = _parse_newsid_from_url(href)
        if not newsid:
            continue
        time_match = _TIME_RE.search(block)
        time_text = _strip_tags(time_match.group(1)) if time_match else ""
        items.append(
            {
                "newsid": int(newsid),
                "title": _strip_tags(title_html),
                "url": _absolute_url(href),
                "postdate": time_text,
                "description": "",
                "image": "",
                "newsauthor": "",
            }
        )
    return items


def _fetch_more_news(ot_ms: int) -> dict:
    payload = _request_json(f"{MORE_API}?ot={int(ot_ms)}", method="POST", data=b"")
    if not payload.get("success"):
        raise ValueError(payload.get("message") or "getmorenews 失败")
    content = payload.get("content") or {}
    if not isinstance(content, dict):
        raise ValueError("getmorenews content 格式异常")
    html = content.get("html") or ""
    items = _parse_more_html(html)
    last_ot = content.get("lastOt")
    try:
        last_ot_int = int(last_ot) if last_ot is not None else None
    except (TypeError, ValueError):
        last_ot_int = None
    return {
        "items": items,
        "last_ot": last_ot_int,
        "no_more": bool(content.get("noMore")),
    }


# --- WebsiteFeedAdapter 接口 ---


def fetch_list_page(page: int = 1, per: int = 20) -> dict:
    page = max(1, int(page))
    per = max(1, int(per))
    api_payload = _request_json(LIST_API)
    api_items = api_payload.get("newslist")
    if not isinstance(api_items, list):
        api_items = []

    if page == 1:
        slice_items = api_items[:per]
        last_ot = None
        if api_items:
            last_ot = _orderdate_to_ms(str(api_items[-1].get("orderdate") or api_items[-1].get("postdate") or ""))
        return {
            "items": slice_items,
            "page": 1,
            "last_ot": last_ot,
            "has_next": bool(api_items) and last_ot is not None,
            "source": "json_api",
        }

    if not api_items:
        return {"items": [], "page": page, "last_ot": None, "has_next": False, "source": "getmorenews"}

    ot = _orderdate_to_ms(str(api_items[-1].get("orderdate") or api_items[-1].get("postdate") or ""))
    if ot is None:
        return {"items": [], "page": page, "last_ot": None, "has_next": False, "source": "getmorenews"}

    current: list[dict] = []
    no_more = False
    for _ in range(2, page + 1):
        more = _fetch_more_news(ot)
        current = more["items"]
        if more["last_ot"] is not None:
            ot = more["last_ot"]
        no_more = more["no_more"]
        if no_more or not current:
            break

    return {
        "items": current[:per],
        "page": page,
        "last_ot": ot,
        "has_next": (not no_more) and bool(current) and ot is not None,
        "source": "getmorenews",
    }


def list_items(payload: dict) -> list[dict]:
    items = payload.get("items")
    return items if isinstance(items, list) else []


def has_next_page(payload: dict) -> bool:
    return bool(payload.get("has_next"))


def normalize_list_item(item: dict) -> dict:
    newsid = item.get("newsid") or item.get("id") or ""
    rel_url = item.get("url") or ""
    url = _absolute_url(str(rel_url)) if rel_url else (_article_url(newsid) if newsid else "")
    if not newsid and url:
        newsid = _parse_newsid_from_url(url)
    published_raw = item.get("postdate") or item.get("orderdate") or ""
    published_at = _format_published_at(published_raw)
    # getmorenews 片段可能只有当日 HH:MM 或 MM-DD，保留可解析结果，否则留空由详情补全
    if published_at and "T" not in published_at and not re.match(r"^\d{4}-", published_at):
        published_at = ""
    return {
        "id": str(newsid),
        "title": str(item.get("title") or "").strip(),
        "url": url,
        "published_at": published_at,
        "author": str(item.get("newsauthor") or item.get("author") or ""),
        "image": str(item.get("image") or ""),
        "summary": str(item.get("description") or item.get("summary") or ""),
    }


def fetch_article_detail(article_id: str, **hints) -> dict:
    newsid = str(article_id).strip()
    if not newsid:
        raise ValueError("article_id 为空")
    data = _request_json(f"{DETAIL_API}/{newsid}")
    if not data.get("success"):
        raise ValueError(f"详情接口失败: newsid={newsid}")
    rel = str(data.get("url") or "")
    url = _absolute_url(rel) if rel else _article_url(data.get("newsid") or newsid)
    author = data.get("newsauthor") or data.get("z") or data.get("newssource") or ""
    return {
        "id": str(data.get("newsid") or newsid),
        "title": str(data.get("title") or ""),
        "url": url,
        "content_html": str(data.get("detail") or ""),
        "image": str(data.get("image") or ""),
        "published_at": _format_published_at(data.get("postdate")),
        "author": str(author),
        "summary": "",
    }


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    from content_utils import clean_html_fragment

    _ = article_id
    return clean_html_fragment(raw_html or "")


def main() -> int:
    parser = argparse.ArgumentParser(description="发现 IT之家 文章")
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
