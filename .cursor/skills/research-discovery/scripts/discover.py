#!/usr/bin/env python3
"""Google Research Blog 发现层适配器（HTML 分页 + 详情页正文）。"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import urllib.parse
from datetime import datetime
from zoneinfo import ZoneInfo

from http_client import fetch_bytes, fetch_json, fetch_text, sleep_between_pages

SHANGHAI = ZoneInfo("Asia/Shanghai")
BASE_URL = "https://research.google"
ENTRY_URL = f"{BASE_URL}/blog/"

FEED_ID = "website:research"
FEED_META = {
    "id": FEED_ID,
    "mpName": "Research",
    "mpCover": "https://research.google/blog/",
    "mpIntro": "Google Research 官方博客",
    "status": 1,
    "source": "website",
    "entryUrl": ENTRY_URL,
}
REFRESH_DEFAULTS = {"max_pages": 3, "per": 12}

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


def _request_html(url: str, referer: str | None = None) -> str:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    if referer:
        headers["Referer"] = referer
    return fetch_text(url, headers=headers)


def _strip_html(value: str) -> str:
    if not value:
        return ""
    text = re.sub(r"<[^>]+>", "", value)
    return html.unescape(text).strip()


def _parse_date_to_iso(date_text: str) -> str:
    value = (date_text or "").strip()
    if not value:
        return ""
    for fmt in ("%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=SHANGHAI).isoformat()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(SHANGHAI).isoformat()
    except ValueError:
        return value


def _safe_join(path: str) -> str:
    if not path:
        return ""
    return urllib.parse.urljoin(BASE_URL, path)


def _extract_cards(list_html: str) -> list[dict]:
    cards: list[dict] = []
    # 站点列表卡片使用 glue-card--blog，直接从块级 HTML 抽取字段。
    pattern = re.compile(
        r"<a class=\"[^\"]*glue-card--blog[^\"]*\" href=\"(?P<href>/blog/[^\"]+/)\"[^>]*>(?P<body>.*?)</a>",
        re.S,
    )
    for match in pattern.finditer(list_html):
        href = match.group("href")
        body = match.group("body")
        title_match = re.search(r"<span class=\"headline-6[^\"]*\">(.*?)</span>", body, re.S)
        date_match = re.search(r"<p class=\"glue-card__eyebrow label\">(.*?)</p>", body, re.S)
        image_match = re.search(r"<img[^>]+src=\"([^\"]+)\"", body)
        topic_matches = re.findall(r"<span class=\"not-glue caption\">(.*?)</span>", body, re.S)

        title = _strip_html(title_match.group(1) if title_match else "")
        date_text = _strip_html(date_match.group(1) if date_match else "")
        topics = [t for t in (_strip_html(x) for x in topic_matches) if t]
        slug = href.rstrip("/").split("/")[-1]
        cards.append(
            {
                "id": slug,
                "title": title,
                "url": _safe_join(href),
                "published_at": _parse_date_to_iso(date_text),
                "author": "Google Research",
                "image": image_match.group(1) if image_match else "",
                "summary": " · ".join(topics[:3]),
            }
        )
    return cards


def _extract_total_pages(list_html: str) -> int:
    page_nums = [int(x) for x in re.findall(r"data-page=\"(\d+)\"", list_html)]
    return max(page_nums) if page_nums else 1


def _extract_detail(article_html: str, article_url: str, article_id: str) -> dict:
    title_match = re.search(r"<h1[^>]*>(.*?)</h1>", article_html, re.S)
    hero_desc = re.search(
        r"<div class=\"basic-hero--blog-detail__description\">(.*?)</div>",
        article_html,
        re.S,
    )
    summary_match = re.search(r"<div class=\"blog-summary__summary\">(.*?)</div>", article_html, re.S)
    image_match = re.search(r"<meta property=\"og:image\" content=\"([^\"]+)\"", article_html)

    title = _strip_html(title_match.group(1) if title_match else "")
    date_text = ""
    author = "Google Research"
    if hero_desc:
        parts = re.findall(r"<p[^>]*>(.*?)</p>", hero_desc.group(1), re.S)
        if parts:
            date_text = _strip_html(parts[0])
        if len(parts) > 1:
            author = _strip_html(parts[1]) or author

    rich_sections = re.findall(
        r"<div class=\"rich-text[^\"]*--mode-standalone[^\"]*\"[^>]*>(.*?)</div>",
        article_html,
        re.S,
    )
    content_html = "\n".join(section.strip() for section in rich_sections if section.strip())

    return {
        "id": article_id,
        "title": title,
        "url": article_url,
        "published_at": _parse_date_to_iso(date_text),
        "author": author,
        "image": image_match.group(1) if image_match else "",
        "summary": _strip_html(summary_match.group(1) if summary_match else ""),
        "content_html": content_html,
    }


# --- WebsiteFeedAdapter 接口 ---


def fetch_list_page(page: int = 1, per: int = 20) -> dict:
    # 该站分页参数为 page，单页条数由站点固定（约 12-13），per 参数仅保留接口兼容。
    _ = per
    page = max(1, int(page))
    url = f"{ENTRY_URL}?{urllib.parse.urlencode({'page': page})}"
    html_text = _request_html(url, referer=ENTRY_URL)
    return {
        "page": page,
        "total_pages": _extract_total_pages(html_text),
        "items": _extract_cards(html_text),
    }


def list_items(payload: dict) -> list[dict]:
    items = payload.get("items")
    return items if isinstance(items, list) else []


def has_next_page(payload: dict) -> bool:
    page = int(payload.get("page", 1))
    total_pages = int(payload.get("total_pages", 1))
    return page < total_pages


def normalize_list_item(item: dict) -> dict:
    return {
        "id": str(item.get("id", "")),
        "title": str(item.get("title", "")).strip(),
        "url": str(item.get("url", "")).strip(),
        "published_at": str(item.get("published_at", "")).strip(),
        "author": str(item.get("author", "")).strip() or "Google Research",
        "image": str(item.get("image", "")).strip(),
        "summary": str(item.get("summary", "")).strip(),
    }


def fetch_article_detail(article_id: str, **hints) -> dict:
    slug = (article_id or "").strip().strip("/")
    if not slug:
        raise ValueError("article_id 不能为空")
    url = f"{ENTRY_URL}{slug}/"
    html_text = _request_html(url, referer=ENTRY_URL)
    return _extract_detail(html_text, url, slug)


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    from content_utils import clean_html_fragment

    _ = article_id
    return clean_html_fragment(raw_html)


def main() -> int:
    parser = argparse.ArgumentParser(description="发现 Google Research Blog 文章")
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
