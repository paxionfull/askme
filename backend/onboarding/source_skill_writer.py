"""写入与校验 discovery skill 文件。"""

from __future__ import annotations

import re
from pathlib import Path

from paths import SKILLS_ROOT

SLUG_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")


def validate_slug(slug: str) -> str:
    value = slug.strip().lower().replace("_", "-")
    if not SLUG_PATTERN.match(value):
        raise ValueError("slug 只能包含小写字母、数字和连字符")
    return value


def skill_dir_for(slug: str) -> Path:
    return SKILLS_ROOT / f"{validate_slug(slug)}-discovery"


def is_complete_discovery_skill(slug: str) -> bool:
    """目录存在且含可用 discover.py 才算完整 skill。"""
    skill_dir = skill_dir_for(slug)
    discover = skill_dir / "scripts" / "discover.py"
    if not discover.is_file():
        return False
    try:
        text = discover.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return False
    return "FEED_ID" in text and "fetch_list_page" in text and "fetch_article_detail" in text


def remove_discovery_skill_dir(slug: str) -> bool:
    """删除 discovery skill 目录（若存在）。返回是否删除。"""
    import shutil

    skill_dir = skill_dir_for(slug)
    if not skill_dir.is_dir():
        return False
    shutil.rmtree(skill_dir)
    return True


def update_discovery_display_name(
    slug: str,
    display_name: str,
    *,
    feed_id: str | None = None,
) -> bool:
    """把已有 discovery skill 的展示名改成博主昵称（复用接入时补齐）。"""
    name = (display_name or "").strip()
    if not name:
        return False
    skill_dir = skill_dir_for(slug)
    discover = skill_dir / "scripts" / "discover.py"
    source_yaml = skill_dir / "source.yaml"
    if not discover.is_file():
        return False

    safe = name.replace("\\", "\\\\").replace('"', '\\"')
    text = discover.read_text(encoding="utf-8")
    new_text, n1 = re.subn(r'"mpName":\s*"[^"]*"', f'"mpName": "{safe}"', text, count=1)
    new_text, n2 = re.subn(
        r'"mpIntro":\s*"[^"]*"',
        f'"mpIntro": "{safe}"',
        new_text,
        count=1,
    )
    changed = False
    if n1 or n2:
        discover.write_text(new_text, encoding="utf-8")
        changed = True

    if source_yaml.is_file():
        lines = source_yaml.read_text(encoding="utf-8").splitlines()
        out: list[str] = []
        name_done = False
        for line in lines:
            if not name_done and line.startswith("name:"):
                out.append(f"name: {name}")
                name_done = True
            else:
                out.append(line)
        if name_done:
            source_yaml.write_text("\n".join(out) + "\n", encoding="utf-8")
            changed = True

    if feed_id:
        try:
            from feed.feed_registry import feed_registry

            feed_registry.set_feed_display_name(feed_id, name)
            changed = True
        except Exception:
            pass
    return changed


def normalize_entry_url(url: str) -> str:
    value = url.strip()
    if not value:
        raise ValueError("请填写网站链接")
    if not value.startswith(("http://", "https://")):
        value = f"https://{value}"
    from urllib.parse import urlparse

    parsed = urlparse(value)
    if not parsed.netloc:
        raise ValueError("请输入有效的网站链接")
    return value


def source_identity_key(url: str) -> str:
    """用于判断「是否同一数据源」：host + path，忽略 query（小红书 token 会变）。"""
    from urllib.parse import urlparse

    parsed = urlparse(normalize_entry_url(url))
    host = parsed.netloc.lower().split(":")[0]
    if host.startswith("www."):
        host = host[4:]
    path = re.sub(r"/+", "/", (parsed.path or "/")).rstrip("/") or "/"
    return f"{host}{path.lower()}"


def _host_slug_base(host: str) -> str:
    labels = [part for part in host.split(".") if part]
    if len(labels) >= 2 and labels[-1] in {"com", "cn", "net", "org", "io", "co", "dev", "ai"}:
        raw = labels[-2]
    elif labels:
        raw = labels[0]
    else:
        raw = "site"
    return re.sub(r"[^a-z0-9]", "", raw.lower()) or "site"


