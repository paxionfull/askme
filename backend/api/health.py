"""健康检查。"""
from __future__ import annotations

from fastapi import APIRouter

from api.deps import feed_client

router = APIRouter(tags=["health"])

@router.get("/api/health")
async def health():
    feeds = await feed_client.list_feeds()
    return {
        "status": "ok",
        "source": "website",
        "feed_count": len(feeds),
    }

