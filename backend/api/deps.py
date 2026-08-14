"""共享服务实例与设置辅助函数。"""
from __future__ import annotations

import json
import os

from auth.credential_store import (
    delete_credential,
    get_cookie_for_slot,
    list_credentials,
    mask_cookie,
    sync_runtime_cookies,
    upsert_credential,
)
from chat.chat_service import ChatService
from feed.article_service import ArticleService
from feed.feed_client import FeedClient
from paths import DATA_DIR

feed_client = FeedClient()
article_service = ArticleService(feed_client)
chat_service = ChatService()

SECRETS_PATH = DATA_DIR / "integrations.json"
CURSOR_API_KEY = "cursor_api_key"
ZHIHU_FEED_IDS = ["website:zhihu:aitechtalk", "website:zhihu:xinziyuan"]


def _load_integrations() -> dict:
    if not SECRETS_PATH.exists():
        return {}
    try:
        return json.loads(SECRETS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_integrations(data: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SECRETS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _mask_cookie(cookie: str) -> str:
    return mask_cookie(cookie)


def _get_saved_zhihu_cookie() -> str:
    return get_cookie_for_slot("zhihu")


def _set_runtime_zhihu_cookie(cookie: str) -> None:
    cookie = cookie.strip()
    if cookie:
        upsert_credential(slot="zhihu", cookie=cookie, label="知乎")
    else:
        # 清空：删除 zhihu slot 凭证
        for item in list_credentials():
            if item["slot"] == "zhihu":
                delete_credential(item["id"])
        sync_runtime_cookies()


def _set_runtime_cursor_api_key(api_key: str) -> None:
    api_key = api_key.strip()
    if api_key:
        os.environ["CURSOR_API_KEY"] = api_key
    else:
        os.environ.pop("CURSOR_API_KEY", None)

