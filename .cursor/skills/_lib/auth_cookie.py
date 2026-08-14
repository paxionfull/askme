"""Discovery 脚本读取 Askme 注入的登录 Cookie。"""

from __future__ import annotations

import os


def get_request_cookie(slot: str = "") -> str:
    """按 slot 读取 Cookie；未指定时回退 ASKME_COOKIE。

    环境变量由 backend credential_store.sync_runtime_cookies 注入：
    - ASKME_COOKIE_<SLOT>
    - ASKME_COOKIE（最近一条）
    - ZHIHU_COOKIE（兼容）
    """
    slot_id = (slot or "").strip().lower().replace("-", "_")
    if slot_id:
        env_key = f"ASKME_COOKIE_{slot_id.upper()}"
        value = os.environ.get(env_key, "").strip()
        if value:
            return value
        if slot_id == "zhihu":
            legacy = os.environ.get("ZHIHU_COOKIE", "").strip()
            if legacy:
                return legacy
    return os.environ.get("ASKME_COOKIE", "").strip()
