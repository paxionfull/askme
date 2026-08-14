"""批量数据源接入：并行调度多个 onboarding 任务。"""

from __future__ import annotations

import asyncio
import re
import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Any, Literal

from auth.auth_signals import (
    auth_error_should_skip_repair,
    classify_exception_as_auth,
    parse_auth_required_slot,
    resolve_slot_from_url,
    slot_id_from_host,
)
from feed.feed_errors import FeedError
from core.llm import LLMError
from onboarding.source_onboarding_cursor import cancel_cursor_run, load_cursor_api_key, run_onboarding_agent
from onboarding.source_onboarding_log import (
    OnboardingCancelled,
    create_session,
    unregister_session,
)
from onboarding.source_onboarding_refresh import refresh_with_auto_repair
from onboarding.source_platform_scaffold import detect_platform
from onboarding.source_skill_writer import (
    is_complete_discovery_skill,
    read_skill_entry_url,
    remove_discovery_skill_dir,
    resolve_feed_id_for_target,
    resolve_onboard_target,
    skill_dir_for,
    source_identity_key,
    update_discovery_display_name,
)

from feed.feed_registry import UNGROUPED_GROUP_ID, feed_registry
from auth.credential_store import (
    cookie_satisfies_slot,
    ensure_slot_meta,
    get_cookie_for_slot,
    remember_auth_slot_for_url,
    slot_configured,
    sync_runtime_cookies,
)

MAX_BATCH_SIZE = 20
DEFAULT_MAX_CONCURRENCY = 5
RELOAD_DEBOUNCE_SECONDS = 1.5

ItemStatus = Literal[
    "queued",
    "running",
    "done",
    "failed",
    "cancelled",
    "skipped",
    "needs_auth",
]
BatchStatus = Literal["running", "done", "cancelled", "needs_auth"]


def parse_entry_urls(raw_urls: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for raw in raw_urls:
        for part in re.split(r"[\n,]+", raw):
            url = part.strip()
            if not url or url in seen:
                continue
            seen.add(url)
            ordered.append(url)
    if len(ordered) > MAX_BATCH_SIZE:
        raise ValueError(f"单次最多 {MAX_BATCH_SIZE} 个链接")
    return ordered


@dataclass
class BatchItem:
    entry_url: str
    slug: str = ""
    name: str = ""
    status: ItemStatus = "queued"
    phase: str = ""
    message: str = ""
    error: str | None = None
    feed_id: str | None = None
    job_id: str | None = None
    skip_reason: str | None = None
    reuse_existing: bool = False
    auth_slot: str | None = None
    login_url: str | None = None
    cookie_hint: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "entry_url": self.entry_url,
            "slug": self.slug,
            "name": self.name,
            "status": self.status,
            "phase": self.phase,
            "message": self.message,
            "error": self.error,
            "feed_id": self.feed_id,
            "job_id": self.job_id,
            "skip_reason": self.skip_reason,
            "reuse_existing": self.reuse_existing,
            "auth_slot": self.auth_slot,
            "login_url": self.login_url,
            "cookie_hint": self.cookie_hint,
        }


def _user_facing_failure_message(exc: BaseException, *, is_platform: bool = False) -> str:
    """区分「要登录」与「适配器/代码问题」，避免用户误判。"""
    text = str(exc).strip() or "接入失败"
    if text.upper().startswith("ASKME_AUTH_REQUIRED") or "需要登录" in text:
        return text
    if is_platform:
        return (
            f"平台适配器问题：{text}。"
            "这通常是探测/验证代码失败，不是缺 Cookie"
            "（缺登录时会单独提示「需要登录授权」）。"
        )
    return (
        f"接入失败（discovery skill / 验证）：{text}。"
        "若需登录会提示授权；否则请根据报错修复适配器或稍后重试。"
    )


