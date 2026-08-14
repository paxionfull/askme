from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from website_feed_adapter import WebsiteFeedAdapter

SKILLS_ROOT = Path(__file__).resolve().parent.parent / ".cursor" / "skills"
DISCOVER_SCRIPT = Path("scripts") / "discover.py"


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


def clear_loaded_skill_modules() -> None:
    to_remove = [name for name in sys.modules if name.startswith("askme_skill_")]
    for name in to_remove:
        del sys.modules[name]


def load_skill_adapters() -> list[WebsiteFeedAdapter]:
    if not SKILLS_ROOT.is_dir():
        return []

    adapters: list[WebsiteFeedAdapter] = []
    for skill_dir in sorted(SKILLS_ROOT.iterdir()):
        if not skill_dir.is_dir() or not skill_dir.name.endswith("-discovery"):
            continue
        module = _load_discover_module(skill_dir)
        if module is None or not _is_adapter(module):
            continue
        adapters.append(module)  # type: ignore[arg-type]
    return adapters


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
