"""Skill 管理 API 聚合。"""

from __future__ import annotations

import re
import shutil
from pathlib import Path

from chat_skill_registry import CHAT_SKILL_ID, get_chat_skill as load_chat_skill, save_chat_skill as persist_chat_skill
from digest_skill_registry import list_digest_skills
from skill_md import parse_skill_frontmatter, skill_meta_from_md
from skill_registry import SKILLS_ROOT
TEXT_SKILL_SUFFIXES = {".md", ".yaml", ".yml", ".py", ".txt", ".json"}
MAX_SKILL_FILE_BYTES = 512_000
_SAFE_SKILL_ID = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]*$")


def _validate_skill_id(skill_id: str) -> str:
    skill_id = str(skill_id or "").strip()
    if not skill_id or not _SAFE_SKILL_ID.match(skill_id):
        raise ValueError("无效的 skill id")
    return skill_id


def _read_text_file(path: Path) -> str | None:
    if not path.is_file():
        return None
    if path.stat().st_size > MAX_SKILL_FILE_BYTES:
        return f"<!-- 文件过大（>{MAX_SKILL_FILE_BYTES} 字节），请在仓库中直接查看：{path.name} -->"
    return path.read_text(encoding="utf-8")


def _collect_skill_files(skill_dir: Path) -> list[dict[str, str]]:
    files: list[dict[str, str]] = []
    if not skill_dir.is_dir():
        return files

    candidates: list[Path] = []
    for path in sorted(skill_dir.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix.lower() not in TEXT_SKILL_SUFFIXES:
            continue
        rel = path.relative_to(skill_dir)
        if rel.parts and rel.parts[0] == "__pycache__":
            continue
        candidates.append(path)

    for path in candidates:
        content = _read_text_file(path)
        if content is None:
            continue
        files.append(
            {
                "path": str(path.relative_to(skill_dir)),
                "content": content,
            }
        )
    return files


def _skill_dir_for_discovery(skill_id: str) -> Path:
    skill_id = _validate_skill_id(skill_id)
    return SKILLS_ROOT / f"{skill_id}-discovery"


def _skill_dir_for_other(skill_id: str) -> Path:
    skill_id = _validate_skill_id(skill_id)
    return SKILLS_ROOT / skill_id


def _extract_feed_id(skill_dir: Path) -> str | None:
    script = skill_dir / "scripts" / "discover.py"
    if not script.is_file():
        return None
    text = script.read_text(encoding="utf-8", errors="ignore")
    match = re.search(r'^FEED_ID\s*=\s*["\']([^"\']+)["\']', text, re.MULTILINE)
    if match:
        return match.group(1).strip()
    return None


def _remove_skill_dir(skill_dir: Path) -> None:
    if skill_dir.is_dir():
        shutil.rmtree(skill_dir)


def delete_discovery_skill(skill_id: str) -> dict[str, str | None]:
    skill_id = _validate_skill_id(skill_id)
    from skill_registry import PLATFORM_SKILL_SLUGS

    if skill_id.endswith("-platform") or skill_id in PLATFORM_SKILL_SLUGS.values():
        raise ValueError("平台级 skill 不可删除；请删除具体账号数据源")

    skill_dir = _skill_dir_for_discovery(skill_id)
    if not skill_dir.is_dir():
        raise ValueError("discovery skill 不存在")

    feed_id = _extract_feed_id(skill_dir) or f"website:{skill_id}"
    _remove_skill_dir(skill_dir)

    from feed_registry import feed_registry

    if feed_id:
        # skill 已物理删除：purge 而非 hide，避免重接时踩「数据源已移除」
        feed_registry.purge_feed(feed_id)

    from skill_registry import clear_loaded_skill_modules

    clear_loaded_skill_modules()
    return {"id": skill_id, "feed_id": feed_id}


def delete_discovery_skill_by_feed_id(feed_id: str) -> dict[str, str | None]:
    target = (feed_id or "").strip()
    if not target:
        raise ValueError("无效的 feed_id")

    from feed_registry import feed_registry

    # 平台账号：只清 registry，保留平台级 skill 供其他账号与 auto_repair 使用
    if feed_registry.get_platform_account(target):
        feed_registry.purge_feed(target)
        from skill_registry import clear_loaded_skill_modules

        clear_loaded_skill_modules()
        return {"id": None, "feed_id": target}

    if not SKILLS_ROOT.is_dir():
        raise ValueError("未找到对应的 discovery skill")

    for skill_dir in sorted(SKILLS_ROOT.iterdir()):
        if not skill_dir.is_dir() or not skill_dir.name.endswith("-discovery"):
            continue
        resolved_feed_id = _extract_feed_id(skill_dir)
        if resolved_feed_id == target:
            skill_id = skill_dir.name[: -len("-discovery")]
            return delete_discovery_skill(skill_id)

    if target.startswith("website:"):
        skill_id = target.split(":", 1)[1].strip()
        if skill_id:
            skill_dir = _skill_dir_for_discovery(skill_id)
            if skill_dir.is_dir():
                return delete_discovery_skill(skill_id)

    raise ValueError("未找到对应的 discovery skill")


def delete_other_skill(skill_id: str) -> dict[str, str]:
    skill_id = _validate_skill_id(skill_id)
    skill_dir = _skill_dir_for_other(skill_id)
    if not skill_dir.is_dir():
        raise ValueError("skill 不存在")
    name = skill_dir.name
    if name.endswith("-discovery") or name.endswith("-digest") or name.startswith("_"):
        raise ValueError("skill 不存在")

    _remove_skill_dir(skill_dir)
    from skill_registry import clear_loaded_skill_modules

    clear_loaded_skill_modules()
    return {"id": skill_id}


def _skill_md_meta(skill_md_path: Path, *, fallback_id: str) -> tuple[str, str, str]:
    if not skill_md_path.is_file():
        return fallback_id, "", ""
    text = skill_md_path.read_text(encoding="utf-8")
    name, description = skill_meta_from_md(text, fallback_id=fallback_id)
    return name, description, text


def get_discovery_skill_detail(skill_id: str) -> dict:
    skill_dir = _skill_dir_for_discovery(skill_id)
    if not skill_dir.is_dir():
        raise ValueError("discovery skill 不存在")

    skill_md_path = skill_dir / "SKILL.md"
    name, description, skill_md = _skill_md_meta(skill_md_path, fallback_id=skill_id)
    source_yaml = _read_text_file(skill_dir / "source.yaml")

    return {
        "id": skill_id,
        "name": name,
        "category": "discovery",
        "description": description,
        "builtin": True,
        "readonly": True,
        "deletable": True,
        "path": str(skill_dir.relative_to(SKILLS_ROOT.parent)),
        "skill_md": skill_md,
        "source_yaml": source_yaml,
        "files": _collect_skill_files(skill_dir),
    }


def get_other_skill_detail(skill_id: str) -> dict:
    skill_dir = _skill_dir_for_other(skill_id)
    if not skill_dir.is_dir():
        raise ValueError("skill 不存在")
    name = skill_dir.name
    if (
        name.endswith("-discovery")
        or name.endswith("-digest")
        or name.startswith("_")
        or name == CHAT_SKILL_ID
    ):
        raise ValueError("skill 不存在")

    skill_md_path = skill_dir / "SKILL.md"
    name, description, skill_md = _skill_md_meta(skill_md_path, fallback_id=name)
    source_yaml = _read_text_file(skill_dir / "source.yaml")

    return {
        "id": name,
        "name": name,
        "category": "other",
        "description": description,
        "builtin": True,
        "readonly": True,
        "deletable": True,
        "path": str(skill_dir.relative_to(SKILLS_ROOT.parent)),
        "skill_md": skill_md,
        "source_yaml": source_yaml,
        "files": _collect_skill_files(skill_dir),
    }


def list_discovery_skills() -> list[dict]:
    items: list[dict] = []
    if not SKILLS_ROOT.is_dir():
        return items
    for skill_dir in sorted(SKILLS_ROOT.iterdir()):
        if not skill_dir.is_dir() or not skill_dir.name.endswith("-discovery"):
            continue
        slug = skill_dir.name[: -len("-discovery")]
        skill_md_path = skill_dir / "SKILL.md"
        source_yaml = skill_dir / "source.yaml"
        fm_name, description, _ = _skill_md_meta(skill_md_path, fallback_id=slug)
        items.append(
            {
                "id": slug,
                "name": fm_name,
                "category": "discovery",
                "description": description,
                "builtin": True,
                "readonly": True,
                "deletable": True,
                "path": str(skill_dir.relative_to(SKILLS_ROOT.parent)),
                "has_source_yaml": source_yaml.is_file(),
            }
        )
    return items


def list_other_skills() -> list[dict]:
    items: list[dict] = []
    if not SKILLS_ROOT.is_dir():
        return items
    for skill_dir in sorted(SKILLS_ROOT.iterdir()):
        if not skill_dir.is_dir():
            continue
        name = skill_dir.name
        if (
            name.endswith("-discovery")
            or name.endswith("-digest")
            or name.startswith("_")
            or name == CHAT_SKILL_ID
        ):
            continue
        skill_md_path = skill_dir / "SKILL.md"
        fm_name, description, _ = _skill_md_meta(skill_md_path, fallback_id=name)
        items.append(
            {
                "id": name,
                "name": fm_name,
                "category": "other",
                "description": description,
                "builtin": True,
                "readonly": True,
                "deletable": True,
                "path": str(skill_dir.relative_to(SKILLS_ROOT.parent)),
            }
        )
    return items


def get_chat_skill() -> dict:
    return load_chat_skill()


def save_chat_skill(*, skill_md: str) -> dict:
    return persist_chat_skill(skill_md=skill_md)


def list_all_skills() -> dict:
    from feed_registry import feed_registry

    default_id = feed_registry.default_digest_skill()
    digest_items = [
        {
            "id": item["id"],
            "name": item["name"],
            "category": "digest",
            "description": item.get("description", ""),
            "builtin": item.get("builtin", False),
            "readonly": False,
            "deletable": True,
            "is_default": item["id"] == default_id,
            "skill_content": item.get("skill_content", ""),
            "skill_md": item.get("skill_md", ""),
            "path": item.get("path", ""),
            "has_profile": bool(item.get("has_profile") or item.get("profile")),
            "input_mode": item.get("input_mode", "full"),
        }
        for item in list_digest_skills()
    ]
    return {
        "discovery": list_discovery_skills(),
        "digest": digest_items,
        "chat": get_chat_skill(),
        "other": list_other_skills(),
        "default_digest_skill": feed_registry.default_digest_skill(),
    }
