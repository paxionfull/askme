"""全局 skill 配置（对话 prompt、默认 digest skill 等）。"""

from __future__ import annotations

import json
from typing import Any

from digest.digest_skill_registry import get_digest_skill
from paths import DATA_DIR

CONFIG_PATH = DATA_DIR / "skill_config.json"
DEFAULT_DIGEST_SKILL = "general-digest"

DEFAULT_CHAT_PROMPT = """你是 Askme 助手。本轮用户消息提供任务所需语料。语气：专业、清晰、中文 Markdown。

按本轮用户消息中的任务形态作答：

【问答】用户对照日报概览提问，消息中含「检索片段」。回复要求：
  - 请详细、有据地回答
  - 具体引用与忠实度要求见系统追加的硬性规则
  - 关键陈述后以内联编号标注出处（如 …[1][2]），风格类似 NotebookLM / Perplexity；禁止改成文末来源列表

【摘要】用户选定文章，消息中以 XML 提供「选定正文」，让你生成摘要。回复要求：
  - 紧扣正文，提炼关键事实、数据与结论；删去冗余背景与空话
  - 多篇若报道同一事件或主题，融合整理为连贯叙述，不要按文章逐篇复述
  - 仅使用原文信息，不编造
  - 关键陈述后以内联编号标注出处（如 …[1][2]），编号对应选定正文中的文章编号，风格同 NotebookLM / Perplexity；禁止改成文末来源列表"""

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
        from chat.chat_skill_registry import DEFAULT_DESCRIPTION, save_chat_skill
        from skills.skill_md import skill_meta_from_md

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
