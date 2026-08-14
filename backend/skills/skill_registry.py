from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any

from feed.website_feed_adapter import WebsiteFeedAdapter
from paths import SKILLS_ROOT

DISCOVER_SCRIPT = Path("scripts") / "discover.py"

# platform id → skill 目录名（不含 -discovery）
PLATFORM_SKILL_SLUGS: dict[str, str] = {
    "zhihu": "zhihu-platform",
    "weixin": "weixin-platform",
    "xiaohongshu": "xiaohongshu-platform",
    "reddit": "reddit-platform",
    "x": "x-platform",
}


def _load_discover_module(skill_dir: Path):
    script = skill_dir / DISCOVER_SCRIPT
    if not script.is_file():
        return None

    module_name = f"askme_skill_{skill_dir.name.replace('-', '_')}"
    spec = importlib.util.spec_from_file_location(module_name, script)
    if spec is None or spec.loader is None:
        return None

    module = importlib.util.module_from_spec(spec)
    lib_root = SKILLS_ROOT / "_lib"
    for path in (lib_root, SKILLS_ROOT):
        path_str = str(path)
        if path_str not in sys.path:
            sys.path.insert(0, path_str)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def _is_adapter(module) -> bool:
    required = (
        "FEED_ID",
        "FEED_META",
        "fetch_list_page",
        "list_items",
        "has_next_page",
        "normalize_list_item",
        "fetch_article_detail",
    )
    return all(hasattr(module, name) for name in required)


def _is_platform_module(module) -> bool:
    platform = str(getattr(module, "PLATFORM", "") or "").strip().lower()
    if not platform:
        return False
    required = (
        "fetch_list_page",
        "list_items",
        "has_next_page",
        "normalize_list_item",
        "fetch_article_detail",
    )
    return all(hasattr(module, name) for name in required)


def clear_loaded_skill_modules() -> None:
    to_remove = [name for name in sys.modules if name.startswith("askme_skill_")]
    for name in to_remove:
        del sys.modules[name]


def load_skill_adapters() -> list[WebsiteFeedAdapter]:
    """仅返回经典「一站一 skill」适配器（不含 PLATFORM 模块）。"""
    if not SKILLS_ROOT.is_dir():
        return []

    adapters: list[WebsiteFeedAdapter] = []
    for skill_dir in sorted(SKILLS_ROOT.iterdir()):
        if not skill_dir.is_dir() or not skill_dir.name.endswith("-discovery"):
            continue
        module = _load_discover_module(skill_dir)
        if module is None:
            continue
        if _is_platform_module(module):
            continue
        if not _is_adapter(module):
            continue
        adapters.append(module)  # type: ignore[arg-type]
    return adapters


def load_platform_modules() -> dict[str, Any]:
    """返回 platform_id → discover 模块。"""
    if not SKILLS_ROOT.is_dir():
        return {}
    modules: dict[str, Any] = {}
    for skill_dir in sorted(SKILLS_ROOT.iterdir()):
        if not skill_dir.is_dir() or not skill_dir.name.endswith("-discovery"):
            continue
        module = _load_discover_module(skill_dir)
        if module is None or not _is_platform_module(module):
            continue
        platform = str(getattr(module, "PLATFORM", "") or "").strip().lower()
        if platform:
            modules[platform] = module
    # 也按约定 slug 兜底加载（模块忘写 PLATFORM 时）
    for platform, slug in PLATFORM_SKILL_SLUGS.items():
        if platform in modules:
            continue
        skill_dir = SKILLS_ROOT / f"{slug}-discovery"
        if not skill_dir.is_dir():
            continue
        module = _load_discover_module(skill_dir)
        if module is None or not _is_adapter(module):
            # 平台模块可能只有 PLATFORM 而无固定 FEED_ID
            if module is not None and _is_platform_module(module):
                modules[platform] = module
            continue
        if _is_platform_module(module):
            modules[platform] = module
    return modules


def reload_skill_adapters() -> list[WebsiteFeedAdapter]:
    clear_loaded_skill_modules()
    return load_skill_adapters()


def list_skill_slugs() -> list[str]:
    if not SKILLS_ROOT.is_dir():
        return []
    return sorted(
        skill_dir.name[: -len("-discovery")]
        for skill_dir in SKILLS_ROOT.iterdir()
        if skill_dir.is_dir() and skill_dir.name.endswith("-discovery")
    )


def platform_skill_slug(platform: str) -> str:
    key = (platform or "").strip().lower()
    return PLATFORM_SKILL_SLUGS.get(key, f"{key}-platform")
