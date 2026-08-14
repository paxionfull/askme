"""小红书（xiaohongshu.com）共用：Cookie、SSR 解析、签名列表/详情 API。"""

from __future__ import annotations

import json
import re
import urllib.parse
from datetime import datetime
from html import escape
from typing import Any
from zoneinfo import ZoneInfo

from auth_cookie import get_request_cookie
from http_client import fetch_bytes_and_headers, fetch_json, fetch_text

SHANGHAI = ZoneInfo("Asia/Shanghai")
BASE_URL = "https://www.xiaohongshu.com"
EDITH_BASE = "https://edith.xiaohongshu.com"
AUTH_SLOT = "xiaohongshu"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

_STATE_RE = re.compile(
    r"window\.__INITIAL_STATE__\s*=\s*(\{.*?\})\s*</script>",
    re.S,
)


class AuthRequiredError(RuntimeError):
    """需要 Askme 引导用户登录；消息必须以 ASKME_AUTH_REQUIRED 开头。"""


def auth_required(message: str) -> AuthRequiredError:
    text = (message or "").strip() or "小红书需要登录 Cookie（含 web_session）"
    if not text.startswith("ASKME_AUTH_REQUIRED"):
        text = f"ASKME_AUTH_REQUIRED:slot={AUTH_SLOT} {text}"
    return AuthRequiredError(text)


def get_cookie() -> str:
    return get_request_cookie(AUTH_SLOT)


def require_cookie() -> str:
    cookie = get_cookie()
    if not cookie:
        raise auth_required("未配置 Cookie，请在 Askme 完成小红书登录授权。")
    parts = parse_cookie_dict(cookie)
    if not (parts.get("web_session") or "").strip():
        raise auth_required(
            "Cookie 缺少 web_session（当前仅为访客态），请重新登录授权后再试。"
        )
    if not (parts.get("a1") or "").strip():
        raise auth_required("Cookie 缺少 a1，请重新登录授权后再试。")
    return cookie


def probe_login_state(cookie: str, *, url: str = "") -> dict[str, Any]:
    """用页面 __INITIAL_STATE__ 判定是否真实登录。

    注意：小红书访客态也会下发 web_session / a1，不能只靠 Cookie 字段名判断。
    打开他人主页时，user.userInfo 是「当前登录账号」，userPageData 才是「主页博主」。
    """
    probe_url = (url or "").strip() or f"{BASE_URL}/explore"
    state = fetch_profile_state(probe_url, cookie)
    user = state.get("user") if isinstance(state.get("user"), dict) else {}
    info = user.get("userInfo") if isinstance(user.get("userInfo"), dict) else {}
    guest = bool(info.get("guest"))
    logged_in = bool(user.get("loggedIn")) and not guest
    raw_notes, meta = extract_notes_from_state(state)
    notes_with_id = 0
    note_author_id = ""
    for item in raw_notes:
        if not isinstance(item, dict):
            continue
        card = item.get("noteCard") if isinstance(item.get("noteCard"), dict) else {}
        nid = str(item.get("id") or card.get("noteId") or card.get("note_id") or "").strip()
        if nid:
            notes_with_id += 1
        if not note_author_id:
            note_user = card.get("user") if isinstance(card.get("user"), dict) else {}
            note_author_id = str(
                note_user.get("userId") or note_user.get("user_id") or ""
            ).strip()
    login_nickname = str(info.get("nickname") or info.get("nickName") or "").strip()
    profile_nickname = str(meta.get("nickname") or "").strip()
    profile_user_id = str(meta.get("user_id") or note_author_id or "").strip()
    return {
        "logged_in": logged_in,
        "guest": guest,
        # 登录账号（用于鉴权）
        "user_id": str(info.get("userId") or info.get("user_id") or "").strip(),
        "nickname": login_nickname,
        # 主页博主（用于数据源显示名；打开他人主页时与登录账号不同）
        "profile_user_id": profile_user_id,
        "profile_nickname": profile_nickname or login_nickname,
        "notes_with_id": notes_with_id,
        "probe_url": probe_url,
    }


