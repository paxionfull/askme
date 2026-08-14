"""已知多账号平台识别与确定性 skill 脚手架（避免 LLM 从零写代码）。"""

from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from paths import DISCOVERY_SKILLS_ROOT, SKILLS_LIB

_LIB_ROOT = SKILLS_LIB

ZHIHU_PEOPLE_RE = re.compile(
    r"^https?://(?:www\.)?zhihu\.com/people/(?P<user_id>[^/?#]+)/?(?:posts)?/?$",
    re.I,
)
ZHIHU_ORG_RE = re.compile(
    r"^https?://(?:www\.)?zhihu\.com/org/(?P<user_id>[^/?#]+)/?(?:posts)?/?$",
    re.I,
)
ZHIHU_POSTS_SUFFIX_RE = re.compile(r"/posts/?$", re.I)
REDDIT_SUB_RE = re.compile(
    r"^https?://(?:www\.|old\.)?reddit\.com/r/(?P<subreddit>[A-Za-z0-9_]+)(?:/.*)?$",
    re.I,
)
X_PROFILE_RE = re.compile(
    r"^https?://(?:www\.)?(?:x\.com|twitter\.com)/(?P<screen>[A-Za-z0-9_]{1,15})/?$",
    re.I,
)
X_RESERVED_PATHS = frozenset(
    {
        "home",
        "explore",
        "search",
        "settings",
        "i",
        "intent",
        "compose",
        "messages",
        "notifications",
        "login",
        "logout",
        "signup",
        "tos",
        "privacy",
        "hashtag",
        "share",
        "jobs",
    }
)


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
        slug, feed_id = _resolve_zhihu_identity(user_id, user_type="people")
        return PlatformMatch(
            platform="zhihu",
            user_type="people",
            user_id=user_id,
            entry_url=profile,
            posts_url=posts,
            slug=slug,
            feed_id=feed_id,
            list_api_path=f"/api/v4/members/{user_id}/articles",
            requires_cookie=True,
            reference_slug="",
        )

    org = ZHIHU_ORG_RE.match(url)
    if org:
        user_id = org.group("user_id")
        profile = normalize_zhihu_entry_url(url)
        posts = f"{profile}/posts"
        slug, feed_id = _resolve_zhihu_identity(user_id, user_type="org")
        return PlatformMatch(
            platform="zhihu",
            user_type="org",
            user_id=user_id,
            entry_url=profile,
            posts_url=posts,
            slug=slug,
            feed_id=feed_id,
            list_api_path=f"/api/v4/members/{user_id}/articles",
            requires_cookie=True,
            reference_slug="",
        )

    parsed = urlparse(url)
    if parsed.netloc.lower().replace("www.", "") == "zhihu.com":
        path_parts = [p for p in parsed.path.split("/") if p]
        if len(path_parts) >= 2 and path_parts[0] in {"people", "org"}:
            user_type = "people" if path_parts[0] == "people" else "org"
            user_id = path_parts[1]
            profile = f"https://www.zhihu.com/{path_parts[0]}/{user_id}"
            posts = f"{profile}/posts"
            slug, feed_id = _resolve_zhihu_identity(user_id, user_type=user_type)
            return PlatformMatch(
                platform="zhihu",
                user_type=user_type,
                user_id=user_id,
                entry_url=profile,
                posts_url=posts,
                slug=slug,
                feed_id=feed_id,
                list_api_path=f"/api/v4/members/{user_id}/articles",
                requires_cookie=True,
                reference_slug="",
            )
    parsed = urlparse(url)
    host = parsed.netloc.lower().replace("www.", "")

    reddit = REDDIT_SUB_RE.match(url)
    if reddit or (host.endswith("reddit.com") and "/r/" in parsed.path.lower()):
        if reddit:
            sub = reddit.group("subreddit")
        else:
            parts = [p for p in parsed.path.split("/") if p]
            try:
                idx = next(i for i, p in enumerate(parts) if p.lower() == "r")
                sub = parts[idx + 1]
            except (StopIteration, IndexError):
                return None
        sub = re.sub(r"[^A-Za-z0-9_]", "", sub)
        if not sub:
            return None
        entry = f"https://www.reddit.com/r/{sub}/"
        slug, feed_id = _resolve_reddit_identity(sub)
        return PlatformMatch(
            platform="reddit",
            user_type="subreddit",
            user_id=sub,
            entry_url=entry,
            posts_url=entry,
            slug=slug,
            feed_id=feed_id,
            list_api_path=f"/r/{sub}/new/",
            requires_cookie=False,
            reference_slug="",
        )

    x_match = X_PROFILE_RE.match(url)
    screen = ""
    if x_match:
        screen = x_match.group("screen")
    elif host in {"x.com", "twitter.com"}:
        parts = [p for p in parsed.path.split("/") if p]
        if (
            parts
            and parts[0].lower() not in X_RESERVED_PATHS
            and "/status/" not in parsed.path.lower()
            and re.fullmatch(r"[A-Za-z0-9_]{1,15}", parts[0])
        ):
            screen = parts[0]
    if screen:
        if screen.lower() in X_RESERVED_PATHS:
            return None
        entry = f"https://x.com/{screen}"
        slug, feed_id = _resolve_x_identity(screen)
        return PlatformMatch(
            platform="x",
            user_type="user",
            user_id=screen,
            entry_url=entry,
            posts_url=entry,
            slug=slug,
            feed_id=feed_id,
            list_api_path=f"/{screen}",
            requires_cookie=True,
            reference_slug="",
        )
    return None


