"""平台账号配置与 platform skill 目录确保存在。"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from feed_registry import feed_registry
from skill_registry import PLATFORM_SKILL_SLUGS, SKILLS_ROOT, platform_skill_slug
from source_platform_scaffold import PlatformMatch
from source_skill_writer import write_skill_files

_PLATFORM_SKILL_BOOTSTRAPPED: set[str] = set()


def account_from_platform_match(
    match: PlatformMatch,
    *,
    display_name: str,
) -> dict[str, Any]:
    entry = match.entry_url
    xsec = ""
    if match.platform == "xiaohongshu" and entry:
        xsec = (parse_qs(urlparse(entry).query).get("xsec_token") or [""])[0]
    return {
        "feed_id": match.feed_id,
        "platform": match.platform,
        "account_key": match.user_id,
        "user_type": match.user_type,
        "entry_url": match.entry_url,
        "posts_url": match.posts_url,
        "display_name": display_name.strip(),
        "list_api_path": match.list_api_path,
        "slug": match.slug,
        "xsec_token": xsec,
    }


def register_platform_account(
    match: PlatformMatch,
    *,
    display_name: str,
) -> dict[str, Any]:
    account = account_from_platform_match(match, display_name=display_name)
    return feed_registry.upsert_platform_account(account)


def ensure_platform_skill(platform: str) -> Path:
    """确保 `{platform}-platform-discovery` 目录存在；已存在则不覆盖（便于 auto_repair 保留修复）。"""
    key = (platform or "").strip().lower()
    slug = platform_skill_slug(key)
    skill_dir = SKILLS_ROOT / f"{slug}-discovery"
    if skill_dir.is_dir() and (skill_dir / "scripts" / "discover.py").is_file():
        return skill_dir

    # 从仓库内已写好的平台 skill 复制；若缺失则从脚手架生成 ContextVar 版不可行时至少建占位
    # 各平台 skill 已在仓库提交；此处仅作兜底
    if key == "weixin":
        files = _weixin_platform_files()
    elif key == "zhihu":
        files = _zhihu_platform_files()
    elif key == "reddit":
        files = _reddit_platform_files()
    else:
        # x / xiaohongshu：运行时走脚手架编译，这里写最小可修目录
        files = _compile_platform_stub_files(key)
    write_skill_files(slug, files)
    _PLATFORM_SKILL_BOOTSTRAPPED.add(key)
    return skill_dir


def _weixin_platform_files() -> dict[str, str]:
    root = SKILLS_ROOT / "weixin-platform-discovery"
    return {
        "scripts/discover.py": (root / "scripts" / "discover.py").read_text(encoding="utf-8"),
        "source.yaml": (root / "source.yaml").read_text(encoding="utf-8"),
        "SKILL.md": (root / "SKILL.md").read_text(encoding="utf-8"),
    }


def _zhihu_platform_files() -> dict[str, str]:
    root = SKILLS_ROOT / "zhihu-platform-discovery"
    return {
        "scripts/discover.py": (root / "scripts" / "discover.py").read_text(encoding="utf-8"),
        "source.yaml": (root / "source.yaml").read_text(encoding="utf-8"),
        "SKILL.md": (root / "SKILL.md").read_text(encoding="utf-8"),
    }


def _reddit_platform_files() -> dict[str, str]:
    root = SKILLS_ROOT / "reddit-platform-discovery"
    return {
        "scripts/discover.py": (root / "scripts" / "discover.py").read_text(encoding="utf-8"),
        "source.yaml": (root / "source.yaml").read_text(encoding="utf-8"),
        "SKILL.md": (root / "SKILL.md").read_text(encoding="utf-8"),
    }


def _compile_platform_stub_files(platform: str) -> dict[str, str]:
    slug = PLATFORM_SKILL_SLUGS.get(platform, f"{platform}-platform")
    discover = f'''#!/usr/bin/env python3
"""{{platform}} 平台 skill 占位（运行时按账号编译 _lib/{{platform}}_scaffold）。"""
from __future__ import annotations
from http_client import fetch_text  # noqa: F401

PLATFORM = "{platform}"
FEED_ID = "website:{platform}:__platform__"
FEED_META = {{
    "id": FEED_ID,
    "mpName": "{platform}",
    "mpCover": "",
    "mpIntro": "{platform} platform",
    "status": 1,
    "source": "website",
    "entryUrl": "",
}}
REFRESH_DEFAULTS = {{"max_pages": 3, "per": 20}}


def fetch_list_page(page: int = 1, per: int = 20) -> dict:
    raise RuntimeError("请通过 FeedClient 绑定 platform_accounts 后访问")


def list_items(payload: dict) -> list:
    return []


def has_next_page(payload: dict) -> bool:
    return False


def normalize_list_item(item: dict) -> dict:
    return item


def fetch_article_detail(article_id: str, **hints) -> dict:
    raise RuntimeError("请通过 FeedClient 绑定 platform_accounts 后访问")
'''
    return {
        "scripts/discover.py": discover.replace("{platform}", platform),
        "source.yaml": f"id: {slug}\nname: {platform}\nplatform: {platform}\nplatform_skill: true\n",
        "SKILL.md": f"---\nname: {slug}-discovery\ndescription: {platform} platform skill\n---\n\n# {platform}\n",
    }
