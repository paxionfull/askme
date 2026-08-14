"""discovery_validate 本地用的登录墙判定（不依赖 backend）。"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

_DOMAIN_SLOTS = {
    "zhihu.com": "zhihu",
    "zhimg.com": "zhihu",
}

_LOGIN_MARKERS = (
    "请先登录",
    "立即登录",
    "扫码登录",
    "login",
    "sign in",
    "signin",
    "未登录",
    "登录后",
    "passport",
    "captcha",
    "验证码",
)


def looks_like_login_wall(body: str) -> bool:
    text = (body or "").lower()
    if not text:
        return False
    hits = sum(1 for marker in _LOGIN_MARKERS if marker in text)
    return hits >= 2 or "请先登录" in text or "扫码登录" in text


def _slot_from_host(host: str) -> str:
    host = host.replace("www.", "")
    parts = [p for p in host.split(".") if p]
    if len(parts) >= 2:
        base = "-".join(parts[-2:])
    else:
        base = parts[0] if parts else "unknown"
    safe = re.sub(r"[^a-z0-9-]+", "-", base.lower()).strip("-")
    return safe[:48] or "unknown"


def resolve_slot_hint(skill_dir: Path, feed_meta: dict[str, Any]) -> str:
    source_yaml = skill_dir / "source.yaml"
    if source_yaml.is_file():
        text = source_yaml.read_text(encoding="utf-8")
        m = re.search(r"^\s*(?:auth_slot|slot)\s*:\s*([a-z0-9_-]+)\s*$", text, re.I | re.M)
        if m:
            return m.group(1).strip().lower()
        if re.search(r"requires_cookie\s*:\s*true", text, re.I):
            # fall through to domain
            pass
    for key in ("entryUrl", "entry_url", "homepage"):
        url = str(feed_meta.get(key) or "")
        if not url:
            continue
        host = urlparse(url).netloc.lower().replace("www.", "")
        for domain, slot in _DOMAIN_SLOTS.items():
            if host == domain or host.endswith("." + domain):
                return slot
        if host:
            return _slot_from_host(host)
    # skill 目录名启发
    name = skill_dir.name.lower()
    if "zhihu" in name:
        return "zhihu"
    m = re.match(r"^(.+)-discovery$", skill_dir.name)
    if m:
        return m.group(1).lower().replace("_", "-")[:48]
    return "unknown"
