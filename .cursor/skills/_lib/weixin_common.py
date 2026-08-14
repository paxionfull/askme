"""微信公众号公共抓取：公众号后台 searchbiz / list_ex + 公开正文页。

凭证（设置页 slot=weixin，或环境变量）：
  ASKME_COOKIE_WEIXIN / WEIXIN_MP_COOKIE
  须含 askme_mp_token=<后台 token> 以及 slave_sid 等登录 Cookie。
  也可另设 WEIXIN_MP_TOKEN。

重要：必须用【公众号】后台扫码登录，不能是小程序（/wxamp）。
"""

from __future__ import annotations

import json
import os
import random
import re
import threading
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from content_utils import clean_html_fragment
from detail_hints import pick_hints, resolve_detail_url
from http_client import fetch_json, fetch_text, sleep_between_pages

SHANGHAI = ZoneInfo("Asia/Shanghai")
MP_HOST = "https://mp.weixin.qq.com"
TOKEN_COOKIE_KEY = "askme_mp_token"
AUTH_REQUIRED = "ASKME_AUTH_REQUIRED:slot=weixin"

# searchbiz：同登录态全局串行 + 最小间隔 + 结果缓存，降低腾讯频控
_SEARCH_LOCK = threading.Lock()
_SEARCH_LAST_AT = 0.0
_SEARCH_COOLDOWN_UNTIL = 0.0
_SEARCH_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_SEARCH_MIN_INTERVAL = float(os.getenv("WEIXIN_SEARCH_MIN_INTERVAL", "3.0"))
_SEARCH_CACHE_TTL = float(os.getenv("WEIXIN_SEARCH_CACHE_TTL", "86400"))
_SEARCH_COOLDOWN_SECONDS = float(os.getenv("WEIXIN_SEARCH_COOLDOWN", "60"))


class WeixinMpRateLimited(RuntimeError):
    """微信后台 API 频控（searchbiz / list_ex 等）。"""

    def __init__(self, message: str, *, retry_after: float = 60.0):
        super().__init__(message)
        self.retry_after = max(1.0, float(retry_after))


# 兼容旧名（搜索接口）
WeixinSearchRateLimited = WeixinMpRateLimited

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

# (fakeid, page, per) -> next begin offset
_PAGE_BEGIN: dict[tuple[str, int, int], int] = {}
# page=1 短缓存：接入时 probe/validate/首刷共用一次 list_ex
_LIST_PAGE_CACHE: dict[tuple[str, int, int], tuple[float, dict[str, Any]]] = {}
_LIST_PAGE_CACHE_TTL = float(os.getenv("WEIXIN_LIST_CACHE_TTL", "120"))
_CURSOR_PATH = (
    Path(__file__).resolve().parents[3] / "data" / "weixin_list_cursors.json"
)
_CURSOR_LOCK = threading.Lock()
_CURSORS_LOADED = False


def _load_page_cursors() -> None:
    """从磁盘恢复分页游标（进程重启后跳页不必重走）。"""
    global _CURSORS_LOADED
    if _CURSORS_LOADED:
        return
    _CURSORS_LOADED = True
    try:
        if not _CURSOR_PATH.is_file():
            return
        raw = json.loads(_CURSOR_PATH.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            return
        for key, begin in raw.items():
            parts = str(key).split("|")
            if len(parts) != 3:
                continue
            fake, page_s, per_s = parts
            try:
                _PAGE_BEGIN[(fake, int(page_s), int(per_s))] = int(begin)
            except (TypeError, ValueError):
                continue
    except Exception:
        pass


def _persist_page_cursors() -> None:
    try:
        _CURSOR_PATH.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            f"{fake}|{page}|{per}": begin
            for (fake, page, per), begin in list(_PAGE_BEGIN.items())
        }
        _CURSOR_PATH.write_text(
            json.dumps(payload, ensure_ascii=False, indent=0),
            encoding="utf-8",
        )
    except Exception:
        pass


