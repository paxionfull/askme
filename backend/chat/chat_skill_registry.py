"""对话 skill 注册表（内置 SKILL.md + 用户覆盖）。"""

from __future__ import annotations

from paths import CHAT_SKILLS_BUILTIN_ROOT, DATA_DIR, PROJECT_ROOT

from pathlib import Path
from typing import Any

from skills.skill_config import builtin_chat_role_prompt, load_skill_config
from skills.skill_md import (
    is_stub_skill_body,
    resolve_skill_instructions,
    skill_meta_from_md,
    strip_frontmatter,
)

CHAT_SKILL_ID = "chat-rag"
BUILTIN_DIR = CHAT_SKILLS_BUILTIN_ROOT / CHAT_SKILL_ID
USER_DIR = DATA_DIR / "chat-skills" / CHAT_SKILL_ID
DEFAULT_DESCRIPTION = "对话时的角色 system prompt（问答与选定文章摘要共用；引用硬性规则由系统在问答时自动追加）"


def _build_skill_md(name: str, description: str, body: str) -> str:
    content = body.strip()
    return f"---\nname: {name}\ndescription: {description}\n---\n\n{content}\n"


def _legacy_prompt_from_config() -> str:
    return str(
        load_skill_config().get("chat_system_prompt") or builtin_chat_role_prompt()
    ).strip()


def _read_builtin_skill_md() -> str:
    path = BUILTIN_DIR / "SKILL.md"
    if path.is_file():
        return path.read_text(encoding="utf-8")
    return _build_skill_md(
        CHAT_SKILL_ID, DEFAULT_DESCRIPTION, builtin_chat_role_prompt()
    )


def _read_user_skill_md() -> str | None:
    path = USER_DIR / "SKILL.md"
    if path.is_file():
        return path.read_text(encoding="utf-8")
    return None


def get_chat_skill_md() -> str:
    user_md = _read_user_skill_md()
    if user_md and user_md.strip():
        return user_md

    builtin_md = _read_builtin_skill_md()
    legacy = _legacy_prompt_from_config()
    instructions = resolve_skill_instructions(
        builtin_md,
        legacy_prompt=legacy,
        fallback=builtin_chat_role_prompt(),
    )
    body = strip_frontmatter(builtin_md).strip()
    if is_stub_skill_body(body, legacy) and legacy:
        name, desc = skill_meta_from_md(builtin_md, fallback_id=CHAT_SKILL_ID)
        return _build_skill_md(name, desc or DEFAULT_DESCRIPTION, instructions)

    return builtin_md


def get_chat_instructions() -> str:
    legacy = "" if _read_user_skill_md() else _legacy_prompt_from_config()
    return resolve_skill_instructions(
        get_chat_skill_md(),
        legacy_prompt=legacy,
        fallback=builtin_chat_role_prompt(),
    )


def get_chat_skill() -> dict[str, Any]:
    skill_md = get_chat_skill_md()
    name, description = skill_meta_from_md(skill_md, fallback_id=CHAT_SKILL_ID)
    skill_content = strip_frontmatter(skill_md).strip()
    user_override = _read_user_skill_md() is not None
    skill_dir = USER_DIR if user_override else BUILTIN_DIR
    path = skill_dir / "SKILL.md"
    rel_root = PROJECT_ROOT

    return {
        "id": CHAT_SKILL_ID,
        "name": name,
        "category": "chat",
        "description": description or DEFAULT_DESCRIPTION,
        "builtin": not user_override,
        "readonly": False,
        "deletable": False,
        "skill_content": skill_content,
        "skill_md": skill_md,
        "path": str(path.relative_to(rel_root)) if path.is_file() else str((USER_DIR / "SKILL.md").relative_to(rel_root)),
    }


def save_chat_skill(*, skill_md: str) -> dict[str, Any]:
    md = skill_md.strip()
    if not md:
        raise ValueError("SKILL.md 内容不能为空")

    body = strip_frontmatter(md).strip()
    if not body:
        raise ValueError("skill 正文不能为空")

    USER_DIR.mkdir(parents=True, exist_ok=True)
    normalized = md if md.endswith("\n") else md + "\n"
    (USER_DIR / "SKILL.md").write_text(normalized, encoding="utf-8")
    return get_chat_skill()
