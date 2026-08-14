"""数据源 Cookie 凭证池：按 slot 绑定，兼容旧版 ZHIHU_COOKIE。"""

from __future__ import annotations

from paths import DATA_DIR

import json
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any

from auth.auth_signals import (
    dump_dynamic_auth_slots,
    get_dynamic_slot_meta,
    list_dynamic_slot_metas,
    load_dynamic_auth_slots,
    normalize_host,
    register_auth_slot,
    resolve_slot_from_url,
    slot_id_from_host,
)
from onboarding.source_platform_scaffold import detect_platform

SECRETS_PATH = DATA_DIR / "integrations.json"
CREDENTIALS_KEY = "credentials"
ZHIHU_COOKIE_KEY = "zhihu_cookie"
AUTH_SLOT_DEFS_KEY = "auth_slot_defs"
_DEBUG_LOG_PATH = "/Users/zhuyuyao/Documents/llm应用/askme/.cursor/debug-fed963.log"


def _agent_log(
    location: str,
    message: str,
    data: dict[str, Any],
    *,
    hypothesis_id: str,
) -> None:
    # region agent log
    try:
        import json
        import time

        with open(_DEBUG_LOG_PATH, "a", encoding="utf-8") as fh:
            fh.write(
                json.dumps(
                    {
                        "sessionId": "fed963",
                        "location": location,
                        "message": message,
                        "data": data,
                        "hypothesisId": hypothesis_id,
                        "timestamp": int(time.time() * 1000),
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
    except Exception:
        pass
    # endregion

SLOT_DEFS: dict[str, dict[str, str]] = {
    "zhihu": {
        "label": "知乎",
        "login_url": "https://www.zhihu.com/signin",
        "cookie_hint": (
            "须真实登录后的完整 Cookie（至少含 d_c0 与 z_c0）。"
            "仅有 d_c0/__zse_ck 仍是访客态，文章列表 API 会 401/602。"
        ),
        "required_token": "d_c0=,z_c0=",
    },
    "x": {
        "label": "X",
        "login_url": "https://x.com/i/flow/login",
        "cookie_hint": (
            "须浏览器登录 x.com 后粘贴完整 Cookie（至少含 auth_token 与 ct0）。"
            "访客/未登录 Cookie 无效。"
        ),
        "required_token": "auth_token=,ct0=",
    },
    "goofish-com": {
        "label": "闲鱼",
        "login_url": "https://www.goofish.com/",
        "cookie_hint": (
            "须真实扫码登录后的完整 Cookie：同时含 unb、cookie2、_m_h5_tk。"
            "仅有 _m_h5_tk/tfstk 仍是访客态；请扫码确认后再等自动捕获或粘贴。"
        ),
        # 多字段：逗号分隔；_m_h5_tk 可匿名下发，必须配合 unb/cookie2 才算登录
        "required_token": "_m_h5_tk=,unb=,cookie2=",
    },
}

_ID_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$")


def mask_cookie(cookie: str) -> str:
    text = cookie.strip()
    if len(text) <= 16:
        return "*" * len(text)
    return f"{text[:8]}...{text[-8:]}"


def list_slots() -> list[dict[str, str]]:
    _ensure_dynamic_slots_loaded()
    merged: dict[str, dict[str, str]] = {
        slot_id: dict(meta) for slot_id, meta in SLOT_DEFS.items()
    }
    for slot_id, meta in list_dynamic_slot_metas().items():
        if slot_id not in merged:
            merged[slot_id] = meta
    return [
        {
            "id": slot_id,
            "label": meta.get("label") or slot_id,
            "login_url": meta.get("login_url") or "",
            "cookie_hint": meta.get("cookie_hint") or "粘贴该站点登录后的完整 Cookie",
        }
        for slot_id, meta in merged.items()
    ]


def get_slot_meta(slot: str) -> dict[str, str] | None:
    _ensure_dynamic_slots_loaded()
    slot_id = slot.strip().lower()
    meta = SLOT_DEFS.get(slot_id)
    if meta:
        return dict(meta)
    dynamic = get_dynamic_slot_meta(slot_id)
    return dict(dynamic) if dynamic else None


def ensure_slot_meta(
    slot: str,
    *,
    login_url: str = "",
    label: str = "",
    required_token: str = "",
    cookie_hint: str = "",
) -> dict[str, str]:
    """已知 slot 返回定义；未知 slot 登记动态占位（供 Agent 发现的新站）。"""
    _ensure_dynamic_slots_loaded()
    existing = get_slot_meta(slot)
    if existing and slot.strip().lower() in SLOT_DEFS:
        return existing
    if (
        existing
        and not login_url
        and not label
        and not required_token
        and not cookie_hint
    ):
        return existing
    slot_id = slot.strip().lower() or "custom"
    host = normalize_host(login_url) if login_url else ""
    meta = register_auth_slot(
        slot_id,
        login_url=login_url or (existing or {}).get("login_url") or "",
        label=label or (existing or {}).get("label") or host or slot_id,
        domains=[host] if host else None,
        required_token=required_token or (existing or {}).get("required_token") or "",
        cookie_hint=cookie_hint or (existing or {}).get("cookie_hint") or "",
    )
    _persist_dynamic_slots()
    return meta


def remember_auth_slot_for_url(
    url: str,
    *,
    slot: str | None = None,
    login_url: str = "",
    label: str = "",
) -> str:
    """接入中途需要授权时：登记 slot↔域名，便于预检与登录引导。"""
    _ensure_dynamic_slots_loaded()
    host = normalize_host(url)
    slot_id = (slot or "").strip().lower() or resolve_slot_from_url(url) or slot_id_from_host(url)
    ensure_slot_meta(
        slot_id,
        login_url=login_url or url,
        label=label or host or slot_id,
    )
    return slot_id


_dynamic_slots_loaded = False


def _ensure_dynamic_slots_loaded() -> None:
    global _dynamic_slots_loaded
    if _dynamic_slots_loaded:
        return
    data = _load_raw()
    load_dynamic_auth_slots(data.get(AUTH_SLOT_DEFS_KEY))
    _dynamic_slots_loaded = True


def _persist_dynamic_slots() -> None:
    data = _load_raw()
    data[AUTH_SLOT_DEFS_KEY] = dump_dynamic_auth_slots()
    _save_raw(data)


def _load_raw() -> dict[str, Any]:
    if not SECRETS_PATH.exists():
        return {}
    try:
        data = json.loads(SECRETS_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_raw(data: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SECRETS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _normalize_credential(raw: dict[str, Any]) -> dict[str, Any] | None:
    cred_id = str(raw.get("id") or "").strip()
    slot = str(raw.get("slot") or "").strip().lower()
    cookie = str(raw.get("cookie") or "").strip()
    if not cred_id or not slot or not cookie:
        return None
    slot_meta = get_slot_meta(slot) or {}
    label = str(raw.get("label") or "").strip() or str(slot_meta.get("label") or slot)
    return {
        "id": cred_id,
        "label": label,
        "slot": slot,
        "cookie": cookie,
        "created_at": float(raw.get("created_at") or 0) or time.time(),
        "updated_at": float(raw.get("updated_at") or 0) or time.time(),
    }


def _migrate_legacy(data: dict[str, Any]) -> bool:
    """把旧 zhihu_cookie 迁进 credentials；返回是否写入了变更。"""
    legacy = str(data.get(ZHIHU_COOKIE_KEY) or "").strip()
    if not legacy:
        return False
    creds = data.get(CREDENTIALS_KEY)
    if not isinstance(creds, list):
        creds = []
    has_zhihu = any(
        isinstance(item, dict) and str(item.get("slot") or "").strip().lower() == "zhihu"
        for item in creds
    )
    if has_zhihu:
        return False
    creds.append(
        {
            "id": "zhihu-legacy",
            "label": "知乎",
            "slot": "zhihu",
            "cookie": legacy,
            "created_at": time.time(),
            "updated_at": time.time(),
        }
    )
    data[CREDENTIALS_KEY] = creds
    return True


def list_credentials(*, include_cookie: bool = False) -> list[dict[str, Any]]:
    data = _load_raw()
    if _migrate_legacy(data):
        _save_raw(data)
        sync_runtime_cookies()
    raw_list = data.get(CREDENTIALS_KEY)
    if not isinstance(raw_list, list):
        return []
    result: list[dict[str, Any]] = []
    for item in raw_list:
        if not isinstance(item, dict):
            continue
        cred = _normalize_credential(item)
        if not cred:
            continue
        public = {
            "id": cred["id"],
            "label": cred["label"],
            "slot": cred["slot"],
            "masked": mask_cookie(cred["cookie"]),
            "created_at": cred["created_at"],
            "updated_at": cred["updated_at"],
            "slot_label": (get_slot_meta(cred["slot"]) or {}).get("label") or cred["slot"],
        }
        if include_cookie:
            public["cookie"] = cred["cookie"]
        result.append(public)
    result.sort(key=lambda item: (-float(item["updated_at"]), item["label"]))
    return result


def get_credential(cred_id: str, *, include_cookie: bool = False) -> dict[str, Any] | None:
    safe = cred_id.strip()
    for item in list_credentials(include_cookie=include_cookie):
        if item["id"] == safe:
            return item
    return None


def get_cookie_for_slot(slot: str) -> str:
    slot_id = slot.strip().lower()
    for item in list_credentials(include_cookie=True):
        if item["slot"] == slot_id:
            return str(item.get("cookie") or "").strip()
    if slot_id == "zhihu":
        return str(_load_raw().get(ZHIHU_COOKIE_KEY) or "").strip()
    return ""


def _required_token_keys(token: str) -> list[str]:
    """解析 required_token：支持单个或逗号/竖线分隔的多个键（可带 =）。"""
    text = (token or "").strip()
    if not text:
        return []
    keys: list[str] = []
    for part in re.split(r"[,|]+", text):
        key = part.strip().rstrip("=").strip()
        if key:
            keys.append(key)
    return keys


def cookie_has_required_token(cookie: str, token: str) -> bool:
    """校验 required_token 对应键均存在且值非空（可多字段）。"""
    keys = _required_token_keys(token)
    if not keys:
        return True
    present: set[str] = set()
    for part in (cookie or "").split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        name, value = part.split("=", 1)
        if name.strip() and value.strip():
            present.add(name.strip())
    return all(key in present for key in keys)


def missing_required_tokens(cookie: str, token: str) -> list[str]:
    keys = _required_token_keys(token)
    if not keys:
        return []
    present: set[str] = set()
    for part in (cookie or "").split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        name, value = part.split("=", 1)
        if name.strip() and value.strip():
            present.add(name.strip())
    return [key for key in keys if key not in present]


def cookie_satisfies_slot(slot: str, cookie: str) -> bool:
    meta = ensure_slot_meta(slot)
    text = (cookie or "").strip()
    if not text:
        return False
    token = str(meta.get("required_token") or "").strip()
    if token:
        return cookie_has_required_token(text, token)
    return "=" in text and len(text) >= 16


def slot_configured(slot: str) -> bool:
    return cookie_satisfies_slot(slot, get_cookie_for_slot(slot))


def validate_cookie_for_slot(slot: str, cookie: str, *, probe_url: str = "") -> None:
    meta = ensure_slot_meta(slot)
    text = cookie.strip()
    if not text:
        raise ValueError("Cookie 不能为空")
    token = str(meta.get("required_token") or "").strip()
    missing = missing_required_tokens(text, token) if token else []
    if missing:
        label = meta.get("label") or slot
        raise ValueError(
            f"Cookie 缺少有效的 {', '.join(missing)}，无法用于{label}（访客态无效）"
        )
    if not token and ("=" not in text or len(text) < 16):
        raise ValueError("Cookie 格式无效，请粘贴浏览器中的完整 Cookie 字符串")


def _new_id(slot: str) -> str:
    base = f"{slot}-{uuid.uuid4().hex[:8]}"
    return base if _ID_RE.match(base) else f"cred-{uuid.uuid4().hex[:10]}"


def upsert_credential(
    *,
    slot: str,
    cookie: str,
    label: str = "",
    cred_id: str | None = None,
    probe_url: str = "",
) -> dict[str, Any]:
    slot_id = slot.strip().lower()
    validate_cookie_for_slot(slot_id, cookie, probe_url=probe_url)
    data = _load_raw()
    _migrate_legacy(data)
    creds = data.get(CREDENTIALS_KEY)
    if not isinstance(creds, list):
        creds = []

    now = time.time()
    cookie_text = cookie.strip()
    display = (label or "").strip() or str(ensure_slot_meta(slot_id).get("label") or slot_id)

    # 同 slot 只保留一条：更新已有或新建
    existing_idx = next(
        (
            i
            for i, item in enumerate(creds)
            if isinstance(item, dict) and str(item.get("slot") or "").strip().lower() == slot_id
        ),
        None,
    )
    if cred_id:
        safe_id = cred_id.strip()
        idx = next(
            (
                i
                for i, item in enumerate(creds)
                if isinstance(item, dict) and str(item.get("id") or "").strip() == safe_id
            ),
            None,
        )
        if idx is None:
            raise ValueError("凭证不存在")
        existing_idx = idx
        target_id = safe_id
    elif existing_idx is not None:
        target_id = str(creds[existing_idx].get("id") or _new_id(slot_id))
    else:
        target_id = _new_id(slot_id)

    record = {
        "id": target_id,
        "label": display,
        "slot": slot_id,
        "cookie": cookie_text,
        "created_at": (
            float(creds[existing_idx].get("created_at") or now)
            if existing_idx is not None and isinstance(creds[existing_idx], dict)
            else now
        ),
        "updated_at": now,
    }

    if existing_idx is not None:
        next_creds = [
            item
            for i, item in enumerate(creds)
            if i == existing_idx
            or not (
                isinstance(item, dict)
                and str(item.get("slot") or "").strip().lower() == slot_id
            )
        ]
        for i, item in enumerate(next_creds):
            if isinstance(item, dict) and str(item.get("id") or "") == target_id:
                next_creds[i] = record
                break
        else:
            next_creds.append(record)
        creds = next_creds
    else:
        creds = [
            item
            for item in creds
            if not (
                isinstance(item, dict)
                and str(item.get("slot") or "").strip().lower() == slot_id
            )
        ]
        creds.append(record)

    data[CREDENTIALS_KEY] = creds
    if slot_id == "zhihu":
        data[ZHIHU_COOKIE_KEY] = cookie_text
    _save_raw(data)
    sync_runtime_cookies()
    return get_credential(target_id) or {
        "id": target_id,
        "label": display,
        "slot": slot_id,
        "masked": mask_cookie(cookie_text),
        "slot_label": ensure_slot_meta(slot_id).get("label") or slot_id,
    }


def delete_credential(cred_id: str) -> None:
    data = _load_raw()
    creds = data.get(CREDENTIALS_KEY)
    if not isinstance(creds, list):
        raise ValueError("凭证不存在")
    target = None
    next_creds = []
    for item in creds:
        if not isinstance(item, dict):
            continue
        if str(item.get("id") or "").strip() == cred_id.strip():
            target = item
            continue
        next_creds.append(item)
    if target is None:
        raise ValueError("凭证不存在")
    data[CREDENTIALS_KEY] = next_creds
    slot = str(target.get("slot") or "").strip().lower()
    if slot == "zhihu" and not any(
        isinstance(item, dict) and str(item.get("slot") or "").strip().lower() == "zhihu"
        for item in next_creds
    ):
        data.pop(ZHIHU_COOKIE_KEY, None)
    _save_raw(data)
    sync_runtime_cookies()


def sync_runtime_cookies() -> None:
    """把凭证注入环境变量，供 discovery 脚本读取。"""
    for key in list(os.environ.keys()):
        if key.startswith("ASKME_COOKIE_"):
            os.environ.pop(key, None)

    latest_generic = ""
    for item in list_credentials(include_cookie=True):
        slot = str(item.get("slot") or "").strip().lower()
        cookie = str(item.get("cookie") or "").strip()
        if not slot or not cookie:
            continue
        # 访客态等无效 Cookie 不注入，避免 skill 误用
        if not cookie_satisfies_slot(slot, cookie):
            continue
        env_key = f"ASKME_COOKIE_{slot.upper().replace('-', '_')}"
        os.environ[env_key] = cookie
        latest_generic = cookie
        if slot == "zhihu":
            os.environ["ZHIHU_COOKIE"] = cookie
            os.environ["ASKME_COOKIE_ZHIHU"] = cookie

    if latest_generic:
        os.environ["ASKME_COOKIE"] = latest_generic
    else:
        os.environ.pop("ASKME_COOKIE", None)

    if not get_cookie_for_slot("zhihu"):
        os.environ.pop("ZHIHU_COOKIE", None)
        os.environ.pop("ASKME_COOKIE_ZHIHU", None)


def _auth_item_for_slot(url: str, slot: str, *, platform: str | None = None) -> dict[str, Any]:
    meta = ensure_slot_meta(slot, login_url=url)
    configured = slot_configured(slot)
    cred = next((c for c in list_credentials() if c["slot"] == slot), None)
    # 登录窗口：默认打开用户入口页；部分平台必须用专用登录页
    slot_id = slot.strip().lower()
    if slot_id == "x":
        # 用官方登录流，避免打开博主页时被拦 / 显示不安全
        login_url = str(meta.get("login_url") or "https://x.com/i/flow/login")
    else:
        login_url = url or str(meta.get("login_url") or "")
    return {
        "entry_url": url,
        "requires_auth": True,
        "platform": platform or slot,
        "slot": slot,
        "slot_label": meta.get("label") or slot,
        "login_url": login_url,
        "cookie_hint": meta.get("cookie_hint") or "",
        "configured": configured,
        "credential_id": cred["id"] if cred else None,
        "credential_label": cred["label"] if cred else None,
        "masked": cred["masked"] if cred else "",
        "can_proceed": configured,
    }


def precheck_entry_urls(entry_urls: list[str]) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    missing_slots: list[str] = []
    seen_missing: set[str] = set()

    for raw in entry_urls:
        url = (raw or "").strip()
        if not url:
            continue

        match = detect_platform(url)
        slot = None
        if match and match.requires_cookie:
            slot = match.platform
        elif not (match and match.platform and not match.requires_cookie):
            # 已知平台且 Cookie 可选（如 Reddit）→ 不因动态 auth_slot 强制预检登录
            slot = resolve_slot_from_url(url)

        # region agent log
        _agent_log(
            "credential_store.py:precheck_entry_urls",
            "precheck slot resolution",
            {
                "entry_url": url,
                "platform": match.platform if match else None,
                "platform_requires_cookie": bool(match and match.requires_cookie),
                "resolved_slot": slot,
                "slot_configured": slot_configured(slot) if slot else None,
            },
            hypothesis_id="B",
        )
        # endregion

        if not slot:
            items.append(
                {
                    "entry_url": url,
                    "requires_auth": False,
                    "platform": match.platform if match else None,
                    "slot": None,
                    "configured": True,
                    "can_proceed": True,
                }
            )
            continue

        item = _auth_item_for_slot(
            url,
            slot,
            platform=match.platform if match else slot,
        )
        items.append(item)
        if not item["configured"] and slot not in seen_missing:
            seen_missing.add(slot)
            missing_slots.append(slot)

    return {
        "items": items,
        "missing_slots": missing_slots,
        "can_proceed": len(missing_slots) == 0,
        "slots": list_slots(),
    }
