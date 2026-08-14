"""知乎发现层公共逻辑：x-zse-96 签名与文章 API。"""

from __future__ import annotations

import json
import os
import re
import urllib.parse
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

import zhihu_sign

SHANGHAI = ZoneInfo("Asia/Shanghai")
ZSE93 = zhihu_sign.ZSE_93

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def _cookie_value(cookie: str, key: str) -> str:
    return zhihu_sign.get_cookie_value(cookie, key)


def _fetch_zse_ck() -> str:
    for version in ("v3",):
        try:
            req = urllib.request.Request(
                f"https://static.zhihu.com/zse-ck/{version}.js",
                headers={"User-Agent": USER_AGENT},
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                script = resp.read().decode("utf-8", errors="ignore")
            match = re.search(r'__g\.ck\|\|"([\w+/=\\]*)",_=', script)
            if match:
                return match.group(1)
        except Exception:
            continue
    raise RuntimeError("无法获取知乎 __zse_ck")


def _fetch_dc0(page_url: str, zse_ck: str) -> str:
    req = urllib.request.Request(
        page_url,
        headers={
            "User-Agent": USER_AGENT,
            "Cookie": f"__zse_ck={zse_ck}",
            "Referer": "https://www.zhihu.com/",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        for header in resp.headers.get_all("Set-Cookie") or []:
            if header.startswith("d_c0="):
                return header.split(";", 1)[0].split("=", 1)[1]
    raise RuntimeError("无法获取知乎 d_c0 cookie")


def _signed_headers(page_url: str, api_path: str, cookie_override: str = "") -> dict[str, str]:
    env_cookie = cookie_override or os.getenv("ZHIHU_COOKIE", "")
    if env_cookie:
        dc0 = _cookie_value(env_cookie, "d_c0")
        zse_ck = _cookie_value(env_cookie, "__zse_ck")
        cookie = env_cookie
        if dc0 and "__zse_ck" not in cookie and zse_ck:
            cookie += f"; __zse_ck={zse_ck}"
    else:
        zse_ck = _fetch_zse_ck()
        dc0 = _fetch_dc0(page_url, zse_ck)
        cookie = f"__zse_ck={zse_ck}; d_c0={dc0}"

    if not dc0:
        dc0 = _cookie_value(cookie, "d_c0")
    if not dc0:
        raise RuntimeError(
            "知乎需要配置 ZHIHU_COOKIE（从浏览器复制 d_c0 等 cookie）。"
            "详见对应 skill 的 SKILL.md。"
        )

    request_url = f"https://www.zhihu.com{api_path}"
    signed = zhihu_sign.get_signed_zhihu_headers(request_url, dc0)
    return {
        "User-Agent": USER_AGENT,
        "Accept": "application/json, text/plain, */*",
        "Referer": page_url,
        "Cookie": cookie,
        **signed,
    }


def _request_json(url: str, headers: dict[str, str]) -> dict:
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if not isinstance(data, dict):
        raise ValueError("知乎 API 返回格式异常")
    if data.get("error"):
        raise RuntimeError(data["error"].get("message") or "知乎 API 错误")
    return data


def _format_timestamp(value: int | str) -> str:
    try:
        ts = int(value)
    except (TypeError, ValueError):
        return str(value)
    return datetime.fromtimestamp(ts, tz=SHANGHAI).isoformat()


def build_articles_api_path(usertype: str, user_id: str, offset: int, limit: int) -> str:
    prefix = "members" if usertype == "people" else "org"
    params = urllib.parse.urlencode(
        {
            "include": (
                "data[*].comment_count,suggest_edit,is_normal,thumbnail_extra_info,thumbnail,"
                "can_comment,comment_permission,admin_closed_comment,content,voteup_count,created,"
                "updated,upvoted_followees,voting,review_info,reaction_instruction,is_labeled,"
                "label_info;data[*].vessay_info;data[*].author.badge[?(type=best_answerer)].topics;"
                "data[*].author.vip_info;"
            ),
            "offset": str(offset),
            "limit": str(limit),
            "sort_by": "created",
        }
    )
    return f"/api/v4/{prefix}/{user_id}/articles?{params}"


def fetch_article_by_id(article_id: str, *, page_url: str) -> dict:
    api_path = (
        f"/api/v4/articles/{article_id}?"
        + urllib.parse.urlencode(
            {
                "include": (
                    "content,comment_count,suggest_edit,is_normal,thumbnail_extra_info,thumbnail,"
                    "can_comment,comment_permission,admin_closed_comment,voteup_count,created,updated,"
                    "review_info,reaction_instruction,is_labeled,label_info;author.badge[?(type=best_answerer)].topics;"
                    "author.vip_info;"
                )
            }
        )
    )
    headers = _signed_headers(page_url, api_path)
    data = _request_json(f"https://www.zhihu.com{api_path}", headers)
    return normalize_article(data)


def fetch_articles_page(
    *,
    usertype: str,
    user_id: str,
    page: int,
    per: int,
) -> dict:
    offset = max(page - 1, 0) * per
    page_url = f"https://www.zhihu.com/{usertype}/{user_id}/posts"
    api_path = build_articles_api_path(usertype, user_id, offset, per)
    headers = _signed_headers(page_url, api_path)
    return _request_json(f"https://www.zhihu.com{api_path}", headers)


def normalize_article(item: dict) -> dict:
    author = item.get("author") or {}
    author_name = author.get("name", "") if isinstance(author, dict) else str(author)
    article_id = str(item.get("id", ""))
    return {
        "id": article_id,
        "title": item.get("title", ""),
        "url": item.get("url") or f"https://zhuanlan.zhihu.com/p/{article_id}",
        "published_at": _format_timestamp(item.get("created", "")),
        "author": author_name,
        "image": item.get("image_url", "") or item.get("thumbnail", "") or "",
        "summary": item.get("excerpt", ""),
        "content_html": item.get("content", ""),
    }


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    from content_utils import clean_html_fragment

    cleaned = clean_html_fragment(raw_html)
    if not cleaned:
        return ""
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return cleaned

    soup = BeautifulSoup(cleaned, "html.parser")
    for node in soup.select('a[data-draft-type="mcn-link-card"], .RichText-LinkCardContainer'):
        node.decompose()
    if soup.body is None:
        return soup.decode()
    return "".join(str(child) for child in soup.children)
