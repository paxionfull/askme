"""SKILL.md frontmatter 解析。"""

from __future__ import annotations

import re


def strip_frontmatter(markdown: str) -> str:
    if not markdown.startswith("---"):
        return markdown
    end = markdown.find("\n---", 3)
    if end == -1:
        return markdown
    return markdown[end + 4 :].lstrip("\n")


def parse_skill_frontmatter(markdown: str) -> dict[str, str]:
    if not markdown.startswith("---"):
        return {}
    lines = markdown.splitlines()
    if len(lines) < 2 or lines[0].strip() != "---":
        return {}

    result: dict[str, str] = {}
    current_key: str | None = None
    block_lines: list[str] = []
    block_fold = False

    def flush() -> None:
        nonlocal current_key, block_lines, block_fold
        if current_key is None:
            return
        if block_lines:
            value = "\n".join(block_lines).strip()
        else:
            value = ""
        result[current_key] = value
        current_key = None
        block_lines = []
        block_fold = False

    idx = 1
    while idx < len(lines):
        line = lines[idx]
        if line.strip() == "---":
            flush()
            break

        if current_key is not None:
            if re.match(r"^[\w-]+:\s*", line):
                flush()
                continue
            if block_fold:
                block_lines.append(line.strip())
            else:
                block_lines.append(line.rstrip())
            idx += 1
            continue

        match = re.match(r"^([\w-]+):\s*(.*)$", line)
        if not match:
            idx += 1
            continue

        key, value = match.group(1), match.group(2).strip()
        if value in {">", ">-", "|", "|-"}:
            current_key = key
            block_fold = value.startswith(">")
            block_lines = []
        elif value:
            result[key] = value.strip('"').strip("'")
        else:
            current_key = key
            block_fold = True
            block_lines = []
        idx += 1

    return result


def skill_meta_from_md(markdown: str, *, fallback_id: str = "") -> tuple[str, str]:
    meta = parse_skill_frontmatter(markdown)
    name = str(meta.get("name") or fallback_id).strip()
    description = str(meta.get("description") or "").strip()
    return name, description


def is_stub_skill_body(body: str, legacy_prompt: str = "") -> bool:
    """SKILL.md 正文仅为占位（标题+一句描述）时视为 stub，运行时应回退 legacy。"""
    text = body.strip()
    if not text:
        return True
    if not legacy_prompt.strip():
        return False
    lines = [line for line in text.splitlines() if line.strip()]
    return len(lines) <= 3 and len(text) < 160


def resolve_skill_instructions(
    skill_md: str,
    *,
    legacy_prompt: str = "",
    fallback: str = "",
) -> str:
    """从 SKILL.md 解析运行时指令：正文优先；stub 时用 legacy；否则 fallback。"""
    body = strip_frontmatter(skill_md).strip()
    legacy = legacy_prompt.strip()
    if is_stub_skill_body(body, legacy) and legacy:
        return legacy
    return body or legacy or fallback