def _set_page_begin(key: tuple[str, int, int], begin: int) -> None:
    with _CURSOR_LOCK:
        _load_page_cursors()
        _PAGE_BEGIN[key] = int(begin)
        _persist_page_cursors()


def _get_page_begin(key: tuple[str, int, int]) -> int | None:
    with _CURSOR_LOCK:
        _load_page_cursors()
        value = _PAGE_BEGIN.get(key)
        return int(value) if value is not None else None

BIZ_RE = re.compile(
    r"""(?:__biz|biz)\s*[=:]\s*["']?(?P<biz>M[zZ][A-Za-z0-9_-]+={0,2})""",
    re.I,
)
NICK_RE = re.compile(
    r"""(?:nickname|nick_name)\s*[=:]\s*["'](?P<nick>[^"']+)["']""",
    re.I,
)
OG_TITLE_RE = re.compile(
    r'property="og:title"\s+content="([^"]+)"',
    re.I,
)
JS_CONTENT_RE = re.compile(
    r'id="js_content"[^>]*>([\s\S]*?)</div>\s*<script',
    re.I,
)
JS_CONTENT_RE2 = re.compile(
    r'id="js_content"[^>]*>([\s\S]*?)</div>',
    re.I,
)


def cookie_value(cookie: str, key: str) -> str:
    for part in (cookie or "").split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        name, value = part.split("=", 1)
        if name.strip() == key:
            return value.strip()
    return ""


def strip_token_cookie(cookie: str) -> str:
    parts: list[str] = []
    for part in (cookie or "").split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        name = part.split("=", 1)[0].strip()
        if name == TOKEN_COOKIE_KEY:
            continue
        parts.append(part)
    if not any(p.startswith("wxtokenkey=") for p in parts):
        parts.append("wxtokenkey=777")
    return "; ".join(parts)


def load_mp_session() -> tuple[str, str]:
    """返回 (token, cookie_header)。缺凭证时抛出 ASKME_AUTH_REQUIRED。"""
    try:
        from credential_store import get_cookie_for_slot, sync_runtime_cookies

        sync_runtime_cookies()
        stored = get_cookie_for_slot("weixin")
        if stored:
            os.environ["ASKME_COOKIE_WEIXIN"] = stored
    except Exception:
        pass

    raw = (
        os.getenv("ASKME_COOKIE_WEIXIN", "").strip()
        or os.getenv("WEIXIN_MP_COOKIE", "").strip()
        or os.getenv("ASKME_COOKIE", "").strip()
    )
    token = (
        cookie_value(raw, TOKEN_COOKIE_KEY)
        or os.getenv("WEIXIN_MP_TOKEN", "").strip()
        or os.getenv("ASKME_WEIXIN_TOKEN", "").strip()
    )
    cookie = strip_token_cookie(raw)
    if not token or not cookie or "slave_sid=" not in cookie:
        raise RuntimeError(
            f"{AUTH_REQUIRED} 微信公众号列表需要公众号后台登录态。"
            "请在设置页配置「微信」凭证（扫码登录公众号后台，勿选小程序），"
            "或设置含 askme_mp_token 与 slave_sid 的 Cookie。"
        )
    return token, cookie


def fakeid_slug(fakeid: str) -> str:
    raw = (fakeid or "").strip()
    safe = re.sub(r"[^a-zA-Z0-9]+", "", raw).lower()
    return safe or "unknown"


def format_weixin_source_name(nickname: str) -> str:
    name = (nickname or "").strip()
    if not name:
        return ""
    for prefix in ("微信-", "微信 · ", "微信·", "公众号-", "公众号 · "):
        if name.startswith(prefix):
            name = name[len(prefix) :].strip()
            break
    return f"微信-{name}" if name else ""


def extract_biz_from_html(html: str) -> str:
    m = BIZ_RE.search(html or "")
    return m.group("biz") if m else ""


