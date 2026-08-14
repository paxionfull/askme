#!/usr/bin/env python3
"""小红书平台发现层 — 多账号共用，user_id 来自 platform_accounts。"""

from __future__ import annotations

from platform_account_ctx import require_account

import argparse
import json
import sys
import urllib.parse

import xiaohongshu_common as x
from content_utils import clean_html_fragment
from detail_hints import pick_hints, resolve_detail_url
from http_client import fetch_bytes, fetch_json, fetch_text, sleep_between_pages
from list_index import ListByIdIndex

PLATFORM = "xiaohongshu"
DEFAULT_COVER = "https://www.xiaohongshu.com/favicon.ico"
FEED_ID = "website:xiaohongshu:__platform__"
FEED_META = {
    "id": FEED_ID,
    "mpName": "小红书",
    "mpCover": DEFAULT_COVER,
    "mpIntro": "小红书（多账号）",
    "status": 1,
    "source": "website",
    "entryUrl": x.BASE_URL,
}
REFRESH_DEFAULTS = {"max_pages": 3, "per": 20}

# 按账号隔离 SSR/API 分页状态，避免多账号互相覆盖
_ACCOUNT_STATE: dict[str, dict] = {}


def _acc() -> dict:
    return require_account()


def _user_id() -> str:
    return str(_acc().get("account_key") or "").strip()


def _xsec_token() -> str:
    acc = _acc()
    token = str(acc.get("xsec_token") or "").strip()
    if token:
        return token
    entry = str(acc.get("entry_url") or acc.get("posts_url") or "").strip()
    if not entry:
        return ""
    try:
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(entry).query)
    except Exception:
        return ""
    values = qs.get("xsec_token") or []
    return str(values[0] or "").strip() if values else ""


def _profile_url() -> str:
    uid = _user_id()
    token = _xsec_token()
    base = f"{x.BASE_URL}/user/profile/{uid}"
    if not token:
        return base
    return (
        f"{base}?xsec_token={urllib.parse.quote(token, safe='')}"
        f"&xsec_source=pc_user"
    )


def _state() -> dict:
    key = _user_id() or "__none__"
    st = _ACCOUNT_STATE.get(key)
    if st is None:
        st = {
            "note_index": ListByIdIndex(),
            "ssr_notes": [],
            "ssr_meta": {},
            "ssr_loaded": False,
            "api_cursor": "",
            "api_available": None,
        }
        _ACCOUNT_STATE[key] = st
    return st


def _index_notes(notes: list[dict]) -> None:
    index = _state()["note_index"]
    for item in notes:
        if not isinstance(item, dict):
            continue
        nid = str(item.get("id") or item.get("note_id") or "").strip()
        if nid:
            index.put(nid, item)


def _xsec_from_url(url: str) -> str:
    if not url:
        return ""
    try:
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    except Exception:
        return ""
    values = qs.get("xsec_token") or []
    return str(values[0] or "").strip() if values else ""


def _load_ssr_notes(*, cookie: str) -> tuple[list[dict], dict]:
    st = _state()
    state = x.fetch_profile_state(_profile_url(), cookie)
    raw_notes, meta = x.extract_notes_from_state(state)
    author = str(meta.get("nickname") or "")

    notes: list[dict] = []
    for item in raw_notes:
        if not isinstance(item, dict):
            continue
        notes.append(item)

    notes = x.ensure_notes_have_ids(notes, context="小红书用户主页 SSR")
    st["ssr_notes"] = notes
    st["ssr_meta"] = meta
    st["ssr_loaded"] = True
    st["api_cursor"] = str(meta.get("cursor") or "")
    _index_notes(
        [
            n
            for n in (x.normalize_ssr_note(i, author_fallback=author) for i in notes)
            if n
        ]
    )
    return notes, meta


def _try_user_posted(
    *, cookie: str, cursor: str, num: int
) -> dict | None:
    """edith user_posted；当前环境常返回 406，失败时返回 None。"""
    st = _state()
    try:
        data = x.fetch_user_posted(
            user_id=_user_id(),
            cookie=cookie,
            cursor=cursor or "",
            num=num,
            xsec_token=_xsec_token(),
            referer=_profile_url(),
        )
        st["api_available"] = True
        return data
    except Exception:
        st["api_available"] = False
        return None


