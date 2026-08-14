"""登录墙 / Cookie 需求判定（预检名单 + 运行时信号）。"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

# 已知需要登录的域名 → slot
DOMAIN_AUTH_SLOTS: dict[str, str] = {
    "zhihu.com": "zhihu",
    "zhimg.com": "zhihu",
    "goofish.com": "goofish-com",
    "x.com": "x",
    "twitter.com": "x",
}

# Agent / 接入中途登记的动态 slot（域名 → slot）；由 register_auth_slot 维护
_DYNAMIC_DOMAIN_SLOTS: dict[str, str] = {}
_DYNAMIC_SLOT_META: dict[str, dict[str, str]] = {}

AUTH_ERROR_MARKERS = (
    "askme_auth_required",
    "requires_cookie",
    "requires_auth",
    "需要登录",
    "请先登录",
    "未登录",
    "登录后",
    "login required",
    "sign in",
    "signin",
    "unauthorized",
    "auth_required",
    "cookie",
    "403",
    "401",
    "扫码登录",
    "验证码",
    "captcha",
    "anti_bot",
    "account/unhuman",
    "passport",
)

LOGIN_WALL_BODY_MARKERS = (
    "请先登录",
    "立即登录",
    "扫码登录",
    "login",
    "sign in",
    "signin",
    "未登录",
    "登录后查看",
    "登录后可见",
    "passport",
    "captcha",
    "验证码",
)


def normalize_host(url_or_host: str) -> str:
    text = (url_or_host or "").strip().lower()
    if not text:
        return ""
    if "://" not in text:
        host = text.split("/")[0]
    else:
        host = urlparse(text).netloc.lower()
    return host.replace("www.", "")


def resolve_slot_from_url(url: str) -> str | None:
    host = normalize_host(url)
    if not host:
        return None
    for domain, slot in DOMAIN_AUTH_SLOTS.items():
        if host == domain or host.endswith("." + domain):
            return slot
    for domain, slot in _DYNAMIC_DOMAIN_SLOTS.items():
        if host == domain or host.endswith("." + domain):
            return slot
    return None


def slot_id_from_host(url_or_host: str) -> str:
    """未知站默认 slot：取注册域名主段（example.com → example-com）。"""
    host = normalize_host(url_or_host)
    if not host:
        return "unknown"
    parts = [p for p in host.split(".") if p]
    if len(parts) >= 2:
        base = "-".join(parts[-2:])
    else:
        base = parts[0]
    safe = re.sub(r"[^a-z0-9-]+", "-", base.lower()).strip("-")
    return safe[:48] or "unknown"


def register_auth_slot(
    slot: str,
    *,
    login_url: str = "",
    label: str = "",
    domains: list[str] | None = None,
    required_token: str = "",
    cookie_hint: str = "",
) -> dict[str, str]:
    """登记（或刷新）动态授权槽位，供预检与登录引导使用。"""
    slot_id = (slot or "").strip().lower() or "unknown"
    host = normalize_host(login_url) if login_url else ""
    prev = _DYNAMIC_SLOT_META.get(slot_id) or {}
    hint = (cookie_hint or "").strip() or str(prev.get("cookie_hint") or "").strip()
    token = (required_token or "").strip() or str(prev.get("required_token") or "").strip()
    meta = {
        "label": (label or "").strip() or host or slot_id,
        "login_url": (login_url or "").strip() or (f"https://{host}" if host else ""),
        "cookie_hint": hint or "粘贴该站点登录后的完整 Cookie",
        "required_token": token,
    }
    if prev.get("login_url") and not meta["login_url"]:
        meta["login_url"] = str(prev["login_url"])
    if prev.get("label") and meta["label"] == slot_id:
        meta["label"] = str(prev["label"])
    _DYNAMIC_SLOT_META[slot_id] = meta

    domain_list = list(domains or [])
    if host and host not in domain_list:
        domain_list.append(host)
    for domain in domain_list:
        d = normalize_host(domain)
        if d:
            _DYNAMIC_DOMAIN_SLOTS[d] = slot_id
    return dict(meta)


def get_dynamic_slot_meta(slot: str) -> dict[str, str] | None:
    meta = _DYNAMIC_SLOT_META.get((slot or "").strip().lower())
    return dict(meta) if meta else None


def list_dynamic_slot_metas() -> dict[str, dict[str, str]]:
    return {k: dict(v) for k, v in _DYNAMIC_SLOT_META.items()}


def load_dynamic_auth_slots(raw: dict[str, Any] | None) -> None:
    """从持久化结构恢复动态 slot（integrations.json 的 auth_slot_defs）。"""
    if not isinstance(raw, dict):
        return
    for slot_id, item in raw.items():
        if not isinstance(item, dict):
            continue
        domains = item.get("domains")
        domain_list = (
            [str(d) for d in domains if str(d).strip()]
            if isinstance(domains, list)
            else []
        )
        register_auth_slot(
            str(slot_id),
            login_url=str(item.get("login_url") or ""),
            label=str(item.get("label") or ""),
            domains=domain_list,
            required_token=str(item.get("required_token") or ""),
            cookie_hint=str(item.get("cookie_hint") or ""),
        )


def dump_dynamic_auth_slots() -> dict[str, Any]:
    out: dict[str, Any] = {}
    for slot_id, meta in _DYNAMIC_SLOT_META.items():
        domains = sorted(
            d for d, s in _DYNAMIC_DOMAIN_SLOTS.items() if s == slot_id
        )
        out[slot_id] = {
            "label": meta.get("label") or slot_id,
            "login_url": meta.get("login_url") or "",
            "cookie_hint": meta.get("cookie_hint") or "",
            "required_token": meta.get("required_token") or "",
            "domains": domains,
        }
    return out


def is_auth_gate_error(message: str) -> bool:
    """缺 Cookie / 需引导登录的硬门禁（应标记 needs_auth，禁止 auto_repair）。"""
    text = message or ""
    if re.search(r"ASKME_AUTH_REQUIRED", text, re.I):
        return True
    gates = (
        "需要登录授权",
        "请先添加知乎 cookie",
        "请先完成登录授权",
        "未配置有效 cookie",
        "请先在设置页或添加源弹窗登录",
        "知乎接入需要登录授权",
    )
    low = text.lower()
    return any(g.lower() in low for g in gates)


def looks_like_auth_error(message: str) -> bool:
    text = (message or "").lower()
    if not text:
        return False
    return any(marker in text for marker in AUTH_ERROR_MARKERS)


def looks_like_login_wall(body: str) -> bool:
    text = (body or "").lower()
    if not text:
        return False
    hits = sum(1 for marker in LOGIN_WALL_BODY_MARKERS if marker in text)
    return hits >= 2 or any(m in text for m in ("请先登录", "扫码登录", "askme_auth_required"))


def parse_auth_required_slot(message: str) -> str | None:
    """从错误信息解析 ASKME_AUTH_REQUIRED:slot=xxx。"""
    text = message or ""
    match = re.search(r"ASKME_AUTH_REQUIRED(?::slot=([a-z0-9_-]+))?", text, re.I)
    if not match:
        return None
    return (match.group(1) or "").strip().lower() or None


def classify_exception_as_auth(exc: BaseException | str) -> dict[str, Any] | None:
    message = str(exc)
    slot = parse_auth_required_slot(message)
    if is_auth_gate_error(message) or slot or looks_like_auth_error(message):
        return {
            "auth_required": True,
            "slot": slot,
            "message": message,
            "gate": is_auth_gate_error(message) or bool(slot),
        }
    return None


def auth_error_should_skip_repair(message: str) -> bool:
    """auto_repair 应跳过：明确的授权门禁，而非泛化的 403/cookie 字样。"""
    return is_auth_gate_error(message) or bool(parse_auth_required_slot(message))


def account_missing_should_skip_repair(message: str) -> bool:
    """账号不存在/已停用：改 skill 无益，禁止 auto_repair。"""
    text = message or ""
    return "不存在" in text or "已停用" in text
