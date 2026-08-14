"""全局 skill 配置（对话 prompt、默认 digest skill 等）。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from chat_service import DEFAULT_ANSWER_SYSTEM_PROMPT
from digest_skill_registry import get_digest_skill
from article_service import DEFAULT_SUMMARY_SYSTEM_PROMPT

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CONFIG_PATH = DATA_DIR / "skill_config.json"
DEFAULT_DIGEST_SKILL = "general-digest"

DEFAULT_CHAT_PROMPT = (
    "你是 Askme 助手。用户会对照左侧日报摘要提问；你还会收到检索到的原文片段。\n\n"
    "请详细、有据地回答。具体引用与篇幅要求由系统在每次请求时追加，"
    "此处仅补充你的角色与语气：专业、清晰、中文 Markdown。"
)

DEFAULT_CONFIG: dict[str, Any] = {
    "chat_system_prompt": DEFAULT_CHAT_PROMPT,
}


def _load() -> dict[str, Any]:
    if not CONFIG_PATH.is_file():
        return json.loads(json.dumps(DEFAULT_CONFIG))
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return json.loads(json.dumps(DEFAULT_CONFIG))
    if not isinstance(data, dict):
        return json.loads(json.dumps(DEFAULT_CONFIG))
    return {
        "chat_system_prompt": str(data.get("chat_system_prompt") or DEFAULT_CONFIG["chat_system_prompt"]).strip(),
    }


def load_skill_config() -> dict[str, Any]:
    return _load()


def save_skill_config(patch: dict[str, Any]) -> dict[str, Any]:
    current = _load()
    if "chat_system_prompt" in patch:
        prompt = str(patch["chat_system_prompt"]).strip()
        if not prompt:
            raise ValueError("对话 system prompt 不能为空")
        from chat_skill_registry import DEFAULT_DESCRIPTION, save_chat_skill
        from skill_md import skill_meta_from_md

        base_md = __import__("chat_skill_registry").get_chat_skill_md()
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
    from feed_registry import feed_registry

    skill_id = feed_registry.default_digest_skill()
    if get_digest_skill(skill_id):
        return skill_id
    if get_digest_skill(DEFAULT_DIGEST_SKILL):
        return DEFAULT_DIGEST_SKILL
    skills = __import__("digest_skill_registry").list_digest_skills()
    return skills[0]["id"] if skills else DEFAULT_DIGEST_SKILL


def get_chat_system_prompt() -> str:
    from skill_runtime import get_chat_role_prompt

    return get_chat_role_prompt()


def get_fallback_digest_prompt() -> str:
    return DEFAULT_SUMMARY_SYSTEM_PROMPT