def _mark_needs_auth(item: BatchItem, message: str, *, slot: str | None = None) -> None:
    item.status = "needs_auth"
    item.phase = "needs_auth"
    resolved = (
        (slot or "").strip().lower()
        or parse_auth_required_slot(message)
        or resolve_slot_from_url(item.entry_url)
        or item.auth_slot
        or slot_id_from_host(item.entry_url)
    )
    required_token = ""
    cookie_hint = ""
    source_yaml = skill_dir_for(item.slug) / "source.yaml"
    if source_yaml.is_file():
        text = source_yaml.read_text(encoding="utf-8")
        m_slot = re.search(r"auth_slot:\s*([a-z0-9_-]+)", text, re.I)
        if m_slot and not (slot or "").strip():
            resolved = m_slot.group(1).lower()
        m_token = re.search(r"required_token:\s*([^\s#]+)", text, re.I)
        if m_token:
            required_token = m_token.group(1).strip().strip("\"'")
        m_hint = re.search(r"cookie_hint:\s*(.+)$", text, re.I | re.M)
        if m_hint:
            cookie_hint = m_hint.group(1).strip().strip("\"'")
    item.auth_slot = remember_auth_slot_for_url(
        item.entry_url,
        slot=resolved,
        login_url=item.entry_url,
    )
    meta = ensure_slot_meta(
        item.auth_slot,
        login_url=item.entry_url,
        required_token=required_token,
        cookie_hint=cookie_hint,
    )
    item.login_url = str(meta.get("login_url") or item.entry_url)
    item.cookie_hint = str(meta.get("cookie_hint") or "") or None
    item.error = message
    item.message = (
        f"需要登录授权（{meta.get('label') or item.auth_slot}）：请完成 Cookie 授权后重试。"
    )


def _refresh_indicates_auth(refresh_result: dict[str, Any], entry_url: str, slug: str) -> str | None:
    """首拉成功但 0 篇时，对已知登录站 / source 声明返回 slot。"""
    article_count = int(refresh_result.get("article_count") or 0)
    new_count = int(refresh_result.get("new_article_count") or 0)
    if article_count > 0 or new_count > 0:
        return None
    slot = resolve_slot_from_url(entry_url)
    if slot:
        return slot
    # source.yaml requires_cookie
    source_yaml = skill_dir_for(slug) / "source.yaml"
    if source_yaml.is_file():
        text = source_yaml.read_text(encoding="utf-8")
        if "requires_cookie: true" in text or "requires_auth: true" in text:
            import re

            m = re.search(r"auth_slot:\s*([a-z0-9_-]+)", text, re.I)
            return (m.group(1).lower() if m else slot) or "unknown"
    return None


def _empty_refresh_auth_decision(
    slot: str,
    *,
    entry_url: str,
) -> tuple[bool, str]:
    """首拉 0 篇时判断是否真的缺授权。

    返回 (needs_auth, detail)。
    - Cookie 缺失 / 访客态 → needs_auth=True
    - 已真实登录但仍 0 篇 → needs_auth=False（可能是 token/空主页等问题）
    """
    sync_runtime_cookies()
    cookie = get_cookie_for_slot(slot)
    if not cookie_satisfies_slot(slot, cookie):
        return True, "未配置有效 Cookie，请完成登录授权后重试"

    slot_id = slot.strip().lower()
    if slot_id == "xiaohongshu":
        try:
            from auth.xiaohongshu_auth import verify_xiaohongshu_cookie

            result = verify_xiaohongshu_cookie(cookie, probe_url=entry_url)
            notes = int(result.get("notes_with_id") or 0)
            nick = str(
                result.get("profile_nickname") or result.get("nickname") or ""
            ).strip()
            if notes <= 0:
                return (
                    False,
                    f"登录有效{f'（{nick}）' if nick else ''}，但主页暂未解析到笔记"
                    "（常见原因：分享链接 xsec_token 过期，可稍后在库页刷新）",
                )
            return False, f"登录有效（{nick or '已登录'}），首拉暂无入库文章"
        except ValueError as exc:
            return True, str(exc)

    if not slot_configured(slot_id):
        return True, "未配置有效 Cookie，请完成登录授权后重试"
    return False, "授权已配置，首拉暂无文章（可稍后在库页刷新）"


