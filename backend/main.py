"""Askme FastAPI 入口。"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.deps import feed_client, _set_runtime_cursor_api_key
from api.router import register_routers
from auth.credential_store import sync_runtime_cookies
from core.llm import apply_stored_llm_config
from feed.feed_scheduler import feed_scheduler
from onboarding.source_onboarding_cursor import load_cursor_api_key


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
    for feed in await feed_client.list_feeds():
        feed_id = feed.get("id", "")
        if feed_id and feed_client.store.count_articles(feed_id) == 0:
            try:
                await feed_client.refresh_feed(feed_id)
            except Exception:
                pass
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
