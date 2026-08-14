"""知乎发现层公共逻辑：x-zse-96 签名与文章 API。"""

from __future__ import annotations

import re
import urllib.error
import urllib.parse
from datetime import datetime
from zoneinfo import ZoneInfo

import zhihu_sign
from auth_cookie import get_request_cookie
from http_client import fetch_json, fetch_text

SHANGHAI = ZoneInfo("Asia/Shanghai")
ZSE93 = zhihu_sign.ZSE_93
AUTH_SLOT = "zhihu"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


class AuthRequiredError(RuntimeError):
    """需要 Askme 引导用户登录；消息必须以 ASKME_AUTH_REQUIRED 开头。"""


def auth_required(message: str) -> AuthRequiredError:
    text = (message or "").strip() or "知乎需要登录 Cookie（含 d_c0 与 z_c0）"
    if not text.startswith("ASKME_AUTH_REQUIRED"):
        text = f"ASKME_AUTH_REQUIRED:slot={AUTH_SLOT} {text}"
    return AuthRequiredError(text)


def _cookie_value(cookie: str, key: str) -> str:
    return zhihu_sign.get_cookie_value(cookie, key)


def get_cookie() -> str:
    return get_request_cookie(AUTH_SLOT)


def require_cookie() -> str:
    """知乎文章列表 API 需真实登录态：d_c0（签名）+ z_c0（登录 ticket）。"""
    cookie = get_cookie()
    if not cookie:
        raise auth_required(
            "未配置知乎 Cookie，请在 Askme 设置页完成知乎登录授权后再试。"
        )
    dc0 = _cookie_value(cookie, "d_c0").strip()
    z_c0 = _cookie_value(cookie, "z_c0").strip()
    if not dc0:
        raise auth_required(
            "Cookie 缺少 d_c0（签名必需），请重新登录知乎并粘贴完整 Cookie。"
        )
    if not z_c0:
        raise auth_required(
            "Cookie 缺少 z_c0（登录态）。仅有 d_c0/__zse_ck 仍是访客态，"
            "文章列表 API 会返回 401/602；请扫码/密码完成真实登录后再保存 Cookie。"
        )
    return cookie


def _fetch_zse_ck() -> str:
    for version in ("v3",):
        try:
            script = fetch_text(
                f"https://static.zhihu.com/zse-ck/{version}.js",
                headers={"User-Agent": USER_AGENT},
            )
            match = re.search(r'__g\.ck\|\|"([\w+/=\\]*)",_=', script)
            if match:
                return match.group(1)
        except Exception:
            continue
    raise RuntimeError("无法获取知乎 __zse_ck")


def _fetch_dc0(page_url: str, zse_ck: str) -> str:
    from http_client import fetch_bytes_and_headers

    _, resp_headers = fetch_bytes_and_headers(
        page_url,
        headers={
            "User-Agent": USER_AGENT,
            "Cookie": f"__zse_ck={zse_ck}",
            "Referer": "https://www.zhihu.com/",
        },
    )
    for header in resp_headers.get_all("Set-Cookie") or []:
        if header.startswith("d_c0="):
            return header.split(";", 1)[0].split("=", 1)[1]
    raise RuntimeError("无法获取知乎 d_c0 cookie")


