#!/usr/bin/env python3
"""Anthropic Research 发现层适配器。"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from html import unescape
from html.parser import HTMLParser
from zoneinfo import ZoneInfo

from http_client import fetch_bytes, fetch_json, fetch_text, sleep_between_pages

SHANGHAI = ZoneInfo("Asia/Shanghai")
BASE_URL = "https://www.anthropic.com"
ENTRY_URL = f"{BASE_URL}/research"

FEED_ID = "website:anthropic-2"
FEED_META = {
    "id": FEED_ID,
    "mpName": "Anthropic",
    "mpCover": "https://www.anthropic.com/images/icons/apple-touch-icon.png",
    "mpIntro": "Anthropic 官方 Research 发布页",
    "status": 1,
    "source": "website",
    "entryUrl": ENTRY_URL,
}
REFRESH_DEFAULTS = {"max_pages": 1, "per": 50}

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def _request_text(url: str, referer: str | None = None) -> str:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml",
    }
    if referer:
        headers["Referer"] = referer
    return fetch_text(url, headers=headers)


def _strip_tags(text: str) -> str:
    cleaned = re.sub(r"<[^>]+>", "", text or "")
    cleaned = unescape(cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def _parse_display_date(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    for fmt in ("%b %d, %Y", "%B %d, %Y"):
        try:
            dt = datetime.strptime(raw, fmt).replace(tzinfo=SHANGHAI)
            return dt.isoformat()
        except ValueError:
            continue
    return raw


def _extract_meta(html: str, key: str) -> str:
    pattern = rf'<meta[^>]+(?:property|name)=["\']{re.escape(key)}["\'][^>]+content=["\']([^"\']*)["\']'
    match = re.search(pattern, html, re.IGNORECASE)
    return unescape(match.group(1).strip()) if match else ""


def _extract_h1(html: str) -> str:
    match = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.IGNORECASE | re.DOTALL)
    return _strip_tags(match.group(1)) if match else ""


def _extract_detail_date(html: str) -> str:
    match = re.search(r"<time[^>]*>(.*?)</time>", html, re.IGNORECASE | re.DOTALL)
    if match:
        return _parse_display_date(_strip_tags(match.group(1)))
    match = re.search(
        r'<[^>]+class=["\'][^"\']*__date[^"\']*["\'][^>]*>(.*?)</[^>]+>',
        html,
        re.IGNORECASE | re.DOTALL,
    )
    if match:
        return _parse_display_date(_strip_tags(match.group(1)))
    return ""


class ResearchListParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_list = False
        self.list_depth = 0
        self.in_item = False
        self.item_depth = 0
        self.current_field = ""
        self.current_item: dict[str, str] | None = None
        self.items: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = {k: (v or "") for k, v in attrs}
        cls = attr_map.get("class", "")
        if tag == "ul" and "PublicationList-module" in cls and "__list" in cls:
            self.in_list = True
            self.list_depth = 1
            return
        if not self.in_list:
            return
        if tag == "ul":
            self.list_depth += 1
        if tag == "li":
            self.in_item = True
            self.item_depth = 1
            self.current_item = {"href": "", "date": "", "category": "", "title": ""}
            self.current_field = ""
            return
        if not self.in_item:
            return
        if tag == "li":
            self.item_depth += 1
        if tag == "a" and self.current_item is not None:
            self.current_item["href"] = attr_map.get("href", "").strip()
        if tag == "time":
            self.current_field = "date"
        elif tag == "span":
            classes = cls.split()
            if any("__subject" in c for c in classes):
                self.current_field = "category"
            elif any("__title" in c for c in classes):
                self.current_field = "title"

    def handle_endtag(self, tag: str) -> None:
        if not self.in_list:
            return
        if self.in_item and tag == "li":
            self.item_depth -= 1
            if self.item_depth == 0:
                if self.current_item:
                    href = self.current_item.get("href", "")
                    if href.startswith("/research/") or href.startswith("/news/"):
                        self.items.append({k: v.strip() for k, v in self.current_item.items()})
                self.current_item = None
                self.in_item = False
                self.current_field = ""
                return
        if tag == "ul":
            self.list_depth -= 1
            if self.list_depth == 0:
                self.in_list = False
        if tag in ("time", "span"):
            self.current_field = ""

    def handle_data(self, data: str) -> None:
        if not self.in_item or not self.current_field or self.current_item is None:
            return
        self.current_item[self.current_field] = f"{self.current_item[self.current_field]} {data}".strip()


class BodyHtmlParser(HTMLParser):
    """提取详情页正文容器 <div class='...Body-module...__body...'> 的 innerHTML。"""

    VOID_TAGS = {
        "area",
        "base",
        "br",
        "col",
        "embed",
        "hr",
        "img",
        "input",
        "link",
        "meta",
        "param",
        "source",
        "track",
        "wbr",
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.capturing = False
        self.depth = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = {k: (v or "") for k, v in attrs}
        cls = attr_map.get("class", "")
        if not self.capturing and tag == "div" and "Body-module" in cls and "__body" in cls:
            self.capturing = True
            self.depth = 1
            return
        if not self.capturing:
            return
        self.depth += 1
        attr_text_parts: list[str] = []
        for k, v in attrs:
            escaped = (v or "").replace('"', "&quot;")
            attr_text_parts.append(f' {k}="{escaped}"')
        attr_text = "".join(attr_text_parts)
        if tag in self.VOID_TAGS:
            self.parts.append(f"<{tag}{attr_text}/>")
            self.depth -= 1
        else:
            self.parts.append(f"<{tag}{attr_text}>")

    def handle_endtag(self, tag: str) -> None:
        if not self.capturing:
            return
        self.depth -= 1
        if self.depth == 0:
            self.capturing = False
            return
        if tag not in self.VOID_TAGS:
            self.parts.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        if self.capturing:
            self.parts.append(data)

    def handle_entityref(self, name: str) -> None:
        if self.capturing:
            self.parts.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        if self.capturing:
            self.parts.append(f"&#{name};")

    def handle_comment(self, data: str) -> None:
        if self.capturing:
            self.parts.append(f"<!--{data}-->")

    def get_html(self) -> str:
        return "".join(self.parts).strip()


def fetch_list_page(page: int = 1, per: int = 20) -> dict:
    if page != 1:
        return {"items": [], "page": page, "has_next_page": False}
    html = _request_text(ENTRY_URL)
    parser = ResearchListParser()
    parser.feed(html)
    return {"items": parser.items[: max(1, per)], "page": page, "has_next_page": False}


def list_items(payload: dict) -> list[dict]:
    items = payload.get("items")
    return items if isinstance(items, list) else []


def has_next_page(payload: dict) -> bool:
    return bool(payload.get("has_next_page"))


def normalize_list_item(item: dict) -> dict:
    href = str(item.get("href", "")).strip()
    article_path = href.lstrip("/")
    url = f"{BASE_URL}/{article_path}" if article_path else ""
    return {
        "id": article_path,
        "title": str(item.get("title", "")).strip(),
        "url": url,
        "published_at": _parse_display_date(str(item.get("date", ""))),
        "author": "Anthropic",
        "image": "",
        "summary": str(item.get("category", "")).strip(),
    }


def fetch_article_detail(article_id: str, **hints) -> dict:
    article_path = (article_id or "").strip().lstrip("/")
    if not article_path:
        raise ValueError("article_id 不能为空")
    url = f"{BASE_URL}/{article_path}"
    html = _request_text(url, referer=ENTRY_URL)
    parser = BodyHtmlParser()
    parser.feed(html)
    content_html = parser.get_html()
    if not content_html:
        raise ValueError(f"未提取到正文容器: {url}")
    return {
        "id": article_path,
        "title": _extract_h1(html) or _extract_meta(html, "og:title"),
        "url": url,
        "published_at": (
            _parse_display_date(
                _extract_meta(html, "article:published_time")
                or _extract_meta(html, "og:article:published_time")
                or _extract_meta(html, "article:modified_time")
            )
            or _extract_detail_date(html)
        ),
        "author": "Anthropic",
        "content_html": content_html,
        "summary": _extract_meta(html, "og:description"),
        "image": _extract_meta(html, "og:image"),
    }


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    return raw_html


def main() -> int:
    parser = argparse.ArgumentParser(description="发现 Anthropic Research 文章")
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
