"""数据源列表、分组、刷新与文章。"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Query

from api.deps import feed_client
from core.time_scope import filter_articles_by_days
from digest.digest_service import resolve_feed_ids_for_groups
from feed.feed_errors import FeedError
from feed.feed_registry import UNGROUPED_GROUP_ID, feed_registry
from feed.feed_scheduler import feed_scheduler
from schemas import FeedGroupsRequest, FeedRenameRequest, RefreshAllRequest, RefreshGroupRequest
from skills.skill_manager import delete_discovery_skill_by_feed_id

router = APIRouter(tags=["feeds"])

@router.post("/api/feeds/refresh-all")
async def refresh_all_feeds(body: RefreshAllRequest | None = None):
    try:
        days = body.days if body is not None else 1
        return feed_scheduler.start_refresh_all(feed_client, days=days)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except FeedError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"更新全部失败: {exc}") from exc


@router.post("/api/feeds/refresh-group")
async def refresh_group_feeds(body: RefreshGroupRequest):
    group_id = body.group_id.strip()
    if not group_id:
        raise HTTPException(status_code=400, detail="请指定分组")

    try:
        feed_ids = await resolve_feed_ids_for_groups(feed_client, [group_id])
        group_name = group_id
        if group_id == UNGROUPED_GROUP_ID:
            group_name = "未分组"
        else:
            for group in feed_registry.list_groups():
                if str(group.get("id", "")) == group_id:
                    group_name = str(group.get("name", "")).strip() or group_id
                    break
        return feed_scheduler.start_refresh_group(
            feed_client,
            group_id=group_id,
            group_name=group_name,
            feed_ids=feed_ids,
            days=body.days,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except FeedError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"更新分组失败: {exc}") from exc


@router.post("/api/feeds/reload-skills")
async def reload_feed_skills():
    try:
        count = feed_client.reload_skills()
        feeds = await feed_client.list_feeds()
        return {"ok": True, "feed_count": count, "feeds": [feed.get("id") for feed in feeds]}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"重新加载 skill 失败: {exc}") from exc


@router.post("/api/sources/{slug}/validate")
async def validate_source(slug: str):
    try:
        safe_slug = validate_slug(slug)
        return run_validation(safe_slug)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"验证失败: {exc}") from exc


@router.get("/api/feeds")
async def list_feeds():
    try:
        feeds = await feed_client.list_feeds()
        groups = feed_client.list_groups()
        group_order = feed_client.list_group_order()
        return {
            "feeds": [
                {
                    "id": feed["id"],
                    "name": feed.get("mpName", ""),
                    "cover": feed.get("mpCover", ""),
                    "intro": feed.get("mpIntro", ""),
                    "entry_url": feed.get("entryUrl", ""),
                    "sync_time": feed.get("syncTime"),
                    "status": feed.get("status"),
                    "group_id": feed.get("groupId"),
                    "platform_account": feed_registry.is_platform_feed(feed["id"]),
                    "platform": (
                        str(feed_registry.get_platform_account(feed["id"]).get("platform") or "")
                        if feed_registry.get_platform_account(feed["id"])
                        else ""
                    ),
                }
                for feed in feeds
            ],
            "groups": groups,
            "group_order": group_order,
            "default_digest_skill": feed_registry.default_digest_skill(),
        }
    except FeedError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"获取数据源失败: {exc}") from exc


@router.delete("/api/feeds/{feed_id:path}")
async def delete_feed(
    feed_id: str,
    remove_skill: bool = Query(False),
):
    try:
        is_platform = feed_registry.is_platform_feed(feed_id)
        skill_removed = False
        if is_platform:
            if remove_skill:
                feed_registry.purge_feed(feed_id)
            else:
                feed_client.hide_feed(feed_id)
            feed_client.reload_skills()
        elif remove_skill:
            try:
                delete_discovery_skill_by_feed_id(feed_id)
                feed_client.reload_skills()
                skill_removed = True
            except ValueError:
                skill_removed = False
        if not is_platform and not skill_removed:
            feed_client.hide_feed(feed_id)
        return {
            "ok": True,
            "feed_id": feed_id,
            "skill_removed": skill_removed,
            "platform_account": is_platform,
        }
    except FeedError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"删除数据源失败: {exc}") from exc


@router.put("/api/feeds/{feed_id:path}/name")
async def rename_feed(feed_id: str, body: FeedRenameRequest):
    try:
        name = feed_client.rename_feed(feed_id, body.name)
        return {"ok": True, "feed_id": feed_id, "name": name}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FeedError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"重命名数据源失败: {exc}") from exc


@router.get("/api/feeds/groups")
async def get_feed_groups():
    try:
        return {
            "groups": feed_client.list_groups(),
            "group_order": feed_client.list_group_order(),
            "default_digest_skill": feed_registry.default_digest_skill(),
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"获取分组失败: {exc}") from exc


@router.put("/api/feeds/groups")
async def save_feed_groups(body: FeedGroupsRequest):
    try:
        groups, group_order = feed_client.set_layout(
            [
                {
                    "id": group.id,
                    "name": group.name,
                    "feed_ids": group.feed_ids,
                    "digest_skill_id": group.digest_skill_id,
                }
                for group in body.groups
            ],
            body.group_order,
        )
        if body.default_digest_skill:
            feed_registry.set_default_digest_skill(body.default_digest_skill)
        return {
            "ok": True,
            "groups": groups,
            "group_order": group_order,
            "default_digest_skill": feed_registry.default_digest_skill(),
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"保存分组失败: {exc}") from exc


@router.post("/api/feeds/{feed_id:path}/refresh")
async def refresh_feed(
    feed_id: str,
    days: int = Query(default=1, ge=1, le=30),
):
    from feed.feed_scheduler import DEFAULT_FEED_REFRESH_TIMEOUT, humanize_refresh_error

    task = asyncio.create_task(feed_client.refresh_feed(feed_id, days=days))
    try:
        done, _pending = await asyncio.wait({task}, timeout=DEFAULT_FEED_REFRESH_TIMEOUT)
        if task not in done:
            def _swallow(done_task: asyncio.Task) -> None:
                try:
                    done_task.result()
                except Exception:
                    pass

            task.add_done_callback(_swallow)
            detail = humanize_refresh_error(
                f"刷新超时（>{int(DEFAULT_FEED_REFRESH_TIMEOUT)}s）"
            )
            raise HTTPException(status_code=504, detail=detail)
        return task.result()
    except HTTPException:
        raise
    except FeedError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"刷新失败: {exc}") from exc


@router.get("/api/feeds/{feed_id:path}/articles")
async def get_articles(
    feed_id: str,
    limit: int | None = Query(default=None, ge=1, le=5000),
    days: int | None = Query(default=None, ge=1, le=30),
    refresh: bool = Query(default=False),
    fresh: bool = Query(default=False),
    include_content: bool = Query(default=False),
):
    try:
        # 按时间过滤时取该源全部再裁剪；否则默认 20 条兼容旧调用
        fetch_limit = None if days is not None else (limit if limit is not None else 20)
        articles = await feed_client.get_articles(
            feed_id,
            limit=fetch_limit,
            refresh=refresh,
            fresh=fresh,
            include_content=include_content,
        )
        if days is not None:
            articles = filter_articles_by_days(articles, days)
        if limit is not None:
            articles = articles[:limit]
        return articles
    except FeedError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"获取文章失败: {exc}") from exc


@router.get("/api/feeds/{feed_id:path}/articles/{article_id}")
async def get_article_detail(feed_id: str, article_id: str):
    try:
        return await feed_client.get_article_content(feed_id, article_id)
    except FeedError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"获取文章正文失败: {exc}") from exc

