"""已知平台识别与确定性 skill 脚手架（避免 LLM 从零写知乎等站点）。"""

from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

SKILLS_ROOT = Path(__file__).resolve().parent.parent / ".cursor" / "skills"
_LIB_ROOT = SKILLS_ROOT / "_lib"

ZHIHU_PEOPLE_RE = re.compile(
    r"^https?://(?:www\.)?zhihu\.com/people/(?P<user_id>[^/?#]+)/?(?:posts)?/?$",
    re.I,
)
ZHIHU_ORG_RE = re.compile(
    r"^https?://(?:www\.)?zhihu\.com/org/(?P<user_id>[^/?#]+)/?(?:posts)?/?$",
    re.I,
)
ZHIHU_POSTS_SUFFIX_RE = re.compile(r"/posts/?$", re.I)


@dataclass(frozen=True)
class PlatformMatch:
    platform: str
    user_type: str
    user_id: str
    entry_url: str
    posts_url: str
    slug: str
    feed_id: str
    list_api_path: str
    requires_cookie: bool = False
    reference_slug: str = ""


def normalize_zhihu_entry_url(entry_url: str) -> str:
    url = entry_url.strip()
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"
    parsed = urlparse(url)
    if parsed.netloc.lower().replace("www.", "") != "zhihu.com":
        raise ValueError("不是知乎 URL")
    path = parsed.path.rstrip("/")
    if ZHIHU_POSTS_SUFFIX_RE.search(path):
        path = ZHIHU_POSTS_SUFFIX_RE.sub("", path)
    return f"https://www.zhihu.com{path}"


def detect_platform(entry_url: str) -> PlatformMatch | None:
    url = entry_url.strip()
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"

    people = ZHIHU_PEOPLE_RE.match(url)
    if people:
        user_id = people.group("user_id")
        profile = normalize_zhihu_entry_url(url)
        posts = f"{profile}/posts"
        slug = _resolve_slug(f"zhihu-{user_id.lower()}")
        prefix = "members"
        return PlatformMatch(
            platform="zhihu",
            user_type="people",
            user_id=user_id,
            entry_url=profile,
            posts_url=posts,
            slug=slug,
            feed_id=f"website:zhihu:{user_id.lower()}",
            list_api_path=f"/api/v4/{prefix}/{user_id}/articles",
            requires_cookie=True,
            reference_slug="zhihu-aitechtalk",
        )

    org = ZHIHU_ORG_RE.match(url)
    if org:
        user_id = org.group("user_id")
        profile = normalize_zhihu_entry_url(url)
        posts = f"{profile}/posts"
        slug = _resolve_slug(f"zhihu-{user_id.lower()}")
        return PlatformMatch(
            platform="zhihu",
            user_type="org",
            user_id=user_id,
            entry_url=profile,
            posts_url=posts,
            slug=slug,
            feed_id=f"website:zhihu:{user_id.lower()}",
            list_api_path=f"/api/v4/members/{user_id}/articles",
            requires_cookie=True,
            reference_slug="zhihu-xinziyuan",
        )

    parsed = urlparse(url)
    if parsed.netloc.lower().replace("www.", "") == "zhihu.com":
        path_parts = [p for p in parsed.path.split("/") if p]
        if len(path_parts) >= 2 and path_parts[0] in {"people", "org"}:
            user_type = "people" if path_parts[0] == "people" else "org"
            user_id = path_parts[1]
            profile = f"https://www.zhihu.com/{path_parts[0]}/{user_id}"
            posts = f"{profile}/posts"
            slug = _resolve_slug(f"zhihu-{user_id.lower()}")
            return PlatformMatch(
                platform="zhihu",
                user_type=user_type,
                user_id=user_id,
                entry_url=profile,
                posts_url=posts,
                slug=slug,
                feed_id=f"website:zhihu:{user_id.lower()}",
                list_api_path=f"/api/v4/members/{user_id}/articles",
                requires_cookie=True,
                reference_slug="zhihu-aitechtalk" if user_type == "people" else "zhihu-xinziyuan",
            )
    parsed = urlparse(url)
    host = parsed.netloc.lower().replace("www.", "")
    if host == "jin10.com":
        entry = f"{parsed.scheme}://{parsed.netloc}/"
        slug = _resolve_slug("jin10")
        return PlatformMatch(
            platform="jin10",
            user_type="flash",
            user_id="",
            entry_url=entry,
            posts_url=entry,
            slug=slug,
            feed_id="website:jin10",
            list_api_path="https://flash-api.jin10.com/get_flash_list",
            requires_cookie=False,
            reference_slug="",
        )
    return None


