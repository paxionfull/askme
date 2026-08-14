"""Reddit 公共抓取：old.reddit.com HTML 列表与帖子正文。"""

from __future__ import annotations

import html
import re
import urllib.parse
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from content_utils import clean_html_fragment
from detail_hints import pick_hints, resolve_detail_url
from http_client import fetch_text, sleep_between_pages

SHANGHAI = ZoneInfo("Asia/Shanghai")
BASE_URL = "https://www.reddit.com"
OLD_BASE = "https://old.reddit.com"

THING_OPEN_RE = re.compile(
    r'<div class=" thing id-t3_([a-z0-9]+)[^"]*"([^>]*)>',
    re.I,
)
TITLE_RE = re.compile(
    r'<a class="title may-blank[^"]*"[^>]*>(.*?)</a>',
    re.I | re.S,
)
TIME_RE = re.compile(
    r'<time[^>]*datetime="([^"]+)"[^>]*>',
    re.I,
)
BODY_MD_RE = re.compile(
    r'<div class="usertext-body[^"]*"[^>]*>\s*<div class="md">(.*?)</div>\s*</div>',
    re.I | re.S,
)
NEXT_RE = re.compile(
    r'class="next-button"[^>]*>.*?<a[^>]+href="([^"]+)"',
    re.I | re.S,
)

# (subreddit, page, per) -> after cursor
_PAGE_AFTER: dict[tuple[str, int, int], str | None] = {}


def normalize_subreddit(name: str) -> str:
    raw = (name or "").strip()
    if raw.lower().startswith("r/"):
        raw = raw[2:]
    raw = raw.strip().strip("/")
    return raw


def headers_for(subreddit: str) -> dict[str, str]:
    sub = normalize_subreddit(subreddit)
    return {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": f"{OLD_BASE}/r/{sub}/",
    }


def _request_html(url: str, *, subreddit: str) -> str:
    return fetch_text(url, headers=headers_for(subreddit))