def extract_nickname_from_html(html: str) -> str:
    for pat in (
        r'id="js_name"[^>]*>([^<]+)<',
        r'property="og:article:author"\s+content="([^"]+)"',
        r'var\s+nickname\s*=\s*htmlDecode\("([^"]+)"\)',
        r'nick_name\s*=\s*"([^"]+)"',
    ):
        m = re.search(pat, html or "", re.I)
        if m:
            return m.group(1).strip()
    m = NICK_RE.search(html or "")
    return m.group("nick").strip() if m else ""


def extract_biz_from_url(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        return ""
    try:
        parsed = urllib.parse.urlparse(raw)
        qs = urllib.parse.parse_qs(parsed.query)
        for key in ("__biz", "biz", "fakeid"):
            vals = qs.get(key) or []
            if vals and vals[0].strip():
                return vals[0].strip()
    except Exception:
        pass
    m = BIZ_RE.search(raw)
    return m.group("biz") if m else ""


def resolve_account_from_entry(entry_url: str, *, fetch_profile: bool | None = None) -> dict[str, str]:
    """从文章/主页 URL 解析 fakeid 与昵称（公开页，无需后台 Cookie）。

    若 URL 已带 __biz 且有 askme_name，默认不发 HTTP（搜索接入场景）。
    文章链接或缺昵称时仍会拉公开页补全。
    """
    url = (entry_url or "").strip()
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"
    biz = extract_biz_from_url(url)
    askme_name = extract_askme_name(url)
    should_fetch = fetch_profile
    if should_fetch is None:
        # 已有 biz + 显示名 hint → 跳过公开页请求
        should_fetch = not (biz and askme_name)

    nickname = askme_name
    if should_fetch:
        try:
            html = fetch_text(
                url,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "text/html",
                    "Referer": "https://mp.weixin.qq.com/",
                },
            )
            if not biz:
                biz = extract_biz_from_html(html)
            nickname = extract_nickname_from_html(html) or nickname
        except Exception:
            pass
    if not biz:
        raise ValueError(
            "无法从链接解析公众号 __biz。请粘贴 mp.weixin.qq.com 文章链接，"
            "或带 __biz= 参数的主页链接。"
        )
    return {
        "fakeid": biz,
        "nickname": nickname or askme_name,
        "entry_url": url,
        "slug_key": fakeid_slug(biz),
        "askme_name": askme_name,
    }


def _mp_headers(token: str, cookie: str) -> dict[str, str]:
    return {
        "User-Agent": USER_AGENT,
        "Host": "mp.weixin.qq.com",
        "Cookie": cookie,
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": (
            f"{MP_HOST}/cgi-bin/appmsg?t=media/appmsg_edit&action=edit"
            f"&type=10&isMul=1&isNew=1&share=1&lang=zh_CN&token={token}"
        ),
        "Origin": MP_HOST,
    }


def _is_freq_control_error(ret: Any, err: Any) -> bool:
    """识别微信后台频控（常见 200013 / err_msg 含频繁）。"""
    if ret in (200013, "200013"):
        return True
    text = str(err or "")
    lower = text.lower()
    return "频繁" in text or "freq" in lower or "too many" in lower or "rate limit" in lower


def _mp_get_json(url: str, *, token: str, cookie: str) -> dict[str, Any]:
    data = fetch_json(url, headers=_mp_headers(token, cookie))
    if not isinstance(data, dict):
        raise ValueError("微信后台 API 返回非 JSON 对象")
    base = data.get("base_resp") or {}
    ret = base.get("ret")
    if ret not in (0, "0", None) and base:
        err = base.get("err_msg") or ret
        if ret in (200002, "200002"):
            raise RuntimeError(
                f"{AUTH_REQUIRED} 公众号后台返回 200002（常见于扫成小程序或会话失效），请重新登录公众号后台"
            )
        if ret in (-3, "-3", 200003, "200003"):
            raise RuntimeError(f"{AUTH_REQUIRED} 公众号后台会话失效，请重新登录")
        if _is_freq_control_error(ret, err):
            raise WeixinMpRateLimited(
                f"微信后台操作过于频繁（ret={ret}），请稍后再试",
                retry_after=_SEARCH_COOLDOWN_SECONDS,
            )
        raise RuntimeError(f"微信后台 API 失败: ret={ret} err={err}")
    return data


