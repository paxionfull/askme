#!/usr/bin/env python3
"""Federal Reserve 发现层适配器（基于 recentpostings HTML 列表）。"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import urllib.parse
from datetime import datetime
from zoneinfo import ZoneInfo

from content_utils import clean_html_fragment

from http_client import fetch_bytes, fetch_json, fetch_text, sleep_between_pages

SHANGHAI = ZoneInfo("Asia/Shanghai")
BASE_URL = "https://www.federalreserve.gov"
LIST_URL = f"{BASE_URL}/recentpostings.htm"

FEED_ID = "website:federalreserve"
FEED_META = {
    "id": FEED_ID,
    "mpName": "Federalreserve",
    "mpCover": "https://www.federalreserve.gov/images/social-media/social-default-image-opengraph.jpg",
    "mpIntro": "Board of Governors of the Federal Reserve System recent postings.",
    "status": 1,
    "source": "website",
    "entryUrl": BASE_URL,
}
REFRESH_DEFAULTS = {"max_pages": 1, "per": 50}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": BASE_URL,
}


def _request_text(url: str) -> str:
    return fetch_text(url, headers=HEADERS)


def _strip_tags(value: str) -> str:
    text = re.sub(r"<[^>]+>", "", value or "", flags=re.DOTALL)
    return html.unescape(re.sub(r"\s+", " ", text)).strip()


def _to_iso_shanghai(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    for fmt in ("%m/%d/%Y", "%B %d, %Y"):
        try:
            dt = datetime.strptime(raw, fmt).replace(tzinfo=SHANGHAI)
            return dt.isoformat()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(SHANGHAI).isoformat()
    except ValueError:
        return raw


def _normalize_id(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    path = parsed.path.strip()
    if not path:
        return parsed.geturl().strip()
    return path.lstrip("/")


def _parse_recentpostings_rows(raw_html: str) -> list[dict]:
    eventlist_match = re.search(
        r"<div class='row eventlist'>(.*?)</div>\s*</div>\s*<a id=\"back-top\"",
        raw_html,
        re.IGNORECASE | re.DOTALL,
    )
    block = eventlist_match.group(1) if eventlist_match else raw_html
    row_pattern = re.compile(
        r"<div class=\"row\">\s*"
        r"<div class=\"col-xs-3 col-md-2 eventlist__time\">\s*<time>\s*(.*?)\s*</time>\s*</div>\s*"
        r"<div class=\"col-xs-9 col-md-10 eventlist__event\">\s*(.*?)\s*</div>\s*"
        r"</div>",
        re.IGNORECASE | re.DOTALL,
    )
    rows: list[dict] = []
    for date_text, event_html in row_pattern.findall(block):
        anchor = re.search(r"<a[^>]+href=\"([^\"]+)\"[^>]*>(.*?)</a>", event_html, re.IGNORECASE | re.DOTALL)
        if not anchor:
            continue
        href = html.unescape(anchor.group(1).strip())
        url = urllib.parse.urljoin(BASE_URL, href)
        paragraphs = re.findall(r"<p[^>]*>(.*?)</p>", event_html, re.IGNORECASE | re.DOTALL)
        summary = _strip_tags(paragraphs[-1]) if paragraphs else ""
        title = summary or _strip_tags(anchor.group(2))
        if not title:
            continue
        rows.append(
            {
                "id": _normalize_id(url),
                "title": title,
                "url": url,
                "published_at": _to_iso_shanghai(date_text),
                "author": "Federal Reserve Board",
                "image": "",
                "summary": summary,
            }
        )
    return rows


def fetch_list_page(page: int = 1, per: int = 20) -> dict:
    page = max(1, int(page))
    per = max(1, int(per))
    rows = _parse_recentpostings_rows(_request_text(LIST_URL))
    start = (page - 1) * per
    end = start + per
    return {"items": rows[start:end], "page": page, "per": per, "total": len(rows)}


def list_items(payload: dict) -> list[dict]:
    items = payload.get("items")
    return items if isinstance(items, list) else []


def has_next_page(payload: dict) -> bool:
    page = int(payload.get("page", 1))
    per = int(payload.get("per", 20))
    total = int(payload.get("total", 0))
    return page * per < total


def normalize_list_item(item: dict) -> dict:
    return {
        "id": str(item.get("id", "")).strip(),
        "title": str(item.get("title", "")).strip(),
        "url": str(item.get("url", "")).strip(),
        "published_at": str(item.get("published_at", "")).strip(),
        "author": str(item.get("author", "Federal Reserve Board")).strip(),
        "image": str(item.get("image", "")).strip(),
        "summary": str(item.get("summary", "")).strip(),
    }


def fetch_article_detail(article_id: str, **hints) -> dict:
    article_key = str(article_id or "").strip()
    if article_key.startswith("http://") or article_key.startswith("https://"):
        url = article_key
    else:
        url = urllib.parse.urljoin(BASE_URL + "/", article_key.lstrip("/"))

    raw_html = _request_text(url)
    title = ""
    published_at = ""

    title_match = re.search(r"<h3[^>]*class=\"title\"[^>]*>(.*?)</h3>", raw_html, re.IGNORECASE | re.DOTALL)
    if title_match:
        title = _strip_tags(title_match.group(1))
    if not title:
        og_title = re.search(
            r"<meta[^>]+property=\"og:title\"[^>]+content=\"([^\"]+)\"",
            raw_html,
            re.IGNORECASE | re.DOTALL,
        )
        title = html.unescape(og_title.group(1)).strip() if og_title else ""
    if not title:
        title = "Federal Reserve"

    time_match = re.search(r"<p[^>]*class=\"article__time\"[^>]*>(.*?)</p>", raw_html, re.IGNORECASE | re.DOTALL)
    if time_match:
        published_at = _to_iso_shanghai(_strip_tags(time_match.group(1)))

    article_match = re.search(
        r"(<div id=\"article\">.*?)(?=<div id=\"lastUpdate\"|<footer class=\"container footer\">)",
        raw_html,
        re.IGNORECASE | re.DOTALL,
    )
    content_html = article_match.group(1).strip() if article_match else raw_html

    return {
        "id": article_key,
        "title": title,
        "url": url,
        "published_at": published_at,
        "author": "Federal Reserve Board",
        "image": "",
        "content_html": content_html,
    }


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    return clean_html_fragment(str(raw_html or ""))


def main() -> int:
    parser = argparse.ArgumentParser(description="发现 Federal Reserve Recent Postings")
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
