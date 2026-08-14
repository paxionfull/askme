"""小红书登录态校验（供凭证保存 / Playwright 捕获调用）。"""

from __future__ import annotations

from paths import SKILLS_LIB

import sys
from pathlib import Path
from typing import Any

if str(SKILLS_LIB) not in sys.path:
    sys.path.insert(0, str(SKILLS_LIB))


def verify_xiaohongshu_cookie(cookie: str, *, probe_url: str = "") -> dict[str, Any]:
    """确认 Cookie 对应真实登录账号，而非仅有 web_session 的访客态。"""
    from xiaohongshu_common import assert_logged_in_cookie, parse_cookie_dict

    text = (cookie or "").strip()
    if not text:
        raise ValueError("Cookie 不能为空")
    parts = parse_cookie_dict(text)
    if not (parts.get("web_session") or "").strip():
        raise ValueError("Cookie 缺少 web_session")
    if not (parts.get("a1") or "").strip():
        raise ValueError("Cookie 缺少 a1")
    try:
        result = assert_logged_in_cookie(text, url=probe_url)
    except Exception as exc:
        msg = str(exc)
        # 去掉 ASKME_AUTH_REQUIRED 前缀，便于前端/校验展示
        if "ASKME_AUTH_REQUIRED" in msg:
            parts_msg = msg.split(" ", 1)
            msg = parts_msg[1] if len(parts_msg) > 1 else msg
        raise ValueError(msg) from exc
    profile_nick = str(result.get("profile_nickname") or "").strip()
    login_nick = str(result.get("nickname") or "").strip()
    return {
        "ok": True,
        "logged_in": True,
        "user_id": result.get("user_id") or "",
        # nickname：登录账号；display/profile：主页博主（探测用户页时优先用后者）
        "nickname": login_nick,
        "profile_nickname": profile_nick or login_nick,
        "profile_user_id": result.get("profile_user_id") or "",
        "notes_with_id": int(result.get("notes_with_id") or 0),
    }
