"""Skill 运行时 system prompt 解析入口。"""

from __future__ import annotations


def get_digest_profile(skill_id: str) -> dict | None:
    from digest.digest_skill_registry import get_digest_skill

    item = get_digest_skill(skill_id)
    if not item:
        return None
    profile = item.get("profile")
    return profile if isinstance(profile, dict) else None


def get_chat_role_prompt() -> str:
    """Chat：返回 SKILL.md 角色层；RAG 规则与上下文由 chat_service 追加。"""
    from chat.chat_skill_registry import get_chat_instructions
    from skills.skill_config import builtin_chat_role_prompt

    return get_chat_instructions().strip() or builtin_chat_role_prompt()