def assert_logged_in_cookie(cookie: str, *, url: str = "") -> dict[str, Any]:
    """校验 Cookie 为真实登录态；访客 web_session 直接失败。"""
    try:
        result = probe_login_state(cookie, url=url)
    except Exception as exc:
        raise auth_required(f"无法校验登录态：{exc}") from exc
    if not result.get("logged_in"):
        raise auth_required(
            "Cookie 仍为访客态（页面 loggedIn=false）。"
            "小红书未登录也会下发 web_session，请扫码/手机完成真实登录后再保存。"
        )
    return result


def parse_cookie_dict(cookie: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for part in (cookie or "").split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        key, value = part.split("=", 1)
        out[key.strip()] = value.strip()
    return out


def default_headers(cookie: str, *, referer: str = BASE_URL) -> dict[str, str]:
    return {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": referer,
        "Cookie": cookie,
    }


def parse_initial_state(html: str) -> dict[str, Any]:
    match = _STATE_RE.search(html or "")
    if not match:
        raise ValueError("页面缺少 window.__INITIAL_STATE__")
    raw = re.sub(r"\bundefined\b", "null", match.group(1))
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("__INITIAL_STATE__ 不是对象")
    return data


def fetch_profile_state(profile_url: str, cookie: str) -> dict[str, Any]:
    html = fetch_text(profile_url, headers=default_headers(cookie, referer=profile_url))
    return parse_initial_state(html)


def note_id_to_published_at(note_id: str) -> str:
    """笔记 id 前 8 位十六进制多为秒级时间戳。"""
    raw = (note_id or "").strip()
    if len(raw) < 8:
        return ""
    try:
        ts = int(raw[:8], 16)
    except ValueError:
        return ""
    if ts < 1_000_000_000 or ts > 4_000_000_000:
        return ""
    return datetime.fromtimestamp(ts, tz=SHANGHAI).isoformat()


def format_unix_ms(value: Any) -> str:
    if value is None or value == "":
        return ""
    try:
        num = float(value)
    except (TypeError, ValueError):
        return ""
    if num > 1e12:
        num = num / 1000.0
    if num < 1_000_000_000:
        return ""
    return datetime.fromtimestamp(num, tz=SHANGHAI).isoformat()


def cover_url_from_card(cover: Any) -> str:
    if not isinstance(cover, dict):
        return ""
    for key in ("urlDefault", "url_default", "urlPre", "url_pre", "url"):
        value = str(cover.get(key) or "").strip()
        if value:
            return value
    info_list = cover.get("infoList") or cover.get("info_list")
    if isinstance(info_list, list):
        for item in info_list:
            if isinstance(item, dict):
                value = str(item.get("url") or "").strip()
                if value:
                    return value
    return ""


def extract_notes_from_state(state: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    user = state.get("user") if isinstance(state.get("user"), dict) else {}
    notes_tabs = user.get("notes") if isinstance(user.get("notes"), list) else []
    raw_notes: list[dict[str, Any]] = []
    if notes_tabs and isinstance(notes_tabs[0], list):
        raw_notes = [item for item in notes_tabs[0] if isinstance(item, dict)]

    queries = user.get("noteQueries") if isinstance(user.get("noteQueries"), list) else []
    query0 = queries[0] if queries and isinstance(queries[0], dict) else {}
    meta = {
        "logged_in": bool(user.get("loggedIn")),
        "has_more": bool(query0.get("hasMore")),
        "cursor": str(query0.get("cursor") or ""),
        "nickname": "",
        "avatar": "",
    }
    page_data = user.get("userPageData") if isinstance(user.get("userPageData"), dict) else {}
    basic = page_data.get("basicInfo") if isinstance(page_data.get("basicInfo"), dict) else {}
    meta["nickname"] = str(basic.get("nickname") or "")
    meta["avatar"] = str(basic.get("imageb") or basic.get("images") or "")
    meta["user_id"] = str(
        basic.get("userId")
        or basic.get("user_id")
        or page_data.get("userId")
        or page_data.get("user_id")
        or ""
    ).strip()
    return raw_notes, meta


def note_explore_url(note_id: str, *, xsec_token: str = "") -> str:
    nid = (note_id or "").strip()
    if not nid:
        return ""
    base = f"{BASE_URL}/explore/{nid}"
    token = (xsec_token or "").strip()
    if not token:
        return base
    query = urllib.parse.urlencode({"xsec_token": token, "xsec_source": "pc_user"})
    return f"{base}?{query}"


def note_profile_url(
    user_id: str,
    note_id: str,
    *,
    xsec_token: str = "",
) -> str:
    """用户主页下的笔记详情路径（部分场景比 /explore 更稳）。"""
    uid = (user_id or "").strip()
    nid = (note_id or "").strip()
    if not uid or not nid:
        return ""
    base = f"{BASE_URL}/user/profile/{uid}/note/{nid}"
    token = (xsec_token or "").strip()
    if not token:
        return base
    query = urllib.parse.urlencode({"xsec_token": token, "xsec_source": "pc_user"})
    return f"{base}?{query}"


def xsec_token_from_url(url: str) -> str:
    if not url:
        return ""
    try:
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    except Exception:
        return ""
    values = qs.get("xsec_token") or []
    return str(values[0] or "").strip() if values else ""


def normalize_ssr_note(item: dict[str, Any], *, author_fallback: str = "") -> dict[str, Any] | None:
    card = item.get("noteCard") if isinstance(item.get("noteCard"), dict) else {}
    note_id = str(
        item.get("id") or card.get("noteId") or card.get("note_id") or ""
    ).strip()
    if not note_id:
        return None
    xsec = str(
        item.get("xsecToken")
        or card.get("xsecToken")
        or card.get("xsec_token")
        or ""
    ).strip()
    title = str(card.get("displayTitle") or card.get("display_title") or "").strip()
    user = card.get("user") if isinstance(card.get("user"), dict) else {}
    author = str(
        user.get("nickname") or user.get("nickName") or author_fallback or ""
    ).strip()
    image = cover_url_from_card(card.get("cover"))
    return {
        "id": note_id,
        "note_id": note_id,
        "title": title or note_id,
        "url": note_explore_url(note_id, xsec_token=xsec),
        "published_at": note_id_to_published_at(note_id),
        "author": author,
        "image": image,
        "summary": title,
        "xsec_token": xsec,
        "type": str(card.get("type") or ""),
    }


def normalize_api_note(item: dict[str, Any], *, author_fallback: str = "") -> dict[str, Any] | None:
    note_id = str(item.get("note_id") or item.get("id") or "").strip()
    if not note_id:
        return None
    xsec = str(item.get("xsec_token") or item.get("xsecToken") or "").strip()
    title = str(item.get("display_title") or item.get("displayTitle") or "").strip()
    user = item.get("user") if isinstance(item.get("user"), dict) else {}
    author = str(
        user.get("nickname") or user.get("nick_name") or author_fallback or ""
    ).strip()
    image = cover_url_from_card(item.get("cover"))
    return {
        "id": note_id,
        "note_id": note_id,
        "title": title or note_id,
        "url": note_explore_url(note_id, xsec_token=xsec),
        "published_at": note_id_to_published_at(note_id),
        "author": author,
        "image": image,
        "summary": title,
        "xsec_token": xsec,
        "type": str(item.get("type") or ""),
    }


def ensure_notes_have_ids(notes: list[dict[str, Any]], *, context: str) -> list[dict[str, Any]]:
    if notes:
        return notes
    raise auth_required(
        f"{context}：未拿到有效 note_id（访客/无效 Cookie 会被清空）。"
        "请在 Askme 用真实账号登录小红书并保存含 web_session 的 Cookie。"
    )


def try_xhshow():
    try:
        from xhshow import Xhshow  # type: ignore

        return Xhshow()
    except Exception:
        return None


def sign_headers_get(*, uri: str, cookie: str, params: dict[str, Any]) -> dict[str, str]:
    client = try_xhshow()
    if client is None:
        raise RuntimeError(
            "缺少 xhshow 签名库（pip install xhshow），无法请求小红书 edith API"
        )
    cookies = parse_cookie_dict(cookie)
    # 数据接口优先 xys；xyw 在部分环境下返回 461
    try:
        signed = client.sign_headers_get(
            uri=uri, cookies=cookies, params=params, sign_format="xys"
        )
    except TypeError:
        signed = client.sign_headers_get(uri=uri, cookies=cookies, params=params)
    if not isinstance(signed, dict):
        raise RuntimeError("xhshow 签名结果异常")
    return signed


def sign_headers_post(*, uri: str, cookie: str, payload: dict[str, Any]) -> dict[str, str]:
    client = try_xhshow()
    if client is None:
        raise RuntimeError(
            "缺少 xhshow 签名库（pip install xhshow），无法请求小红书 edith API"
        )
    cookies = parse_cookie_dict(cookie)
    try:
        signed = client.sign_headers_post(
            uri=uri, cookies=cookies, payload=payload, sign_format="xys"
        )
    except TypeError:
        signed = client.sign_headers_post(uri=uri, cookies=cookies, payload=payload)
    if not isinstance(signed, dict):
        raise RuntimeError("xhshow 签名结果异常")
    return signed


def fetch_user_posted(
    *,
    user_id: str,
    cookie: str,
    cursor: str = "",
    num: int = 30,
    xsec_token: str = "",
    referer: str = "",
) -> dict[str, Any]:
    params: dict[str, Any] = {
        "num": str(max(1, min(int(num), 50))),
        "cursor": cursor or "",
        "user_id": user_id,
        "image_formats": "jpg,webp,avif",
    }
    if xsec_token:
        params["xsec_token"] = xsec_token
        params["xsec_source"] = "pc_user"

    uri = "/api/sns/web/v1/user_posted"
    signed = sign_headers_get(uri=uri, cookie=cookie, params=params)
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Origin": BASE_URL,
        "Referer": referer or f"{BASE_URL}/user/profile/{user_id}",
        "Cookie": cookie,
        **signed,
    }
    url = f"{EDITH_BASE}{uri}?{urllib.parse.urlencode(params)}"
    data = fetch_json(url, headers=headers)
    if not isinstance(data, dict):
        raise ValueError("user_posted 响应不是 JSON 对象")
    code = data.get("code")
    msg = str(data.get("msg") or "")
    if code in (-101, 401, 403) or "登录" in msg:
        raise auth_required(f"user_posted 需要登录: code={code} msg={msg}")
    if data.get("success") is False and code not in (0, None):
        raise RuntimeError(f"user_posted 失败: code={code} msg={msg}")
    return data


def fetch_note_feed(
    *,
    note_id: str,
    cookie: str,
    xsec_token: str = "",
    referer: str = "",
) -> dict[str, Any]:
    """POST /api/sns/web/v1/feed 取笔记详情。"""
    uri = "/api/sns/web/v1/feed"
    payload: dict[str, Any] = {
        "source_note_id": note_id,
        "image_formats": ["jpg", "webp", "avif"],
        "extra": {"need_body_topic": "1"},
        "xsec_source": "pc_user",
        "xsec_token": xsec_token or "",
    }
    signed = sign_headers_post(uri=uri, cookie=cookie, payload=payload)
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json;charset=UTF-8",
        "Origin": BASE_URL,
        "Referer": referer or note_explore_url(note_id, xsec_token=xsec_token),
        "Cookie": cookie,
        **signed,
    }
    body, _ = fetch_bytes_and_headers(
        f"{EDITH_BASE}{uri}",
        headers=headers,
        data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        method="POST",
    )
    data = json.loads(body.decode("utf-8", errors="replace"))
    if not isinstance(data, dict):
        raise ValueError("feed 响应不是 JSON 对象")
    code = data.get("code")
    msg = str(data.get("msg") or "")
    if code in (-101, 401, 403) or "登录" in msg:
        raise auth_required(f"feed 需要登录: code={code} msg={msg}")
    if data.get("success") is False and code not in (0, None):
        raise RuntimeError(f"feed 失败: code={code} msg={msg}")
    return data


