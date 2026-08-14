"""用户级数据源配置：隐藏（软删除）与分组。"""

from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
REGISTRY_PATH = DATA_DIR / "feed_registry.json"
GROUP_ID_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$")
UNGROUPED_GROUP_ID = "__ungrouped__"
SYSTEM_GROUP_IDS = {UNGROUPED_GROUP_ID}

DEFAULT_REGISTRY: dict[str, Any] = {
    "hidden_feed_ids": [],
    "groups": [],
    "group_order": [],
    "default_digest_skill": "general-digest",
}


def _normalize_feed_id(feed_id: str) -> str:
    value = feed_id.strip()
    if not value:
        raise ValueError("feed_id 不能为空")
    return value


def _normalize_group_id(group_id: str) -> str:
    value = group_id.strip().lower()
    if not value or not GROUP_ID_PATTERN.match(value):
        raise ValueError(f"无效的分组 id: {group_id}")
    return value


def _normalize_groups(groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    assigned_feeds: set[str] = set()

    for raw in groups:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name", "")).strip()
        if not name:
            continue
        group_id = str(raw.get("id", "")).strip().lower() or f"group-{uuid.uuid4().hex[:8]}"
        group_id = _normalize_group_id(group_id)
        if group_id in SYSTEM_GROUP_IDS:
            continue
        if group_id in seen_ids:
            continue
        seen_ids.add(group_id)

        feed_ids: list[str] = []
        digest_skill_id = str(raw.get("digest_skill_id") or "").strip()
        for feed_id in raw.get("feed_ids") or []:
            fid = _normalize_feed_id(str(feed_id))
            if fid in assigned_feeds:
                continue
            assigned_feeds.add(fid)
            feed_ids.append(fid)

        normalized.append(
            {
                "id": group_id,
                "name": name,
                "feed_ids": feed_ids,
                "digest_skill_id": digest_skill_id or None,
            }
        )
    return normalized


def _normalize_group_order(order: list[Any], groups: list[dict[str, Any]]) -> list[str]:
    valid_ids = {str(group.get("id", "")) for group in groups}
    normalized: list[str] = []
    seen: set[str] = set()
    for item in order:
        group_id = str(item).strip().lower()
        if group_id in SYSTEM_GROUP_IDS or group_id not in valid_ids or group_id in seen:
            continue
        seen.add(group_id)
        normalized.append(group_id)
    for group in groups:
        group_id = str(group.get("id", ""))
        if group_id and group_id not in seen:
            normalized.append(group_id)
    return normalized


class FeedRegistry:
    def __init__(self, path: Path | None = None):
        self.path = path or REGISTRY_PATH
        self._data = self._load()

    def _load(self) -> dict[str, Any]:
        if not self.path.is_file():
            return json.loads(json.dumps(DEFAULT_REGISTRY))
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return json.loads(json.dumps(DEFAULT_REGISTRY))
        if not isinstance(data, dict):
            return json.loads(json.dumps(DEFAULT_REGISTRY))
        hidden = data.get("hidden_feed_ids")
        groups = data.get("groups")
        group_order = data.get("group_order")
        normalized_groups = _normalize_groups(groups if isinstance(groups, list) else [])
        return {
            "hidden_feed_ids": [
                _normalize_feed_id(str(item))
                for item in (hidden if isinstance(hidden, list) else [])
                if str(item).strip()
            ],
            "groups": normalized_groups,
            "group_order": _normalize_group_order(
                group_order if isinstance(group_order, list) else [],
                normalized_groups,
            ),
            "default_digest_skill": str(data.get("default_digest_skill") or "general-digest").strip(),
        }

    def reload(self) -> None:
        self._data = self._load()

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps(self._data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    @property
    def hidden_feed_ids(self) -> set[str]:
        return set(self._data.get("hidden_feed_ids") or [])

    def is_hidden(self, feed_id: str) -> bool:
        return _normalize_feed_id(feed_id) in self.hidden_feed_ids

    def hide_feed(self, feed_id: str) -> None:
        fid = _normalize_feed_id(feed_id)
        hidden = list(self._data.get("hidden_feed_ids") or [])
        if fid not in hidden:
            hidden.append(fid)
        self._data["hidden_feed_ids"] = hidden
        self._remove_feed_from_groups(fid)
        self.save()

    def unhide_feed(self, feed_id: str) -> None:
        fid = _normalize_feed_id(feed_id)
        hidden = [item for item in (self._data.get("hidden_feed_ids") or []) if item != fid]
        self._data["hidden_feed_ids"] = hidden
        self.save()

    def default_digest_skill(self) -> str:
        return str(self._data.get("default_digest_skill") or "general-digest").strip()

    def set_default_digest_skill(self, skill_id: str) -> str:
        self._data["default_digest_skill"] = skill_id.strip()
        self.save()
        return self.default_digest_skill

    def list_groups(self) -> list[dict[str, Any]]:
        return [dict(group) for group in self._data.get("groups") or []]

    def list_group_order(self) -> list[str]:
        return list(self._data.get("group_order") or [])

    def group_id_for_feed(self, feed_id: str) -> str | None:
        fid = _normalize_feed_id(feed_id)
        for group in self._data.get("groups") or []:
            if fid in (group.get("feed_ids") or []):
                return str(group.get("id"))
        return None

    def set_groups(self, groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return self.set_layout(groups, self.list_group_order())[0]

    def set_layout(
        self,
        groups: list[dict[str, Any]],
        group_order: list[str] | None = None,
    ) -> tuple[list[dict[str, Any]], list[str]]:
        normalized = _normalize_groups(groups)
        order = _normalize_group_order(group_order or [], normalized)
        self._data["groups"] = normalized
        self._data["group_order"] = order
        self.save()
        return [dict(group) for group in normalized], list(order)

    def _remove_feed_from_groups(self, feed_id: str) -> None:
        fid = _normalize_feed_id(feed_id)
        updated: list[dict[str, Any]] = []
        for group in self._data.get("groups") or []:
            feed_ids = [item for item in (group.get("feed_ids") or []) if item != fid]
            updated.append({**group, "feed_ids": feed_ids})
        self._data["groups"] = updated


feed_registry = FeedRegistry()
