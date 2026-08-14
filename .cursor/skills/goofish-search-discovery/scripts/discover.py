#!/usr/bin/env python3
"""闲鱼（Goofish）搜索发现层 — PC mtop 搜索 + 商品详情。"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import urllib.parse
from datetime import datetime
from html import escape
from zoneinfo import ZoneInfo

from auth_cookie import get_request_cookie
from content_utils import clean_html_fragment
from detail_hints import pick_hints, resolve_detail_url
from http_client import fetch_json, fetch_with_headers, sleep_between_pages
from list_index import ListByIdIndex

SHANGHAI = ZoneInfo("Asia/Shanghai")
BASE_URL = "https://www.goofish.com"
H5API_BASE = "https://h5api.m.goofish.com/h5"
APP_KEY = "34839810"
SEARCH_API = "mtop.taobao.idlemtopsearch.pc.search"
DETAIL_API = "mtop.taobao.idle.pc.detail"
AUTH_SLOT = "goofish-com"
REQUIRED_COOKIE_KEYS = ("_m_h5_tk", "unb", "cookie2")
ENTRY_URL = (
    "https://www.goofish.com/search?"
    "q=%E7%BD%91%E7%90%83%E6%8B%8D&spm=a21ybx.home.searchInput.0"
)
DEFAULT_KEYWORD = "网球拍"
LOGO_URL = "https://img.alicdn.com/tfs/TB19WObTNv1gK0jSZFFXXb0sXXa-144-144.png"

FEED_ID = "website:goofish-search"
FEED_META = {
    "id": FEED_ID,
    "mpName": "Goofish · search",
    "mpCover": LOGO_URL,
    "mpIntro": "闲鱼搜索：网球拍",
    "status": 1,
    "source": "website",
    "entryUrl": ENTRY_URL,
}
REFRESH_DEFAULTS = {"max_pages": 3, "per": 30}

DEFAULT_HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
    "Origin": BASE_URL,
    "Referer": f"{BASE_URL}/",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
}

_LIST_INDEX = ListByIdIndex()
_COOKIE_CACHE: str | None = None


class AuthRequiredError(RuntimeError):
    """需要 Askme 引导用户登录闲鱼。"""


def _auth_required(message: str) -> AuthRequiredError:
    text = (message or "").strip() or "闲鱼搜索需要登录 Cookie"
    if not text.startswith("ASKME_AUTH_REQUIRED"):
        text = f"ASKME_AUTH_REQUIRED:slot={AUTH_SLOT} {text}"
    return AuthRequiredError(text)


def _parse_cookie_dict(cookie: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for part in (cookie or "").split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        name, value = part.split("=", 1)
        name = name.strip()
        value = value.strip()
        if name and value:
            out[name] = value
    return out


def _keyword_from_entry() -> str:
    qs = urllib.parse.parse_qs(urllib.parse.urlparse(ENTRY_URL).query)
    values = qs.get("q") or []
    raw = str(values[0] or "").strip() if values else ""
    return raw or DEFAULT_KEYWORD


def require_cookie() -> str:
    global _COOKIE_CACHE
    if _COOKIE_CACHE is not None:
        return _COOKIE_CACHE
    cookie = get_request_cookie(AUTH_SLOT).strip()
    if not cookie:
        raise _auth_required(
            "未配置 Cookie，请在 Askme 完成闲鱼扫码登录授权"
            "（须含 unb、cookie2、_m_h5_tk）。"
        )
    parts = _parse_cookie_dict(cookie)
    missing = [k for k in REQUIRED_COOKIE_KEYS if not (parts.get(k) or "").strip()]
    if missing:
        raise _auth_required(
            f"Cookie 缺少 {', '.join(missing)}（访客态无效），"
            "请扫码登录后重新授权。"
        )
    _COOKIE_CACHE = cookie
    return cookie


def _h5_token(cookie: str) -> str:
    raw = _parse_cookie_dict(cookie).get("_m_h5_tk", "")
    return raw.split("_", 1)[0].strip()


def _sign(token: str, timestamp_ms: str, data_json: str) -> str:
    raw = f"{token}&{timestamp_ms}&{APP_KEY}&{data_json}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()


def _merge_set_cookie(cookie: str, set_cookie_header: str) -> str:
    """用响应 Set-Cookie 刷新签名相关字段（忽略风控临时 cookie）。"""
    if not set_cookie_header:
        return cookie
    allow = {"_m_h5_tk", "_m_h5_tk_enc", "cookie2", "unb", "t", "_tb_token_", "cna"}
    parts = _parse_cookie_dict(cookie)
    for segment in re.split(r",(?=\s*[A-Za-z0-9_\-]+=)", set_cookie_header):
        first = segment.split(";", 1)[0].strip()
        if "=" not in first:
            continue
        name, value = first.split("=", 1)
        name = name.strip()
        value = value.strip()
        if name in allow and value:
            parts[name] = value
    return "; ".join(f"{k}={v}" for k, v in parts.items())


def _mtop_post(
    api: str,
    data_obj: dict,
    *,
    cookie: str,
    version: str = "1.0",
    _token_retry: bool = False,
) -> dict:
    global _COOKIE_CACHE
    data_json = json.dumps(data_obj, ensure_ascii=False, separators=(",", ":"))
    t = str(int(time.time() * 1000))
    token = _h5_token(cookie)
    if not token:
        raise _auth_required("Cookie 中 _m_h5_tk 无效，请重新登录授权。")
    sign = _sign(token, t, data_json)
    params = {
        "jsv": "2.7.2",
        "appKey": APP_KEY,
        "t": t,
        "sign": sign,
        "v": version,
        "type": "originaljson",
        "accountSite": "xianyu",
        "dataType": "json",
        "api": api,
        "sessionOption": "AutoLoginOnly",
        "spm_cnt": "a21ybx.search.0.0",
    }
    url = f"{H5API_BASE}/{api}/{version}/?{urllib.parse.urlencode(params)}"
    body = urllib.parse.urlencode({"data": data_json}).encode("utf-8")
    headers = dict(DEFAULT_HEADERS)
    headers["Cookie"] = cookie
    raw, resp_headers = fetch_with_headers(url, headers=headers, data=body, method="POST")
    set_cookie = resp_headers.get("set-cookie") or ""
    if set_cookie:
        merged = _merge_set_cookie(cookie, set_cookie)
        if merged != cookie:
            _COOKIE_CACHE = merged
            cookie = merged
    try:
        payload = json.loads(raw.decode("utf-8", errors="replace"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"mtop 响应不是 JSON: {api}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"mtop 响应格式异常: {api}")

    ret = payload.get("ret") or []
    ret_text = " | ".join(str(x) for x in ret) if isinstance(ret, list) else str(ret)
    ok = any("SUCCESS" in str(x) for x in (ret if isinstance(ret, list) else [ret]))
    if ok:
        return payload

    # 风控/滑块：已有登录 Cookie 时不要伪装成缺授权
    if any(
        marker in ret_text
        for marker in ("RGV587", "被挤爆", "FAIL_SYS_USER_VALIDATE", "x5sec", "_____tmd_____")
    ):
        raise ValueError(f"闲鱼触发风控校验 ({api}): {ret_text}")

    low = ret_text.lower()
    auth_markers = (
        "SESSION_EXPIRED",
        "TOKEN_EXOIRED",
        "TOKEN_EXPIRED",
        "FAIL_SYS_SESSION_EXPIRED",
        "FAIL_SYS_TOKEN",
        "请登录",
        "未登录",
        "FAIL_SYS_USER_VALIDATE::登录",
    )
    if any(marker in ret_text for marker in auth_markers) or "login" in low:
        if (not _token_retry) and "TOKEN" in ret_text.upper() and set_cookie:
            return _mtop_post(
                api,
                data_obj,
                cookie=_COOKIE_CACHE or cookie,
                version=version,
                _token_retry=True,
            )
        raise _auth_required(f"闲鱼 mtop 鉴权失败: {ret_text}")
    raise ValueError(f"闲鱼 mtop 调用失败 ({api}): {ret_text}")


def _main_block(item: dict) -> dict:
    """搜索结果卡片：resultList[].data.item.main。"""
    if not isinstance(item, dict):
        return {}
    if isinstance(item.get("cardData"), dict):
        return item["cardData"]
    data = item.get("data")
    if isinstance(data, dict):
        nested = data.get("item")
        if isinstance(nested, dict) and isinstance(nested.get("main"), dict):
            return nested["main"]
        if isinstance(data.get("main"), dict):
            return data["main"]
        return data
    return item


def _ex_content(item: dict) -> dict:
    main = _main_block(item)
    ex = main.get("exContent")
    if isinstance(ex, dict):
        return ex
    return main if isinstance(main, dict) else {}


def _click_args(item: dict) -> dict:
    main = _main_block(item)
    click = main.get("clickParam") if isinstance(main.get("clickParam"), dict) else {}
    args = click.get("args")
    return args if isinstance(args, dict) else {}


def _detail_params(item: dict) -> dict:
    ex = _ex_content(item)
    params = ex.get("detailParams")
    return params if isinstance(params, dict) else {}


def _item_id(item: dict) -> str:
    ex = _ex_content(item)
    params = _detail_params(item)
    args = _click_args(item)
    for source in (ex, params, args, item):
        if not isinstance(source, dict):
            continue
        for key in ("itemId", "item_id", "id"):
            value = str(source.get(key) or "").strip()
            if value:
                return value
    return ""


def _title_of(item: dict) -> str:
    ex = _ex_content(item)
    params = _detail_params(item)
    for source in (ex, params):
        text = str(source.get("title") or "").strip()
        if text:
            return text
    span = ex.get("titleSpan") if isinstance(ex.get("titleSpan"), dict) else {}
    text = str(span.get("content") or "").strip()
    if text:
        return text
    summary = ex.get("titleSummary")
    if isinstance(summary, dict):
        text = str(summary.get("text") or "").strip()
        if text:
            return text
    return ""


def _image_of(item: dict) -> str:
    ex = _ex_content(item)
    for key in ("picUrl", "mainPicUrl", "image", "pic"):
        url = str(ex.get(key) or "").strip()
        if url:
            return url
    pic = ex.get("mainPicInfo")
    if isinstance(pic, dict):
        url = str(pic.get("url") or pic.get("picUrl") or "").strip()
        if url:
            return url
    return ""


def _author_of(item: dict) -> str:
    ex = _ex_content(item)
    params = _detail_params(item)
    for key in ("userNickName", "userNick", "sellerNick", "nick"):
        name = str(ex.get(key) or params.get(key) or "").strip()
        if name:
            return name
    user = ex.get("user") if isinstance(ex.get("user"), dict) else {}
    for key in ("userNick", "nick", "user_nick"):
        name = str(user.get(key) or "").strip()
        if name:
            return name
    return ""


def _price_of(item: dict) -> str:
    params = _detail_params(item)
    args = _click_args(item)
    for source in (params, args):
        for key in ("soldPrice", "displayPrice", "price"):
            value = source.get(key)
            if value is not None and str(value).strip() and not isinstance(value, (list, dict)):
                return str(value).strip()
    ex = _ex_content(item)
    price = ex.get("price")
    if isinstance(price, list):
        texts = [
            str(part.get("text") or "").strip()
            for part in price
            if isinstance(part, dict) and str(part.get("text") or "").strip()
        ]
        if texts:
            return "".join(texts).lstrip("¥").strip()
    if isinstance(price, dict):
        text = str(price.get("price") or price.get("text") or "").strip()
        if text:
            return text
    if price is not None and not isinstance(price, (list, dict)) and str(price).strip():
        return str(price).strip()
    return ""


def _published_at_of(item: dict) -> str:
    args = _click_args(item)
    ex = _ex_content(item)
    params = _detail_params(item)
    for source in (args, ex, params, item):
        if not isinstance(source, dict):
            continue
        for key in ("publishTime", "gmtCreate", "createTime", "published_at"):
            iso = _to_iso(source.get(key))
            if iso:
                return iso
    return datetime.now(SHANGHAI).replace(microsecond=0).isoformat()


def _to_iso(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, (int, float)):
        ts = float(value)
        if ts > 1e12:
            ts /= 1000.0
        try:
            return datetime.fromtimestamp(ts, tz=SHANGHAI).isoformat()
        except (OverflowError, OSError, ValueError):
            return ""
    text = str(value).strip()
    if not text:
        return ""
    if re.fullmatch(r"\d{10,13}", text):
        return _to_iso(int(text))
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(SHANGHAI).isoformat()
    except ValueError:
        return ""


def _index_items(items: list[dict]) -> None:
    for item in items:
        if not isinstance(item, dict):
            continue
        iid = _item_id(item)
        if iid:
            _LIST_INDEX.put(iid, item)


# --- WebsiteFeedAdapter 接口 ---


def fetch_list_page(page: int = 1, per: int = 30) -> dict:
    cookie = require_cookie()
    keyword = _keyword_from_entry()
    rows = max(1, min(int(per or 30), 30))
    page_number = max(1, int(page or 1))
    data = {
        "pageNumber": page_number,
        "keyword": keyword,
        "fromFilter": False,
        "rowsPerPage": rows,
        "sortValue": "",
        "sortField": "",
        "customDistance": "",
        "gps": "",
        "propValueStr": "",
        "customGps": "",
        "searchReqFromPage": "pcSearch",
        "extraFilterValue": "",
        "userPositionJson": "{}",
    }
    payload = _mtop_post(SEARCH_API, data, cookie=cookie)
    items = list_items(payload)
    if page_number == 1:
        _LIST_INDEX.clear()
    _index_items(items)
    return payload


def list_items(payload: dict) -> list[dict]:
    if not isinstance(payload, dict):
        return []
    data = payload.get("data")
    if not isinstance(data, dict):
        return []
    items = data.get("resultList")
    if not isinstance(items, list):
        return []
    out: list[dict] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if not _item_id(item):
            continue
        if not _image_of(item) and not _title_of(item):
            continue
        out.append(item)
    return out


def has_next_page(payload: dict) -> bool:
    if not isinstance(payload, dict):
        return False
    data = payload.get("data")
    if not isinstance(data, dict):
        return False
    info = data.get("resultInfo") if isinstance(data.get("resultInfo"), dict) else {}
    if "hasNextPage" in info:
        return bool(info.get("hasNextPage"))
    control = (
        info.get("searchResControlFields")
        if isinstance(info.get("searchResControlFields"), dict)
        else {}
    )
    if "hasNextPage" in control:
        return bool(control.get("hasNextPage"))
    num_found = control.get("numFound") or info.get("numFound")
    page_number = data.get("pageNumber") or info.get("pageNumber") or 1
    try:
        found = int(num_found)
        page = int(page_number)
    except (TypeError, ValueError):
        return len(list_items(payload)) >= 30
    return page * 30 < found


def normalize_list_item(item: dict) -> dict:
    iid = _item_id(item)
    title = _title_of(item)
    price = _price_of(item)
    summary_parts = []
    if price:
        summary_parts.append(f"¥{price}" if not str(price).startswith("¥") else str(price))
    author = _author_of(item)
    if author:
        summary_parts.append(author)
    return {
        "id": iid,
        "title": title or iid,
        "url": f"{BASE_URL}/item?id={urllib.parse.quote(iid)}" if iid else "",
        "published_at": _published_at_of(item),
        "author": author,
        "image": _image_of(item),
        "summary": " · ".join(summary_parts),
    }


def _rich_text_to_html(rich_text: object) -> str:
    if rich_text is None:
        return ""
    if isinstance(rich_text, str):
        text = rich_text.strip()
        if not text:
            return ""
        if text.startswith("{") or text.startswith("["):
            try:
                return _rich_text_to_html(json.loads(text))
            except json.JSONDecodeError:
                return f"<p>{escape(text)}</p>"
        return f"<p>{escape(text)}</p>"
    if isinstance(rich_text, list):
        return "".join(_rich_text_to_html(x) for x in rich_text)
    if not isinstance(rich_text, dict):
        return f"<p>{escape(str(rich_text))}</p>"

    # 常见结构：{type, value/content/text/children}
    parts: list[str] = []
    for key in ("children", "content", "data", "ops", "paragraphs"):
        nested = rich_text.get(key)
        if nested:
            parts.append(_rich_text_to_html(nested))
    if parts:
        return "".join(parts)

    text = str(
        rich_text.get("text")
        or rich_text.get("value")
        or rich_text.get("contentText")
        or ""
    ).strip()
    if text:
        return f"<p>{escape(text)}</p>"

    # 兜底：把叶子字符串拼起来
    leaf: list[str] = []

    def walk(node: object) -> None:
        if isinstance(node, str):
            s = node.strip()
            if s and not s.startswith("http"):
                leaf.append(s)
        elif isinstance(node, list):
            for x in node:
                walk(x)
        elif isinstance(node, dict):
            for v in node.values():
                walk(v)

    walk(rich_text)
    if leaf:
        return "".join(f"<p>{escape(x)}</p>" for x in leaf[:40])
    return ""


def _detail_item_do(payload: dict) -> dict:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    detail = data.get("itemDetailDO") if isinstance(data.get("itemDetailDO"), dict) else data
    item_do = detail.get("itemDO") if isinstance(detail.get("itemDO"), dict) else detail
    return item_do if isinstance(item_do, dict) else {}


def _build_content_html(item_do: dict, *, title: str, url: str) -> str:
    chunks: list[str] = []
    if title:
        chunks.append(f"<h1>{escape(title)}</h1>")
    price = item_do.get("soldPrice") or item_do.get("price") or item_do.get("defaultPriceDesc")
    if price is not None and str(price).strip():
        chunks.append(f"<p><strong>价格</strong>：¥{escape(str(price).strip())}</p>")
    if url:
        chunks.append(f'<p><a href="{escape(url, quote=True)}">查看原商品</a></p>')

    images = item_do.get("imageInfos")
    if isinstance(images, list):
        for img in images[:12]:
            if isinstance(img, dict):
                src = str(
                    img.get("url")
                    or img.get("picUrl")
                    or img.get("majorUrl")
                    or img.get("imageUrl")
                    or ""
                ).strip()
            else:
                src = str(img or "").strip()
            if src:
                chunks.append(f'<p><img src="{escape(src, quote=True)}" alt=""/></p>')

    desc_html = ""
    for key in ("richTextDesc", "desc", "description", "itemDesc"):
        if item_do.get(key):
            desc_html = _rich_text_to_html(item_do.get(key))
            if desc_html.strip():
                break
    if desc_html:
        chunks.append(f'<div class="desc">{desc_html}</div>')
    elif not images:
        # 至少保证有可读正文
        nick = ""
        user = item_do.get("user") if isinstance(item_do.get("user"), dict) else {}
        nick = str(user.get("userNick") or user.get("nick") or "").strip()
        extra = f"卖家：{nick}" if nick else "闲鱼商品"
        chunks.append(f"<p>{escape(title or extra)}</p>")
    return "\n".join(chunks)


def _fallback_content_from_meta(
    *,
    iid: str,
    title: str,
    url: str,
    image: str,
    author: str,
    summary: str,
    price: str = "",
) -> str:
    chunks: list[str] = []
    if title:
        chunks.append(f"<h1>{escape(title)}</h1>")
    if price:
        text = str(price).strip()
        if text and not text.startswith("¥"):
            text = f"¥{text}"
        chunks.append(f"<p><strong>价格</strong>：{escape(text)}</p>")
    if author:
        chunks.append(f"<p><strong>卖家</strong>：{escape(author)}</p>")
    if url:
        chunks.append(f'<p><a href="{escape(url, quote=True)}">查看原商品</a></p>')
    if image:
        chunks.append(f'<p><img src="{escape(image, quote=True)}" alt="{escape(title)}"/></p>')
    body = (summary or title or "").strip()
    if body:
        chunks.append(f"<p>{escape(body)}</p>")
    if not chunks:
        chunks.append(f"<p>闲鱼商品 {escape(iid)}</p>")
    return "\n".join(chunks)


def fetch_article_detail(article_id: str, **hints) -> dict:
    meta = pick_hints(**hints)
    iid = str(article_id or "").strip()
    url = resolve_detail_url(iid, **hints) or meta.get("url") or ""
    if not url and iid:
        url = f"{BASE_URL}/item?id={urllib.parse.quote(iid)}"
    if not iid and url:
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
        values = qs.get("id") or []
        iid = str(values[0] or "").strip() if values else ""
    if not iid:
        raise ValueError("缺少商品 id")

    cached = _LIST_INDEX.get(iid)
    cached_norm = normalize_list_item(cached) if isinstance(cached, dict) and cached else {}
    title = meta.get("title") or str(cached_norm.get("title") or "").strip()
    author = meta.get("author") or str(cached_norm.get("author") or "").strip()
    image = meta.get("image") or str(cached_norm.get("image") or "").strip()
    summary = meta.get("summary") or str(cached_norm.get("summary") or "").strip()
    published = meta.get("published_at") or str(cached_norm.get("published_at") or "").strip()
    price = ""
    if isinstance(cached, dict):
        price = _price_of(cached)
        if not title:
            title = _title_of(cached)
        if not image:
            image = _image_of(cached)
        if not author:
            author = _author_of(cached)
        if not published:
            published = _published_at_of(cached)

    cookie = require_cookie()
    try:
        payload = _mtop_post(DETAIL_API, {"itemId": iid}, cookie=cookie)
        item_do = _detail_item_do(payload)
        title = str(item_do.get("title") or title or "").strip() or iid
        published = (
            _to_iso(
                item_do.get("gmtCreate")
                or item_do.get("publishTime")
                or item_do.get("onlineTime")
            )
            or published
            or datetime.now(SHANGHAI).replace(microsecond=0).isoformat()
        )
        user = item_do.get("user") if isinstance(item_do.get("user"), dict) else {}
        author = str(
            user.get("userNick") or user.get("nick") or author or ""
        ).strip()
        images = item_do.get("imageInfos")
        if isinstance(images, list) and images:
            first = images[0]
            if isinstance(first, dict):
                image = str(first.get("url") or first.get("picUrl") or image or "").strip()
            else:
                image = str(first or image or "").strip()
        content_html = _build_content_html(item_do, title=title, url=url)
        return {
            "id": iid,
            "title": title,
            "url": url,
            "published_at": published
            or datetime.now(SHANGHAI).replace(microsecond=0).isoformat(),
            "author": author,
            "image": image,
            "content_html": content_html,
        }
    except ValueError as exc:
        err = str(exc)
        # 详情接口常被 baxia/滑块拦截；列表已有标题/图/摘要时降级组装正文
        if "风控" not in err and "RGV587" not in err and "USER_VALIDATE" not in err:
            raise
        content_html = _fallback_content_from_meta(
            iid=iid,
            title=title or iid,
            url=url,
            image=image,
            author=author,
            summary=summary or title,
            price=price,
        )
        if len(content_html.strip()) < 40:
            raise
        return {
            "id": iid,
            "title": title or iid,
            "url": url,
            "published_at": published
            or datetime.now(SHANGHAI).replace(microsecond=0).isoformat(),
            "author": author,
            "image": image,
            "content_html": content_html,
        }


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    _ = article_id
    return clean_html_fragment(raw_html)


def discover_recent(*, max_pages: int = 3, per: int = 30) -> list[dict]:
    results: list[dict] = []
    seen: set[str] = set()
    for page in range(1, max_pages + 1):
        payload = fetch_list_page(page=page, per=per)
        for item in list_items(payload):
            article = normalize_list_item(item)
            iid = article["id"]
            if not iid or iid in seen:
                continue
            seen.add(iid)
            results.append(article)
        if not has_next_page(payload):
            break
        sleep_between_pages()
    return results


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Goofish search discovery")
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--per", type=int, default=30)
    parser.add_argument("--id", dest="item_id", default="")
    parser.add_argument("--recent", action="store_true")
    args = parser.parse_args(argv)

    try:
        if args.item_id:
            detail = fetch_article_detail(args.item_id)
            print(json.dumps(detail, ensure_ascii=False, indent=2))
            return 0
        if args.recent:
            items = discover_recent(max_pages=3, per=args.per)
            print(json.dumps(items, ensure_ascii=False, indent=2))
            return 0
        payload = fetch_list_page(page=args.page, per=args.per)
        items = [normalize_list_item(x) for x in list_items(payload)]
        print(json.dumps(items, ensure_ascii=False, indent=2))
        return 0
    except AuthRequiredError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