def _path_slug_tail(path_parts: list[str], *, max_parts: int = 4) -> str:
    """把有意义的 path 段编进 slug（如 information/AI → information-ai）。"""
    skip = {"index", "home", "www", "page", "p"}
    cleaned: list[str] = []
    for part in path_parts[:max_parts]:
        token = re.sub(r"[^a-z0-9]+", "-", part.lower()).strip("-")
        if not token or token in skip:
            continue
        cleaned.append(token)
    return "-".join(cleaned)


def _allocate_unique_slug(preferred: str, *, entry_url: str, display_name: str) -> tuple[str, str]:
    """同 identity 优先复用已有 slug；否则用 preferred，被占用则递增后缀。"""
    target_key = source_identity_key(entry_url)
    reused = _find_slug_by_identity(target_key)
    if reused:
        return reused, display_name

    base = validate_slug((preferred or "site")[:62].rstrip("-") or "site")
    slug = base
    suffix = 2
    while skill_dir_for(slug).exists() and is_complete_discovery_skill(slug):
        # preferred 链上已被其他入口占用（无论 feed 是否 hidden）→ 换新 slug
        candidate = f"{base}-{suffix}"
        slug = validate_slug(candidate[:62].rstrip("-") or f"site-{suffix}")
        suffix += 1
        if suffix > 99:
            raise ValueError("无法为该域名生成唯一 slug")
    return slug, display_name


def _find_slug_by_identity(target_key: str) -> str | None:
    """若已有完整 discovery skill 指向同一入口，返回其 slug（含 hidden）。"""
    if not SKILLS_ROOT.is_dir():
        return None
    for skill_dir in sorted(SKILLS_ROOT.iterdir()):
        name = skill_dir.name
        if not skill_dir.is_dir() or not name.endswith("-discovery"):
            continue
        slug = name[: -len("-discovery")]
        if not slug or not is_complete_discovery_skill(slug):
            continue
        existing = read_skill_entry_url(slug)
        if existing and source_identity_key(existing) == target_key:
            return validate_slug(slug)
    return None


def read_skill_entry_url(slug: str) -> str:
    source_yaml = skill_dir_for(slug) / "source.yaml"
    if not source_yaml.is_file():
        return ""
    try:
        text = source_yaml.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""
    for key in ("entry_url:", "homepage:"):
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith(key):
                return stripped.split(":", 1)[1].strip().strip("\"'")
    return ""


def derive_source_identity(entry_url: str) -> tuple[str, str]:
    from urllib.parse import urlparse

    parsed = urlparse(normalize_entry_url(entry_url))
    host = parsed.netloc.lower().split(":")[0]
    if host.startswith("www."):
        host = host[4:]

    path_parts = [part for part in parsed.path.split("/") if part]

    # 小红书用户主页：同域名不同用户必须拆成独立 slug
    if host.endswith("xiaohongshu.com") and len(path_parts) >= 3:
        if path_parts[0].lower() == "user" and path_parts[1].lower() == "profile":
            user_id = re.sub(r"[^a-z0-9]", "", path_parts[2].lower())
            if user_id:
                slug = validate_slug(f"xiaohongshu-{user_id}"[:62].rstrip("-"))
                return slug, user_id

    # Reddit subreddit
    if host.endswith("reddit.com") and len(path_parts) >= 2 and path_parts[0].lower() == "r":
        sub = re.sub(r"[^a-z0-9_]", "", path_parts[1].lower())
        if sub:
            slug = validate_slug(f"reddit-{sub.replace('_', '-')}"[:62].rstrip("-"))
            return slug, sub

    # X / Twitter 用户主页
    if host in {"x.com", "twitter.com"} and path_parts:
        screen = path_parts[0]
        reserved = {
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
        }
        if screen.lower() not in reserved and re.fullmatch(r"[A-Za-z0-9_]{1,15}", screen):
            slug = validate_slug(f"x-{screen.lower().replace('_', '-')}"[:62].rstrip("-"))
            return slug, screen

    host_base = _host_slug_base(host)
    path_tail = _path_slug_tail(path_parts)
    if path_tail:
        preferred = f"{host_base}-{path_tail}"
        # 展示名带末段，便于区分频道/栏目
        leaf = path_parts[-1].strip() or path_tail
        display_name = f"{host_base.replace('-', ' ').title()} · {leaf}"
    else:
        preferred = host_base
        display_name = host_base.replace("-", " ").title()

    return _allocate_unique_slug(preferred, entry_url=entry_url, display_name=display_name)

