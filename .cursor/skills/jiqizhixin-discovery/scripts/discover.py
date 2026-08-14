#!/usr/bin/env python3
"""机器之心发现层适配器 — 供 Askme FeedClient 与各 skill 脚本复用。"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

SHANGHAI = ZoneInfo("Asia/Shanghai")
BASE_URL = "https://www.jiqizhixin.com"
LIST_API = f"{BASE_URL}/api/article_library/articles.json"

FEED_ID = "website:jiqizhixin"
FEED_META = {
    "id": FEED_ID,
    "mpName": "机器之心",
    "mpCover": (
        "https://cdn.jiqizhixin.com/assets/global/"
        "logo-ec761a87e9b6e17f8a2cb653be0f9a8d252b9cd7ac31a0064f81b433732da019.png"
    ),
    "mpIntro": "专业的人工智能媒体和产业服务平台",
    "status": 1,
    "source": "website",
    "entryUrl": f"{BASE_URL}/articles",
}
REFRESH_DEFAULTS = {"max_pages": 3, "per": 20}

DEFAULT_HEADERS = {
    "Accept": "application/json",
    "Referer": f"{BASE_URL}/articles",
    "X-Requested-With": "XMLHttpRequest",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
}


def _request_json(url: str, referer: str | None = None) -> dict:
    headers = dict(DEFAULT_HEADERS)
    if referer:
        headers["Referer"] = referer
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read().decode("utf-8")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("响应不是 JSON 对象")
    return data


def _parse_published_at(value: str) -> datetime | None:
    if not value:
        return None
    for fmt in ("%Y/%m/%d %H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=SHANGHAI)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(SHANGHAI)
    except ValueError:
        return None


def _format_published_at(value: str) -> str:
    parsed = _parse_published_at(value)
    if parsed is None:
        return value
    return parsed.isoformat()


# --- WebsiteFeedAdapter 接口 ---


def fetch_list_page(page: int = 1, per: int = 20) -> dict:
    query = urllib.parse.urlencode({"sort": "time", "page": page, "per": per})
    url = f"{LIST_API}?{query}"
    return _request_json(url)


def list_items(payload: dict) -> list[dict]:
    items = payload.get("articles")
    return items if isinstance(items, list) else []


def has_next_page(payload: dict) -> bool:
    return bool(payload.get("hasNextPage"))


def normalize_list_item(item: dict) -> dict:
    slug = item.get("slug", "")
    published_raw = item.get("publishedAt", "")
    return {
        "id": slug,
        "title": item.get("title", ""),
        "url": f"{BASE_URL}/articles/{slug}" if slug else "",
        "published_at": _format_published_at(published_raw),
        "author": item.get("author", ""),
        "image": item.get("coverImageUrl", ""),
        "summary": item.get("content", ""),
    }


def fetch_article_detail(article_id: str) -> dict:
    slug = article_id
    url = f"{BASE_URL}/api/article_library/articles/{slug}.json"
    data = _request_json(url, referer=f"{BASE_URL}/articles/{slug}")
    author = data.get("author") or {}
    author_name = author.get("name", "") if isinstance(author, dict) else str(author)
    return {
        "id": slug,
        "title": data.get("title", ""),
        "url": f"{BASE_URL}/articles/{slug}",
        "published_at": _format_published_at(data.get("published_at", "")),
        "author": author_name,
        "image": data.get("cover_image_url", ""),
        "content_html": data.get("content", ""),
    }


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    from content_utils import clean_html_fragment

    return clean_html_fragment(raw_html)


# --- CLI 辅助（与适配器共用逻辑） ---


def normalize_article(item: dict) -> dict:
    base = normalize_list_item(item)
    published_raw = item.get("publishedAt", "")
    return {
        "id": item.get("id", ""),
        "title": base["title"],
        "slug": base["id"],
        "url": base["url"],
        "published_at": base["published_at"],
        "published_at_display": published_raw,
        "author": base["author"],
        "category": item.get("category", ""),
        "tags": item.get("tagList", []) or [],
        "cover_image": base["image"],
        "summary": base["summary"],
        "source": item.get("source", "机器之心"),
    }


def discover_recent(*, days: int = 1, max_pages: int = 5, per: int = 20) -> list[dict]:
    cutoff = datetime.now(SHANGHAI) - timedelta(days=days)
    results: list[dict] = []
    seen: set[str] = set()

    for page in range(1, max_pages + 1):
        payload = fetch_list_page(page=page, per=per)
        items = list_items(payload)
        if not items:
            break

        stop = False
        for item in items:
            article = normalize_article(item)
            slug = article["slug"]
            if not slug or slug in seen:
                continue
            seen.add(slug)

            published_dt = _parse_published_at(item.get("publishedAt", ""))
            if published_dt and published_dt < cutoff:
                stop = True
                continue

            results.append(article)

        if stop or not has_next_page(payload):
            break

    return results


def main() -> int:
    parser = argparse.ArgumentParser(description="发现机器之心文章库文章")
    parser.add_argument("--days", type=int, default=1, help="只保留最近 N 天（默认 1）")
    parser.add_argument("--page", type=int, default=1, help="仅拉取指定页（与 --days 互斥时优先单页）")
    parser.add_argument("--per", type=int, default=20, help="每页条数，默认 20")
    parser.add_argument("--max-pages", type=int, default=5, help="按天数过滤时最多翻页数")
    parser.add_argument("--slug", type=str, default="", help="拉取单篇详情（slug，如 2026-07-02-9）")
    parser.add_argument(
        "--mode",
        choices=("recent", "page"),
        default="recent",
        help="recent=按天数聚合；page=只取一页",
    )
    args = parser.parse_args()

    try:
        if args.slug:
            output = fetch_article_detail(args.slug)
        elif args.mode == "page":
            payload = fetch_list_page(page=args.page, per=args.per)
            output = {
                "total_count": payload.get("totalCount"),
                "has_next_page": has_next_page(payload),
                "articles": [normalize_article(item) for item in list_items(payload)],
            }
        else:
            output = {
                "days": args.days,
                "count": 0,
                "articles": discover_recent(days=args.days, max_pages=args.max_pages, per=args.per),
            }
            output["count"] = len(output["articles"])
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1

    print(
        json.dumps(
            {"ok": True, **output} if isinstance(output, dict) else {"ok": True, "article": output},
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