def format_zhihu_source_name(nickname: str) -> str:
    """数据源显示名：知乎-{用户昵称}。"""
    name = (nickname or "").strip()
    if not name:
        return ""
    for prefix in ("知乎-", "知乎 · ", "知乎·", "知乎用户 · ", "知乎机构号 · ", "知乎专栏 · "):
        if name.startswith(prefix):
            name = name[len(prefix) :].strip()
            break
    return f"知乎-{name}" if name else ""


def format_reddit_source_name(subreddit: str) -> str:
    """数据源显示名：Reddit-{板块名}。"""
    name = (subreddit or "").strip()
    if not name:
        return ""
    for prefix in ("Reddit-", "Reddit · ", "Reddit·"):
        if name.startswith(prefix):
            name = name[len(prefix) :].strip()
            break
    if name.lower().startswith("r/"):
        name = name[2:].strip()
    return f"Reddit-{name}" if name else ""


def format_x_source_name(screen_or_name: str) -> str:
    """数据源显示名：X-{用户名}（优先显示名，兼容 screen_name）。"""
    name = (screen_or_name or "").strip()
    if not name:
        return ""
    for prefix in ("X-", "X · ", "X·"):
        if name.startswith(prefix):
            name = name[len(prefix) :].strip()
            break
    if name.startswith("@"):
        name = name[1:].strip()
    return f"X-{name}" if name else ""


def _yaml_field(path: Path, key: str) -> str:
    if not path.is_file():
        return ""
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""
    prefix = f"{key}:"
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith(prefix):
            return stripped.split(":", 1)[1].strip().strip("\"'")
    return ""


def _resolve_zhihu_identity(user_id: str, *, user_type: str) -> tuple[str, str]:
    """每个知乎用户独立 skill：优先 zhihu-{uid}；兼容历史自定义 slug/feed。"""
    _ = user_type
    uid_raw = (user_id or "").strip()
    uid = uid_raw.lower()
    preferred = f"zhihu-{uid}"
    preferred_feed = f"website:zhihu:{uid}"

    def _feed_from_discover(slug: str, fallback: str) -> str:
        discover = DISCOVERY_SKILLS_ROOT / f"{slug}-discovery" / "scripts" / "discover.py"
        if not discover.is_file():
            return fallback
        try:
            text = discover.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            return fallback
        m = re.search(r'^FEED_ID\s*=\s*"([^"]+)"', text, re.M)
        return (m.group(1).strip() if m else "") or fallback

    preferred_dir = DISCOVERY_SKILLS_ROOT / f"{preferred}-discovery"
    if preferred_dir.is_dir():
        return _resolve_slug(preferred), _feed_from_discover(preferred, preferred_feed)

    # 历史 skill（如 zhihu-xinziyuan）slug 与 user_id 不完全一致
    if DISCOVERY_SKILLS_ROOT.is_dir():
        for skill_dir in DISCOVERY_SKILLS_ROOT.iterdir():
            name = skill_dir.name
            if not name.startswith("zhihu-") or not name.endswith("-discovery"):
                continue
            if name == "zhihu-discovery":
                # 早期扁平源，不当作用户 skill 模板
                continue
            slug = name[: -len("-discovery")]
            source_yaml = skill_dir / "source.yaml"
            existing_uid = _yaml_field(source_yaml, "user_id").strip()
            if existing_uid.lower() == uid:
                return _resolve_slug(slug), _feed_from_discover(slug, preferred_feed)
    return _resolve_slug(preferred), preferred_feed


def _feed_id_from_discover(slug: str, fallback: str) -> str:
    discover = DISCOVERY_SKILLS_ROOT / f"{slug}-discovery" / "scripts" / "discover.py"
    if not discover.is_file():
        return fallback
    try:
        text = discover.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return fallback
    m = re.search(r'^FEED_ID\s*=\s*"([^"]+)"', text, re.M)
    return (m.group(1).strip() if m else "") or fallback


