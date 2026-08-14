#!/usr/bin/env python3
"""财联社（cls.cn）发现层适配器 — 电报 roll API + 详情页 __NEXT_DATA__。"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
import urllib.parse
from datetime import datetime
from zoneinfo import ZoneInfo

from http_client import fetch_bytes, fetch_json, fetch_text, sleep_between_pages

SHANGHAI = ZoneInfo("Asia/Shanghai")
BASE_URL = "https://www.cls.cn"
LIST_API = f"{BASE_URL}/v1/roll/get_roll_list"
APP = "CailianpressWeb"
OS = "web"
SV = "8.7.9"

FEED_ID = "website:cls"
FEED_META = {
    "id": FEED_ID,
    "mpName": "财联社",
    "mpCover": "https://cdnjs.cls.cn/www/20200601/image/favicon.ico",
    "mpIntro": "主流财经新闻集团和财经通讯社 · 电报快讯",
    "status": 1,
    "source": "website",
    "entryUrl": f"{BASE_URL}/telegraph",
}
REFRESH_DEFAULTS = {"max_pages": 3, "per": 50}

DEFAULT_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Referer": f"{BASE_URL}/telegraph",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
}


def _serialize_param(key: str, value) -> str | None:
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return f"{key}={value}"
    if isinstance(value, list):
        if not value:
            return f"{key}[]"
        parts = [_serialize_param(f"{key}[{i}]", item) for i, item in enumerate(value)]
        return "&".join(p for p in parts if p)
    if isinstance(value, dict):
        parts = [_serialize_param(f"{key}[{k}]", value[k]) for k in sorted(value.keys())]
        return "&".join(p for p in parts if p)
    return f"{key}={value}"


def _sign_params(params: dict) -> str:
    """CLS Web 签名：MD5(SHA1(按 key 排序的 key=value&...))。"""
    parts = [_serialize_param(k, params[k]) for k in sorted(params.keys())]
    payload = "&".join(p for p in parts if p)
    sha1_hex = hashlib.sha1(payload.encode("utf-8")).hexdigest()
    return hashlib.md5(sha1_hex.encode("utf-8")).hexdigest()


def _request_json(url: str, *, referer: str | None = None) -> dict:
    headers = dict(DEFAULT_HEADERS)
    if referer:
        headers["Referer"] = referer
    data = fetch_json(url, headers=headers)
    if not isinstance(data, dict):
        raise ValueError("响应不是 JSON 对象")
    return data


def _request_text(url: str, *, referer: str | None = None) -> str:
    headers = {
        "Accept": "text/html,application/xhtml+xml",
        "Referer": referer or f"{BASE_URL}/telegraph",
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
    }
    return fetch_text(url, headers=headers)


def _api_get(path: str, params: dict) -> dict:
    query = {
        "app": APP,
        "os": OS,
        "sv": SV,
        **params,
    }
    query["sign"] = _sign_params(query)
    url = f"{BASE_URL}{path}?{urllib.parse.urlencode(query)}"
    return _request_json(url)


def _format_ctime(value) -> str:
    try:
        ts = int(value)
    except (TypeError, ValueError):
        return ""
    if ts <= 0:
        return ""
    return datetime.fromtimestamp(ts, tz=SHANGHAI).isoformat()


def _strip_html(text: str) -> str:
    if not text:
        return ""
    return html.unescape(re.sub(r"<[^>]+>", "", text)).strip()


def _item_title(item: dict) -> str:
    explicit = _strip_html(str(item.get("title") or ""))
    if explicit:
        return explicit
    content = _strip_html(str(item.get("content") or item.get("brief") or ""))
    match = re.match(r"^【([^】]+)】", content)
    if match:
        return match.group(1).strip()
    return content[:80] if content else str(item.get("id", ""))


def _item_author(item: dict) -> str:
    author = item.get("author")
    if isinstance(author, dict):
        name = str(author.get("name") or author.get("nickname") or "").strip()
        if name:
            return name
    if isinstance(author, str) and author.strip():
        return author.strip()
    return "财联社"


def _content_to_html(text: str) -> str:
    plain = str(text or "").strip()
    if not plain:
        return ""
    if "<" in plain and ">" in plain:
        return plain
    escaped = html.escape(plain)
    paragraphs = [p.strip() for p in re.split(r"\n+", escaped) if p.strip()]
    if not paragraphs:
        return f"<p>{escaped}</p>"
    return "".join(f"<p>{p}</p>" for p in paragraphs)


def _is_article_item(item: dict) -> bool:
    if not isinstance(item, dict):
        return False
    if int(item.get("is_ad") or 0) == 1:
        return False
    content = _strip_html(str(item.get("content") or item.get("brief") or ""))
    return bool(content or item.get("title") or item.get("id"))


def _fetch_roll(*, rn: int = 20, last_time: int = 0) -> dict:
    params: dict = {"refresh_type": 1, "rn": int(rn)}
    if last_time:
        params["last_time"] = int(last_time)
    payload = _api_get("/v1/roll/get_roll_list", params)
    if int(payload.get("errno") or 0) != 0:
        raise ValueError(f"财联社列表失败: errno={payload.get('errno')} msg={payload.get('msg')}")
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    items = data.get("roll_data") if isinstance(data, dict) else None
    if not isinstance(items, list):
        items = []
    return {"items": items, "raw": payload}


# --- WebsiteFeedAdapter 接口 ---


def fetch_list_page(page: int = 1, per: int = 20) -> dict:
    page = max(1, int(page))
    per = max(1, min(int(per), 50))
    last_time = 0
    items: list[dict] = []
    for _ in range(page):
        result = _fetch_roll(rn=per, last_time=last_time)
        items = result["items"]
        if not items:
            break
        last_time = int(items[-1].get("ctime") or 0)
        if not last_time:
            break
    return {"items": items, "page": page, "per": per, "last_time": last_time}


def list_items(payload: dict) -> list[dict]:
    items = payload.get("items")
    if not isinstance(items, list):
        return []
    return [item for item in items if _is_article_item(item)]


def has_next_page(payload: dict) -> bool:
    items = list_items(payload)
    per = int(payload.get("per") or 20)
    return len(items) >= per


def normalize_list_item(item: dict) -> dict:
    article_id = str(item.get("id", ""))
    content = str(item.get("content") or item.get("brief") or "")
    return {
        "id": article_id,
        "title": _item_title(item),
        "url": f"{BASE_URL}/detail/{article_id}" if article_id else "",
        "published_at": _format_ctime(item.get("ctime")),
        "author": _item_author(item),
        "image": str(item.get("img") or item.get("share_img") or ""),
        "summary": _strip_html(content)[:200],
    }


def _parse_detail_next_data(page_html: str) -> dict:
    match = re.search(
        r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>',
        page_html,
        re.DOTALL,
    )
    if not match:
        raise ValueError("详情页缺少 __NEXT_DATA__")
    data = json.loads(match.group(1))
    detail = (
        data.get("props", {})
        .get("pageProps", {})
        .get("articleDetail")
    )
    if not isinstance(detail, dict):
        raise ValueError("详情页 articleDetail 缺失")
    return detail


def _detail_from_list_pages(article_id: str) -> dict | None:
    for page in range(1, 4):
        payload = fetch_list_page(page=page, per=40)
        for item in list_items(payload):
            if str(item.get("id") or "") != str(article_id):
                continue
            content = str(item.get("content") or item.get("brief") or "")
            normalized = normalize_list_item(item)
            normalized["content_html"] = _content_to_html(content)
            return normalized
    return None


def fetch_article_detail(article_id: str, **hints) -> dict:
    aid = str(article_id).strip()
    url = f"{BASE_URL}/detail/{aid}"
    try:
        page_html = _request_text(url, referer=f"{BASE_URL}/telegraph")
        detail = _parse_detail_next_data(page_html)
        content = str(detail.get("content") or detail.get("brief") or "")
        title = _strip_html(str(detail.get("title") or ""))
        if not title:
            title = _item_title({"title": "", "content": content, "id": aid})
        author = detail.get("author")
        author_name = "财联社"
        if isinstance(author, dict):
            author_name = str(author.get("name") or author.get("nickname") or author_name)
        elif isinstance(author, str) and author.strip():
            author_name = author.strip()
        if content.strip():
            return {
                "id": aid,
                "title": title,
                "url": url,
                "published_at": _format_ctime(detail.get("ctime")),
                "author": author_name,
                "image": "",
                "content_html": _content_to_html(content),
            }
    except Exception:
        pass

    from_list = _detail_from_list_pages(aid)
    if from_list and str(from_list.get("content_html") or "").strip():
        return from_list

    return {
        "id": aid,
        "title": "",
        "url": url,
        "published_at": "",
        "author": "财联社",
        "image": "",
        "content_html": "",
    }


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    from content_utils import clean_html_fragment

    return clean_html_fragment(raw_html)


def main() -> int:
    parser = argparse.ArgumentParser(description="发现财联社电报")
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