def _search_biz_uncached(query: str, *, begin: int = 0, count: int = 5) -> list[dict[str, Any]]:
    token, cookie = load_mp_session()
    params = {
        "action": "search_biz",
        "begin": begin,
        "count": count,
        "query": query,
        "token": token,
        "lang": "zh_CN",
        "f": "json",
        "ajax": "1",
        "random": random.random(),
    }
    url = f"{MP_HOST}/cgi-bin/searchbiz?" + urllib.parse.urlencode(params)
    data = _mp_get_json(url, token=token, cookie=cookie)
    items = data.get("list") or []
    return [x for x in items if isinstance(x, dict)]


def search_biz(query: str, *, begin: int = 0, count: int = 5) -> list[dict[str, Any]]:
    """搜索公众号：命中缓存则不请求；否则全局串行并保证最小间隔。"""
    q = (query or "").strip()
    if not q:
        return []
    # 仅缓存首页搜索（批量接入场景）；翻页不缓存
    use_cache = begin == 0
    cache_key = q.casefold()
    if use_cache:
        hit = _SEARCH_CACHE.get(cache_key)
        if hit is not None:
            cached_at, items = hit
            if time.monotonic() - cached_at < _SEARCH_CACHE_TTL:
                return [dict(x) for x in items]

    global _SEARCH_LAST_AT, _SEARCH_COOLDOWN_UNTIL
    with _SEARCH_LOCK:
        if use_cache:
            hit = _SEARCH_CACHE.get(cache_key)
            if hit is not None:
                cached_at, items = hit
                if time.monotonic() - cached_at < _SEARCH_CACHE_TTL:
                    return [dict(x) for x in items]

        now = time.monotonic()
        if now < _SEARCH_COOLDOWN_UNTIL:
            wait = _SEARCH_COOLDOWN_UNTIL - now
            raise WeixinMpRateLimited(
                "微信搜索冷却中，请稍后再试，或改用文章链接接入（无需搜索）",
                retry_after=wait,
            )
        gap = _SEARCH_MIN_INTERVAL - (now - _SEARCH_LAST_AT)
        if gap > 0:
            time.sleep(gap)
        try:
            items = _search_biz_uncached(q, begin=begin, count=count)
        except WeixinMpRateLimited as exc:
            _SEARCH_COOLDOWN_UNTIL = time.monotonic() + _SEARCH_COOLDOWN_SECONDS
            raise WeixinMpRateLimited(
                f"{exc}。搜索公众号易触发限流，可改用文章链接接入（无需搜索）",
                retry_after=getattr(exc, "retry_after", _SEARCH_COOLDOWN_SECONDS),
            ) from exc
        _SEARCH_LAST_AT = time.monotonic()
        if use_cache:
            _SEARCH_CACHE[cache_key] = (_SEARCH_LAST_AT, [dict(x) for x in items])
        return items


def normalize_search_hit(item: dict[str, Any]) -> dict[str, Any]:
    """对外搜索结果字段。"""
    return {
        "fakeid": str(item.get("fakeid") or "").strip(),
        "nickname": str(item.get("nickname") or "").strip(),
        "alias": str(item.get("alias") or "").strip(),
        "round_head_img": str(item.get("round_head_img") or "").strip(),
        "signature": str(item.get("signature") or "").strip(),
        "service_type": item.get("service_type"),
        "verify_status": item.get("verify_status"),
    }


def extract_askme_name(url: str) -> str:
    """从合成入口 URL 读取 askme_name（接入时携带的显示名 hint）。"""
    try:
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(url or "").query)
        vals = qs.get("askme_name") or []
        if vals and vals[0].strip():
            return urllib.parse.unquote(vals[0].strip())
    except Exception:
        pass
    return ""


def build_weixin_entry_url(fakeid: str, *, nickname: str = "") -> str:
    """批量接入用的合成入口：带 __biz，可选 askme_name。"""
    fake = (fakeid or "").strip()
    params: dict[str, str] = {"action": "home", "__biz": fake}
    name = (nickname or "").strip()
    if name:
        params["askme_name"] = name
    return f"{MP_HOST}/mp/profile_ext?" + urllib.parse.urlencode(params)