def _apply_empty_refresh_outcome(
    item: BatchItem,
    *,
    slot: str,
    refresh_result: dict[str, Any],
    session,
    result_detail: dict[str, Any],
) -> None:
    needs_auth, detail = _empty_refresh_auth_decision(slot, entry_url=item.entry_url)
    if needs_auth:
        _mark_needs_auth(item, detail, slot=slot)
        session.finish(
            success=False,
            detail={**result_detail, "refresh": refresh_result, "needs_auth": True},
        )
        return
    item.status = "done"
    item.phase = "done"
    base = str(refresh_result.get("message") or f"已接入 {item.feed_id}")
    item.message = f"{base}；{detail}"
    session.finish(
        success=True,
        detail={**result_detail, "refresh": refresh_result, "empty_but_authed": True},
    )


def _exception_needs_auth(exc: BaseException) -> dict[str, Any] | None:
    info = classify_exception_as_auth(exc)
    if not info:
        return None
    # 硬门禁一定走 needs_auth；泛化 auth 信号也引导授权（避免当代码失败）
    if info.get("gate") or auth_error_should_skip_repair(str(exc)):
        return info
    return info


def _assign_feed_group(feed_id: str | None, group_id: str | None) -> None:
    if not feed_id:
        return
    gid = (group_id or "").strip()
    try:
        # 未分组：从所有自定义分组中移除；有分组：移动到目标组
        feed_registry.assign_feed_to_group(
            feed_id,
            None if (not gid or gid == UNGROUPED_GROUP_ID) else gid,
        )
    except ValueError:
        pass


def _attach_existing_feed(
    *,
    feed_id: str,
    group_id: str | None,
) -> str:
    """将已有 skill 对应的数据源加入目标分组（隐藏源先恢复）。"""
    restored = False
    if feed_registry.is_hidden(feed_id):
        feed_registry.unhide_feed(feed_id)
        restored = True
    _assign_feed_group(feed_id, group_id)
    gid = (group_id or "").strip()
    if restored and gid and gid != UNGROUPED_GROUP_ID:
        return "已恢复并从所选分组接入"
    if restored:
        return "已恢复数据源（skill 已存在）"
    if gid and gid != UNGROUPED_GROUP_ID:
        return "数据源已存在，已加入所选分组"
    return "数据源已存在，无需重复接入"


def _refresh_reused_platform_display_name(item: BatchItem) -> str | None:
    """复用已有平台 skill 时，用「平台-{昵称}」覆盖占位名。"""
    from onboarding.platform_registry import get_platform_spec

    platform = detect_platform(item.entry_url)
    if not platform:
        return None
    spec = get_platform_spec(platform.platform)
    if not spec or not spec.refresh_display_name:
        return None
    try:
        name = (spec.refresh_display_name(platform, item.slug, item.name or "") or "").strip()
    except Exception:
        return None
    if not name:
        return None
    feed_id = item.feed_id or platform.feed_id
    update_discovery_display_name(item.slug, name, feed_id=feed_id)
    item.name = name
    return name


async def _refresh_onboarded_feed(feed_client, feed_id: str) -> dict[str, Any]:
    feed_client.ensure_feed_visible(feed_id)
    # 首拉用近 3 天：默认「今天」对小红书等更新频率不均的源过窄，易得到 0 篇
    # 微信：限制页数并加大 page size，减少 list_ex 次数
    if str(feed_id).startswith("website:weixin:"):
        return await feed_client.refresh_feed(feed_id, days=3, max_pages=3, per=20)
    return await feed_client.refresh_feed(feed_id, days=3)