def _resolve_slug(base: str) -> str:
    from source_skill_writer import validate_slug

    return validate_slug(base)


def _zhihu_cookie_configured() -> bool:
    return bool(os.getenv("ZHIHU_COOKIE", "").strip())


def fetch_zhihu_profile_name(match: PlatformMatch) -> str:
    if not _zhihu_cookie_configured():
        return match.user_id
    lib = str(_LIB_ROOT)
    if lib not in sys.path:
        sys.path.insert(0, lib)
    import zhihu_common as z

    payload = z.fetch_articles_page(
        usertype=match.user_type,
        user_id=match.user_id,
        page=1,
        per=1,
    )
    items = payload.get("data") or []
    if not items:
        return match.user_id
    author = items[0].get("author") or {}
    if isinstance(author, dict) and author.get("name"):
        return str(author["name"])
    return match.user_id


def probe_zhihu_api(match: PlatformMatch) -> dict[str, Any]:
    result: dict[str, Any] = {
        "platform": "zhihu",
        "user_type": match.user_type,
        "user_id": match.user_id,
        "posts_url": match.posts_url,
        "list_api_path": match.list_api_path,
        "cookie_configured": _zhihu_cookie_configured(),
    }
    if not _zhihu_cookie_configured():
        result["error"] = "未配置 ZHIHU_COOKIE，请在设置页填写知乎 Cookie"
        return result
    lib = str(_LIB_ROOT)
    if lib not in sys.path:
        sys.path.insert(0, lib)
    import zhihu_common as z

    try:
        payload = z.fetch_articles_page(
            usertype=match.user_type,
            user_id=match.user_id,
            page=1,
            per=3,
        )
        items = payload.get("data") or []
        sample = [z.normalize_article(item) for item in items[:2]]
        result.update(
            {
                "ok": True,
                "list_count": len(items),
                "has_next_page": not bool((payload.get("paging") or {}).get("is_end")),
                "sample_articles": [
                    {k: v for k, v in art.items() if k != "content_html"}
                    for art in sample
                ],
                "display_name": fetch_zhihu_profile_name(match),
            }
        )
    except Exception as exc:
        result["error"] = str(exc)
    return result


def scaffold_zhihu_files(match: PlatformMatch, *, display_name: str) -> dict[str, str]:
    user_type_literal = "people" if match.user_type == "people" else "org"
    intro = f"知乎{'用户' if match.user_type == 'people' else '机构号'} · {display_name}"
    discover_py = f'''#!/usr/bin/env python3
"""知乎 {display_name} ({match.user_id}) 发现层适配器。"""

from __future__ import annotations

import argparse
import json
import sys

import zhihu_common as z

USER_ID = "{match.user_id}"
USER_TYPE = "{user_type_literal}"
PAGE_URL = "{match.posts_url}"

FEED_ID = "{match.feed_id}"
FEED_META = {{
    "id": FEED_ID,
    "mpName": "{display_name}",
    "mpCover": "",
    "mpIntro": "{intro}",
    "status": 1,
    "source": "website",
    "entryUrl": PAGE_URL,
}}
REFRESH_DEFAULTS = {{"max_pages": 3, "per": 20}}


def fetch_list_page(page: int = 1, per: int = 20) -> dict:
    return z.fetch_articles_page(usertype=USER_TYPE, user_id=USER_ID, page=page, per=per)


def list_items(payload: dict) -> list[dict]:
    items = payload.get("data")
    return items if isinstance(items, list) else []


def has_next_page(payload: dict) -> bool:
    paging = payload.get("paging") or {{}}
    return not bool(paging.get("is_end"))


def normalize_list_item(item: dict) -> dict:
    data = z.normalize_article(item)
    return {{
        "id": data["id"],
        "title": data["title"],
        "url": data["url"],
        "published_at": data["published_at"],
        "author": data["author"],
        "image": data["image"],
        "summary": data["summary"],
    }}


def fetch_article_detail(article_id: str, **hints) -> dict:
    return z.fetch_article_by_id(article_id, page_url=PAGE_URL)


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    return z.normalize_article_body(raw_html, article_id=article_id)


def main() -> int:
    parser = argparse.ArgumentParser(description="发现知乎 {display_name} 文章")
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--per", type=int, default=20)
    parser.add_argument("--id", type=str, default="")
    args = parser.parse_args()
    try:
        if args.id:
            output = fetch_article_detail(args.id)
        else:
            payload = fetch_list_page(page=args.page, per=args.per)
            output = {{
                "articles": [normalize_list_item(item) for item in list_items(payload)],
                "has_next_page": has_next_page(payload),
            }}
    except Exception as exc:
        print(json.dumps({{"ok": False, "error": str(exc)}}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps({{"ok": True, **output}}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
'''
    source_yaml = f"""id: {match.slug}
name: {display_name}
homepage: {match.entry_url}
entry_url: {match.posts_url}
platform: zhihu
user_type: {match.user_type}
user_id: {match.user_id}

discovery:
  type: zhihu_api
  list_url: {match.list_api_path}
  requires_cookie: true

validation:
  last_verified_at: "2026-07-03"
"""
    skill_md = f"""---
name: {match.slug}-discovery
description: >-
  Discovers articles from 知乎{display_name} ({match.user_id}).
  Requires ZHIHU_COOKIE for server-side access.
---

# 知乎 · {display_name}

主页：{match.posts_url}

## 配置

```bash
ZHIHU_COOKIE='d_c0=...; __zse_ck=...; _zap=...'
```

## 快速执行

```bash
export ZHIHU_COOKIE='...'
python .cursor/skills/{match.slug}-discovery/scripts/discover.py --page 1 --per 20
```

## 接入 Askme

Feed ID：`{match.feed_id}`

委托 `_lib/zhihu_common` 处理签名与 API。
"""
    return {
        "scripts/discover.py": discover_py,
        "source.yaml": source_yaml,
        "SKILL.md": skill_md,
    }


