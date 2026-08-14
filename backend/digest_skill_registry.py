"""Digest 摘要 skill 注册表（内置 + 用户自定义）。"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from digest_profile import load_profile_from_dir, normalize_profile, save_profile_to_dir
from skill_md import resolve_skill_instructions, skill_meta_from_md, strip_frontmatter, is_stub_skill_body
BUILTIN_ROOT = Path(__file__).resolve().parent.parent / ".cursor" / "skills"
USER_ROOT = Path(__file__).resolve().parent.parent / "data" / "digest-skills"
SKILL_ID_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")
DIGEST_SUFFIX = "-digest"


def _parse_simple_yaml(text: str) -> dict[str, Any]:
    data: dict[str, Any] = {}
    current_key: str | None = None
    block_lines: list[str] = []

    def flush_block() -> None:
        nonlocal current_key, block_lines
        if current_key is not None:
            data[current_key] = "\n".join(block_lines).rstrip("\n")
        current_key = None
        block_lines = []

    for line in text.splitlines():
        if line.strip().startswith("#"):
            continue
        if not line.strip() and current_key:
            block_lines.append("")
            continue
        match = re.match(r"^([a-z_]+):\s*(.*)$", line)
        if match and not line.startswith(" "):
            flush_block()
            key, value = match.group(1), match.group(2)
            if value == "|" or value == ">":
                current_key = key
                block_lines = []
            elif value:
                data[key] = value.strip().strip('"').strip("'")
            else:
                current_key = key
                block_lines = []
            continue
        if current_key is not None:
            block_lines.append(line[1:] if line.startswith(" ") else line)

    flush_block()
    return data


def _build_skill_md(skill_id: str, name: str, description: str, skill_content: str) -> str:
    body = skill_content.strip()
    return (
        f"---\nname: {skill_id}\ndescription: {description}\n---\n\n{body}\n"
    )


def _profile_stub_body() -> str:
    return (
        "结构化概览 skill（分类 → 重点关注 → 类内聚类 → 渲染）。\n\n"
        "规则与类别定义见同目录 `digest_profile.json`。"
        "系统按配置执行两步 LLM，再渲染为固定 Markdown，不直接使用本文件作为生成 prompt。"
    )


def _load_digest_skill(skill_dir: Path, *, builtin: bool) -> dict[str, Any] | None:
    digest_yaml = skill_dir / "digest.yaml"
    skill_md_path = skill_dir / "SKILL.md"

    raw: dict[str, Any] = {}
    legacy_prompt = ""
    if digest_yaml.is_file():
        raw = _parse_simple_yaml(digest_yaml.read_text(encoding="utf-8"))
        legacy_prompt = str(raw.get("system_prompt") or "").strip()

    skill_md = skill_md_path.read_text(encoding="utf-8") if skill_md_path.is_file() else ""
    profile = load_profile_from_dir(skill_dir)

    skill_id = str(raw.get("id") or skill_dir.name).strip()
    if not skill_id.endswith(DIGEST_SUFFIX):
        skill_id = f"{skill_id}{DIGEST_SUFFIX}" if not skill_id.endswith("-digest") else skill_id

    fm_name, fm_desc = skill_meta_from_md(skill_md, fallback_id=skill_id)
    name = fm_name or str(raw.get("name") or skill_id).strip()
    description = fm_desc or str(raw.get("description") or "").strip()
    skill_content = resolve_skill_instructions(skill_md, legacy_prompt=legacy_prompt)
    if not skill_content and not profile:
        return None
    if not skill_content and profile:
        skill_content = _profile_stub_body()

    if not description:
        body = strip_frontmatter(skill_md).strip()
        for line in body.splitlines():
            stripped = line.strip()
            if stripped and not stripped.startswith("#"):
                description = stripped[:200]
                break
        if not description and profile:
            description = "结构化概览 skill"

    body = strip_frontmatter(skill_md).strip()
    if (is_stub_skill_body(body, legacy_prompt) and legacy_prompt) or not skill_md.strip():
        skill_md = _build_skill_md(skill_id, name, description, skill_content)

    input_mode = str(raw.get("input_mode") or "full").strip() or "full"
    if profile:
        input_mode = str(profile.get("input_mode") or input_mode).strip() or input_mode

    return {
        "id": skill_id,
        "name": name,
        "description": description,
        "skill_content": skill_content,
        "skill_md": skill_md,
        "input_mode": input_mode,
        "profile": profile,
        "has_profile": profile is not None,
        "builtin": builtin,
        "readonly": False,
        "deletable": True,
        "category": "digest",
        "path": str(skill_dir.relative_to(skill_dir.parent.parent.parent))
        if builtin
        else str(skill_dir.relative_to(USER_ROOT.parent)),
    }

def _skill_dir_candidates(root: Path) -> list[Path]:
    if not root.is_dir():
        return []
    dirs = [path for path in root.iterdir() if path.is_dir()]
    dirs.sort(key=lambda item: item.name)
    return dirs


def _skill_dir_for(safe_id: str, *, builtin: bool) -> Path:
    return (BUILTIN_ROOT if builtin else USER_ROOT) / safe_id


def get_digest_skill_detail(skill_id: str) -> dict[str, Any]:
    item = get_digest_skill(skill_id)
    if not item:
        raise ValueError("digest skill 不存在")
    return dict(item)


def validate_skill_id(skill_id: str) -> str:
    value = skill_id.strip().lower().replace("_", "-")
    if not value.endswith(DIGEST_SUFFIX):
        value = f"{value}{DIGEST_SUFFIX}"
    if not SKILL_ID_PATTERN.match(value):
        raise ValueError("skill id 只能包含小写字母、数字和连字符")
    return value


def list_digest_skills() -> list[dict[str, Any]]:
    skills: dict[str, dict[str, Any]] = {}
    for skill_dir in _skill_dir_candidates(BUILTIN_ROOT):
        if not skill_dir.name.endswith(DIGEST_SUFFIX):
            continue
        item = _load_digest_skill(skill_dir, builtin=True)
        if item:
            skills[item["id"]] = item

    USER_ROOT.mkdir(parents=True, exist_ok=True)
    for skill_dir in _skill_dir_candidates(USER_ROOT):
        item = _load_digest_skill(skill_dir, builtin=False)
        if item:
            skills[item["id"]] = item
    return sorted(skills.values(), key=lambda item: (not item["builtin"], item["name"]))


def get_digest_skill(skill_id: str) -> dict[str, Any] | None:
    safe_id = validate_skill_id(skill_id)
    for item in list_digest_skills():
        if item["id"] == safe_id:
            return dict(item)
    return None


def get_skill_instructions(skill_id: str, *, fallback: str = "") -> str:
    item = get_digest_skill(skill_id)
    if item and item.get("skill_content"):
        return str(item["skill_content"])
    return fallback


def get_system_prompt(skill_id: str, *, fallback: str = "") -> str:
    return get_skill_instructions(skill_id, fallback=fallback)


def save_user_digest_skill(
    skill_id: str,
    *,
    skill_md: str | None = None,
    profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    safe_id = validate_skill_id(skill_id)
    existing = get_digest_skill(safe_id)
    md = (skill_md or "").strip()
    normalized_profile = normalize_profile(profile) if profile is not None else None

    if not md and normalized_profile is None and not (existing and existing.get("profile")):
        raise ValueError("请提供 profile 或 SKILL.md")

    builtin = bool(existing and existing.get("builtin"))
    if existing:
        skill_dir = _skill_dir_for(safe_id, builtin=builtin)
    else:
        USER_ROOT.mkdir(parents=True, exist_ok=True)
        skill_dir = USER_ROOT / safe_id
        builtin = False
    skill_dir.mkdir(parents=True, exist_ok=True)

    if normalized_profile is not None:
        save_profile_to_dir(skill_dir, normalized_profile)
        input_mode = str(normalized_profile.get("input_mode") or "titles")
    else:
        input_mode = str(existing.get("input_mode") or "full").strip() if existing else "full"
        if existing and existing.get("profile"):
            # 仅更新 md 时保留已有 profile
            normalized_profile = normalize_profile(existing["profile"])

    if not md:
        display_name = safe_id
        desc = "结构化概览 skill"
        if existing:
            display_name = str(existing.get("name") or display_name)
            desc = str(existing.get("description") or desc)
        md = _build_skill_md(safe_id, display_name, desc, _profile_stub_body())

    fm_name, fm_desc = skill_meta_from_md(md, fallback_id=safe_id)
    body = strip_frontmatter(md).strip()
    if not body:
        raise ValueError("skill 正文不能为空")

    display_name = fm_name or safe_id
    desc = fm_desc or "结构化概览 skill"
    normalized_md = md if md.endswith("\n") else md + "\n"
    (skill_dir / "SKILL.md").write_text(normalized_md, encoding="utf-8")
    yaml_text = (
        f'id: {safe_id}\nname: "{display_name}"\ndescription: "{desc}"\n'
        f"input_mode: {input_mode}\n"
    )
    (skill_dir / "digest.yaml").write_text(yaml_text, encoding="utf-8")

    item = _load_digest_skill(skill_dir, builtin=builtin)
    if not item:
        raise ValueError("保存 digest skill 失败")
    return item

def delete_user_digest_skill(skill_id: str) -> None:
    import shutil

    safe_id = validate_skill_id(skill_id)
    existing = get_digest_skill(safe_id)
    if not existing:
        raise ValueError("skill 不存在")

    if existing.get("builtin"):
        skill_dir = BUILTIN_ROOT / safe_id
    else:
        skill_dir = USER_ROOT / safe_id

    if skill_dir.is_dir():
        shutil.rmtree(skill_dir)

    from feed_registry import feed_registry

    if feed_registry.default_digest_skill() == safe_id:
        remaining = [item for item in list_digest_skills() if item["id"] != safe_id]
        fallback = remaining[0]["id"] if remaining else "general-digest"
        feed_registry.set_default_digest_skill(fallback)

    groups = feed_registry.list_groups()
    updated_groups = []
    changed = False
    for group in groups:
        if group.get("digest_skill_id") == safe_id:
            updated_groups.append({**group, "digest_skill_id": None})
            changed = True
        else:
            updated_groups.append(group)
    if changed:
        feed_registry.set_layout(updated_groups, feed_registry.list_group_order())