def fetch_list_page(page: int = 1, per: int = 20) -> dict:
    st = _state()
    cookie = x.require_cookie()
    page = max(1, int(page))
    per = max(1, min(int(per), 50))

    if page == 1 or not st["ssr_loaded"]:
        notes, meta = _load_ssr_notes(cookie=cookie)
        start = 0
        end = per
        chunk = notes[start:end]
        has_more_ssr = bool(meta.get("has_more")) and len(notes) > end
        has_more_api = bool(meta.get("has_more")) and not has_more_ssr
        if has_more_api and st["api_available"] is not False:
            probe = _try_user_posted(cookie=cookie, cursor=str(meta.get("cursor") or ""), num=1)
            if probe is None:
                has_more_api = False
        return {
            "notes": chunk,
            "page": page,
            "per": per,
            "source": "ssr",
            "has_more": bool(has_more_ssr or (has_more_api and st["api_available"])),
            "cursor": str(meta.get("cursor") or ""),
            "nickname": str(meta.get("nickname") or ""),
        }

    ssr_notes = st["ssr_notes"]
    ssr_meta = st["ssr_meta"]
    if page > 1 and (page - 1) * per < len(ssr_notes):
        if page > 2:
            sleep_between_pages()
        start = (page - 1) * per
        end = start + per
        chunk = ssr_notes[start:end]
        has_more = end < len(ssr_notes) or (
            bool(ssr_meta.get("has_more")) and st["api_available"] is not False
        )
        if has_more and end >= len(ssr_notes) and st["api_available"] is not False:
            probe = _try_user_posted(
                cookie=cookie,
                cursor=st["api_cursor"] or str(ssr_meta.get("cursor") or ""),
                num=1,
            )
            if probe is None:
                has_more = end < len(ssr_notes)
        return {
            "notes": chunk,
            "page": page,
            "per": per,
            "source": "ssr",
            "has_more": has_more,
            "cursor": st["api_cursor"] or str(ssr_meta.get("cursor") or ""),
            "nickname": str(ssr_meta.get("nickname") or ""),
        }

    if st["api_available"] is False:
        return {
            "notes": [],
            "page": page,
            "per": per,
            "source": "api",
            "has_more": False,
            "cursor": "",
            "nickname": str(ssr_meta.get("nickname") or ""),
        }

    sleep_between_pages()
    cursor = st["api_cursor"] or str(ssr_meta.get("cursor") or "")
    data = _try_user_posted(cookie=cookie, cursor=cursor, num=per)
    if data is None:
        return {
            "notes": [],
            "page": page,
            "per": per,
            "source": "api",
            "has_more": False,
            "cursor": "",
            "nickname": str(ssr_meta.get("nickname") or ""),
        }

    payload = data.get("data") if isinstance(data.get("data"), dict) else {}
    api_notes = payload.get("notes") if isinstance(payload.get("notes"), list) else []
    author = str(ssr_meta.get("nickname") or "")
    normalized_raw: list[dict] = []
    index = st["note_index"]
    for item in api_notes:
        if not isinstance(item, dict):
            continue
        normalized_raw.append(item)
        norm = x.normalize_api_note(item, author_fallback=author)
        if norm:
            index.put(norm["id"], norm)

    st["api_cursor"] = str(payload.get("cursor") or "")
    return {
        "notes": normalized_raw,
        "page": page,
        "per": per,
        "source": "api",
        "has_more": bool(payload.get("has_more")),
        "cursor": st["api_cursor"],
        "nickname": author,
    }


def list_items(payload: dict) -> list[dict]:
    items = payload.get("notes")
    return items if isinstance(items, list) else []


def has_next_page(payload: dict) -> bool:
    return bool(payload.get("has_more"))


def normalize_list_item(item: dict) -> dict:
    st = _state()
    author = str(st["ssr_meta"].get("nickname") or _acc().get("display_name") or "")
    if isinstance(item.get("noteCard"), dict) or "noteCard" in item:
        data = x.normalize_ssr_note(item, author_fallback=author)
    else:
        data = x.normalize_api_note(item, author_fallback=author)
    if not data:
        raise ValueError("无法解析小红书笔记列表项")
    st["note_index"].put(data["id"], data)
    return {
        "id": data["id"],
        "title": data["title"],
        "url": data["url"],
        "published_at": data["published_at"],
        "author": data["author"],
        "image": data["image"],
        "summary": data["summary"],
        "xsec_token": data.get("xsec_token", ""),
    }