@dataclass
class OnboardingBatch:
    batch_id: str
    items: list[BatchItem] = field(default_factory=list)
    status: BatchStatus = "running"
    cancelled: bool = False
    auto_validate: bool = True
    reload: bool = True
    max_concurrency: int = DEFAULT_MAX_CONCURRENCY
    group_id: str | None = None
    auto_repair: bool = True
    _task: asyncio.Task | None = field(default=None, repr=False)

    @property
    def total(self) -> int:
        return len(self.items)

    def count_by_status(self, status: ItemStatus) -> int:
        return sum(1 for item in self.items if item.status == status)

    @property
    def completed(self) -> int:
        return self.count_by_status("done")

    @property
    def failed(self) -> int:
        return self.count_by_status("failed")

    @property
    def skipped(self) -> int:
        return self.count_by_status("skipped")

    @property
    def running(self) -> int:
        return self.count_by_status("running")

    @property
    def queued(self) -> int:
        return self.count_by_status("queued")

    @property
    def needs_auth(self) -> int:
        return self.count_by_status("needs_auth")

    @property
    def finished(self) -> int:
        return sum(
            1
            for item in self.items
            if item.status in {"done", "failed", "cancelled", "skipped", "needs_auth"}
        )

    def summary_message(self) -> str:
        if self.status == "running":
            return f"批量接入中 {self.completed}/{self.total} 完成"
        parts: list[str] = []
        if self.completed:
            parts.append(f"已接入 {self.completed} 个")
        if self.skipped:
            parts.append(f"跳过 {self.skipped} 个")
        if self.needs_auth:
            parts.append(f"待授权 {self.needs_auth} 个")
        if self.failed:
            parts.append(f"失败 {self.failed} 个")
        if self.count_by_status("cancelled"):
            parts.append(f"取消 {self.count_by_status('cancelled')} 个")
        return "，".join(parts) if parts else "批量接入已完成"

    def to_dict(self) -> dict[str, Any]:
        return {
            "batch_id": self.batch_id,
            "status": self.status,
            "total": self.total,
            "completed": self.completed,
            "failed": self.failed,
            "skipped": self.skipped,
            "needs_auth": self.needs_auth,
            "running": self.running,
            "queued": self.queued,
            "message": self.summary_message(),
            "items": [item.to_dict() for item in self.items],
        }


_batches: dict[str, OnboardingBatch] = {}
_batch_lock = Lock()
_reload_task: asyncio.Task | None = None
_reload_lock = asyncio.Lock()


def _new_batch_id() -> str:
    return uuid.uuid4().hex[:12]


def _prepare_item(entry_url: str, seen_slugs: set[str]) -> BatchItem:
    item = BatchItem(entry_url=entry_url)
    try:
        slug, name, normalized = resolve_onboard_target(entry_url)
    except ValueError as exc:
        item.status = "skipped"
        item.skip_reason = str(exc)
        item.message = str(exc)
        return item

    feed_id = resolve_feed_id_for_target(normalized, slug)

    if skill_dir_for(slug).exists():
        if not is_complete_discovery_skill(slug):
            remove_discovery_skill_dir(slug)
            try:
                feed_registry.purge_feed(feed_id)
            except Exception:
                pass
        else:
            # skill 已完整：仅当入口页同一用户/同一站点时才复用，否则不应走到这里
            existing_entry = read_skill_entry_url(slug)
            if existing_entry and source_identity_key(existing_entry) != source_identity_key(
                normalized
            ):
                item.slug = slug
                item.name = name
                item.status = "skipped"
                item.skip_reason = (
                    f"slug「{slug}」已被其他页面占用（{existing_entry}），请联系开发排查"
                )
                item.message = item.skip_reason
                return item
            if slug in seen_slugs:
                item.slug = slug
                item.name = name
                item.status = "skipped"
                item.skip_reason = f"本批次 slug 冲突: {slug}"
                item.message = item.skip_reason
                return item
            seen_slugs.add(slug)
            item.slug = slug
            item.name = name
            item.entry_url = normalized
            item.feed_id = feed_id
            item.reuse_existing = True
            return item

    if slug in seen_slugs:
        item.slug = slug
        item.name = name
        item.status = "skipped"
        item.skip_reason = f"本批次 slug 冲突: {slug}"
        item.message = item.skip_reason
        return item

    seen_slugs.add(slug)
    item.slug = slug
    item.name = name
    item.entry_url = normalized
    item.feed_id = feed_id
    return item


def _needs_cursor_agent(entry_url: str) -> bool:
    return detect_platform(entry_url.strip()) is None


async def _schedule_reload(feed_client) -> None:
    global _reload_task
    async with _reload_lock:
        if _reload_task and not _reload_task.done():
            return

        async def _debounced() -> None:
            await asyncio.sleep(RELOAD_DEBOUNCE_SECONDS)
            feed_client.reload_skills()

        _reload_task = asyncio.create_task(_debounced())


