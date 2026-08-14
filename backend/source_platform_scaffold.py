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
XHS_PROFILE_RE = re.compile(
    r"^https?://(?:www\.)?xiaohongshu\.com/user/profile/(?P<user_id>[A-Za-z0-9]+)(?:/[^?#]*)?(?:[?#].*)?$",
    re.I,
)
REDDIT_SUB_RE = re.compile(
    r"^https?://(?:www\.|old\.)?reddit\.com/r/(?P<subreddit>[A-Za-z0-9_]+)(?:/.*)?$",
    re.I,
)
X_PROFILE_RE = re.compile(
    r"^https?://(?:www\.)?(?:x\.com|twitter\.com)/(?P<screen>[A-Za-z0-9_]{1,15})/?$",
    re.I,
)
WEIXIN_HOSTS = frozenset({"mp.weixin.qq.com"})
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

    xhs = XHS_PROFILE_RE.match(url)
    if xhs or (host.endswith("xiaohongshu.com") and "/user/profile/" in parsed.path.lower()):
        if xhs:
            user_id = xhs.group("user_id")
        else:
            parts = [p for p in parsed.path.split("/") if p]
            try:
                idx = next(i for i, p in enumerate(parts) if p.lower() == "profile")
                user_id = parts[idx + 1]
            except (StopIteration, IndexError):
                return None
        user_id = re.sub(r"[^A-Za-z0-9]", "", user_id)
        if not user_id:
            return None
        from urllib.parse import parse_qs, urlencode

        qs = parse_qs(parsed.query)
        token = (qs.get("xsec_token") or [""])[0].strip()
        query = urlencode(
            {
                "xsec_token": token,
                "xsec_source": (qs.get("xsec_source") or ["app_share"])[0] or "app_share",
            }
        ) if token else ""
        profile = f"https://www.xiaohongshu.com/user/profile/{user_id}"
        if query:
            profile = f"{profile}?{query}"
        slug, feed_id = _resolve_xiaohongshu_identity(user_id)
        return PlatformMatch(
            platform="xiaohongshu",
            user_type="user",
            user_id=user_id,
            entry_url=profile,
            posts_url=profile,
            slug=slug,
            feed_id=feed_id,
            list_api_path="/api/sns/web/v1/user_posted",
            requires_cookie=True,
            reference_slug="",
        )

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
            requires_cookie=False,
            reference_slug="",
        )

    if host in WEIXIN_HOSTS or host.endswith(".weixin.qq.com"):
        # 仅识别文章 / 带 __biz 的公众号页；后台登录页不算数据源入口
        path_l = parsed.path.lower()
        qs = parsed.query.lower()
        looks_article = "/s/" in path_l or path_l.rstrip("/").endswith("/s")
        looks_biz = "__biz=" in qs or "fakeid=" in qs or "biz=" in qs
        looks_profile = "/mp/profile_ext" in path_l
        if not (looks_article or looks_biz or looks_profile):
            return None
        try:
            account = _resolve_weixin_account(url)
        except Exception:
            return None
        fakeid = str(account.get("fakeid") or "").strip()
        if not fakeid:
            return None
        entry = str(account.get("entry_url") or url).strip() or url
        slug, feed_id = _resolve_weixin_identity(fakeid)
        return PlatformMatch(
            platform="weixin",
            user_type="account",
            user_id=fakeid,
            entry_url=entry,
            posts_url=entry,
            slug=slug,
            feed_id=feed_id,
            list_api_path="/cgi-bin/appmsg?action=list_ex",
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


def format_xiaohongshu_source_name(nickname: str) -> str:
    """数据源显示名：小红书-{用户昵称}。"""
    name = (nickname or "").strip()
    if not name:
        return ""
    for prefix in ("小红书-", "小红书 · ", "小红书·"):
        if name.startswith(prefix):
            name = name[len(prefix) :].strip()
            break
    return f"小红书-{name}" if name else ""


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


def format_weixin_source_name(nickname: str) -> str:
    """数据源显示名：微信-{公众号昵称}。"""
    name = (nickname or "").strip()
    if not name:
        return ""
    for prefix in ("微信-", "微信 · ", "微信·", "公众号-", "公众号 · "):
        if name.startswith(prefix):
            name = name[len(prefix) :].strip()
            break
    return f"微信-{name}" if name else ""


def weixin_name_hint_from_url(entry_url: str) -> str:
    """从合成入口 query askme_name 读取显示名 hint。"""
    lib = str(_LIB_ROOT)
    if lib not in sys.path:
        sys.path.insert(0, lib)
    try:
        import weixin_common as w

        return w.extract_askme_name(entry_url) or ""
    except Exception:
        return ""


def _resolve_weixin_account(entry_url: str) -> dict[str, str]:
    lib = str(_LIB_ROOT)
    if lib not in sys.path:
        sys.path.insert(0, lib)
    import weixin_common as w

    return w.resolve_account_from_entry(entry_url)


def _resolve_weixin_identity(fakeid: str) -> tuple[str, str]:
    """每个公众号独立 skill：weixin-{biz_slug} / website:weixin:{biz_slug}。"""
    lib = str(_LIB_ROOT)
    if lib not in sys.path:
        sys.path.insert(0, lib)
    import weixin_common as w

    key = w.fakeid_slug(fakeid)
    preferred = f"weixin-{key}"
    preferred_feed = f"website:weixin:{key}"

    preferred_dir = SKILLS_ROOT / f"{preferred}-discovery"
    if preferred_dir.is_dir():
        return _resolve_slug(preferred), _feed_id_from_discover(preferred, preferred_feed)

    # 历史 skill：source.yaml 里 fakeid 匹配
    if SKILLS_ROOT.is_dir():
        for skill_dir in SKILLS_ROOT.iterdir():
            name = skill_dir.name
            if not name.startswith("weixin-") or not name.endswith("-discovery"):
                continue
            slug = name[: -len("-discovery")]
            existing = _yaml_field(skill_dir / "source.yaml", "fakeid").strip()
            if existing == fakeid:
                return _resolve_slug(slug), _feed_id_from_discover(slug, preferred_feed)
    return _resolve_slug(preferred), preferred_feed


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
        discover = SKILLS_ROOT / f"{slug}-discovery" / "scripts" / "discover.py"
        if not discover.is_file():
            return fallback
        try:
            text = discover.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            return fallback
        m = re.search(r'^FEED_ID\s*=\s*"([^"]+)"', text, re.M)
        return (m.group(1).strip() if m else "") or fallback

    preferred_dir = SKILLS_ROOT / f"{preferred}-discovery"
    if preferred_dir.is_dir():
        return _resolve_slug(preferred), _feed_from_discover(preferred, preferred_feed)

    # 历史 skill（如 zhihu-xinziyuan）slug 与 user_id 不完全一致
    if SKILLS_ROOT.is_dir():
        for skill_dir in SKILLS_ROOT.iterdir():
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


def _resolve_xiaohongshu_identity(user_id: str) -> tuple[str, str]:
    """每个小红书用户独立 skill：slug=xiaohongshu-{uid}，feed=website:xiaohongshu:{uid}。

    早期曾用扁平 slug=xiaohongshu / feed=website:xiaohongshu（与脚手架模板混用）。
    若已存在 per-user skill，沿用其 discover.py 里的 FEED_ID（兼容旧库文章）。
    """
    uid = user_id.lower()
    preferred = f"xiaohongshu-{uid}"
    preferred_feed = f"website:xiaohongshu:{uid}"
    discover = SKILLS_ROOT / f"{preferred}-discovery" / "scripts" / "discover.py"
    if discover.is_file():
        try:
            text = discover.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            text = ""
        m = re.search(r'^FEED_ID\s*=\s*"([^"]+)"', text, re.M)
        feed = (m.group(1).strip() if m else "") or preferred_feed
        return _resolve_slug(preferred), feed
    return _resolve_slug(preferred), preferred_feed


def _feed_id_from_discover(slug: str, fallback: str) -> str:
    discover = SKILLS_ROOT / f"{slug}-discovery" / "scripts" / "discover.py"
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

    preferred_dir = SKILLS_ROOT / f"{preferred}-discovery"
    if preferred_dir.is_dir():
        return _resolve_slug(preferred), _feed_id_from_discover(preferred, preferred_feed)

    # 历史扁平源：reddit-discovery 指向同一 sub 时沿用旧 feed_id
    flat = SKILLS_ROOT / "reddit-discovery"
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

    preferred_dir = SKILLS_ROOT / f"{preferred}-discovery"
    if preferred_dir.is_dir():
        return _resolve_slug(preferred), _feed_id_from_discover(preferred, preferred_feed)

    flat = SKILLS_ROOT / "x-discovery"
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
    from source_skill_writer import validate_slug

    return validate_slug(base)


def _zhihu_cookie_configured() -> bool:
    try:
        from credential_store import slot_configured, sync_runtime_cookies

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


def scaffold_zhihu_files(match: PlatformMatch, *, display_name: str) -> dict[str, str]:
    """基于 _lib/zhihu_scaffold 通用模板，按用户生成独立 skill。"""
    ref = _LIB_ROOT / "zhihu_scaffold" / "discover.py"
    if not ref.is_file():
        raise ValueError("缺少知乎脚手架模板：.cursor/skills/_lib/zhihu_scaffold/discover.py")

    user_type_literal = "people" if match.user_type == "people" else "org"
    label = format_zhihu_source_name(display_name or match.user_id) or match.user_id
    safe_name = label.replace("\\", "\\\\").replace('"', '\\"')
    page_url = (match.posts_url or match.entry_url).replace("\\", "\\\\").replace('"', '\\"')

    raw = ref.read_text(encoding="utf-8")
    raw = (
        raw.replace("__ASKME_USER_ID__", match.user_id)
        .replace("__ASKME_USER_TYPE__", user_type_literal)
        .replace("__ASKME_PAGE_URL__", page_url)
        .replace("__ASKME_FEED_ID__", match.feed_id)
        .replace("__ASKME_DISPLAY_NAME__", safe_name)
    )
    if "__ASKME_" in raw:
        raise ValueError("知乎脚手架模板占位符未完全替换")

    source_yaml = f"""id: {match.slug}
name: {label}
homepage: {match.entry_url}
entry_url: {match.posts_url}
platform: zhihu
user_type: {match.user_type}
user_id: {match.user_id}

discovery:
  type: zhihu_api
  list_url: {match.list_api_path}
  requires_cookie: true
  auth_slot: zhihu

validation:
  last_verified_at: "2026-07-22"
"""
    skill_md = f"""---
name: {match.slug}-discovery
description: >-
  Discovers articles from {label} ({match.user_id}).
  Requires Zhihu Cookie for server-side access.
---

# {label}

主页：{match.posts_url}

## 配置

在 Askme 设置页完成知乎登录授权，或设置：

```bash
export ASKME_COOKIE_ZHIHU='d_c0=...; __zse_ck=...; _zap=...'
```

## 快速执行

```bash
python .cursor/skills/{match.slug}-discovery/scripts/discover.py --page 1 --per 20
```

Feed ID：`{match.feed_id}`

委托 `_lib/zhihu_common` 处理签名与 API。
"""
    return {
        "scripts/discover.py": raw,
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


def probe_xiaohongshu_profile(match: PlatformMatch) -> dict[str, Any]:
    """探测小红书用户主页是否可抓（需真实登录 Cookie）。"""
    try:
        from credential_store import get_cookie_for_slot, sync_runtime_cookies

        sync_runtime_cookies()
        cookie = get_cookie_for_slot("xiaohongshu") or ""
    except Exception as exc:
        return {"ok": False, "cookie_configured": False, "error": str(exc)}

    if not cookie.strip():
        return {
            "ok": False,
            "cookie_configured": False,
            "error": "未配置小红书 Cookie，请先完成登录授权",
        }

    lib = str(_LIB_ROOT)
    if lib not in sys.path:
        sys.path.insert(0, lib)
    try:
        import xiaohongshu_common as x

        result = x.probe_login_state(cookie, url=match.entry_url)
        nickname = str(
            result.get("profile_nickname") or result.get("nickname") or ""
        ).strip()
        notes = int(result.get("notes_with_id") or 0)
        logged_in = bool(result.get("logged_in"))
        if not logged_in:
            return {
                "ok": False,
                "cookie_configured": True,
                "error": "Cookie 仍为访客态，请重新登录授权",
                "probe": result,
            }
        display = format_xiaohongshu_source_name(nickname or match.user_id)
        return {
            "ok": notes > 0 or bool(nickname),
            "cookie_configured": True,
            "display_name": display or match.user_id,
            "notes_with_id": notes,
            "probe": result,
            "error": "" if notes > 0 or nickname else "主页未解析到笔记（可能需有效 xsec_token）",
        }
    except Exception as exc:
        return {"ok": False, "cookie_configured": True, "error": str(exc)}


def scaffold_xiaohongshu_files(match: PlatformMatch, *, display_name: str) -> dict[str, str]:
    """基于 _lib/xiaohongshu_scaffold 通用模板，按 user_id 生成独立 skill。"""
    from urllib.parse import parse_qs, urlparse

    ref = _LIB_ROOT / "xiaohongshu_scaffold" / "discover.py"
    if not ref.is_file():
        raise ValueError("缺少小红书脚手架模板：.cursor/skills/_lib/xiaohongshu_scaffold/discover.py")

    qs = parse_qs(urlparse(match.entry_url).query)
    token = (qs.get("xsec_token") or [""])[0].strip()
    label = format_xiaohongshu_source_name(display_name or match.user_id) or match.user_id
    safe_name = label.replace("\\", "\\\\").replace('"', '\\"')

    raw = ref.read_text(encoding="utf-8")
    raw = (
        raw.replace("__ASKME_USER_ID__", match.user_id)
        .replace("__ASKME_XSEC_TOKEN__", token.replace("\\", "\\\\").replace('"', '\\"'))
        .replace("__ASKME_FEED_ID__", match.feed_id)
        .replace("__ASKME_DISPLAY_NAME__", safe_name)
    )
    if "__ASKME_" in raw:
        raise ValueError("小红书脚手架模板占位符未完全替换")

    source_yaml = f"""id: {match.slug}
name: {label}
homepage: https://www.xiaohongshu.com/user/profile/{match.user_id}
entry_url: {match.entry_url}
platform: xiaohongshu
user_id: "{match.user_id}"

discovery:
  type: xiaohongshu_ssr_api
  list_url: /api/sns/web/v1/user_posted
  requires_cookie: true
  auth_slot: xiaohongshu
  quirks:
    - 列表优先解析用户主页 SSR window.__INITIAL_STATE__（user.notes）
    - 详情必须使用笔记级 xsec_token（来自列表项）；主页 xsec_token 不可用于详情

content:
  type: xiaohongshu_feed
  url_template: https://www.xiaohongshu.com/explore/{{id}}

validation:
  last_verified_at: "2026-07-22"
  expected_min_items: 1
  min_body_chars: 80
"""
    skill_md = f"""---
name: {match.slug}-discovery
description: >-
  Discovers notes from Xiaohongshu user {label} ({match.user_id}) via SSR
  and edith feed API. Requires logged-in Cookie (web_session).
---

# {label}

用户主页：{match.entry_url}

## 配置

在 Askme 设置页完成小红书登录授权，或设置：

```bash
export ASKME_COOKIE_XIAOHONGSHU='web_session=...; a1=...; ...'
```

## 快速执行

```bash
python .cursor/skills/{match.slug}-discovery/scripts/discover.py --page 1 --per 20
```

Feed ID：`{match.feed_id}`
"""
    return {
        "scripts/discover.py": raw,
        "source.yaml": source_yaml,
        "SKILL.md": skill_md,
    }


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


def scaffold_reddit_files(match: PlatformMatch, *, display_name: str) -> dict[str, str]:
    """基于 _lib/reddit_scaffold 通用模板，按 subreddit 生成独立 skill。"""
    ref = _LIB_ROOT / "reddit_scaffold" / "discover.py"
    if not ref.is_file():
        raise ValueError("缺少 Reddit 脚手架模板：.cursor/skills/_lib/reddit_scaffold/discover.py")

    label = format_reddit_source_name(display_name or match.user_id) or format_reddit_source_name(
        match.user_id
    )
    safe_name = label.replace("\\", "\\\\").replace('"', '\\"')
    sub = match.user_id

    raw = ref.read_text(encoding="utf-8")
    raw = (
        raw.replace("__ASKME_SUBREDDIT__", sub)
        .replace("__ASKME_FEED_ID__", match.feed_id)
        .replace("__ASKME_DISPLAY_NAME__", safe_name)
    )
    if "__ASKME_" in raw:
        raise ValueError("Reddit 脚手架模板占位符未完全替换")

    source_yaml = f"""id: {match.slug}
name: {label}
homepage: https://www.reddit.com
entry_url: {match.entry_url}
platform: reddit
subreddit: {sub}

discovery:
  type: html
  url: https://old.reddit.com/r/{sub}/new/
  requires_cookie: false

validation:
  last_verified_at: "2026-07-22"
  expected_min_items: 1
"""
    skill_md = f"""---
name: {match.slug}-discovery
description: >-
  Discovers posts from Reddit r/{sub} via old.reddit.com HTML listing
  and comment pages.
---

# {label}

入口：{match.entry_url}

## 快速执行

```bash
python .cursor/skills/{match.slug}-discovery/scripts/discover.py --page 1 --per 10
```

Feed ID：`{match.feed_id}`

委托 `_lib/reddit_common` 解析 old.reddit.com。
"""
    return {
        "scripts/discover.py": raw,
        "source.yaml": source_yaml,
        "SKILL.md": skill_md,
    }


def probe_x_profile(match: PlatformMatch) -> dict[str, Any]:
    """轻量探测：尽量解析用户显示名；网络失败时回退 screen_name。"""
    result: dict[str, Any] = {
        "platform": "x",
        "screen_name": match.user_id,
        "entry_url": match.entry_url,
        "display_name": format_x_source_name(match.user_id),
    }
    profile_name = ""
    count = 0
    errors: list[str] = []

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
            from http_client import fetch_text

            for mirror in (
                "https://xcancel.com",
                "https://nitter.poast.org",
                "https://nitter.privacyredirect.com",
            ):
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


def scaffold_x_files(match: PlatformMatch, *, display_name: str) -> dict[str, str]:
    """基于 _lib/x_scaffold 通用模板，按 screen_name 生成独立 skill。"""
    ref = _LIB_ROOT / "x_scaffold" / "discover.py"
    if not ref.is_file():
        raise ValueError("缺少 X 脚手架模板：.cursor/skills/_lib/x_scaffold/discover.py")

    label = format_x_source_name(display_name or match.user_id) or format_x_source_name(
        match.user_id
    )
    safe_name = label.replace("\\", "\\\\").replace('"', '\\"')
    screen = match.user_id

    raw = ref.read_text(encoding="utf-8")
    raw = (
        raw.replace("__ASKME_SCREEN_NAME__", screen)
        .replace("__ASKME_FEED_ID__", match.feed_id)
        .replace("__ASKME_DISPLAY_NAME__", safe_name)
    )
    if "__ASKME_" in raw:
        raise ValueError("X 脚手架模板占位符未完全替换")

    source_yaml = f"""id: {match.slug}
name: {label}
homepage: https://x.com
entry_url: {match.entry_url}
feed_id: {match.feed_id}
platform: x
screen_name: {screen}

discovery:
  type: x_hybrid
  requires_cookie: false

validation:
  min_body_chars: 20
  last_verified_at: "2026-07-22"
  expected_min_items: 1
"""
    skill_md = f"""---
name: {match.slug}-discovery
description: >-
  Discovers posts from X user @{screen} via Nitter mirrors, GraphQL guest,
  and syndication fallback.
---

# {label}

主页：{match.entry_url}

## 快速执行

```bash
python .cursor/skills/{match.slug}-discovery/scripts/discover.py --page 1 --per 5
```

Feed ID：`{match.feed_id}`
"""
    return {
        "scripts/discover.py": raw,
        "source.yaml": source_yaml,
        "SKILL.md": skill_md,
    }


def refresh_x_display_name_from_list(slug: str, match: PlatformMatch) -> str | None:
    """从账号绑定的 X 列表作者字段解析「X-{用户名}」（编译脚手架，不依赖 per-user skill）。"""
    _ = slug
    try:
        from platform_accounts import account_from_platform_match
        from platform_scaffold_bind import compile_scaffold_adapter

        account = account_from_platform_match(
            match,
            display_name=format_x_source_name(match.user_id) or match.user_id,
        )
        mod = compile_scaffold_adapter("x", account)
        payload = mod.fetch_list_page(page=1, per=3)
        items = mod.list_items(payload) if hasattr(mod, "list_items") else payload.get("items") or []
    except Exception:
        return None
    for item in items:
        if not isinstance(item, dict):
            continue
        author = str(item.get("author") or "").strip()
        if author:
            return format_x_source_name(author)
    return None


def _weixin_cookie_configured() -> bool:
    try:
        from credential_store import slot_configured, sync_runtime_cookies

        sync_runtime_cookies()
        return slot_configured("weixin")
    except Exception:
        return bool(
            os.getenv("ASKME_COOKIE_WEIXIN", "").strip()
            or os.getenv("WEIXIN_MP_COOKIE", "").strip()
        )


def probe_weixin_account(match: PlatformMatch) -> dict[str, Any]:
    """探测公众号后台 list_ex；无凭证时明确提示。"""
    nickname_hint = weixin_name_hint_from_url(match.entry_url)
    # 已有 fakeid + 显示名时不必再拉公开页；否则按需 resolve 补昵称
    if not nickname_hint:
        try:
            account = _resolve_weixin_account(match.entry_url)
            nickname_hint = (
                str(account.get("nickname") or "").strip()
                or str(account.get("askme_name") or "").strip()
                or nickname_hint
            )
        except Exception:
            pass

    result: dict[str, Any] = {
        "platform": "weixin",
        "fakeid": match.user_id,
        "entry_url": match.entry_url,
        "nickname": nickname_hint,
        "display_name": format_weixin_source_name(nickname_hint or match.user_id),
        "cookie_configured": _weixin_cookie_configured(),
        "ok": False,
        "list_count": 0,
        "sample_titles": [],
        "error": "",
    }
    if not result["cookie_configured"]:
        result["error"] = (
            "未配置微信公众号后台凭证（ASKME_AUTH_REQUIRED:slot=weixin）。"
            "请在设置页登录【公众号】后台（勿选小程序），保存含 askme_mp_token 的 Cookie。"
        )
        return result

    lib = str(_LIB_ROOT)
    if lib not in sys.path:
        sys.path.insert(0, lib)
    try:
        import weixin_common as w

        probed = w.probe_account(match.user_id, nickname_hint=nickname_hint)
        result.update(probed)
        if probed.get("display_name"):
            result["display_name"] = probed["display_name"]
        elif nickname_hint:
            result["display_name"] = format_weixin_source_name(nickname_hint)
    except Exception as exc:
        result["ok"] = False
        result["error"] = str(exc)
    return result


def scaffold_weixin_files(match: PlatformMatch, *, display_name: str) -> dict[str, str]:
    """基于 _lib/weixin_scaffold 通用模板，按 fakeid 生成独立 skill。"""
    ref = _LIB_ROOT / "weixin_scaffold" / "discover.py"
    if not ref.is_file():
        raise ValueError("缺少微信脚手架模板：.cursor/skills/_lib/weixin_scaffold/discover.py")

    label = format_weixin_source_name(display_name or match.user_id) or format_weixin_source_name(
        match.user_id
    )
    if not label.startswith("微信-"):
        label = format_weixin_source_name(label) or f"微信-{match.user_id[:12]}"
    safe_name = label.replace("\\", "\\\\").replace('"', '\\"')
    fakeid = match.user_id
    entry = match.entry_url

    raw = ref.read_text(encoding="utf-8")
    raw = (
        raw.replace("__ASKME_FAKEID__", fakeid)
        .replace("__ASKME_FEED_ID__", match.feed_id)
        .replace("__ASKME_DISPLAY_NAME__", safe_name)
        .replace("__ASKME_ENTRY_URL__", entry)
    )
    if "__ASKME_" in raw:
        raise ValueError("微信脚手架模板占位符未完全替换")

    source_yaml = f"""id: {match.slug}
name: {label}
homepage: https://mp.weixin.qq.com
entry_url: {entry}
feed_id: {match.feed_id}
platform: weixin
fakeid: {fakeid}

discovery:
  type: weixin_mp_admin
  requires_cookie: true
  cookie_slot: weixin

validation:
  min_body_chars: 40
  last_verified_at: "2026-07-23"
  expected_min_items: 1
"""
    skill_md = f"""---
name: {match.slug}-discovery
description: >-
  Discovers articles from WeChat Official Account via mp.weixin.qq.com
  admin list_ex API; article body from public /s/ pages.
---

# {label}

入口：{entry}

## 快速执行

```bash
python .cursor/skills/{match.slug}-discovery/scripts/discover.py --page 1 --per 5
```

Feed ID：`{match.feed_id}`

列表依赖公众号后台 Cookie（设置页「微信」凭证）；正文走公开文章页。
须用【公众号】扫码登录，不能是小程序。
"""
    return {
        "scripts/discover.py": raw,
        "source.yaml": source_yaml,
        "SKILL.md": skill_md,
    }

