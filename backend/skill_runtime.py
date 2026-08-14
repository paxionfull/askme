"""Skill 运行时 system prompt 解析入口。"""

from __future__ import annotations


def get_digest_system_prompt(skill_id: str) -> str:
    """Digest：system message 即 skill 指令全文（无额外拼装）。"""
    from digest_skill_registry import get_digest_skill
    from skill_config import get_fallback_digest_prompt

    item = get_digest_skill(skill_id)
    if item:
        content = str(item.get("skill_content") or "").strip()
        if content:
            return content
    return get_fallback_digest_prompt()


def get_digest_input_mode(skill_id: str) -> str:
    from digest_skill_registry import get_digest_skill

    item = get_digest_skill(skill_id)
    if item:
        mode = str(item.get("input_mode") or "full").strip()
        if mode:
            return mode
    return "full"


def get_chat_role_prompt() -> str:
    """Chat：返回 SKILL.md 角色层；RAG 规则与上下文由 chat_service 追加。"""
    from chat_skill_registry import get_chat_instructions
    from skill_config import DEFAULT_CHAT_PROMPT

    return get_chat_instructions().strip() or DEFAULT_CHAT_PROMPT
