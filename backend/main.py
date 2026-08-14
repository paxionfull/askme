"""Askme FastAPI 入口。"""
from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.deps import feed_client, _set_runtime_cursor_api_key
from api.router import register_routers
from auth.credential_store import sync_runtime_cookies
from core.llm import apply_stored_llm_config
from feed.feed_scheduler import feed_scheduler
from onboarding.source_onboarding_cursor import load_cursor_api_key

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    sync_runtime_cookies()
    _set_runtime_cursor_api_key(load_cursor_api_key())
    try:
        apply_stored_llm_config()
    except Exception:
        pass
    try:
        from feed.platform_skill_migrate import migrate_per_user_platform_skills

        migrate_per_user_platform_skills(delete_dirs=True)
        feed_client.reload_skills()
    except Exception:
        pass
    feed_scheduler.start(feed_client)
    # 启动时异步跑一次保留清理，不阻塞服务就绪
    try:
        from feed.data_retention import run_data_retention

        asyncio.create_task(asyncio.to_thread(run_data_retention))
    except Exception:
        pass

    async def _refresh_empty_feeds_background() -> None:
        """空源补刷放到后台，避免阻塞 API 就绪（保留清理后常见大量空源）。"""
        try:
            feeds = await feed_client.list_feeds()
        except Exception:
            logger.exception("启动空源补刷：列出数据源失败")
            return
        empty_ids = [
            str(f.get("id") or "")
            for f in feeds
            if f.get("id") and feed_client.store.count_articles(str(f.get("id") or "")) == 0
        ]
        for feed_id in empty_ids:
            # 刚同步过的跳过，避免热重载反复打空源
            try:
                last_sync = feed_client.store.get_last_sync(feed_id)
                if last_sync and (time.time() - float(last_sync)) < 3600:
                    continue
            except Exception:
                pass
            try:
                await feed_client.refresh_feed(feed_id)
            except Exception:
                logger.exception("启动空源补刷失败: %s", feed_id)

    asyncio.create_task(_refresh_empty_feeds_background())
    yield
    feed_scheduler.shutdown()


app = FastAPI(title="Askme API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_routers(app)
