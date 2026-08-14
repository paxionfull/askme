"""汇总并挂载全部 APIRouter。"""
from __future__ import annotations

from fastapi import FastAPI

from api import articles, chat, digest, feeds, health, llm, onboarding, settings, skills


def register_routers(app: FastAPI) -> None:
    app.include_router(health.router)
    app.include_router(llm.router)
    app.include_router(articles.router)
    app.include_router(digest.router)
    app.include_router(chat.router)
    app.include_router(settings.router)
    app.include_router(feeds.router)
    app.include_router(skills.router)
    app.include_router(onboarding.router)
