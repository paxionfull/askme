"""将平台 skill 模块绑定到具体账号，生成 WebsiteFeed 可用的 adapter。"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

_LIB = Path(__file__).resolve().parent.parent / ".cursor" / "skills" / "_lib"
if str(_LIB) not in sys.path:
    sys.path.insert(0, str(_LIB))

from platform_account_ctx import platform_account_scope  # noqa: E402


class BoundPlatformAdapter:
    """一个 PLATFORM skill + 一条 platform_accounts 记录 → 一个 FEED_ID。"""

    def __init__(self, platform_module: Any, account: dict[str, Any]):
        self._module = platform_module
        self.account = dict(account)
        self.FEED_ID = str(account["feed_id"])
        display = str(account.get("display_name") or "").strip() or self.FEED_ID
        entry = str(account.get("entry_url") or account.get("posts_url") or "").strip()
        cover = str(getattr(platform_module, "DEFAULT_COVER", "") or "").strip()
        self.FEED_META = {
            "id": self.FEED_ID,
            "mpName": display,
            "mpCover": cover,
            "mpIntro": display,
            "status": 1,
            "source": "website",
            "entryUrl": entry,
            "platform": str(account.get("platform") or ""),
        }
        defaults = getattr(platform_module, "REFRESH_DEFAULTS", None)
        self.REFRESH_DEFAULTS = dict(defaults) if isinstance(defaults, dict) else {}

    def _call(self, name: str, *args: Any, **kwargs: Any) -> Any:
        fn = getattr(self._module, name)
        with platform_account_scope(self.account):
            return fn(*args, **kwargs)

    def fetch_list_page(self, page: int, per: int) -> dict[str, Any]:
        return self._call("fetch_list_page", page, per)

    def list_items(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        return self._call("list_items", payload)

    def has_next_page(self, payload: dict[str, Any]) -> bool:
        return bool(self._call("has_next_page", payload))

    def normalize_list_item(self, item: dict[str, Any]) -> dict[str, Any]:
        return self._call("normalize_list_item", item)

    def fetch_article_detail(self, article_id: str, **hints: Any) -> dict[str, Any]:
        return self._call("fetch_article_detail", article_id, **hints)

    def normalize_article_body(self, raw_html: str, *, article_id: str = "") -> str:
        normalize = getattr(self._module, "normalize_article_body", None)
        if not callable(normalize):
            return raw_html
        with platform_account_scope(self.account):
            return normalize(raw_html, article_id=article_id)
