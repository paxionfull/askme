"""Cursor 接入 / 修复 prompt 的注入配额（集中配置，避免散落 magic number）。"""

from __future__ import annotations

# Cursor run 结果写入日志时的预览长度
PROMPT_CURSOR_RESULT_PREVIEW_CHARS = 4000

# 修复 prompt：当前损坏文件的截断（实例状态，非规范文档）
PROMPT_REPAIR_DISCOVER_MAX_CHARS = 12000
PROMPT_REPAIR_YAML_MAX_CHARS = 4000
PROMPT_REPAIR_SKILL_MD_MAX_CHARS = 4000

# 验证失败后 Cursor 自动修复轮数（含首次验证）
DEFAULT_MAX_REPAIR_ATTEMPTS = 4
