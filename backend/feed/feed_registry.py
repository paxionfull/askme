"""用户级数据源配置：隐藏（软删除）与分组。"""

from __future__ import annotations

from paths import DATA_DIR

import json
import re
import uuid
from pathlib import Path
from typing import Any

REGISTRY_PATH = DATA_DIR / "feed_registry.json"
GROUP_ID_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$")
UNGROUPED_GROUP_ID = "__ungrouped__"
SYSTEM_GROUP_IDS = {UNGROUPED_GROUP_ID}

DEFAULT_REGISTRY: dict[str, Any] = {
    "hidden_feed_ids": [],
    "groups": [],
    "group_order": [],
    "feed_display_names": {},
    "platform_accounts": {},
    "default_digest_skill": "general-digest",
    # 已见过的网站类 skill feed_id；新出现的默认 hide，不自动进用户源
    "known_website_feed_ids": [],
    # 一次性：把历史上自动出现的网站类内置源从用户源/分组拆掉
    "website_skills_detached_v1": False,
}

# 已知多账号平台：一平台一 skill，账号参数存在 platform_accounts
PLATFORM_IDS = frozenset({"zhihu", "reddit", "x"})


def _normalize_platform_account(raw: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    feed_id = str(raw.get("feed_id") or "").strip()
    platform = str(raw.get("platform") or "").strip().lower()
    account_key = str(raw.get("account_key") or "").strip()
    if not feed_id or not platform or not account_key:
        return None
    if platform not in PLATFORM_IDS:
        return None
    return {
        "feed_id": _normalize_feed_id(feed_id),
        "platform": platform,
        "account_key": account_key,
        "user_type": str(raw.get("user_type") or "").strip(),
        "entry_url": str(raw.get("entry_url") or "").strip(),
        "posts_url": str(raw.get("posts_url") or "").strip(),
        "display_name": str(raw.get("display_name") or "").strip(),
        "list_api_path": str(raw.get("list_api_path") or "").strip(),
        "slug": str(raw.get("slug") or "").strip(),
        "xsec_token": str(raw.get("xsec_token") or "").strip(),
    }


def _normalize_platform_accounts(raw: Any) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    if not isinstance(raw, dict):
        return result
    for key, value in raw.items():
        item = _normalize_platform_account(value if isinstance(value, dict) else {})
        if not item:
            continue
        fid = item["feed_id"]
        # 允许 key 与 feed_id 不一致时以记录内 feed_id 为准
        if str(key).strip() and str(key).strip() != fid:
            item = {**item, "feed_id": fid}
        result[fid] = item
    return result


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
        # 缺省 True：兼容旧数据，避免定时刷新突然停掉；新建分组由前端显式传 false
        auto_refresh = True if "auto_refresh" not in raw else bool(raw.get("auto_refresh"))
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
                "auto_refresh": auto_refresh,
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
        raw_display_names = data.get("feed_display_names")
        display_names: dict[str, str] = {}
        if isinstance(raw_display_names, dict):
            for key, value in raw_display_names.items():
                fid = str(key).strip()
                name = str(value).strip()
                if fid and name:
                    display_names[fid] = name
        raw_known = data.get("known_website_feed_ids")
        known_website: list[str] = []
        if isinstance(raw_known, list):
            for item in raw_known:
                value = str(item).strip()
                if value:
                    known_website.append(_normalize_feed_id(value))
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
            "feed_display_names": display_names,
            "platform_accounts": _normalize_platform_accounts(data.get("platform_accounts")),
            "default_digest_skill": str(data.get("default_digest_skill") or "general-digest").strip(),
            "known_website_feed_ids": known_website,
            "website_skills_detached_v1": bool(data.get("website_skills_detached_v1")),
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

    @property
    def known_website_feed_ids(self) -> set[str]:
        return set(self._data.get("known_website_feed_ids") or [])

    def set_known_website_feed_ids(self, feed_ids: set[str] | list[str]) -> None:
        normalized: list[str] = []
        seen: set[str] = set()
        for item in feed_ids:
            fid = _normalize_feed_id(str(item))
            if fid in seen:
                continue
            seen.add(fid)
            normalized.append(fid)
        self._data["known_website_feed_ids"] = normalized
        self.save()

    @property
    def website_skills_detached_v1(self) -> bool:
        return bool(self._data.get("website_skills_detached_v1"))

    def mark_website_skills_detached_v1(self) -> None:
        self._data["website_skills_detached_v1"] = True
        self.save()

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

    def purge_feed(self, feed_id: str) -> None:
        """彻底移除数据源登记：清 hidden，并从分组中剔除。

        用于「同时删除 skill」场景。此时不应再 hide——否则重接时会误报「数据源已移除」。
        """
        fid = _normalize_feed_id(feed_id)
        hidden = [item for item in (self._data.get("hidden_feed_ids") or []) if item != fid]
        self._data["hidden_feed_ids"] = hidden
        self._remove_feed_from_groups(fid)
        names = dict(self._data.get("feed_display_names") or {})
        names.pop(fid, None)
        self._data["feed_display_names"] = names
        accounts = dict(self._data.get("platform_accounts") or {})
        accounts.pop(fid, None)
        self._data["platform_accounts"] = accounts
        known = [item for item in (self._data.get("known_website_feed_ids") or []) if item != fid]
        self._data["known_website_feed_ids"] = known
        self.save()

    def list_platform_accounts(self) -> dict[str, dict[str, Any]]:
        return {
            fid: dict(account)
            for fid, account in (self._data.get("platform_accounts") or {}).items()
        }

    def get_platform_account(self, feed_id: str) -> dict[str, Any] | None:
        fid = _normalize_feed_id(feed_id)
        account = (self._data.get("platform_accounts") or {}).get(fid)
        return dict(account) if isinstance(account, dict) else None

    def upsert_platform_account(self, account: dict[str, Any]) -> dict[str, Any]:
        item = _normalize_platform_account(account)
        if not item:
            raise ValueError("无效的平台账号配置")
        accounts = dict(self._data.get("platform_accounts") or {})
        accounts[item["feed_id"]] = item
        self._data["platform_accounts"] = accounts
        display = item.get("display_name") or ""
        if display:
            names = dict(self._data.get("feed_display_names") or {})
            names[item["feed_id"]] = display
            self._data["feed_display_names"] = names
        # 重新接入时确保可见
        hidden = [x for x in (self._data.get("hidden_feed_ids") or []) if x != item["feed_id"]]
        self._data["hidden_feed_ids"] = hidden
        self.save()
        return dict(item)

    def remove_platform_account(self, feed_id: str) -> bool:
        fid = _normalize_feed_id(feed_id)
        accounts = dict(self._data.get("platform_accounts") or {})
        if fid not in accounts:
            return False
        accounts.pop(fid, None)
        self._data["platform_accounts"] = accounts
        self.save()
        return True

    def is_platform_feed(self, feed_id: str) -> bool:
        return self.get_platform_account(feed_id) is not None

    def display_name_for_feed(self, feed_id: str) -> str | None:
        fid = _normalize_feed_id(feed_id)
        names = self._data.get("feed_display_names") or {}
        value = str(names.get(fid, "")).strip()
        return value or None

    def set_feed_display_name(self, feed_id: str, name: str) -> str:
        fid = _normalize_feed_id(feed_id)
        label = name.strip()
        if not label:
            raise ValueError("名称不能为空")
        names = dict(self._data.get("feed_display_names") or {})
        names[fid] = label
        self._data["feed_display_names"] = names
        self.save()
        return label

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

    def assign_feed_to_group(self, feed_id: str, group_id: str | None) -> None:
        fid = _normalize_feed_id(feed_id)
        gid = (group_id or "").strip().lower()
        self._remove_feed_from_groups(fid)
        if not gid or gid == UNGROUPED_GROUP_ID:
            self.save()
            return

        gid = _normalize_group_id(gid)
        groups = self._data.get("groups") or []
        for group in groups:
            if str(group.get("id", "")) == gid:
                feed_ids = [item for item in (group.get("feed_ids") or []) if item != fid]
                feed_ids.append(fid)
                group["feed_ids"] = feed_ids
                self.save()
                return
        raise ValueError(f"分组不存在: {group_id}")


feed_registry = FeedRegistry()