def note_from_feed_payload(data: dict[str, Any], note_id: str) -> dict[str, Any]:
    payload = data.get("data") if isinstance(data.get("data"), dict) else {}
    items = payload.get("items") if isinstance(payload.get("items"), list) else []
    for item in items:
        if not isinstance(item, dict):
            continue
        model = item.get("note_card") or item.get("noteCard") or item
        if not isinstance(model, dict):
            continue
        nid = str(model.get("note_id") or model.get("id") or "").strip()
        if note_id and nid and nid != note_id:
            continue
        return model
    raise ValueError(f"feed 未返回笔记 {note_id}")


def fetch_note_detail_state(note_url: str, cookie: str) -> dict[str, Any]:
    html = fetch_text(note_url, headers=default_headers(cookie, referer=BASE_URL))
    if "你访问的页面不见了" in html or "页面不见了" in html:
        raise ValueError(f"笔记不存在或无权访问: {note_url}")
    return parse_initial_state(html)


def extract_note_detail(state: dict[str, Any], note_id: str) -> dict[str, Any]:
    note_store = state.get("note") if isinstance(state.get("note"), dict) else {}
    detail_map = note_store.get("noteDetailMap")
    if not isinstance(detail_map, dict) or not detail_map:
        raise auth_required("详情页 noteDetailMap 为空，通常需要有效登录 Cookie。")

    entry = detail_map.get(note_id)
    if not isinstance(entry, dict):
        first = next(iter(detail_map.values()), None)
        entry = first if isinstance(first, dict) else None
    if not isinstance(entry, dict):
        raise ValueError(f"noteDetailMap 中无笔记 {note_id}")

    note = entry.get("note") if isinstance(entry.get("note"), dict) else entry
    if not isinstance(note, dict):
        raise ValueError("笔记详情结构异常")
    return detail_dict_from_note_card(note, fallback_id=note_id)