def _resolve_reddit_identity(subreddit: str) -> tuple[str, str]:
    """每个 subreddit 独立 skill：reddit-{sub} / website:reddit:{sub}。

    兼容早期扁平 reddit-discovery（FEED_ID=website:reddit）。
    """
    sub_raw = (subreddit or "").strip()
    sub = sub_raw.lower()
    preferred = f"reddit-{sub}"
    preferred_feed = f"website:reddit:{sub}"

    preferred_dir = DISCOVERY_SKILLS_ROOT / f"{preferred}-discovery"
    if preferred_dir.is_dir():
        return _resolve_slug(preferred), _feed_id_from_discover(preferred, preferred_feed)

    # 历史扁平源：reddit-discovery 指向同一 sub 时沿用旧 feed_id
    flat = DISCOVERY_SKILLS_ROOT / "reddit-discovery"
    if flat.is_dir():
        existing_sub = _yaml_field(flat / "source.yaml", "subreddit").strip()
        if not existing_sub:
            # 从 entry_url 推断
            entry = _yaml_field(flat / "source.yaml", "entry_url")
            m = re.search(r"/r/([^/?#]+)", entry or "", re.I)
            existing_sub = m.group(1) if m else ""
        if existing_sub.lower() == sub:
            return _resolve_slug(preferred), _feed_id_from_discover("reddit", preferred_feed)

    return _resolve_slug(preferred), preferred_feed


def _resolve_x_identity(screen_name: str) -> tuple[str, str]:
    """每个 X 用户独立 skill：x-{screen} / website:x:{screen}。

    兼容早期扁平 x-discovery（FEED_ID=website:x）。
    """
    screen_raw = (screen_name or "").strip()
    screen = screen_raw.lower()
    preferred = f"x-{screen}"
    preferred_feed = f"website:x:{screen}"

    preferred_dir = DISCOVERY_SKILLS_ROOT / f"{preferred}-discovery"
    if preferred_dir.is_dir():
        return _resolve_slug(preferred), _feed_id_from_discover(preferred, preferred_feed)

    flat = DISCOVERY_SKILLS_ROOT / "x-discovery"
    if flat.is_dir():
        existing = _yaml_field(flat / "source.yaml", "screen_name").strip()
        if not existing:
            entry = _yaml_field(flat / "source.yaml", "entry_url")
            m = re.search(r"(?:x\.com|twitter\.com)/([^/?#]+)", entry or "", re.I)
            existing = m.group(1) if m else ""
        if existing.lower() == screen:
            return _resolve_slug(preferred), _feed_id_from_discover("x", preferred_feed)

    return _resolve_slug(preferred), preferred_feed


def _resolve_slug(base: str) -> str:
    from onboarding.source_skill_writer import validate_slug

    return validate_slug(base)


def _zhihu_cookie_configured() -> bool:
    try:
        from auth.credential_store import slot_configured, sync_runtime_cookies

        sync_runtime_cookies()
        return slot_configured("zhihu")
    except Exception:
        return bool(os.getenv("ZHIHU_COOKIE", "").strip())


def fetch_zhihu_profile_name(match: PlatformMatch) -> str:
    raw = match.user_id
    if not _zhihu_cookie_configured():
        return format_zhihu_source_name(raw) or raw
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
        return format_zhihu_source_name(raw) or raw
    author = items[0].get("author") or {}
    if isinstance(author, dict) and author.get("name"):
        raw = str(author["name"])
    return format_zhihu_source_name(raw) or raw


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
        result["error"] = "未配置知乎 Cookie，请在添加数据源时粘贴授权，或到设置页管理凭证"
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


def probe_reddit_subreddit(match: PlatformMatch) -> dict[str, Any]:
    result: dict[str, Any] = {
        "platform": "reddit",
        "subreddit": match.user_id,
        "entry_url": match.entry_url,
    }
    lib = str(_LIB_ROOT)
    if lib not in sys.path:
        sys.path.insert(0, lib)
    try:
        import reddit_common as r

        payload = r.fetch_list_page(match.user_id, page=1, per=5)
        items = r.list_items(payload)
        result.update(
            {
                "ok": bool(items),
                "list_count": len(items),
                "display_name": format_reddit_source_name(match.user_id),
                "sample_titles": [str(i.get("title") or "")[:80] for i in items[:2]],
                "error": "" if items else "列表为空（可能被拦截或 sub 不存在）",
            }
        )
    except Exception as exc:
        result["ok"] = False
        result["error"] = str(exc)
    return result


def _x_cookie_configured() -> bool:
    try:
        from auth.credential_store import slot_configured, sync_runtime_cookies

        sync_runtime_cookies()
        return slot_configured("x")
    except Exception:
        return bool(os.getenv("ASKME_COOKIE_X", "").strip())


