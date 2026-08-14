#!/usr/bin/env python3
"""BLS CES 发现层适配器（基于 BLS Public API v2）。"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from http_client import fetch_bytes, fetch_json, fetch_text, sleep_between_pages

SHANGHAI = ZoneInfo("Asia/Shanghai")
BASE_URL = "https://www.bls.gov/ces/"
API_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/"

FEED_ID = "website:bls"
FEED_META = {
    "id": FEED_ID,
    "mpName": "Bls",
    "mpCover": "https://www.bls.gov/images/bls_emblem.png",
    "mpIntro": "U.S. Bureau of Labor Statistics - Current Employment Statistics.",
    "status": 1,
    "source": "website",
    "entryUrl": BASE_URL,
}
REFRESH_DEFAULTS = {"max_pages": 3, "per": 12}

SERIES = {
    "CES0000000001": "Total nonfarm payrolls",
    "CES0500000001": "Total private",
    "CES0600000001": "Goods-producing",
    "CES0800000001": "Service-providing",
}
SERIES_ORDER = list(SERIES.keys())

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Referer": BASE_URL,
}

PERIOD_TO_MONTH = {f"M{i:02d}": i for i in range(1, 13)}
MONTH_TO_PERIOD = {value: key for key, value in PERIOD_TO_MONTH.items()}


def _post_json(payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    data = fetch_json(API_URL, headers=HEADERS, data=body, method="POST")
    if not isinstance(data, dict):
        raise ValueError("BLS API 返回格式异常")
    if str(data.get("status", "")).upper() != "REQUEST_SUCCEEDED":
        raise ValueError(f"BLS API 请求失败: {data.get('message')}")
    return data


def _month_to_iso(year: int, month: int) -> str:
    return datetime(year, month, 1, 8, 30, tzinfo=SHANGHAI).isoformat()


def _series_data_index(year: int) -> dict[str, dict[str, dict]]:
    payload = _post_json(
        {
            "seriesid": SERIES_ORDER,
            "startyear": str(year),
            "endyear": str(year),
        }
    )
    rows = payload.get("Results", {}).get("series", [])
    index: dict[str, dict[str, dict]] = {}
    for series in rows if isinstance(rows, list) else []:
        sid = str(series.get("seriesID", ""))
        data = series.get("data")
        if sid and isinstance(data, list):
            index[sid] = {}
            for item in data:
                period = str(item.get("period", "")).strip()
                if period in PERIOD_TO_MONTH:
                    index[sid][period] = item
    return index


def _rows_for_year(year: int) -> list[dict]:
    index = _series_data_index(year)
    headline = index.get("CES0000000001", {})
    rows: list[dict] = []
    for period, item in headline.items():
        month = PERIOD_TO_MONTH.get(period)
        if not month:
            continue
        article_id = f"{year}-{month:02d}"
        rows.append(
            {
                "id": article_id,
                "title": f"BLS CES Employment Update - {year}-{month:02d}",
                "url": f"{BASE_URL}#{article_id}",
                "published_at": _month_to_iso(year, month),
                "period": period,
                "year": year,
                "headline_value": str(item.get("value", "")),
                "latest": str(item.get("latest", "")).lower() == "true",
            }
        )
    rows.sort(key=lambda x: x.get("published_at", ""), reverse=True)
    return rows


def fetch_list_page(page: int = 1, per: int = 12) -> dict:
    page = max(1, int(page))
    per = max(1, int(per))
    current_year = datetime.now(tz=SHANGHAI).year
    target_year = current_year - (page - 1)
    rows = _rows_for_year(target_year)
    return {
        "items": rows[:per],
        "page": page,
        "per": per,
        "target_year": target_year,
        "current_year": current_year,
    }


def list_items(payload: dict) -> list[dict]:
    items = payload.get("items")
    return items if isinstance(items, list) else []


def has_next_page(payload: dict) -> bool:
    page = int(payload.get("page", 1))
    current_year = int(payload.get("current_year", datetime.now(tz=SHANGHAI).year))
    target_year = int(payload.get("target_year", current_year))
    # BLS v2 公共 API 对 start/end year 范围通常支持最近几十年，分页到 2000 年即可覆盖现代统计区间。
    return bool(target_year > 2000 and page < 20)


def normalize_list_item(item: dict) -> dict:
    return {
        "id": str(item.get("id", "")).strip(),
        "title": str(item.get("title", "")).strip(),
        "url": str(item.get("url", "")).strip(),
        "published_at": str(item.get("published_at", "")).strip(),
        "author": "U.S. Bureau of Labor Statistics",
        "image": "",
        "summary": (
            f"CES monthly snapshot: total nonfarm payrolls {item.get('headline_value', '')} "
            "thousand employees."
        ).strip(),
    }


def fetch_article_detail(article_id: str, **hints) -> dict:
    parts = (article_id or "").split("-")
    if len(parts) != 2:
        raise ValueError(f"article_id 格式错误: {article_id}")
    year = int(parts[0])
    month = int(parts[1])
    period = MONTH_TO_PERIOD.get(month)
    if not period:
        raise ValueError(f"无法识别月份: {article_id}")

    index = _series_data_index(year)
    metrics: list[str] = []
    for sid in SERIES_ORDER:
        item = index.get(sid, {}).get(period, {})
        value = str(item.get("value", ""))
        footnotes = item.get("footnotes") if isinstance(item.get("footnotes"), list) else []
        flags = [str(x.get("text", "")).strip() for x in footnotes if isinstance(x, dict) and x.get("text")]
        marker = f" ({'; '.join(flags)})" if flags else ""
        metrics.append(f"<li><strong>{SERIES[sid]}:</strong> {value}{marker}</li>")

    title = f"BLS CES Employment Update - {year}-{month:02d}"
    content_html = (
        f"<article><h1>{title}</h1>"
        f"<p>Source: <a href=\"{BASE_URL}\">{BASE_URL}</a></p>"
        "<p>This report is generated from BLS Public API v2 CES series for the selected month. "
        "Values are in thousands of employees and reflect the monthly establishment survey snapshot.</p>"
        "<ul>"
        + "".join(metrics)
        + "</ul>"
        "<p>Data endpoint: https://api.bls.gov/publicAPI/v2/timeseries/data/</p>"
        "</article>"
    )
    return {
        "id": article_id,
        "title": title,
        "url": f"{BASE_URL}#{article_id}",
        "published_at": _month_to_iso(year, month),
        "author": "U.S. Bureau of Labor Statistics",
        "image": "",
        "content_html": content_html,
    }


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    return str(raw_html or "").strip()


def main() -> int:
    parser = argparse.ArgumentParser(description="发现 BLS CES 月度更新")
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
