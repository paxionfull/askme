"""全局 skill 配置（对话 prompt、默认 digest skill 等）。"""

from __future__ import annotations

import json
from typing import Any

from digest.digest_skill_registry import get_digest_skill
from paths import CHAT_SKILLS_BUILTIN_ROOT, DATA_DIR
from skills.skill_md import strip_frontmatter

CONFIG_PATH = DATA_DIR / "skill_config.json"
DEFAULT_DIGEST_SKILL = "general-digest"

# 仅当 chat-rag/SKILL.md 缺失时的紧急回退；正常真源是 skill 文件。
_FALLBACK_CHAT_PROMPT = "你是 Askme 助手。语气：专业、清晰、中文 Markdown。"


def builtin_chat_role_prompt() -> str:
    """从内置 chat-rag/SKILL.md 读取角色正文（单一真源）。"""
    path = CHAT_SKILLS_BUILTIN_ROOT / "chat-rag" / "SKILL.md"
    if path.is_file():
        body = strip_frontmatter(path.read_text(encoding="utf-8")).strip()
        if body:
            return body
    return _FALLBACK_CHAT_PROMPT


# 兼容旧名：指向 builtin skill；运行时请优先 get_chat_system_prompt() / builtin_chat_role_prompt()
DEFAULT_CHAT_PROMPT = builtin_chat_role_prompt()

DEFAULT_CONFIG: dict[str, Any] = {
    "chat_system_prompt": "",  # 空表示使用 builtin_chat_role_prompt()
}


def _load() -> dict[str, Any]:
    if not CONFIG_PATH.is_file():
        return {"chat_system_prompt": builtin_chat_role_prompt()}
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"chat_system_prompt": builtin_chat_role_prompt()}
    if not isinstance(data, dict):
        return {"chat_system_prompt": builtin_chat_role_prompt()}
    stored = str(data.get("chat_system_prompt") or "").strip()
    return {
        "chat_system_prompt": stored or builtin_chat_role_prompt(),
    }


def load_skill_config() -> dict[str, Any]:
    return _load()


def save_skill_config(patch: dict[str, Any]) -> dict[str, Any]:
    current = _load()
    if "chat_system_prompt" in patch:
        prompt = str(patch["chat_system_prompt"]).strip()
        if not prompt:
            raise ValueError("对话 system prompt 不能为空")
        from chat.chat_skill_registry import DEFAULT_DESCRIPTION, get_chat_skill_md, save_chat_skill
        from skills.skill_md import skill_meta_from_md

        base_md = get_chat_skill_md()
        name, desc = skill_meta_from_md(base_md, fallback_id="chat-rag")
        skill_md = (
            f"---\nname: {name}\ndescription: {desc or DEFAULT_DESCRIPTION}\n---\n\n{prompt}\n"
        )
        save_chat_skill(skill_md=skill_md)
        current["chat_system_prompt"] = prompt
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(current, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return current


def get_default_digest_skill() -> str:
    from feed.feed_registry import feed_registry

    skill_id = feed_registry.default_digest_skill()
    if get_digest_skill(skill_id):
        return skill_id
    if get_digest_skill(DEFAULT_DIGEST_SKILL):
        return DEFAULT_DIGEST_SKILL
    skills = __import__("digest_skill_registry").list_digest_skills()
    return skills[0]["id"] if skills else DEFAULT_DIGEST_SKILL


def get_chat_system_prompt() -> str:
    from skills.skill_runtime import get_chat_role_prompt

    return get_chat_role_prompt()
