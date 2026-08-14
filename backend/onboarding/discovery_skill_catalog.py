"""动态维护 discovery skill 参考目录（name / description / path），供接入 Agent 选型。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from paths import DISCOVERY_SKILLS_ROOT, SKILLS_LIB
from skills.skill_md import skill_meta_from_md

# 写入仓库内，IDE 手动接入与 Cursor SDK 均可读到同一份表
CATALOG_PATH = SKILLS_LIB / "DISCOVERY_SKILL_CATALOG.md"

# 不作为「结构参考」候选的目录名（完整目录名）
_SKIP_DIR_NAMES = frozenset()


def _is_complete_discover_script(skill_dir: Path) -> bool:
    script = skill_dir / "scripts" / "discover.py"
    if not script.is_file():
        return False
    try:
        text = script.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return False
    return "fetch_list_page" in text and "fetch_article_detail" in text


def list_discovery_skill_catalog(
    *,
    exclude_slug: str = "",
) -> list[dict[str, str]]:
    """扫描 `skills/discovery/*-discovery/`，返回可作参考的 skill 条目。"""
    items: list[dict[str, str]] = []
    if not DISCOVERY_SKILLS_ROOT.is_dir():
        return items

    exclude = (exclude_slug or "").strip().lower()
    for skill_dir in sorted(DISCOVERY_SKILLS_ROOT.iterdir()):
        if not skill_dir.is_dir() or not skill_dir.name.endswith("-discovery"):
            continue
        if skill_dir.name in _SKIP_DIR_NAMES:
            continue
        if not _is_complete_discover_script(skill_dir):
            continue

        slug = skill_dir.name[: -len("-discovery")]
        if exclude and slug.lower() == exclude:
            continue

        skill_md_path = skill_dir / "SKILL.md"
        if skill_md_path.is_file():
            try:
                md = skill_md_path.read_text(encoding="utf-8")
            except OSError:
                md = ""
        else:
            md = ""
        name, description = skill_meta_from_md(md, fallback_id=slug)
        description = " ".join(description.split())
        rel_path = f"skills/discovery/{skill_dir.name}/"
        items.append(
            {
                "name": name or slug,
                "slug": slug,
                "description": description,
                "path": rel_path,
            }
        )
    return items


def format_discovery_skill_catalog_markdown(
    entries: list[dict[str, str]] | None = None,
    *,
    exclude_slug: str = "",
) -> str:
    """格式化为 Markdown 表，供 prompt / 落盘。"""
    rows = entries if entries is not None else list_discovery_skill_catalog(
        exclude_slug=exclude_slug
    )
    lines = [
        "# Discovery skill 参考目录（动态）",
        "",
        "接入未知站时：**必须**从下表按 name/description 选出 ≥2 个形态最接近的 skill，",
        "再打开其 `path` 下的 `scripts/discover.py` 与 `source.yaml` 学习结构；",
        "**禁止** `ls` 全目录碰运气，**禁止**照搬 URL/字段。",
        "",
        "| name | description | path |",
        "| --- | --- | --- |",
    ]
    if not rows:
        lines.append("| _(empty)_ | 暂无完整 discovery skill | — |")
    else:
        for item in rows:
            name = _md_cell(item.get("name") or "")
            desc = _md_cell(item.get("description") or "")
            path = _md_cell(item.get("path") or "")
            lines.append(f"| {name} | {desc} | {path} |")
    lines.append("")
    return "\n".join(lines)


def _md_cell(value: str) -> str:
    return str(value or "").replace("|", "\\|").replace("\n", " ").strip()


def write_discovery_skill_catalog(*, exclude_slug: str = "") -> Path:
    """刷新 `_lib/DISCOVERY_SKILL_CATALOG.md`（全量，不含 exclude；exclude 仅用于 prompt）。"""
    # 落盘始终全量，方便 IDE；exclude 只在 format 给 prompt 时用
    del exclude_slug
    text = format_discovery_skill_catalog_markdown()
    CATALOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CATALOG_PATH.write_text(text, encoding="utf-8")
    return CATALOG_PATH


def catalog_for_onboarding_prompt(*, exclude_slug: str = "") -> dict[str, Any]:
    """接入 prompt 用：条目 + markdown；并刷新落盘全量表。"""
    write_discovery_skill_catalog()
    entries = list_discovery_skill_catalog(exclude_slug=exclude_slug)
    markdown = format_discovery_skill_catalog_markdown(entries)
    return {
        "entries": entries,
        "markdown": markdown,
        "catalog_path": "skills/discovery/_lib/DISCOVERY_SKILL_CATALOG.md",
        "count": len(entries),
    }