def detail_dict_from_note_card(note: dict[str, Any], *, fallback_id: str = "") -> dict[str, Any]:
    title = str(note.get("title") or note.get("display_title") or note.get("displayTitle") or "").strip()
    desc = str(note.get("desc") or note.get("description") or "").strip()
    author_obj = note.get("user") if isinstance(note.get("user"), dict) else {}
    author = str(author_obj.get("nickname") or author_obj.get("nickName") or "").strip()
    published = format_unix_ms(note.get("time") or note.get("last_update_time") or note.get("lastUpdateTime"))
    nid = str(note.get("note_id") or note.get("noteId") or fallback_id).strip()
    if not published:
        published = note_id_to_published_at(nid)

    images: list[str] = []
    image_list = note.get("image_list") or note.get("imageList") or []
    if isinstance(image_list, list):
        for img in image_list:
            if not isinstance(img, dict):
                continue
            url = str(img.get("url_default") or img.get("urlDefault") or img.get("url") or "").strip()
            if not url:
                info_list = img.get("info_list") or img.get("infoList")
                if isinstance(info_list, list):
                    for info in info_list:
                        if isinstance(info, dict) and info.get("url"):
                            url = str(info["url"]).strip()
                            break
            if url:
                images.append(url)

    # 视频笔记也可能只有封面
    if not images:
        cover = note.get("cover")
        cover_url = cover_url_from_card(cover)
        if cover_url:
            images.append(cover_url)

    content_html = build_note_html(title=title, desc=desc, images=images)
    return {
        "id": nid,
        "title": title or nid,
        "url": note_explore_url(nid),
        "published_at": published,
        "author": author,
        "image": images[0] if images else "",
        "summary": desc[:200] if desc else title,
        "content_html": content_html,
    }


def build_note_html(*, title: str, desc: str, images: list[str]) -> str:
    parts: list[str] = []
    if title:
        parts.append(f"<h1>{escape(title)}</h1>")
    if desc:
        body = escape(desc).replace("\n", "<br/>")
        parts.append(f"<p>{body}</p>")
    for url in images[:20]:
        parts.append(f'<p><img src="{escape(url, quote=True)}" /></p>')
    html = "\n".join(parts).strip()
    return html if html else "<p></p>"