def to_old(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        return ""
    raw = raw.replace("https://www.reddit.com", OLD_BASE)
    raw = raw.replace("https://reddit.com", OLD_BASE)
    if raw.startswith("/"):
        return OLD_BASE + raw
    return raw


def to_www(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        return ""
    raw = raw.replace(OLD_BASE, BASE_URL)
    if raw.startswith("/"):
        return BASE_URL + raw
    return raw


def _strip_tags(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").strip()


def _attr(attrs: str, name: str) -> str:
    match = re.search(rf'\b{re.escape(name)}="([^"]*)"', attrs or "")
    return html.unescape(match.group(1)) if match else ""


def format_published_at(*, datetime_iso: str = "", timestamp_ms: str = "") -> str:
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
    ms = (timestamp_ms or "").strip()
    if ms.isdigit():
        try:
            return (
                datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc)
                .astimezone(SHANGHAI)
                .isoformat()
            )
        except (OSError, OverflowError, ValueError):
            pass
    return ""


def list_url(subreddit: str, *, per: int, after: str | None) -> str:
    sub = normalize_subreddit(subreddit)
    query: dict[str, str] = {"limit": str(per)}
    if after:
        query["after"] = after
    return f"{OLD_BASE}/r/{sub}/new/?{urllib.parse.urlencode(query)}"


def _parse_next_after(page_html: str) -> str | None:
    match = NEXT_RE.search(page_html or "")
    if not match:
        return None
    href = html.unescape(match.group(1))
    query = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
    after = (query.get("after") or [""])[0].strip()
    return after or None


def parse_list_html(page_html: str) -> tuple[list[dict], str | None]:
    opens = list(THING_OPEN_RE.finditer(page_html or ""))
    items: list[dict] = []
    for index, match in enumerate(opens):
        post_id = match.group(1)
        attrs = match.group(2)
        end = opens[index + 1].start() if index + 1 < len(opens) else len(page_html)
        block = page_html[match.start() : end]

        permalink = _attr(attrs, "data-permalink") or _attr(attrs, "data-url")
        if not permalink:
            continue
        title_m = TITLE_RE.search(block)
        title = html.unescape(_strip_tags(title_m.group(1))) if title_m else ""
        if not title:
            continue
        time_m = TIME_RE.search(block)
        published = format_published_at(
            datetime_iso=time_m.group(1) if time_m else "",
            timestamp_ms=_attr(attrs, "data-timestamp"),
        )
        domain = _attr(attrs, "data-domain")
        outbound = _attr(attrs, "data-url")
        summary = ""
        md_m = BODY_MD_RE.search(block)
        if md_m:
            summary = html.unescape(_strip_tags(md_m.group(1)))[:280]

        items.append(
            {
                "id": post_id,
                "fullname": _attr(attrs, "data-fullname") or f"t3_{post_id}",
                "title": title,
                "permalink": permalink,
                "url": to_www(permalink),
                "published_at": published,
                "author": _attr(attrs, "data-author") or "reddit",
                "image": "",
                "summary": summary,
                "domain": domain,
                "outbound_url": outbound if outbound.startswith("http") else "",
            }
        )
    return items, _parse_next_after(page_html)


def _ensure_page_after(subreddit: str, page: int, per: int) -> str | None:
    sub = normalize_subreddit(subreddit).lower()
    key = (sub, page, per)
    if page <= 1:
        _PAGE_AFTER[key] = None
        return None
    if key in _PAGE_AFTER:
        return _PAGE_AFTER[key]

    cursor: str | None = None
    for current in range(1, page):
        next_key = (sub, current + 1, per)
        if next_key not in _PAGE_AFTER:
            html_page = _request_html(list_url(sub, per=per, after=cursor), subreddit=sub)
            _, next_after = parse_list_html(html_page)
            _PAGE_AFTER[next_key] = next_after
            if current < page - 1:
                sleep_between_pages()
        cursor = _PAGE_AFTER.get(next_key)
        if not cursor and current + 1 < page:
            _PAGE_AFTER[key] = None
            return None
    return _PAGE_AFTER.get(key)


def fetch_list_page(subreddit: str, page: int = 1, per: int = 25) -> dict:
    sub = normalize_subreddit(subreddit)
    page = max(1, int(page or 1))
    per = max(1, min(int(per or 25), 100))
    after = _ensure_page_after(sub, page, per)
    page_html = _request_html(list_url(sub, per=per, after=after), subreddit=sub)
    items, next_after = parse_list_html(page_html)
    _PAGE_AFTER[(sub.lower(), page + 1, per)] = next_after
    return {
        "items": items,
        "page": page,
        "per": per,
        "after": after,
        "next_after": next_after,
        "has_next": bool(next_after and items),
        "subreddit": sub,
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


def extract_detail(page_html: str, article_id: str, *, subreddit: str) -> dict:
    sub = normalize_subreddit(subreddit)
    marker = f'id="thing_t3_{article_id}"'
    idx = page_html.find(marker)
    if idx < 0:
        match = THING_OPEN_RE.search(page_html)
        if not match:
            raise ValueError(f"未找到 Reddit 帖子: {article_id}")
        article_id = match.group(1)
        idx = match.start()
        attrs = match.group(2)
        chunk_start = match.start()
    else:
        div_start = page_html.rfind("<div", 0, idx)
        chunk_start = div_start if div_start >= 0 else idx
        open_m = THING_OPEN_RE.search(page_html[chunk_start : chunk_start + 800])
        attrs = open_m.group(2) if open_m else ""

    end_markers = (
        '<div class="commentarea"',
        'class="sitetable nestedlisting"',
        'id="siteTable_"',
    )
    end = len(page_html)
    for token in end_markers:
        pos = page_html.find(token, chunk_start + 1)
        if pos != -1:
            end = min(end, pos)
    chunk = page_html[chunk_start:end]

    title_m = TITLE_RE.search(chunk)
    title = html.unescape(_strip_tags(title_m.group(1))) if title_m else ""
    time_m = TIME_RE.search(chunk)
    published = format_published_at(
        datetime_iso=time_m.group(1) if time_m else "",
        timestamp_ms=_attr(attrs, "data-timestamp"),
    )
    author = _attr(attrs, "data-author") or "reddit"
    permalink = _attr(attrs, "data-permalink") or f"/r/{sub}/comments/{article_id}/"
    outbound = _attr(attrs, "data-url")
    domain = _attr(attrs, "data-domain")

    md_m = BODY_MD_RE.search(chunk)
    body_html = md_m.group(1).strip() if md_m else ""

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
        parts.append("<p>(empty selftext)</p>")

    content_html = "\n".join(parts)
    summary = html.unescape(_strip_tags(body_html))[:280] if body_html else title
    return {
        "id": article_id,
        "title": title,
        "url": to_www(permalink),
        "published_at": published,
        "author": author,
        "image": "",
        "summary": summary,
        "content_html": content_html,
        "outbound_url": outbound if outbound.startswith("http") else "",
        "domain": domain,
    }


def fetch_article_detail(subreddit: str, article_id: str, **hints) -> dict:
    sub = normalize_subreddit(subreddit)
    meta = pick_hints(**hints)
    url = resolve_detail_url(article_id, **hints) or meta.get("url", "")
    if not url:
        url = f"{BASE_URL}/r/{sub}/comments/{article_id}/"
    page_html = _request_html(to_old(url), subreddit=sub)
    detail = extract_detail(page_html, str(article_id).strip(), subreddit=sub)
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
