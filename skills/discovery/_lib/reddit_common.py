"""Reddit 公共抓取：有登录 Cookie 时用官方 JSON，否则用公开归档（arctic-shift / pullpush）。"""

from __future__ import annotations

import html
import json
import re
import urllib.error
import urllib.parse
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from auth_cookie import get_request_cookie
from content_utils import clean_html_fragment
from detail_hints import pick_hints, resolve_detail_url
from http_client import fetch_text, sleep_between_pages

SHANGHAI = ZoneInfo("Asia/Shanghai")
BASE_URL = "https://www.reddit.com"
OLD_BASE = "https://old.reddit.com"
ARCTIC_BASE = "https://arctic-shift.photon-reddit.com/api/posts"
PULLPUSH_BASE = "https://api.pullpush.io/reddit/search/submission/"
AUTH_SLOT = "reddit-com"
# 仅这些键视为真实登录；edgebucket 等访客 Cookie 不算
_LOGIN_COOKIE_KEYS = ("reddit_session", "token_v2")

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
ARCHIVE_UA = "AskmeRedditBot/1.0 (+https://github.com/local/askme)"

# (subreddit, page, per) -> before cursor (created_utc int as str, or t3_ fullname for reddit json)
_PAGE_CURSOR: dict[tuple[str, int, int], str | None] = {}


def normalize_subreddit(name: str) -> str:
    raw = (name or "").strip()
    if raw.lower().startswith("r/"):
        raw = raw[2:]
    raw = raw.strip().strip("/")
    return raw


def _cookie_header_has_login(cookie: str) -> bool:
    text = (cookie or "").strip()
    if not text:
        return False
    lower = text.lower()
    for key in _LOGIN_COOKIE_KEYS:
        # key=value 且值非空
        match = re.search(rf"(?:^|;\s*){re.escape(key)}=([^;]*)", lower)
        if match and match.group(1).strip():
            return True
    return False


def _cookie() -> str:
    """返回可用于官方 JSON 的登录 Cookie；仅有访客字段时返回空。"""
    raw = (
        get_request_cookie(AUTH_SLOT)
        or get_request_cookie("reddit")
        or get_request_cookie("reddit_com")
        or ""
    ).strip()
    if not raw or not _cookie_header_has_login(raw):
        return ""
    return raw


def headers_for(subreddit: str, *, accept: str = "application/json") -> dict[str, str]:
    sub = normalize_subreddit(subreddit)
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": accept,
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": f"{BASE_URL}/r/{sub}/",
    }
    cookie = _cookie()
    if cookie:
        headers["Cookie"] = cookie
    return headers


def _archive_headers() -> dict[str, str]:
    return {"User-Agent": ARCHIVE_UA, "Accept": "application/json"}