def fetch_article_detail(article_id: str, **hints) -> dict:
    """拉取笔记正文。

    必须使用「笔记级」xsec_token。主页分享 token 不能用于详情，
    否则会出现「笔记不存在或无权访问」，尽管笔记本身存在。
    """
    meta = pick_hints(**hints)
    url = resolve_detail_url(article_id, **hints) or meta.get("url", "")
    cookie = x.require_cookie()
    indexed = _state()["note_index"].get(article_id)

    xsec = (
        str(indexed.get("xsec_token") or "").strip()
        or str(hints.get("xsec_token") or "").strip()
        or x.xsec_token_from_url(url)
        or _xsec_from_url(url)
    )
    if not xsec:
        xsec = _resolve_note_xsec(article_id, cookie=cookie)

    candidates: list[str] = []
    for candidate in (
        url,
        x.note_explore_url(article_id, xsec_token=xsec) if xsec else "",
        x.note_profile_url(_user_id(), article_id, xsec_token=xsec) if xsec else "",
        x.note_explore_url(article_id) if not xsec else "",
        x.note_profile_url(_user_id(), article_id) if not xsec else "",
    ):
        text = str(candidate or "").strip()
        if text and text not in candidates:
            candidates.append(text)

    detail: dict | None = None
    last_error: Exception | None = None

    # 优先 edith feed（需笔记级 token）；失败再走笔记页 SSR
    if xsec:
        try:
            feed = x.fetch_note_feed(
                note_id=article_id,
                cookie=cookie,
                xsec_token=xsec,
                referer=candidates[0] if candidates else _profile_url(),
            )
            card = x.note_from_feed_payload(feed, article_id)
            detail = x.detail_dict_from_note_card(card, fallback_id=article_id)
        except Exception as exc:
            last_error = exc
            detail = None

    if detail is None:
        for candidate in candidates:
            try:
                state = x.fetch_note_detail_state(candidate, cookie)
                detail = x.extract_note_detail(state, article_id)
                url = candidate
                break
            except Exception as exc:
                last_error = exc
                detail = None

    if detail is None:
        if last_error is not None:
            raise last_error
        raise ValueError(f"无法获取笔记详情: {article_id}")

    if meta.get("title") and not detail.get("title"):
        detail["title"] = meta["title"]
    if meta.get("author") and not detail.get("author"):
        detail["author"] = meta["author"]
    if meta.get("image") and not detail.get("image"):
        detail["image"] = meta["image"]
    if meta.get("published_at") and not detail.get("published_at"):
        detail["published_at"] = meta["published_at"]
    if url:
        detail["url"] = url
    elif xsec:
        detail["url"] = x.note_explore_url(article_id, xsec_token=xsec)
    detail["id"] = article_id
    return detail


def _resolve_note_xsec(article_id: str, *, cookie: str) -> str:
    """冷启动拉正文时，从主页 SSR 列表找回笔记级 xsec_token。"""
    st = _state()
    if not st["ssr_loaded"]:
        try:
            _load_ssr_notes(cookie=cookie)
        except Exception:
            return ""
    for item in st["ssr_notes"]:
        if not isinstance(item, dict):
            continue
        card = item.get("noteCard") if isinstance(item.get("noteCard"), dict) else {}
        nid = str(item.get("id") or card.get("noteId") or card.get("note_id") or "").strip()
        if nid != article_id:
            continue
        token = str(
            item.get("xsecToken")
            or card.get("xsecToken")
            or card.get("xsec_token")
            or ""
        ).strip()
        if token:
            norm = x.normalize_ssr_note(item)
            if norm:
                st["note_index"].put(article_id, norm)
            return token
    return ""


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    _ = article_id
    return clean_html_fragment(raw_html or "")


def main() -> int:
    parser = argparse.ArgumentParser(description="发现小红书笔记（需绑定账号上下文）")
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