def list_appmsg(
    fakeid: str,
    *,
    begin: int = 0,
    count: int = 10,
) -> dict[str, Any]:
    token, cookie = load_mp_session()
    params = {
        "token": token,
        "lang": "zh_CN",
        "f": "json",
        "ajax": "1",
        "random": random.random(),
        "action": "list_ex",
        "begin": begin,
        "count": count,
        "query": "",
        "fakeid": fakeid,
        "type": "9",
    }
    url = f"{MP_HOST}/cgi-bin/appmsg?" + urllib.parse.urlencode(params)
    return _mp_get_json(url, token=token, cookie=cookie)


def fetch_list_page(fakeid: str, page: int = 1, per: int = 10) -> dict[str, Any]:
    fake = (fakeid or "").strip()
    if not fake:
        raise ValueError("缺少 fakeid")
    page = max(1, int(page or 1))
    per = max(1, min(int(per or 10), 20))
    key = (fake, page, per)

    # 首页短缓存：同账号短时间内 probe / validate / 首刷只打一次 list_ex
    if page <= 1:
        cached = _LIST_PAGE_CACHE.get(key)
        if cached is not None:
            cached_at, payload = cached
            if time.monotonic() - cached_at < _LIST_PAGE_CACHE_TTL:
                return dict(payload)

    if page <= 1:
        begin = 0
    else:
        begin = _get_page_begin((fake, page - 1, per))
        if begin is None:
            # 线性补齐游标
            begin = 0
            for p in range(1, page):
                payload = list_appmsg(fake, begin=begin, count=per)
                items = payload.get("app_msg_list") or []
                begin = begin + len(items)
                _set_page_begin((fake, p, per), begin)
                if not items:
                    break
                if p + 1 < page:
                    sleep_between_pages()
            begin = _get_page_begin((fake, page - 1, per)) or begin

    payload = list_appmsg(fake, begin=begin, count=per)
    items = payload.get("app_msg_list") or []
    next_begin = begin + len(items)
    _set_page_begin(key, next_begin)
    total = int(payload.get("app_msg_cnt") or 0)
    result = {
        "fakeid": fake,
        "page": page,
        "per": per,
        "begin": begin,
        "items": items if isinstance(items, list) else [],
        "app_msg_cnt": total,
        "has_next": bool(items) and (total <= 0 or next_begin < total),
    }
    if page <= 1:
        _LIST_PAGE_CACHE[key] = (time.monotonic(), dict(result))
    return result


def list_items(payload: dict) -> list[dict]:
    items = payload.get("items") or payload.get("app_msg_list") or []
    return [x for x in items if isinstance(x, dict)]


def has_next_page(payload: dict) -> bool:
    return bool(payload.get("has_next"))


def _ts_to_iso(ts: Any) -> str:
    try:
        value = int(ts)
    except (TypeError, ValueError):
        return ""
    if value <= 0:
        return ""
    dt = datetime.fromtimestamp(value, tz=timezone.utc).astimezone(SHANGHAI)
    return dt.isoformat()


def normalize_list_item(item: dict) -> dict:
    aid = str(item.get("aid") or item.get("appmsgid") or "").strip()
    link = str(item.get("link") or "").strip()
    title = str(item.get("title") or "").strip()
    digest = str(item.get("digest") or "").strip()
    cover = str(item.get("cover") or "").strip()
    published = _ts_to_iso(item.get("update_time") or item.get("create_time"))
    # article_id 用 aid；无则从 link 尾部
    article_id = aid
    if not article_id and link:
        m = re.search(r"/s/([^/?#]+)", link)
        article_id = m.group(1) if m else link
    return {
        "id": article_id,
        "title": title,
        "url": link,
        "published_at": published,
        "author": str(item.get("author_name") or "").strip(),
        "image": cover,
        "summary": digest,
    }