def to_www(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        return ""
    raw = raw.replace(OLD_BASE, BASE_URL)
    raw = raw.replace("https://reddit.com", BASE_URL)
    if raw.startswith("/"):
        return BASE_URL + raw
    return raw


def format_published_at(*, datetime_iso: str = "", timestamp_s: float | int | str = "") -> str:
    raw = (datetime_iso or "").strip()
    if raw:
        try:
            return (
                datetime.fromisoformat(raw.replace("Z", "+00:00"))
                .astimezone(SHANGHAI)
                .isoformat()
            )
        except ValueError:
            pass
    ts_raw = timestamp_s
    if isinstance(ts_raw, str):
        ts_raw = ts_raw.strip()
        if not ts_raw:
            return ""
        try:
            ts_val = float(ts_raw)
        except ValueError:
            return ""
    else:
        ts_val = float(ts_raw) if ts_raw else 0.0
    if ts_val <= 0:
        return ""
    # Reddit / pullpush use seconds; tolerate ms
    if ts_val > 1e12:
        ts_val = ts_val / 1000.0
    try:
        return (
            datetime.fromtimestamp(ts_val, tz=timezone.utc)
            .astimezone(SHANGHAI)
            .isoformat()
        )
    except (OSError, OverflowError, ValueError):
        return ""


def _is_removed_text(text: str) -> bool:
    return (text or "").strip().lower() in {"[removed]", "[deleted]", "removed", "deleted"}


def _is_deleted_submission(data: dict) -> bool:
    """归档/官方 JSON 中已删帖的常见信号。"""
    title = str(data.get("title") or "").strip()
    if _is_removed_text(title):
        return True
    author = str(data.get("author") or "").strip()
    if _is_removed_text(author):
        return True
    removed = data.get("removed")
    if removed is True or str(removed or "").lower() in {"true", "1"}:
        return True
    if str(data.get("removed_by_category") or "").strip():
        return True
    return False


def _selftext_usable(selftext: str) -> bool:
    raw = (selftext or "").strip()
    return bool(raw) and not _is_removed_text(raw)


def _submission_from_reddit_child(child: dict) -> dict | None:
    if not isinstance(child, dict):
        return None
    data = child.get("data") if child.get("kind") == "t3" or "data" in child else child
    if not isinstance(data, dict):
        return None
    return _normalize_submission(data)


def _normalize_submission(data: dict) -> dict | None:
    if _is_deleted_submission(data):
        return None
    post_id = str(data.get("id") or "").strip()
    title = re.sub(r"\s+", " ", html.unescape(str(data.get("title") or "")).strip())
    if not post_id or not title:
        return None
    author = str(data.get("author") or "reddit").strip() or "reddit"

    permalink = str(data.get("permalink") or "").strip()
    if not permalink:
        sub = str(data.get("subreddit") or "").strip()
        if sub:
            permalink = f"/r/{sub}/comments/{post_id}/"
    url = to_www(permalink) if permalink else ""
    outbound = str(data.get("url") or "").strip()
    if outbound and outbound.startswith("/"):
        outbound = to_www(outbound)
    # Reddit often sets url == permalink for self posts
    if outbound and permalink and to_www(outbound).rstrip("/") == to_www(permalink).rstrip("/"):
        outbound = ""
    if outbound and not outbound.startswith("http"):
        outbound = ""

    selftext = str(data.get("selftext") or "")
    is_self = bool(data.get("is_self"))
    # 归档源常把正文打成 [removed]，但仍有标题/作者；勿因正文缺失整帖丢弃
    if _is_removed_text(selftext):
        selftext = ""

    created = data.get("created_utc") or data.get("created") or 0
    published = format_published_at(timestamp_s=created)
    summary = ""
    if _selftext_usable(selftext):
        summary = re.sub(r"\s+", " ", selftext).strip()[:280]

    return {
        "id": post_id,
        "fullname": str(data.get("name") or f"t3_{post_id}"),
        "title": title,
        "permalink": permalink or f"/comments/{post_id}/",
        "url": url or to_www(permalink),
        "published_at": published,
        "created_utc": float(created) if created else 0.0,
        "author": author,
        "image": "",
        "summary": summary,
        "domain": str(data.get("domain") or ""),
        "outbound_url": outbound,
        "selftext": selftext if _selftext_usable(selftext) else "",
        "is_self": is_self,
    }


def _parse_json_listing(raw: str) -> tuple[list[dict], str | None]:
    text = (raw or "").strip()
    if not text.startswith("{") and not text.startswith("["):
        return [], None
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return [], None

    listing = payload
    if isinstance(payload, list) and payload:
        # comment pages: [listing, comments]
        listing = payload[0] if isinstance(payload[0], dict) else {}
    if not isinstance(listing, dict):
        return [], None
    data = listing.get("data") if isinstance(listing.get("data"), dict) else listing
    children = data.get("children") if isinstance(data, dict) else None
    if not isinstance(children, list):
        # pullpush shape: {"data": [submission, ...]}
        if isinstance(listing.get("data"), list):
            children = listing["data"]
        else:
            return [], None

    items: list[dict] = []
    for child in children:
        if isinstance(child, dict) and "data" in child and child.get("kind", "t3") == "t3":
            item = _submission_from_reddit_child(child)
        elif isinstance(child, dict):
            item = _normalize_submission(child)
        else:
            item = None
        if item:
            items.append(item)

    after = None
    if isinstance(data, dict):
        after_raw = data.get("after")
        if after_raw:
            after = str(after_raw)
    return items, after


def _fetch_reddit_json(url: str, *, subreddit: str) -> str:
    return fetch_text(url, headers=headers_for(subreddit, accept="application/json"))


def _list_url_reddit(subreddit: str, *, per: int, after: str | None) -> str:
    sub = normalize_subreddit(subreddit)
    query: dict[str, str] = {"limit": str(per), "raw_json": "1"}
    if after:
        query["after"] = after
    return f"{BASE_URL}/r/{sub}/new.json?{urllib.parse.urlencode(query)}"


def _list_url_arctic(subreddit: str, *, per: int, before: str | None) -> str:
    sub = normalize_subreddit(subreddit)
    query: dict[str, str] = {
        "subreddit": sub,
        "limit": str(per),
        "sort": "desc",
    }
    if before:
        query["before"] = before
    return f"{ARCTIC_BASE}/search?{urllib.parse.urlencode(query)}"


def _list_url_pullpush(subreddit: str, *, per: int, before: str | None) -> str:
    sub = normalize_subreddit(subreddit)
    query: dict[str, str] = {
        "subreddit": sub,
        "size": str(per),
        "sort": "desc",
        "sort_type": "created_utc",
    }
    if before:
        query["before"] = before
    return f"{PULLPUSH_BASE}?{urllib.parse.urlencode(query)}"


def _detail_url_arctic(article_id: str) -> str:
    pid = str(article_id or "").strip()
    if pid.startswith("t3_"):
        pid = pid[3:]
    return f"{ARCTIC_BASE}/ids?{urllib.parse.urlencode({'ids': pid})}"


def _detail_url_pullpush(article_id: str) -> str:
    pid = str(article_id or "").strip()
    if pid.startswith("t3_"):
        pid = pid[3:]
    return f"{PULLPUSH_BASE}?{urllib.parse.urlencode({'ids': pid})}"


def _try_reddit_list(subreddit: str, *, per: int, after: str | None) -> tuple[list[dict], str | None] | None:
    url = _list_url_reddit(subreddit, per=per, after=after)
    try:
        raw = _fetch_reddit_json(url, subreddit=subreddit)
    except urllib.error.HTTPError as exc:
        if exc.code in {401, 403, 429}:
            return None
        raise
    except Exception:
        return None
    items, next_after = _parse_json_listing(raw)
    if not items and ("please wait" in raw.lower() or "log in" in raw.lower()):
        return None
    return items, next_after


def _page_cursor_from_items(items: list[dict], *, per: int) -> str | None:
    if not items:
        return None
    created = items[-1].get("created_utc") or 0
    if not created:
        return None
    next_before = str(int(float(created)))
    if len(items) >= per:
        return next_before
    return next_before if items else None


def _fetch_archive_list(
    url: str,
) -> tuple[list[dict], str | None] | None:
    try:
        # 归档限流时尽快切下一源，避免 429 长退避占满探测时间
        raw = fetch_text(url, headers=_archive_headers(), retries=1)
    except urllib.error.HTTPError as exc:
        if exc.code in {401, 403, 429, 502, 503, 520, 521, 522, 523, 524}:
            return None
        raise
    except Exception:
        return None
    items, _ = _parse_json_listing(raw)
    return items, None


def _archive_list(subreddit: str, *, per: int, before: str | None) -> tuple[list[dict], str | None, str]:
    """公开归档：优先 arctic-shift，失败再 pullpush。返回 (items, next_before, source)。"""
    # 多取一些以抵消已删帖过滤
    size = min(100, max(per * 4, per + 20))
    # arctic-shift 通常更实时；pullpush 易 429
    attempts = (
        ("arctic", _list_url_arctic(subreddit, per=size, before=before)),
        ("pullpush", _list_url_pullpush(subreddit, per=size, before=before)),
    )
    last_source = "arctic"
    for source, url in attempts:
        last_source = source
        result = _fetch_archive_list(url)
        if result is None:
            continue
        items, _ = result
        if not items:
            continue
        page_items = items[:per]
        return page_items, _page_cursor_from_items(items, per=per), source
    return [], None, last_source


def _ensure_page_cursor(subreddit: str, page: int, per: int, *, source: str) -> str | None:
    sub = normalize_subreddit(subreddit).lower()
    key = (f"{source}:{sub}", page, per)
    if page <= 1:
        _PAGE_CURSOR[key] = None
        return None
    if key in _PAGE_CURSOR:
        return _PAGE_CURSOR[key]

    cursor: str | None = None
    for current in range(1, page):
        next_key = (f"{source}:{sub}", current + 1, per)
        if next_key not in _PAGE_CURSOR:
            if source == "reddit":
                result = _try_reddit_list(sub, per=per, after=cursor)
                if result is None:
                    _PAGE_CURSOR[key] = None
                    return None
                _, next_cursor = result
            else:
                _, next_cursor, _ = _archive_list(sub, per=per, before=cursor)
            _PAGE_CURSOR[next_key] = next_cursor
            if current < page - 1:
                sleep_between_pages()
        cursor = _PAGE_CURSOR.get(next_key)
        if not cursor and current + 1 < page:
            _PAGE_CURSOR[key] = None
            return None
    return _PAGE_CURSOR.get(key)


def fetch_list_page(subreddit: str, page: int = 1, per: int = 25) -> dict:
    sub = normalize_subreddit(subreddit)
    page = max(1, int(page or 1))
    per = max(1, min(int(per or 25), 100))

    # 有真实登录 Cookie 时优先官方 JSON；否则（或失败）走公开归档
    items: list[dict] = []
    next_cursor: str | None = None
    cursor: str | None = None
    source = "archive"
    if _cookie():
        cursor = _ensure_page_cursor(sub, page, per, source="reddit")
        result = _try_reddit_list(sub, per=per, after=cursor)
        if result is not None and result[0]:
            source = "reddit"
            items, next_cursor = result
    if source != "reddit":
        cursor = _ensure_page_cursor(sub, page, per, source="archive")
        items, next_cursor, archive_source = _archive_list(sub, per=per, before=cursor)
        source = archive_source

    _PAGE_CURSOR[(f"{source}:{sub.lower()}", page + 1, per)] = next_cursor
    # 归档分页游标统一挂在 archive 键下，避免 arctic/pullpush 切换丢页
    if source != "reddit":
        _PAGE_CURSOR[(f"archive:{sub.lower()}", page + 1, per)] = next_cursor
    return {
        "items": items,
        "page": page,
        "per": per,
        "after": cursor,
        "next_after": next_cursor,
        "has_next": bool(next_cursor and items),
        "subreddit": sub,
        "source": source,
    }


def list_items(payload: dict) -> list[dict]:
    items = payload.get("items")
    return items if isinstance(items, list) else []


def has_next_page(payload: dict) -> bool:
    return bool(payload.get("has_next"))


def normalize_list_item(item: dict) -> dict:
    post_id = str(item.get("id") or "").strip()
    permalink = str(item.get("permalink") or item.get("url") or "").strip()
    return {
        "id": post_id,
        "title": str(item.get("title") or "").strip(),
        "url": to_www(permalink),
        "published_at": str(item.get("published_at") or "").strip(),
        "author": str(item.get("author") or "reddit").strip(),
        "image": str(item.get("image") or ""),
        "summary": str(item.get("summary") or "").strip(),
    }


def _selftext_to_html(selftext: str) -> str:
    text = (selftext or "").strip()
    if not text:
        return ""
    blocks = re.split(r"\n\s*\n", text)
    parts: list[str] = []
    for block in blocks:
        line = html.escape(block.strip()).replace("\n", "<br/>\n")
        if line:
            parts.append(f"<p>{line}</p>")
    return "\n".join(parts)


def _detail_from_item(item: dict, *, subreddit: str) -> dict:
    sub = normalize_subreddit(subreddit)
    post_id = str(item.get("id") or "").strip()
    title = str(item.get("title") or "").strip()
    author = str(item.get("author") or "reddit").strip()
    permalink = str(item.get("permalink") or "").strip()
    outbound = str(item.get("outbound_url") or "").strip()
    domain = str(item.get("domain") or "").strip()
    selftext = str(item.get("selftext") or "").strip()
    body_html = _selftext_to_html(selftext)

    parts: list[str] = []
    if title:
        parts.append(f"<h1>{html.escape(title)}</h1>")
    if author:
        parts.append(f"<p><strong>Author:</strong> {html.escape(author)}</p>")
    if body_html:
        parts.append(body_html)
    elif outbound.startswith("http"):
        parts.append(
            "<p>Link post on r/{sub}: "
            '<a href="{href}">{label}</a></p>'.format(
                sub=html.escape(sub),
                href=html.escape(outbound),
                label=html.escape(outbound),
            )
        )
        if domain:
            parts.append(f"<p>Domain: {html.escape(domain)}</p>")
        parts.append(
            "<p>This Reddit submission shares an external URL; "
            "full discussion is on the comments page.</p>"
        )
    else:
        # 归档常无 selftext：用标题 + 讨论页链接保证正文长度
        post_url = to_www(permalink) if permalink else f"{BASE_URL}/r/{sub}/comments/{post_id}/"
        parts.append(f"<p>{html.escape(title)}</p>")
        parts.append(
            f'<p>Discussion: <a href="{html.escape(post_url)}">{html.escape(post_url)}</a></p>'
        )

    content_html = "\n".join(parts)
    summary = (
        re.sub(r"\s+", " ", selftext).strip()[:280]
        if selftext
        else title
    )
    return {
        "id": post_id,
        "title": title,
        "url": to_www(permalink) if permalink else f"{BASE_URL}/r/{sub}/comments/{post_id}/",
        "published_at": str(item.get("published_at") or "").strip(),
        "author": author,
        "image": "",
        "summary": summary,
        "content_html": content_html,
        "outbound_url": outbound if outbound.startswith("http") else "",
        "domain": domain,
    }


def _fetch_detail_archive(article_id: str) -> dict | None:
    for url in (_detail_url_arctic(article_id), _detail_url_pullpush(article_id)):
        try:
            raw = fetch_text(url, headers=_archive_headers(), retries=1)
        except Exception:
            continue
        items, _ = _parse_json_listing(raw)
        if items:
            return items[0]
    return None


def _fetch_detail_reddit_json(subreddit: str, article_id: str, url: str) -> dict | None:
    pid = str(article_id or "").strip()
    detail_url = url
    if detail_url:
        detail_url = to_www(detail_url)
        if not detail_url.endswith(".json"):
            detail_url = detail_url.rstrip("/") + ".json?raw_json=1"
    else:
        sub = normalize_subreddit(subreddit)
        detail_url = f"{BASE_URL}/r/{sub}/comments/{pid}.json?raw_json=1"
    try:
        raw = _fetch_reddit_json(detail_url, subreddit=subreddit)
    except Exception:
        return None
    items, _ = _parse_json_listing(raw)
    return items[0] if items else None


def fetch_article_detail(subreddit: str, article_id: str, **hints) -> dict:
    sub = normalize_subreddit(subreddit)
    meta = pick_hints(**hints)
    url = resolve_detail_url(article_id, **hints) or meta.get("url", "")
    pid = str(article_id or "").strip()

    item = None
    if _cookie():
        item = _fetch_detail_reddit_json(sub, pid, url)
    if item is None:
        item = _fetch_detail_archive(pid)
    if item is None and url:
        item = _fetch_detail_reddit_json(sub, pid, url)
    if item is None:
        # 用列表 hints 拼出最小正文，避免无空
        item = {
            "id": pid,
            "title": str(meta.get("title") or "").strip() or f"Reddit post {pid}",
            "permalink": url or f"/r/{sub}/comments/{pid}/",
            "url": url or f"{BASE_URL}/r/{sub}/comments/{pid}/",
            "published_at": str(meta.get("published_at") or ""),
            "author": str(meta.get("author") or "reddit"),
            "summary": str(meta.get("summary") or ""),
            "selftext": str(meta.get("summary") or ""),
            "outbound_url": "",
            "domain": "",
        }

    detail = _detail_from_item(item, subreddit=sub)
    if not detail.get("title") and meta.get("title"):
        detail["title"] = meta["title"]
    if not detail.get("published_at") and meta.get("published_at"):
        detail["published_at"] = meta["published_at"]
    if not detail.get("author") and meta.get("author"):
        detail["author"] = meta["author"]
    if not detail.get("summary") and meta.get("summary"):
        detail["summary"] = meta["summary"]
    if meta.get("url"):
        detail["url"] = to_www(meta["url"])
    return detail


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    _ = article_id
    return clean_html_fragment(raw_html or "")