async def _run_item(
    batch: OnboardingBatch,
    item: BatchItem,
    *,
    sem: asyncio.Semaphore,
    feed_client,
) -> None:
    if batch.cancelled:
        if item.status == "queued":
            item.status = "cancelled"
            item.message = "已取消"
        return

    async with sem:
        if batch.cancelled or item.status != "queued":
            if item.status == "queued":
                item.status = "cancelled"
                item.message = "已取消"
            return

        item.status = "running"
        item.phase = "start"
        item.message = "接入启动中…"

        if item.reuse_existing:
            feed_id = item.feed_id or resolve_feed_id_for_target(item.entry_url, item.slug)
            item.feed_id = feed_id
            item.phase = "attach"
            item.message = "数据源已存在，正在加入分组并刷新…"
            session = create_session(
                entry_url=item.entry_url,
                slug=item.slug,
                name=item.name,
            )
            item.job_id = session.job_id
            try:
                display_name = _refresh_reused_platform_display_name(item)
                if display_name:
                    session.name = display_name
                    item.message = f"数据源已存在，已更新显示名为「{display_name}」，正在刷新…"
                    session.log("display_name", name=display_name)
                attach_msg = _attach_existing_feed(feed_id=feed_id, group_id=batch.group_id)
                sync_runtime_cookies()
                refresh_result: dict[str, Any] | None = None
                async for refresh_event in refresh_with_auto_repair(
                    slug=item.slug,
                    do_refresh=lambda fid=feed_id: _refresh_onboarded_feed(feed_client, fid),
                    reload_skills=feed_client.reload_skills,
                    session=session,
                    auto_validate=batch.auto_validate,
                    auto_repair=batch.auto_repair,
                ):
                    if batch.cancelled or session.cancelled:
                        break
                    rev_kind = refresh_event.get("event", "status")
                    if rev_kind == "refresh_done":
                        refresh_result = refresh_event.get("data") or {}
                    elif rev_kind == "status":
                        item.phase = str(refresh_event.get("phase") or item.phase)
                        item.message = str(refresh_event.get("message") or item.message)
                if batch.cancelled or session.cancelled:
                    item.status = "cancelled"
                    item.phase = "cancelled"
                    item.message = "已取消"
                    return
                if refresh_result is None:
                    raise FeedError("复用接入未返回刷新结果", status_code=502)
                auth_slot = _refresh_indicates_auth(refresh_result, item.entry_url, item.slug)
                check_slot = None
                if auth_slot and auth_slot != "unknown":
                    check_slot = auth_slot
                elif auth_slot == "unknown":
                    check_slot = resolve_slot_from_url(item.entry_url)
                if check_slot:
                    _apply_empty_refresh_outcome(
                        item,
                        slot=check_slot,
                        refresh_result=refresh_result,
                        session=session,
                        result_detail={"attached": True, "display_name": display_name},
                    )
                else:
                    item.status = "done"
                    item.phase = "attached"
                    repaired = bool(refresh_result.get("auto_repaired"))
                    base_msg = str(refresh_result.get("message") or attach_msg)
                    if display_name:
                        base_msg = f"显示名「{display_name}」· {base_msg}"
                    item.message = f"自动修复后{base_msg}" if repaired else base_msg
                    session.finish(
                        success=True,
                        detail={
                            "refresh": refresh_result,
                            "attached": True,
                            "display_name": display_name,
                        },
                    )
                if batch.reload:
                    await _schedule_reload(feed_client)
            except Exception as exc:
                auth = _exception_needs_auth(exc)
                if auth:
                    _mark_needs_auth(item, str(exc), slot=auth.get("slot"))
                    session.finish(
                        success=False,
                        detail={"error": str(exc), "needs_auth": True},
                    )
                else:
                    item.status = "failed"
                    item.phase = "attach_failed"
                    item.error = str(exc) or "加入分组失败"
                    item.message = item.error
                    session.finish(success=False, detail={"error": item.error})
            return

        session = create_session(
            entry_url=item.entry_url,
            slug=item.slug,
            name=item.name,
        )
        item.job_id = session.job_id

        try:
            async for event in run_onboarding_agent(
                slug=item.slug,
                name=item.name,
                entry_url=item.entry_url,
                auto_validate=batch.auto_validate,
                session=session,
                auto_repair=batch.auto_repair,
            ):
                if batch.cancelled or session.cancelled:
                    break
                kind = event.get("event", "status")
                if kind == "result":
                    data = event.get("data") or {}
                    item.feed_id = str(data.get("feed_id") or f"website:{item.slug}")
                    _assign_feed_group(item.feed_id, batch.group_id)
                    try:
                        refresh_result: dict[str, Any] | None = None
                        async for refresh_event in refresh_with_auto_repair(
                            slug=item.slug,
                            do_refresh=lambda fid=item.feed_id: _refresh_onboarded_feed(
                                feed_client, fid
                            ),
                            reload_skills=feed_client.reload_skills,
                            session=session,
                            auto_validate=batch.auto_validate,
                            auto_repair=batch.auto_repair,
                        ):
                            if batch.cancelled or session.cancelled:
                                break
                            rev_kind = refresh_event.get("event", "status")
                            if rev_kind == "refresh_done":
                                refresh_result = refresh_event.get("data") or {}
                            elif rev_kind == "status":
                                item.phase = str(refresh_event.get("phase") or item.phase)
                                item.message = str(
                                    refresh_event.get("message") or item.message
                                )
                        if batch.cancelled or session.cancelled:
                            break
                        if refresh_result is None:
                            raise FeedError("首拉未返回结果", status_code=502)
                        auth_slot = _refresh_indicates_auth(
                            refresh_result, item.entry_url, item.slug
                        )
                        check_slot = (
                            auth_slot
                            if auth_slot and auth_slot != "unknown"
                            else (resolve_slot_from_url(item.entry_url) if auth_slot else None)
                        )
                        if check_slot:
                            _apply_empty_refresh_outcome(
                                item,
                                slot=check_slot,
                                refresh_result=refresh_result,
                                session=session,
                                result_detail=data,
                            )
                        else:
                            item.status = "done"
                            item.phase = "done"
                            repaired = bool(refresh_result.get("auto_repaired"))
                            base_msg = str(
                                refresh_result.get("message")
                                or f"已接入并更新 {item.feed_id}"
                            )
                            item.message = (
                                f"自动修复后{base_msg}" if repaired else base_msg
                            )
                            session.finish(
                                success=True,
                                detail={**data, "refresh": refresh_result},
                            )
                        if batch.reload:
                            await _schedule_reload(feed_client)
                    except FeedError as exc:
                        auth = _exception_needs_auth(exc)
                        if auth:
                            _mark_needs_auth(item, str(exc), slot=auth.get("slot"))
                            session.finish(
                                success=False,
                                detail={**data, "refresh_error": str(exc), "needs_auth": True},
                            )
                            if batch.reload:
                                await _schedule_reload(feed_client)
                            break
                        item.status = "failed"
                        item.phase = "refresh_failed"
                        item.error = str(exc)
                        item.message = (
                            f"skill 已写入，但首次拉取失败（适配器/网络）：{exc}。"
                            "缺登录时会提示授权；否则请检查 discovery 实现或稍后重试。"
                        )
                        session.finish(
                            success=False,
                            detail={**data, "refresh_error": str(exc)},
                        )
                        if batch.reload:
                            await _schedule_reload(feed_client)
                        break
                    break
                elif kind == "status":
                    item.phase = str(event.get("phase") or item.phase)
                    item.message = str(event.get("message") or item.message)

            if item.status == "running":
                if session.cancelled or batch.cancelled:
                    raise OnboardingCancelled("接入已取消")
                item.status = "failed"
                item.error = "Agent 未返回结果"
                item.message = item.error
                session.finish(success=False, detail={"error": item.error})
        except OnboardingCancelled:
            item.status = "cancelled"
            item.phase = "cancelled"
            item.message = "已取消"
            session.cleanup_partial_skill()
            session.finish(success=False, detail={"cancelled": True})
        except LLMError as exc:
            auth = _exception_needs_auth(exc)
            is_platform = bool(detect_platform(item.entry_url))
            if auth:
                _mark_needs_auth(item, str(exc), slot=auth.get("slot"))
                session.log("needs_auth", detail=str(exc))
                # 保留已写 skill，便于授权后重试
                session.finish(success=False, detail={"error": str(exc), "needs_auth": True})
            else:
                item.status = "failed"
                item.error = str(exc)
                item.message = _user_facing_failure_message(exc, is_platform=is_platform)
                session.log("error", detail=str(exc))
                session.cleanup_partial_skill()
                session.finish(success=False, detail={"error": str(exc)})
        except Exception as exc:
            auth = _exception_needs_auth(exc)
            is_platform = bool(detect_platform(item.entry_url))
            if auth:
                _mark_needs_auth(item, str(exc), slot=auth.get("slot"))
                session.log("needs_auth", detail=str(exc))
                session.finish(success=False, detail={"error": str(exc), "needs_auth": True})
            else:
                item.status = "failed"
                item.error = str(exc) or "接入失败"
                item.message = _user_facing_failure_message(exc, is_platform=is_platform)
                session.log("error", detail=item.error)
                session.cleanup_partial_skill()
                session.finish(success=False, detail={"error": item.error})
        finally:
            unregister_session(session.job_id)


