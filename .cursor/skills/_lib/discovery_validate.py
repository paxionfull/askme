#!/usr/bin/env python3
"""验证 *-discovery skill：列表 + 详情 + 正文。"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

SKILLS_ROOT = Path(__file__).resolve().parent.parent
DISCOVER_SCRIPT = Path("scripts") / "discover.py"
MIN_LIST_ITEMS = 1
MIN_BODY_CHARS = 80


def _load_module(skill_dir: Path):
    script = skill_dir / DISCOVER_SCRIPT
    if not script.is_file():
        raise FileNotFoundError(f"缺少 discover.py: {script}")

    lib_root = SKILLS_ROOT / "_lib"
    for path in (lib_root, SKILLS_ROOT):
        path_str = str(path)
        if path_str not in sys.path:
            sys.path.insert(0, path_str)

    module_name = f"askme_validate_{skill_dir.name.replace('-', '_')}"
    spec = importlib.util.spec_from_file_location(module_name, script)
    if spec is None or spec.loader is None:
        raise ImportError(f"无法加载 {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def _min_body_chars_for(skill_dir: Path) -> int:
    source_yaml = skill_dir / "source.yaml"
    if not source_yaml.is_file():
        return MIN_BODY_CHARS
    text = source_yaml.read_text(encoding="utf-8")
    match = re.search(r"^\s*min_body_chars:\s*(\d+)\s*$", text, re.MULTILINE)
    if match:
        return max(1, int(match.group(1)))
    return MIN_BODY_CHARS


def validate_skill(slug: str, *, min_items: int = MIN_LIST_ITEMS) -> dict:
    skill_dir = SKILLS_ROOT / f"{slug}-discovery"
    if not skill_dir.is_dir():
        raise FileNotFoundError(f"未找到 skill 目录: {skill_dir.name}")

    module = _load_module(skill_dir)
    required = (
        "fetch_list_page",
        "list_items",
        "has_next_page",
        "normalize_list_item",
        "fetch_article_detail",
    )
    missing = [name for name in required if not hasattr(module, name)]
    if missing:
        raise ValueError(f"discover.py 缺少接口: {', '.join(missing)}")

    payload = module.fetch_list_page(1, 5)
    items = module.list_items(payload)
    if len(items) < min_items:
        raise ValueError(f"列表文章数不足: {len(items)} < {min_items}")

    normalized = [module.normalize_list_item(item) for item in items[: min(len(items), 3)]]
    for article in normalized:
        for key in ("id", "title", "url", "published_at"):
            if not str(article.get(key, "")).strip():
                raise ValueError(f"列表项缺少字段 {key}: {article}")

    sample_id = normalized[0]["id"]
    detail = module.fetch_article_detail(sample_id)
    html = str(detail.get("content_html", "") or "")
    plain_len = len(html.strip())
    min_body_chars = _min_body_chars_for(skill_dir)
    if plain_len < min_body_chars:
        raise ValueError(
            f"正文过短或为空（{plain_len} 字符，要求 ≥{min_body_chars}），请检查 fetch_article_detail"
        )

    normalize_body = getattr(module, "normalize_article_body", None)
    cleaned_len = plain_len
    if callable(normalize_body):
        cleaned = normalize_body(html, article_id=sample_id)
        cleaned_len = len(str(cleaned or "").strip())

    return {
        "ok": True,
        "slug": slug,
        "feed_id": getattr(module, "FEED_ID", ""),
        "list_count": len(items),
        "sample_id": sample_id,
        "sample_title": normalized[0].get("title", ""),
        "body_chars": plain_len,
        "cleaned_body_chars": cleaned_len,
        "has_next_page": bool(module.has_next_page(payload)),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="验证 discovery skill")
    parser.add_argument("slug", help="skill slug，如 qbitai、jiqizhixin")
    parser.add_argument("--min-items", type=int, default=MIN_LIST_ITEMS)
    args = parser.parse_args()
    try:
        result = validate_skill(args.slug, min_items=args.min_items)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
