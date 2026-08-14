"""把旧「每账号一个 discovery skill」迁移为 platform_accounts + 平台级 skill。"""

from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any

from feed.feed_registry import PLATFORM_IDS, feed_registry
from paths import DISCOVERY_SKILLS_ROOT
from skills.skill_registry import PLATFORM_SKILL_SLUGS

_FEED_ID_RE = re.compile(r'^FEED_ID\s*=\s*["\']([^"\']+)["\']', re.M)
_CONST_RE = {
    "FEED_ID": re.compile(r'^FEED_ID\s*=\s*["\']([^"\']+)["\']', re.M),
    "USER_ID": re.compile(r'^USER_ID\s*=\s*["\']([^"\']*)["\']', re.M),
    "USER_TYPE": re.compile(r'^USER_TYPE\s*=\s*["\']([^"\']*)["\']', re.M),
    "SCREEN_NAME": re.compile(r'^SCREEN_NAME\s*=\s*["\']([^"\']*)["\']', re.M),
    "SUBREDDIT": re.compile(r'^SUBREDDIT\s*=\s*["\']([^"\']*)["\']', re.M),
    "ENTRY_URL": re.compile(r'^ENTRY_URL\s*=\s*["\']([^"\']*)["\']', re.M),
    "PAGE_URL": re.compile(r'^PAGE_URL\s*=\s*["\']([^"\']*)["\']', re.M),
    "mpName": re.compile(r'["\']mpName["\']\s*:\s*["\']([^"\']*)["\']'),
}


def _yaml_field(path: Path, key: str) -> str:
    if not path.is_file():
        return ""
    text = path.read_text(encoding="utf-8", errors="ignore")
    match = re.search(rf"^{re.escape(key)}:\s*(.+)$", text, re.M)
    if not match:
        return ""
    return match.group(1).strip().strip("\"'")


def _const(text: str, name: str) -> str:
    pattern = _CONST_RE.get(name)
    if not pattern:
        return ""
    match = pattern.search(text)
    return match.group(1).strip() if match else ""


def _detect_platform_from_feed_id(feed_id: str) -> str | None:
    if not feed_id.startswith("website:"):
        return None
    parts = feed_id.split(":")
    if len(parts) < 2:
        return None
    platform = parts[1].strip().lower()
    if platform in PLATFORM_IDS:
        # website:zhihu 旧扁平源（无第三段）保留为经典 skill
        if platform == "zhihu" and len(parts) == 2:
            return None
        if platform == "reddit" and len(parts) == 2:
            # website:reddit 可能是 indiehackers 兼容 id
            return "reddit"
        if platform == "x" and len(parts) < 3:
            return None
        return platform
    return None


def _account_from_skill_dir(skill_dir: Path) -> dict[str, Any] | None:
    name = skill_dir.name
    if not name.endswith("-discovery"):
        return None
    slug = name[: -len("-discovery")]
    # 跳过平台级 skill 与非账号目录
    if slug.endswith("-platform") or slug in PLATFORM_SKILL_SLUGS.values():
        return None

    discover = skill_dir / "scripts" / "discover.py"
    source_yaml = skill_dir / "source.yaml"
    if not discover.is_file():
        return None
    text = discover.read_text(encoding="utf-8", errors="ignore")
    if "PLATFORM =" in text or 'PLATFORM ="' in text:
        return None

    feed_id = _const(text, "FEED_ID") or _yaml_field(source_yaml, "feed_id")
    if not feed_id:
        return None
    platform = _yaml_field(source_yaml, "platform") or _detect_platform_from_feed_id(feed_id)
    if not platform:
        # 目录名前缀推断
        for pid in PLATFORM_IDS:
            if slug.startswith(f"{pid}-"):
                platform = pid
                break
    if not platform or platform not in PLATFORM_IDS:
        return None
    # 旧扁平 zhihu-discovery（FEED_ID=website:zhihu）不迁移
    if feed_id == "website:zhihu":
        return None

    account_key = (
        _yaml_field(source_yaml, "user_id")
        or _yaml_field(source_yaml, "subreddit")
        or _const(text, "USER_ID")
        or _const(text, "SCREEN_NAME")
        or _const(text, "SUBREDDIT")
    )
    if not account_key and feed_id.startswith("website:"):
        parts = feed_id.split(":")
        if len(parts) >= 3:
            account_key = parts[-1]
    if not account_key:
        return None

    entry = (
        _yaml_field(source_yaml, "entry_url")
        or _const(text, "ENTRY_URL")
        or _const(text, "PAGE_URL")
    )
    display = (
        _yaml_field(source_yaml, "name")
        or _const(text, "mpName")
        or feed_registry.display_name_for_feed(feed_id)
        or ""
    )
    user_type = _yaml_field(source_yaml, "user_type") or _const(text, "USER_TYPE") or ""

    posts = entry
    if platform == "zhihu" and entry and not entry.rstrip("/").endswith("/posts"):
        posts = entry.rstrip("/") + "/posts"

    return {
        "feed_id": feed_id,
        "platform": platform,
        "account_key": account_key,
        "user_type": user_type,
        "entry_url": entry,
        "posts_url": posts,
        "display_name": display,
        "list_api_path": _yaml_field(source_yaml, "list_url")
        or (
            f"/api/v4/members/{account_key}/articles" if platform == "zhihu" else ""
        ),
        "slug": slug,
        "_skill_dir": str(skill_dir),
    }


def migrate_per_user_platform_skills(*, delete_dirs: bool = True) -> dict[str, Any]:
    """扫描并迁移；返回统计。可重复执行（幂等 upsert）。"""
    migrated: list[str] = []
    skipped: list[str] = []
    deleted: list[str] = []
    if not DISCOVERY_SKILLS_ROOT.is_dir():
        return {"migrated": [], "skipped": [], "deleted": []}

    for skill_dir in sorted(DISCOVERY_SKILLS_ROOT.iterdir()):
        if not skill_dir.is_dir() or not skill_dir.name.endswith("-discovery"):
            continue
        account = _account_from_skill_dir(skill_dir)
        if not account:
            skipped.append(skill_dir.name)
            continue
        skill_path = account.pop("_skill_dir", "")
        feed_registry.upsert_platform_account(account)
        migrated.append(account["feed_id"])
        if delete_dirs and skill_path:
            path = Path(skill_path)
            # 不删平台级 skill
            slug = path.name[: -len("-discovery")]
            if slug.endswith("-platform"):
                continue
            if path.is_dir():
                shutil.rmtree(path)
                deleted.append(path.name)

    return {"migrated": migrated, "skipped": skipped, "deleted": deleted}