def probe_x_profile(match: PlatformMatch) -> dict[str, Any]:
    """轻量探测：尽量解析用户显示名；网络失败时回退 screen_name。"""
    cookie_ok = _x_cookie_configured()
    result: dict[str, Any] = {
        "platform": "x",
        "screen_name": match.user_id,
        "entry_url": match.entry_url,
        "display_name": format_x_source_name(match.user_id),
        "cookie_configured": cookie_ok,
    }
    profile_name = ""
    count = 0
    errors: list[str] = []

    if not cookie_ok:
        result.update(
            {
                "ok": False,
                "list_count": 0,
                "profile_name": "",
                "error": (
                    "ASKME_AUTH_REQUIRED:slot=x 未配置 X Cookie。"
                    "请在设置页登录 x.com 后保存含 auth_token 与 ct0 的凭证。"
                ),
                "soft_fail": False,
            }
        )
        return result

    lib = str(_LIB_ROOT)
    if lib not in sys.path:
        sys.path.insert(0, lib)

    # 1) syndication timeline
    try:
        import json
        from http_client import fetch_text

        page = fetch_text(
            f"https://syndication.twitter.com/srv/timeline-profile/screen-name/{match.user_id}",
            headers={
                "Accept": "text/html,application/xhtml+xml",
                "Referer": match.entry_url,
            },
        )
        m = re.search(
            r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>',
            page,
            re.DOTALL,
        )
        if m:
            data = json.loads(m.group(1))
            page_props = ((data.get("props") or {}).get("pageProps") or {})
            entries = (page_props.get("timeline") or {}).get("entries") or []
            if isinstance(entries, list):
                count = len(entries)
                for entry in entries:
                    if not isinstance(entry, dict):
                        continue
                    content = entry.get("content") or {}
                    tweet = content.get("tweet") if isinstance(content, dict) else None
                    if not isinstance(tweet, dict):
                        continue
                    user = tweet.get("user") if isinstance(tweet.get("user"), dict) else {}
                    screen = str(user.get("screen_name") or "").strip()
                    if screen.lower() == match.user_id.lower():
                        profile_name = str(user.get("name") or "").strip()
                        if profile_name:
                            break
    except Exception as exc:
        errors.append(f"syndication: {exc}")

    # 2) Nitter 镜像取全名
    if not profile_name:
        try:
            import json
            from http_client import fetch_text
            from x_access_policy import sleep_between_x_access

            for mirror in (
                "https://xcancel.com",
                "https://nitter.poast.org",
                "https://nitter.privacyredirect.com",
            ):
                sleep_between_x_access()
                try:
                    html = fetch_text(
                        f"{mirror}/{match.user_id}",
                        headers={"Accept": "text/html", "Referer": f"{mirror}/"},
                    )
                except Exception as exc:
                    errors.append(f"{mirror}: {exc}")
                    continue
                # <a class="profile-card-fullname" ...>Name</a> 或 title=
                name_m = re.search(
                    r'class="profile-card-fullname"[^>]*>([^<]+)<',
                    html,
                    re.I,
                )
                if not name_m:
                    name_m = re.search(
                        r'class="profile-card-fullname"[^>]*title="([^"]+)"',
                        html,
                        re.I,
                    )
                if name_m:
                    profile_name = name_m.group(1).strip()
                    if profile_name:
                        break
        except Exception as exc:
            errors.append(f"nitter: {exc}")

    display = format_x_source_name(profile_name or match.user_id)
    result.update(
        {
            "ok": True,
            "list_count": count,
            "profile_name": profile_name,
            "display_name": display,
            "error": "; ".join(errors) if errors and not profile_name else "",
            "soft_fail": bool(errors) and not profile_name,
        }
    )
    return result


def refresh_x_display_name_from_list(slug: str, match: PlatformMatch) -> str | None:
    """从账号绑定的 X 列表作者字段解析「X-{用户名}」。"""
    _ = slug
    try:
        from feed.platform_accounts import account_from_platform_match
        from feed.platform_adapter import BoundPlatformAdapter
        from skills.skill_registry import load_platform_modules

        account = account_from_platform_match(
            match,
            display_name=format_x_source_name(match.user_id) or match.user_id,
        )
        module = load_platform_modules().get("x")
        if module is None:
            return None
        mod = BoundPlatformAdapter(module, account)
        payload = mod.fetch_list_page(page=1, per=3)
        items = mod.list_items(payload)
    except Exception:
        return None
    for item in items:
        if not isinstance(item, dict):
            continue
        author = str(item.get("author") or "").strip()
        if author:
            return format_x_source_name(author)
    return None




