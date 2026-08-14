#!/usr/bin/env python3
"""知乎用户专栏发现层适配器 — 供 Askme FeedClient 与各 skill 脚本复用。"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

SHANGHAI = ZoneInfo("Asia/Shanghai")
BASE_URL = "https://zhuanlan.zhihu.com"
ENTRY_URL = "https://zhuanlan.zhihu.com/p/340414725"

FEED_ID = "website:zhihu"
FEED_META = {
    "id": FEED_ID,
    "mpName": "知乎·Khazix",
    "mpCover": "https://static.zhihu.com/heifetz/favicon.ico",
    "mpIntro": "知乎用户 Khazix 的专栏文章",
    "status": 1,
    "source": "website",
    "entryUrl": ENTRY_URL,
}
REFRESH_DEFAULTS = {"max_pages": 1, "per": 1}

DEFAULT_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": "https://www.zhihu.com/",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
}

_COOKIE = os.environ.get("ZHIHU_COOKIE", "")
if _COOKIE:
    DEFAULT_HEADERS["Cookie"] = _COOKIE


def _request(url: str, referer: str | None = None) -> str:
    headers = dict(DEFAULT_HEADERS)
    if referer:
        headers["Referer"] = referer
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        if "系统监测到您的网络环境存在异常" in body:
            raise RuntimeError(f"HTTP {e.code} 触发知乎反爬验证: {url}")
        raise RuntimeError(f"HTTP {e.code} 请求失败: {url}\n响应: {body[:500]}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"URL 请求失败: {url} - {e}") from e


def _ts_to_iso(ts) -> str:
    """将时间戳（秒/毫秒）或 ISO 字符串转为 Asia/Shanghai 的 ISO8601 字符串。"""
    if not ts:
        return ""
    # 1. 处理数字时间戳（秒或毫秒）
    try:
        ts_int = int(ts)
        if ts_int > 1e12:  # 毫秒级
            ts_int //= 1000
        return datetime.fromtimestamp(ts_int, tz=SHANGHAI).isoformat()
    except (ValueError, TypeError, OSError, OverflowError):
        pass
    
    # 2. 处理 ISO 字符串
    try:
        dt_str = str(ts).replace("Z", "+00:00")
        dt = datetime.fromisoformat(dt_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(SHANGHAI).isoformat()
    except (ValueError, TypeError):
        return str(ts)


def _extract_meta_property(html: str, prop: str) -> str:
    match = re.search(rf'<meta\s+[^>]*property=["\']og:{prop}["\'][^>]*content=["\'](.*?)["\']', html, re.IGNORECASE | re.DOTALL)
    if match:
        return match.group(1)
    match = re.search(rf'<meta\s+[^>]*content=["\'](.*?)["\'][^>]*property=["\']og:{prop}["\']', html, re.IGNORECASE | re.DOTALL)
    return match.group(1) if match else ""


def _extract_meta_content(html: str, name: str) -> str:
    match = re.search(rf'<meta\s+[^>]*name=["\']{name}["\'][^>]*content=["\'](.*?)["\']', html, re.IGNORECASE | re.DOTALL)
    if match:
        return match.group(1)
    match = re.search(rf'<meta\s+[^>]*content=["\'](.*?)["\'][^>]*name=["\']{name}["\']', html, re.IGNORECASE | re.DOTALL)
    return match.group(1) if match else ""


def _extract_js_object(html: str, key: str) -> dict:
    pattern = rf'"{key}"\s*:\s*\{{'
    match = re.search(pattern, html)
    if not match:
        return {}

    start = match.end() - 1
    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(html)):
        c = html[i]
        if escape:
            escape = False
            continue
        if c == '\\':
            escape = True
            continue
        if c == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                json_str = html[start:i+1]
                try:
                    return json.loads(json_str)
                except json.JSONDecodeError:
                    return {}
    return {}


def _extract_rich_text(html: str) -> str:
    patterns = [
        r'<div class="RichText ztext Post-RichText[^"]*"[^>]*>(.*?)</div>\s*<div',
        r'<div class="RichText ztext Post-RichText[^"]*"[^>]*>(.*?)</div>\s*</div',
        r'<div class="RichText ztext Post-RichText[^"]*"[^>]*>(.*?)(?=<div class="ContentItem-actions|<div class="Post-Sidewards|<footer)',
        r'<div class="RichText ztext CopyrightRichText-richText[^"]*"[^>]*>(.*?)</div>\s*</div',
        r'<div class="RichText ztext[^"]*"[^>]*>(.*?)(?=<div class="ContentItem-actions|<footer)',
    ]
    for pattern in patterns:
        match = re.search(pattern, html, re.DOTALL)
        if match and len(match.group(1)) > 50:
            return match.group(1)
    return ""


def fetch_list_page(page: int = 1, per: int = 1) -> dict:
    try:
        raw_html = _request(ENTRY_URL, referer="https://www.zhihu.com/")
        
        if "系统监测到您的网络环境存在异常" in raw_html or "安全验证 - 知乎" in raw_html:
            raise RuntimeError("触发知乎反爬验证")

        article_id = ENTRY_URL.rstrip("/").split("/")[-1]
        title = _extract_meta_property(raw_html, "title") or _extract_meta_content(raw_html, "title")
        image = _extract_meta_property(raw_html, "image")
        
        # 优先尝试从 meta 标签提取时间
        published_at_raw = _extract_meta_property(raw_html, "published_at") or _extract_meta_content(raw_html, "published_at")
        if not published_at_raw:
            published_at_raw = _extract_meta_property(raw_html, "datePublished") or _extract_meta_content(raw_html, "datePublished")
            
        author = _extract_meta_property(raw_html, "author") or "知乎用户"
        summary = _extract_meta_property(raw_html, "description")

        data = _extract_js_object(raw_html, "article")
        if data:
            if not published_at_raw:
                published_at_raw = data.get("publishedTime") or data.get("created") or data.get("updated")
            if not author or author == "知乎用户":
                author_obj = data.get("author", {})
                author = author_obj.get("name", author)
            if not title:
                title = data.get("title", title)
            if not image:
                image = data.get("image_url") or data.get("titleImage", image)
            if not summary:
                summary = data.get("excerpt", summary)

        published_at = _ts_to_iso(published_at_raw)
        if not published_at:
            try:
                pub_date = datetime.strptime(published_at_raw, "%Y-%m-%d %H:%M:%S")
                published_at = pub_date.replace(tzinfo=SHANGHAI).isoformat()
            except Exception:
                published_at = published_at_raw if published_at_raw else ""

        return {
            "data": [{
                "id": article_id,
                "title": title,
                "url": ENTRY_URL,
                "published_at": published_at,
                "author": author,
                "image": image,
                "summary": summary,
                "content_html": _extract_rich_text(raw_html),
            }],
            "paging": {
                "is_end": True,
                "is_start": True,
                "next": "",
                "previous": "",
                "totals": 1,
            },
            "_page": page,
            "_per": per,
            "_source": "html_meta",
        }
    except RuntimeError:
        return {
            "data": [],
            "paging": {"is_end": True, "is_start": True, "next": "", "previous": "", "totals": 0},
            "_page": page, "_per": per,
        }


def list_items(payload: dict) -> list[dict]:
    items = payload.get("data")
    return items if isinstance(items, list) else []


def has_next_page(payload: dict) -> bool:
    paging = payload.get("paging") or {}
    is_end = paging.get("is_end", True)
    return not is_end


def normalize_list_item(item: dict) -> dict:
    return {
        "id": str(item.get("id", "")),
        "title": item.get("title", ""),
        "url": item.get("url", ""),
        "published_at": item.get("published_at", ""),
        "author": item.get("author", ""),
        "image": item.get("image", ""),
        "summary": item.get("summary", ""),
    }


def fetch_article_detail(article_id: str) -> dict:
    url = f"{BASE_URL}/p/{article_id}"
    try:
        raw_html = _request(url, referer="https://www.zhihu.com/")
        
        if "系统监测到您的网络环境存在异常" in raw_html or "安全验证 - 知乎" in raw_html:
            raise RuntimeError("触发知乎反爬验证")

        title = _extract_meta_property(raw_html, "title") or _extract_meta_content(raw_html, "title")
        image = _extract_meta_property(raw_html, "image")
        
        published_at_raw = _extract_meta_property(raw_html, "published_at") or _extract_meta_content(raw_html, "published_at")
        if not published_at_raw:
            published_at_raw = _extract_meta_property(raw_html, "datePublished") or _extract_meta_content(raw_html, "datePublished")
            
        author = _extract_meta_property(raw_html, "author") or "知乎用户"
        summary = _extract_meta_property(raw_html, "description")
        content_html = _extract_rich_text(raw_html)

        data = _extract_js_object(raw_html, "article")
        if data:
            if not published_at_raw:
                published_at_raw = data.get("publishedTime") or data.get("created") or data.get("updated")
            if not author or author == "知乎用户":
                author_obj = data.get("author", {})
                author = author_obj.get("name", author)
            if not title:
                title = data.get("title", title)
            if not image:
                image = data.get("image_url") or data.get("titleImage", image)
            if not summary:
                summary = data.get("excerpt", summary)
            content_html = content_html or data.get("content", "")

        published_at = _ts_to_iso(published_at_raw)
        if not published_at:
            try:
                pub_date = datetime.strptime(published_at_raw, "%Y-%m-%d %H:%M:%S")
                published_at = pub_date.replace(tzinfo=SHANGHAI).isoformat()
            except Exception:
                published_at = published_at_raw if published_at_raw else ""

        return {
            "id": str(article_id),
            "title": title,
            "url": url,
            "published_at": published_at,
            "author": author,
            "image": image,
            "content_html": content_html,
        }
    except RuntimeError:
        return {
            "id": str(article_id),
            "title": "",
            "url": url,
            "published_at": "",
            "author": "",
            "image": "",
            "content_html": "",
        }


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    from content_utils import clean_html_fragment
    return clean_html_fragment(raw_html)


def _main() -> int:
    parser = argparse.ArgumentParser(description="知乎发现层适配器 CLI")
    parser.add_argument("--page", type=int, default=1, help="页码，从 1 开始")
    parser.add_argument("--per", type=int, default=1, help="每页条数")
    parser.add_argument("--id", type=str, default="", help="获取指定文章 ID 的详情")
    args = parser.parse_args()

    if args.id:
        detail = fetch_article_detail(args.id)
        print(json.dumps(detail, ensure_ascii=False, indent=2))
        return 0

    payload = fetch_list_page(args.page, args.per)
    items = list_items(payload)
    print(f"第 {args.page} 页获取到 {len(items)} 条数据，是否有下一页: {has_next_page(payload)}")
    for item in items:
        normalized = normalize_list_item(item)
        print(json.dumps(normalized, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(_main())
