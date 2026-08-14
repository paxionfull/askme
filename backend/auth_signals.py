"""登录墙 / Cookie 需求判定（预检名单 + 运行时信号）。"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

# 已知需要登录的域名 → slot
DOMAIN_AUTH_SLOTS: dict[str, str] = {
    "zhihu.com": "zhihu",
    "zhimg.com": "zhihu",
    "xiaohongshu.com": "xiaohongshu",
    "xhscdn.com": "xiaohongshu",
    "xhslink.com": "xiaohongshu",
    "mp.weixin.qq.com": "weixin",
}

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
    return None


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
    if slot or looks_like_auth_error(message):
        return {
            "auth_required": True,
            "slot": slot,
            "message": message,
        }
    return None