def fetch_article_detail(fakeid: str, article_id: str, **hints: object) -> dict:
    _ = fakeid
    meta = pick_hints(**hints)
    url = resolve_detail_url(article_id, **hints) or meta.get("url", "")
    if not url:
        # 兼容纯 /s/xxx id
        aid = (article_id or "").strip()
        if aid.startswith("http"):
            url = aid
        elif re.fullmatch(r"[A-Za-z0-9_-]{6,}", aid):
            url = f"{MP_HOST}/s/{aid}"
        else:
            raise ValueError("缺少文章 url，无法拉取正文")

    html = fetch_text(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html",
            "Referer": "https://mp.weixin.qq.com/",
        },
    )
    title = meta.get("title") or ""
    m = OG_TITLE_RE.search(html)
    if m:
        title = title or m.group(1).strip()
    body_m = JS_CONTENT_RE.search(html) or JS_CONTENT_RE2.search(html)
    raw_html = body_m.group(1) if body_m else ""
    content_html = clean_html_fragment(raw_html) if raw_html else ""
    # 空正文不 raise：交给 backend 写入 parse_failed，便于重试与排查（避免静默 none）
    result = {
        "id": article_id,
        "title": title,
        "url": url,
        "published_at": meta.get("published_at", ""),
        "author": meta.get("author", "") or extract_nickname_from_html(html),
        "image": meta.get("image", ""),
        "summary": meta.get("summary", ""),
        "content_html": content_html,
    }
    if not content_html:
        result["body_status"] = "parse_failed"
        result["body_detail"] = "未解析到公众号正文 #js_content"
    return result


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    _ = article_id
    return clean_html_fragment(raw_html or "")


def verify_mp_session() -> dict[str, Any]:
    """校验公众号后台登录态：load session + 轻量 searchbiz。"""
    result: dict[str, Any] = {
        "ok": False,
        "cookie_configured": False,
        "message": "",
        "hit_count": 0,
        "error": "",
    }
    try:
        load_mp_session()
        result["cookie_configured"] = True
    except Exception as exc:
        result["error"] = str(exc)
        result["message"] = str(exc)
        return result

    try:
        # 任意短查询即可验证 token/cookie；不依赖具体已接入账号
        hits = search_biz("微信", begin=0, count=1)
        result["ok"] = True
        result["hit_count"] = len(hits)
        result["message"] = "微信公众号后台登录有效"
        return result
    except WeixinMpRateLimited as exc:
        # 频控说明会话本身仍可用
        result["ok"] = True
        result["message"] = f"微信公众号后台登录有效（接口繁忙：{exc}）"
        result["error"] = str(exc)
        return result
    except Exception as exc:
        result["ok"] = False
        result["error"] = str(exc)
        result["message"] = str(exc)
        return result


def probe_account(fakeid: str, *, nickname_hint: str = "") -> dict[str, Any]:
    """探测列表是否可用；返回 display_name / sample titles。"""
    result: dict[str, Any] = {
        "fakeid": fakeid,
        "nickname": nickname_hint or "",
        "ok": False,
        "cookie_configured": False,
        "list_count": 0,
        "display_name": format_weixin_source_name(nickname_hint) if nickname_hint else "",
        "sample_titles": [],
        "error": "",
    }
    try:
        load_mp_session()
        result["cookie_configured"] = True
    except Exception as exc:
        result["error"] = str(exc)
        return result

    try:
        payload = fetch_list_page(fakeid, page=1, per=5)
        items = list_items(payload)
        titles = [str(i.get("title") or "")[:80] for i in items[:3]]
        result.update(
            {
                "ok": bool(items),
                "list_count": len(items),
                "app_msg_cnt": payload.get("app_msg_cnt"),
                "sample_titles": titles,
                "error": "" if items else "列表为空（目标号可能禁止被搜索/会话异常）",
            }
        )
        if not result["display_name"] and nickname_hint:
            result["display_name"] = format_weixin_source_name(nickname_hint)
    except Exception as exc:
        result["ok"] = False
        result["error"] = str(exc)
    return result
