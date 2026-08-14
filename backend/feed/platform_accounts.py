"""平台账号配置与 platform skill 目录确保存在。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from feed.feed_registry import feed_registry
from paths import DISCOVERY_SKILLS_ROOT
from skills.skill_registry import PLATFORM_SKILL_SLUGS, platform_skill_slug
from onboarding.source_platform_scaffold import PlatformMatch
from onboarding.source_skill_writer import write_skill_files

_PLATFORM_SKILL_BOOTSTRAPPED: set[str] = set()

_REQUIRED_SKILL_MD_MARKERS = (
    "## 模型",
    "## 接口",
    "platform_accounts",
)


def account_from_platform_match(
    match: PlatformMatch,
    *,
    display_name: str,
) -> dict[str, Any]:
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
    }


def register_platform_account(
    match: PlatformMatch,
    *,
    display_name: str,
) -> dict[str, Any]:
    account = account_from_platform_match(match, display_name=display_name)
    return feed_registry.upsert_platform_account(account)


def _assert_platform_skill_shape(skill_dir: Path, platform: str) -> None:
    """平台 skill 须与站级同构：discover.py + source.yaml + 完整 SKILL.md。"""
    discover = skill_dir / "scripts" / "discover.py"
    source_yaml = skill_dir / "source.yaml"
    skill_md = skill_dir / "SKILL.md"
    missing = [
        name
        for name, path in (
            ("scripts/discover.py", discover),
            ("source.yaml", source_yaml),
            ("SKILL.md", skill_md),
        )
        if not path.is_file()
    ]
    if missing:
        raise ValueError(
            f"平台 skill 不完整（{platform}）：缺少 {', '.join(missing)}。"
            f"请维护 skills/discovery/{skill_dir.name}/"
        )
    text = discover.read_text(encoding="utf-8")
    if "raise RuntimeError(\"请通过 FeedClient" in text or "平台 skill 占位" in text:
        raise ValueError(
            f"平台 skill {skill_dir.name} 仍是空 stub，须提供真实 discover.py"
            "（require_account + WebsiteFeedAdapter 接口）"
        )
    if "require_account" not in text:
        raise ValueError(
            f"平台 skill {skill_dir.name} 的 discover.py 须使用 platform_account_ctx.require_account"
        )
    md = skill_md.read_text(encoding="utf-8")
    if "description:" not in md[:400]:
        raise ValueError(f"平台 skill {skill_dir.name} 的 SKILL.md 缺少 frontmatter description")
    for marker in _REQUIRED_SKILL_MD_MARKERS:
        if marker not in md:
            raise ValueError(
                f"平台 skill {skill_dir.name} 的 SKILL.md 缺少「{marker}」章节（须与 onboarding 契约一致）"
            )
    yaml_text = source_yaml.read_text(encoding="utf-8")
    if "platform_skill: true" not in yaml_text:
        raise ValueError(f"平台 skill {skill_dir.name} 的 source.yaml 须含 platform_skill: true")


def ensure_platform_skill(platform: str) -> Path:
    """确保 `{platform}-platform-discovery` 目录存在且符合契约；不覆盖已有可修文件。"""
    key = (platform or "").strip().lower()
    slug = platform_skill_slug(key)
    skill_dir = DISCOVERY_SKILLS_ROOT / f"{slug}-discovery"
    if skill_dir.is_dir() and (skill_dir / "scripts" / "discover.py").is_file():
        _assert_platform_skill_shape(skill_dir, key)
        return skill_dir

    # 仅从仓库内已提交的平台 skill 复制；禁止再生成空 stub
    files = _load_committed_platform_files(key)
    write_skill_files(slug, files)
    _PLATFORM_SKILL_BOOTSTRAPPED.add(key)
    _assert_platform_skill_shape(skill_dir, key)
    return skill_dir


def _load_committed_platform_files(platform: str) -> dict[str, str]:
    slug = PLATFORM_SKILL_SLUGS.get(platform)
    if not slug:
        raise ValueError(f"未知平台，无法确保 skill: {platform}")
    root = DISCOVERY_SKILLS_ROOT / f"{slug}-discovery"
    required = ("scripts/discover.py", "source.yaml", "SKILL.md")
    missing = [rel for rel in required if not (root / rel).is_file()]
    if missing:
        raise ValueError(
            f"仓库缺少平台 skill 源文件（{platform}）：{', '.join(missing)}。"
            f"请先提交 skills/discovery/{slug}-discovery/"
        )
    return {rel: (root / rel).read_text(encoding="utf-8") for rel in required}