def resolve_onboard_target(
    entry_url: str,
    *,
    slug: str | None = None,
    name: str | None = None,
) -> tuple[str, str, str]:
    from onboarding.source_platform_scaffold import detect_platform

    normalized_url = normalize_entry_url(entry_url)
    platform = detect_platform(normalized_url)
    if platform and not (slug and slug.strip()):
        final_slug = platform.slug
        if platform.platform == "zhihu":
            final_name = name.strip() if name and name.strip() else platform.user_id
        elif platform.platform == "jin10":
            final_name = name.strip() if name and name.strip() else "金十数据"
        elif platform.platform == "xiaohongshu":
            final_name = name.strip() if name and name.strip() else platform.user_id
        elif platform.platform == "reddit":
            from onboarding.source_platform_scaffold import format_reddit_source_name

            final_name = (
                name.strip()
                if name and name.strip()
                else format_reddit_source_name(platform.user_id)
            )
        elif platform.platform == "x":
            from onboarding.source_platform_scaffold import format_x_source_name

            final_name = (
                name.strip() if name and name.strip() else format_x_source_name(platform.user_id)
            )
        elif platform.platform == "weixin":
            from onboarding.source_platform_scaffold import format_weixin_source_name, weixin_name_hint_from_url

            hint = weixin_name_hint_from_url(platform.entry_url)
            final_name = (
                name.strip()
                if name and name.strip()
                else format_weixin_source_name(hint)
                or format_weixin_source_name(platform.user_id)
                or platform.user_id
            )
        else:
            final_name = name.strip() if name and name.strip() else platform.user_id
        if skill_dir_for(final_slug).exists() and not is_complete_discovery_skill(final_slug):
            remove_discovery_skill_dir(final_slug)
        if platform.platform in {"zhihu", "jin10"}:
            entry = platform.posts_url
        elif platform.platform in {"xiaohongshu", "reddit", "x", "weixin"}:
            entry = platform.entry_url
        else:
            entry = normalized_url
        return final_slug, final_name, entry

    auto_slug, auto_name = derive_source_identity(normalized_url)
    final_slug = validate_slug(slug) if slug and slug.strip() else auto_slug
    final_name = name.strip() if name and name.strip() else auto_name
    if skill_dir_for(final_slug).exists() and not is_complete_discovery_skill(final_slug):
        remove_discovery_skill_dir(final_slug)
    return final_slug, final_name, normalized_url


def resolve_feed_id_for_target(entry_url: str, slug: str) -> str:
    """根据入口 URL / slug 解析 feed_id（知乎等平台不等于 website:{slug}）。"""
    from onboarding.source_platform_scaffold import detect_platform

    platform = detect_platform((entry_url or "").strip())
    if platform:
        return platform.feed_id
    return f"website:{validate_slug(slug)}"


def onboard_target_already_exists(slug: str, feed_id: str) -> bool:
    return (
        skill_dir_for(slug).exists()
        and is_complete_discovery_skill(slug)
        and not _is_hidden_feed(feed_id)
    )


def _is_hidden_feed(feed_id: str) -> bool:
    from feed.feed_registry import feed_registry

    return feed_registry.is_hidden(feed_id)


def write_skill_files(slug: str, files: dict[str, str]) -> Path:
    safe_slug = validate_slug(slug)
    skill_dir = skill_dir_for(safe_slug)
    if skill_dir.exists():
        raise ValueError(f"数据源 skill 已存在: {skill_dir.name}")

    allowed = {"scripts/discover.py", "SKILL.md", "source.yaml"}
    for rel_path, content in files.items():
        rel = rel_path.strip().lstrip("/")
        if rel == "discover.py":
            rel = "scripts/discover.py"
        if rel not in allowed:
            raise ValueError(f"不允许写入路径: {rel}")
        target = skill_dir / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content.strip() + "\n", encoding="utf-8")
        if rel.endswith("discover.py"):
            target.chmod(0o755)

    required = skill_dir / "scripts" / "discover.py"
    if not required.is_file():
        raise ValueError("缺少 scripts/discover.py")
    return skill_dir