async def _run_batch(batch: OnboardingBatch, feed_client) -> None:
    queued = [item for item in batch.items if item.status == "queued"]
    sem = asyncio.Semaphore(batch.max_concurrency)
    try:
        await asyncio.gather(
            *[
                _run_item(batch, item, sem=sem, feed_client=feed_client)
                for item in queued
            ]
        )
    finally:
        if batch.reload and batch.completed > 0:
            await _schedule_reload(feed_client)
            if _reload_task:
                try:
                    await _reload_task
                except Exception:
                    pass
        if batch.cancelled:
            batch.status = "cancelled"
        elif batch.needs_auth > 0 and batch.failed == 0:
            batch.status = "needs_auth"
        else:
            batch.status = "done"


def get_batch(batch_id: str) -> OnboardingBatch | None:
    with _batch_lock:
        return _batches.get(batch_id)


async def start_batch(
    *,
    entry_urls: list[str],
    feed_client,
    max_concurrency: int | None = None,
    auto_validate: bool = True,
    reload: bool = True,
    group_id: str | None = None,
    auto_repair: bool = True,
) -> OnboardingBatch:
    urls = parse_entry_urls(entry_urls)
    if not urls:
        raise ValueError("请至少提供一个有效链接")

    seen_slugs: set[str] = set()
    items = [_prepare_item(url, seen_slugs) for url in urls]
    queued = [item for item in items if item.status == "queued"]

    if queued and not load_cursor_api_key():
        needs_cursor = any(_needs_cursor_agent(item.entry_url) for item in queued)
        if needs_cursor:
            raise LLMError(
                "请先在设置页配置 Cursor API Key（Dashboard → Integrations）",
                status_code=400,
            )

    batch = OnboardingBatch(
        batch_id=_new_batch_id(),
        items=items,
        auto_validate=auto_validate,
        reload=reload,
        max_concurrency=min(10, max(1, max_concurrency or DEFAULT_MAX_CONCURRENCY)),
        group_id=(group_id or "").strip() or None,
        auto_repair=auto_repair,
    )

    with _batch_lock:
        _batches[batch.batch_id] = batch

    if not queued:
        batch.status = "done"
        return batch

    batch._task = asyncio.create_task(_run_batch(batch, feed_client))
    return batch


async def cancel_batch(batch_id: str) -> bool:
    batch = get_batch(batch_id)
    if batch is None or batch.status != "running":
        return False

    batch.cancelled = True
    for item in batch.items:
        if item.status == "queued":
            item.status = "cancelled"
            item.message = "已取消"
        elif item.status == "running" and item.job_id:
            await cancel_cursor_run(item.job_id)
            from onboarding.source_onboarding_log import cancel_job

            cancel_job(item.job_id)
    return True
