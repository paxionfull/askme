"""Digest 结构化配置（重点 / 分类 / 不重要）。"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

OTHER_CATEGORY_ID = "other"
IGNORED_CATEGORY_ID = "ignored"
FOCUS_BUCKET_ID = "__focus__"

_ID_RE = re.compile(r"^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$", re.I)


def _slug(value: str, *, fallback: str) -> str:
    text = re.sub(r"[^a-z0-9]+", "-", (value or "").strip().lower())
    text = text.strip("-")
    if not text:
        text = fallback
    if not _ID_RE.match(text):
        text = fallback
    return text[:64]


def default_profile() -> dict[str, Any]:
    return {
        "version": 1,
        "input_mode": "titles",
        "focus": {
            "enabled": True,
            "criteria": "",
            "max_events": 10,
            "exclusive": True,
        },
        "categories": [],
        "ignore": {
            "criteria": "",
        },
        "cluster": {
            "enabled": True,
        },
    }


def normalize_profile(raw: dict[str, Any] | None) -> dict[str, Any]:
    base = default_profile()
    if not isinstance(raw, dict):
        return base

    focus_raw = raw.get("focus") if isinstance(raw.get("focus"), dict) else {}
    ignore_raw = raw.get("ignore") if isinstance(raw.get("ignore"), dict) else {}
    cluster_raw = raw.get("cluster") if isinstance(raw.get("cluster"), dict) else {}

    categories: list[dict[str, str]] = []
    seen: set[str] = set()
    for index, item in enumerate(raw.get("categories") or []):
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        cat_id = str(item.get("id") or "").strip() or _slug(name, fallback=f"cat-{index + 1}")
        cat_id = _slug(cat_id, fallback=f"cat-{index + 1}")
        if cat_id in {OTHER_CATEGORY_ID, IGNORED_CATEGORY_ID, FOCUS_BUCKET_ID}:
            cat_id = f"{cat_id}-{index + 1}"
        if cat_id in seen:
            cat_id = f"{cat_id}-{index + 1}"
        seen.add(cat_id)
        categories.append(
            {
                "id": cat_id,
                "name": name,
                "criteria": str(item.get("criteria") or "").strip(),
            }
        )

    input_mode = str(raw.get("input_mode") or base["input_mode"]).strip() or "titles"
    if input_mode not in {"titles", "full"}:
        input_mode = "titles"

    max_events = focus_raw.get("max_events", base["focus"]["max_events"])
    try:
        max_events_i = max(1, min(50, int(max_events)))
    except (TypeError, ValueError):
        max_events_i = 10

    return {
        "version": 1,
        "input_mode": input_mode,
        "focus": {
            "enabled": bool(focus_raw.get("enabled", True)),
            "criteria": str(focus_raw.get("criteria") or "").strip(),
            "max_events": max_events_i,
            "exclusive": bool(focus_raw.get("exclusive", True)),
        },
        "categories": categories,
        "ignore": {
            "criteria": str(ignore_raw.get("criteria") or "").strip(),
        },
        "cluster": {
            "enabled": bool(cluster_raw.get("enabled", True)),
        },
    }


def classification_labels(profile: dict[str, Any]) -> list[dict[str, str]]:
    """第 ① 步可用的全部类别（含其他、不重要）。"""
    labels = [
        {
            "id": item["id"],
            "name": item["name"],
            "criteria": item.get("criteria") or "",
        }
        for item in profile.get("categories") or []
    ]
    labels.append(
        {
            "id": OTHER_CATEGORY_ID,
            "name": "其他",
            "criteria": "无法归入以上类别的内容",
        }
    )
    ignore_criteria = str((profile.get("ignore") or {}).get("criteria") or "").strip()
    labels.append(
        {
            "id": IGNORED_CATEGORY_ID,
            "name": "不重要",
            "criteria": ignore_criteria or "广告、软广、无实质信息、与主题无关的内容",
        }
    )
    return labels


def load_profile_from_dir(skill_dir: Path) -> dict[str, Any] | None:
    path = skill_dir / "digest_profile.json"
    if not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(raw, dict):
        return None
    return normalize_profile(raw)


def save_profile_to_dir(skill_dir: Path, profile: dict[str, Any]) -> dict[str, Any]:
    skill_dir.mkdir(parents=True, exist_ok=True)
    normalized = normalize_profile(profile)
    path = skill_dir / "digest_profile.json"
    path.write_text(
        json.dumps(normalized, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return normalized


def article_ref_id(feed_id: str, article_id: str) -> str:
    return f"{feed_id}::{article_id}"


def split_article_ref_id(ref_id: str) -> tuple[str, str]:
    feed_id, sep, article_id = (ref_id or "").partition("::")
    if not sep:
        return "", ref_id
    return feed_id, article_id