JIN10_APP_ID = "bVBF4FyRTn5NJF5n"
JIN10_APP_VERSION = "1.0.0"
JIN10_FLASH_API = "https://flash-api.jin10.com/get_flash_list"


def probe_jin10_api() -> dict[str, Any]:
    import json
    import urllib.request

    headers = {
        "x-app-id": JIN10_APP_ID,
        "x-version": JIN10_APP_VERSION,
        "Referer": "https://www.jin10.com/",
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
    }
    url = f"{JIN10_FLASH_API}?channel=-8200&vip=1"
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=5) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        items = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(items, list) or not items:
            return {"ok": False, "error": "金十 API 返回空列表"}
        sample = items[0]
        inner = sample.get("data") if isinstance(sample, dict) else {}
        return {
            "ok": True,
            "list_count": len(items),
            "sample_id": str(sample.get("id", "")),
            "sample_title": str((inner or {}).get("content", ""))[:60],
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def scaffold_jin10_files(match: PlatformMatch, *, display_name: str) -> dict[str, str]:
    discover_py = f'''#!/usr/bin/env python3
"""金十数据快讯发现层适配器。"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse
from datetime import datetime
from zoneinfo import ZoneInfo

from http_client import fetch_json

SHANGHAI = ZoneInfo("Asia/Shanghai")
BASE_URL = "https://www.jin10.com"
FLASH_API = "{JIN10_FLASH_API}"
APP_ID = "{JIN10_APP_ID}"
APP_VERSION = "{JIN10_APP_VERSION}"

FEED_ID = "{match.feed_id}"
FEED_META = {{
    "id": FEED_ID,
    "mpName": "{display_name}",
    "mpCover": "https://cdn.jin10.com/assets/img/commons/logo_v3_s.jpg",
    "mpIntro": "金十数据 · 财经快讯",
    "status": 1,
    "source": "website",
    "entryUrl": "{match.entry_url}",
}}
REFRESH_DEFAULTS = {{"max_pages": 3, "per": 20}}

_HEADERS = {{
    "x-app-id": APP_ID,
    "x-version": APP_VERSION,
    "Accept": "application/json",
    "Referer": f"{{BASE_URL}}/",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
}}

_FLASH_BY_ID: dict[str, dict] = {{}}


def _index_flash_items(items: list[dict]) -> None:
    for item in items:
        article_id = str(item.get("id", ""))
        if article_id:
            _FLASH_BY_ID[article_id] = item


def _request_list(*, max_time: str = "") -> list[dict]:
    params = {{"channel": "-8200", "vip": "1"}}
    if max_time:
        params["max_time"] = max_time
    url = f"{{FLASH_API}}?{{urllib.parse.urlencode(params)}}"
    payload = fetch_json(url, headers=_HEADERS)
    items = payload.get("data") if isinstance(payload, dict) else None
    rows = items if isinstance(items, list) else []
    _index_flash_items(rows)
    return rows


def _find_flash_item(article_id: str, *, max_pages: int = 20) -> dict | None:
    wanted = str(article_id)
    if wanted in _FLASH_BY_ID:
        return _FLASH_BY_ID[wanted]
    items = _request_list()
    if wanted in _FLASH_BY_ID:
        return _FLASH_BY_ID[wanted]
    max_time = str(items[-1].get("time") or "") if items else ""
    for _ in range(max(0, max_pages - 1)):
        if not max_time:
            break
        items = _request_list(max_time=max_time)
        if wanted in _FLASH_BY_ID:
            return _FLASH_BY_ID[wanted]
        if not items:
            break
        max_time = str(items[-1].get("time") or "")
    return None


def _format_time(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=SHANGHAI).isoformat()
        except ValueError:
            continue
    return text


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").strip()


def _item_content(item: dict) -> str:
    data = item.get("data") if isinstance(item.get("data"), dict) else {{}}
    return str(data.get("content") or "")


def _item_title(item: dict) -> str:
    content = _strip_html(_item_content(item))
    match_bracket = re.match(r"^【([^】]+)】", content)
    if match_bracket:
        return match_bracket.group(1)
    return content[:60]


def fetch_list_page(page: int = 1, per: int = 20) -> dict:
    items = _request_list()
    if page > 1 and items:
        max_time = str(items[-1].get("time") or "")
        items = _request_list(max_time=max_time) if max_time else []
    return {{"data": items, "page": page, "per": per}}


def list_items(payload: dict) -> list[dict]:
    items = payload.get("data")
    return items if isinstance(items, list) else []


def has_next_page(payload: dict) -> bool:
    items = list_items(payload)
    page = int(payload.get("page") or 1)
    per = int(payload.get("per") or 20)
    return len(items) >= per and page < 50


def normalize_list_item(item: dict) -> dict:
    article_id = str(item.get("id", ""))
    content_html = _item_content(item)
    title = _item_title(item)
    return {{
        "id": article_id,
        "title": title,
        "url": f"{{BASE_URL}}/flash/{{article_id}}.html",
        "published_at": _format_time(item.get("time")),
        "author": "{display_name}",
        "image": "",
        "summary": _strip_html(content_html)[:200],
    }}


def fetch_article_detail(article_id: str, **hints) -> dict:
    from detail_hints import pick_hints

    meta = pick_hints(**hints)
    item = _find_flash_item(str(article_id))
    if item:
        normalized = normalize_list_item(item)
        normalized["content_html"] = _item_content(item)
        if meta.get("title"):
            normalized["title"] = meta["title"]
        if meta.get("url"):
            normalized["url"] = meta["url"]
        if meta.get("published_at"):
            normalized["published_at"] = meta["published_at"]
        return normalized
    return {{
        "id": str(article_id),
        "title": meta.get("title", ""),
        "url": meta.get("url") or f"{{BASE_URL}}/flash/{{article_id}}.html",
        "published_at": meta.get("published_at", ""),
        "author": "{display_name}",
        "image": "",
        "content_html": "",
    }}


def normalize_article_body(raw_html: str, *, article_id: str = "") -> str:
    from content_utils import clean_html_fragment
    return clean_html_fragment(raw_html)


def main() -> int:
    parser = argparse.ArgumentParser(description="金十数据发现层 CLI")
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--per", type=int, default=20)
    parser.add_argument("--id", type=str, default="")
    args = parser.parse_args()
    try:
        if args.id:
            output = fetch_article_detail(args.id)
        else:
            payload = fetch_list_page(page=args.page, per=args.per)
            output = {{
                "articles": [normalize_list_item(item) for item in list_items(payload)],
                "has_next_page": has_next_page(payload),
            }}
    except Exception as exc:
        print(json.dumps({{"ok": False, "error": str(exc)}}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps({{"ok": True, **output}}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
'''
    source_yaml = f"""id: {match.slug}
name: {display_name}
homepage: {match.entry_url}
entry_url: {match.entry_url}
platform: jin10
feed_id: {match.feed_id}

discovery:
  type: jin10_flash_api
  url: {JIN10_FLASH_API}
  headers:
    x-app-id: {JIN10_APP_ID}
    x-version: {JIN10_APP_VERSION}
  query:
    channel: "-8200"
    vip: 1

validation:
  min_body_chars: 30
  last_verified_at: "2026-07-03"
"""
    skill_md = f"""---
name: {match.slug}-discovery
description: Discovers flash news from 金十数据 (jin10.com) via flash-api.
---

# 金十数据

入口：{match.entry_url}

Flash API 必须带 `x-app-id` / `x-version` 请求头。

```bash
python .cursor/skills/{match.slug}-discovery/scripts/discover.py --page 1 --per 20
python .cursor/skills/_lib/discovery_validate.py {match.slug}
```

Feed ID：`{match.feed_id}`
"""
    return {
        "scripts/discover.py": discover_py,
        "source.yaml": source_yaml,
        "SKILL.md": skill_md,
    }
