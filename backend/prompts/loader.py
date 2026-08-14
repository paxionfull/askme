"""Prompt 文件加载与渲染（backend/prompts/*.md）。"""

from __future__ import annotations

from pathlib import Path
from string import Template

PROMPTS_DIR = Path(__file__).resolve().parent


def load_prompt(prompt_id: str) -> str:
    """读取 ``backend/prompts/{prompt_id}.md``，去掉首尾空白。"""
    path = PROMPTS_DIR / f"{prompt_id}.md"
    if not path.is_file():
        raise FileNotFoundError(f"prompt 不存在: {path}")
    return path.read_text(encoding="utf-8").strip()


def render_prompt(prompt_id: str, **kwargs: object) -> str:
    """用 ``$var`` / ``${var}`` 渲染模板（避免与 Markdown `{}` 冲突）。

    第一参数是文件 stem，勿占用 ``name`` 等常见模板变量名。
    """
    return Template(load_prompt(prompt_id)).safe_substitute(**kwargs).strip()