def _signed_headers(page_url: str, api_path: str, cookie_override: str = "") -> dict[str, str]:
    cookie = (cookie_override or "").strip() or require_cookie()
    dc0 = _cookie_value(cookie, "d_c0")
    zse_ck = _cookie_value(cookie, "__zse_ck")
    if dc0 and "__zse_ck" not in cookie and zse_ck:
        cookie = f"{cookie}; __zse_ck={zse_ck}"

    if not dc0:
        raise auth_required("Cookie 缺少 d_c0，无法计算 x-zse-96 签名。")

    xsrf = _cookie_value(cookie, "_xsrf")
    request_url = f"https://www.zhihu.com{api_path}"
    signed = zhihu_sign.get_signed_zhihu_headers(request_url, dc0)
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json, text/plain, */*",
        "Referer": page_url,
        "Origin": "https://www.zhihu.com",
        "Cookie": cookie,
        **signed,
    }
    if xsrf:
        headers["x-xsrftoken"] = xsrf
    return headers


def _raise_api_auth_if_needed(exc: BaseException) -> None:
    """将 401/403/登录墙映射为 ASKME_AUTH_REQUIRED。"""
    err = str(exc)
    low = err.lower()
    body = ""
    if isinstance(exc, urllib.error.HTTPError):
        try:
            raw = exc.read()
            body = raw.decode("utf-8", "replace") if isinstance(raw, (bytes, bytearray)) else str(raw)
        except Exception:
            body = ""
    blob = f"{err}\n{body}"
    blob_low = blob.lower()
    if any(
        token in blob_low
        for token in (
            "401",
            "authorization required",
            "authenticationinvalidclient",
            "zerr_not_login",
            "authenticationerror",
            "未登录",
            "请先登录",
            "第三方应用独立请求",
        )
    ) or '"code": 602' in blob or '"code":602' in blob:
        raise auth_required(
            "知乎文章 API 拒绝当前 Cookie（需真实登录态 z_c0）。"
            f"原始错误: {err}"
            + (f" | {body[:180]}" if body else "")
        ) from exc


def _request_json(url: str, headers: dict[str, str]) -> dict:
    try:
        data = fetch_json(url, headers=headers)
    except Exception as exc:  # noqa: BLE001
        _raise_api_auth_if_needed(exc)
        raise
    if not isinstance(data, dict):
        raise ValueError("知乎 API 返回格式异常")
    if data.get("error"):
        message = ""
        err = data["error"]
        if isinstance(err, dict):
            message = str(err.get("message") or err.get("name") or "")
            code = err.get("code")
            name = str(err.get("name") or "")
            if code in (602, 101) or "Authentication" in name or "NOT_LOGIN" in name:
                raise auth_required(message or "知乎 API 需要登录授权")
        raise RuntimeError(message or "知乎 API 错误")
    return data


def _format_timestamp(value: int | str) -> str:
    try:
        ts = int(value)
    except (TypeError, ValueError):
        return str(value)
    return datetime.fromtimestamp(ts, tz=SHANGHAI).isoformat()


def build_articles_api_path(usertype: str, user_id: str, offset: int, limit: int) -> str:
    # 机构号页面路径为 /org/{id}，但文章列表 API 与个人号相同，均走 /api/v4/members/
    # （/api/v4/org/{id}/articles 会 404）
    del usertype  # Referer 用 usertype；列表 API 固定 members
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
    return f"/api/v4/members/{user_id}/articles?{params}"


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
    headers = _signed_headers(page_url or "https://www.zhihu.com/", api_path)
    data = _request_json(f"https://www.zhihu.com{api_path}", headers)
    return normalize_article(data)


def fetch_articles_page(
    *,
    usertype: str,
    user_id: str,
    page: int,
    per: int,
) -> dict:
    if not str(user_id or "").strip():
        raise ValueError("知乎 user_id / account_key 为空")
    offset = max(page - 1, 0) * per
    page_url = f"https://www.zhihu.com/{usertype}/{user_id}/posts"
    api_path = build_articles_api_path(usertype, user_id, offset, per)
    headers = _signed_headers(page_url, api_path)
    return _request_json(f"https://www.zhihu.com{api_path}", headers)


def normalize_article(item: dict) -> dict:
    author = item.get("author") or {}
    author_name = author.get("name", "") if isinstance(author, dict) else str(author)
    article_id = str(item.get("id", ""))
    url = str(item.get("url") or "").strip()
    if not url and article_id:
        url = f"https://zhuanlan.zhihu.com/p/{article_id}"
    # 列表字段：优先 created；部分响应只有 created_time / updated
    published_raw = item.get("created")
    if published_raw in (None, ""):
        published_raw = item.get("created_time") or item.get("updated") or ""
    title = str(item.get("title") or "").strip()
    return {
        "id": article_id,
        "title": title,
        "url": url,
        "published_at": _format_timestamp(published_raw),
        "author": author_name,
        "image": item.get("image_url", "") or item.get("thumbnail", "") or "",
        "summary": item.get("excerpt", "") or item.get("excerpt_title", "") or "",
        "content_html": item.get("content", ""),
    }


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    from content_utils import clean_html_fragment

    _ = article_id
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


def fetch_profile_name(usertype: str, user_id: str) -> str:
    """轻量读成员资料（不依赖文章列表权限）。"""
    _ = usertype
    api_path = f"/api/v4/members/{user_id}"
    page_url = f"https://www.zhihu.com/people/{user_id}"
    headers = _signed_headers(page_url, api_path)
    data = _request_json(f"https://www.zhihu.com{api_path}", headers)
    return str(data.get("name") or "").strip()
