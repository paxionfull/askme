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
from onboarding.agent import cancel_agent_run, has_agent_credentials
from onboarding.source_onboarding_cursor import run_onboarding_agent
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
    get_slot_meta,
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
    group_id: str | None = None

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
            "group_id": self.group_id,
        }


def _user_facing_failure_message(exc: BaseException, *, is_platform: bool = False) -> str:
    """区分「要登录」与「适配器/代码问题」，避免用户误判。"""
    text = str(exc).strip() or "接入失败"
    if "不存在" in text or "已停用" in text:
        return text
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


def _user_facing_refresh_failure_message(exc: BaseException) -> str:
    """首拉失败给用户看的话术（隐藏内部状态错误）。"""
    text = str(exc).strip() or "首次拉取失败"
    if "不存在" in text or "已停用" in text:
        return text
    lowered = text.lower()
    if "数据源已移除" in text or "skill 未装载" in text:
        return (
            "接入流程异常，未能完成首次拉取；半成品 skill 已清理，请稍后重试添加。"
        )
    if "name '" in lowered and "is not defined" in lowered:
        return (
            "接入后自动修复过程出错；半成品 skill 已清理，请稍后重试添加。"
        )
    if "首拉失败且自动修复异常" in text or "自动修复后仍拉取失败" in text:
        return (
            f"首次拉取未成功：{text}。"
            "半成品 skill 已从技能库移除，可稍后重试或换一个入口 URL。"
        )
    return (
        f"首次拉取失败：{text}。"
        "半成品 skill 已清理；缺登录时会单独提示授权，否则请稍后重试。"
    )


def _skill_requires_cookie(slug: str) -> bool:
    source_yaml = skill_dir_for(slug) / "source.yaml"
    if not source_yaml.is_file():
        return False
    text = source_yaml.read_text(encoding="utf-8")
    return bool(re.search(r"requires_cookie\s*:\s*true", text, re.I))


def _is_antibot_auth_message(message: str) -> bool:
    low = (message or "").lower()
    return any(
        marker in low
        for marker in (
            "cloudflare",
            "incapsula",
            "imperva",
            "cf_clearance",
            "incap_ses_",
            "人机验证",
            "防护",
            "bot challenge",
            "anti_bot",
        )
    )


def _auth_handoff_message(meta: dict[str, str], message: str, slot: str) -> str:
    label = str(meta.get("label") or slot)
    if _is_antibot_auth_message(message):
        return (
            f"需要反爬 Cookie（{label}）：请在浏览器通过人机验证后导出完整 Cookie 并授权，"
            "再重试接入（非账号登录，令牌会过期）。"
        )
    return f"需要登录授权（{label}）：请完成 Cookie 授权后重试。"


def _is_progress_status_message(message: str) -> bool:
    """接入过程中的阶段文案，不能当作失败根因展示。"""
    text = (message or "").strip()
    if not text:
        return True
    progress_markers = (
        "正在验证 skill",
        "正在探测",
        "接入启动中",
        "正在准备修复",
        "正在启动 Cursor",
        "Cursor 正在",
        "命令执行完成",
        "文件操作完成",
        "自动修复中",
        "平台账号已登记",
        "登记",
    )
    return any(text.startswith(m) or m in text for m in progress_markers)


def _auth_exhausted_message(slot: str, message: str, *, slug: str = "") -> str:
    label = str((get_slot_meta(slot) or {}).get("label") or slot)
    if _is_antibot_auth_message(message):
        hint = str((get_slot_meta(slot) or {}).get("cookie_hint") or "").strip()
        extra = f" 提示：{hint}" if hint else ""
        return (
            f"「{label}」Cookie 已保存，但仍无法通过站点反爬防护（Cloudflare/Incapsula 等）。"
            "这类令牌不是账号登录，会快速过期。"
            f"{extra}"
            " 若多次失败，该站点可能无法在本环境稳定接入。"
        )
    reason = (message or "").strip()
    if _is_progress_status_message(reason):
        reason = "首拉未获取到文章（列表为空）"
    return (
        f"「{label}」Cookie 已保存，但拉取仍失败。"
        f" 原因：{reason[:220]}。"
        " 请确认 Cookie 来自真实登录且未过期；若仍失败，该源可能暂不支持接入。"
    )


def _zero_article_failure_message(
    item: BatchItem,
    *,
    slot: str = "",
    refresh_result: dict[str, Any] | None = None,
) -> str:
    _ = slot  # 保留参数以兼容旧调用；空列表不再归因于 Cookie
    if _skill_requires_cookie(item.slug) and not slot_configured(slot):
        meta = get_slot_meta(slot) if slot else None
        label = str((meta or {}).get("label") or slot or item.name or item.slug)
        return (
            f"「{label}」首拉未获取到文章：需要有效的反爬/登录 Cookie。"
            " 请完成授权后重试；若已授权仍失败，令牌可能已过期。"
        )
    return _neutral_empty_refresh_message(item, refresh_result=refresh_result)


def _refresh_has_articles(refresh_result: dict[str, Any]) -> bool:
    if int(refresh_result.get("scoped_upserts") or 0) > 0:
        return True
    if int(refresh_result.get("article_count") or 0) > 0:
        return True
    return int(refresh_result.get("new_article_count") or 0) > 0


def _neutral_empty_refresh_message(
    item: BatchItem,
    *,
    refresh_result: dict[str, Any] | None = None,
) -> str:
    label = item.name or item.slug
    list_seen = int((refresh_result or {}).get("list_items_seen") or 0)
    if list_seen <= 0:
        return (
            f"「{label}」首拉未获取到文章：账号列表为空或暂无可解析的原创帖。"
            " 请确认入口 URL 是否正确，或稍后重试。"
        )
    return (
        f"「{label}」已拉取到列表条目但未入库新文章。"
        " 可能是条目均已存在或字段解析不完整，请稍后重试。"
    )


def _mark_refresh_empty_failure(
    item: BatchItem,
    *,
    slot: str,
    refresh_result: dict[str, Any],
    session,
    result_detail: dict[str, Any],
    detail: str,
) -> None:
    item.status = "failed"
    item.phase = "refresh_empty"
    item.error = detail
    item.message = detail
    session.finish(
        success=False,
        detail={**result_detail, "refresh": refresh_result, "empty": True},
    )


def _mark_needs_auth(item: BatchItem, message: str, *, slot: str | None = None) -> None:
    platform_match = detect_platform(item.entry_url)
    if platform_match and not platform_match.requires_cookie:
        item.status = "failed"
        item.phase = "failed"
        item.error = message
        item.message = _user_facing_failure_message(Exception(message), is_platform=True)
        return
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
    if slot_configured(resolved):
        item.status = "failed"
        item.phase = "auth_ineffective"
        item.message = _auth_exhausted_message(resolved, message, slug=item.slug)
        return
    item.status = "needs_auth"
    item.phase = "needs_auth"
    item.message = _auth_handoff_message(meta, message, resolved)


def _refresh_indicates_auth(refresh_result: dict[str, Any], entry_url: str, slug: str) -> str | None:
    """仅当刷新结果明确指向鉴权失败时返回 slot；空列表不等同于 Cookie 失效。"""
    _ = slug
    if refresh_result.get("auth_required"):
        return (
            str(refresh_result.get("auth_slot") or "").strip().lower()
            or resolve_slot_from_url(entry_url)
        )
    message = str(refresh_result.get("message") or refresh_result.get("error") or "")
    if message and auth_error_should_skip_repair(message):
        return resolve_slot_from_url(entry_url)
    return None


def _empty_refresh_auth_decision(
    slot: str,
    *,
    entry_url: str,
    slug: str = "",
    message: str = "",
    item: BatchItem | None = None,
    refresh_result: dict[str, Any] | None = None,
) -> tuple[bool, str]:
    """首拉 0 篇：True=引导授权，False=明确失败（不可假成功）。"""
    _ = entry_url, slug, message
    sync_runtime_cookies()
    cookie = get_cookie_for_slot(slot)
    slot_id = slot.strip().lower()
    if not cookie_satisfies_slot(slot, cookie) or not slot_configured(slot_id):
        return True, "未配置有效 Cookie，请完成登录授权后重试"
    if item is not None:
        return False, _neutral_empty_refresh_message(item, refresh_result=refresh_result)
    label = str((get_slot_meta(slot_id) or {}).get("label") or slot_id)
    return False, (
        f"「{label}」首拉未获取到文章：账号列表为空或暂无可解析的原创帖。"
        " 请确认入口 URL 是否正确，或稍后重试。"
    )


def _apply_empty_refresh_outcome(
    item: BatchItem,
    *,
    slot: str,
    refresh_result: dict[str, Any],
    session,
    result_detail: dict[str, Any],
) -> None:
    needs_auth, detail = _empty_refresh_auth_decision(
        slot,
        entry_url=item.entry_url,
        slug=item.slug,
        message=item.error or item.message or "",
        item=item,
        refresh_result=refresh_result,
    )
    if needs_auth:
        _mark_needs_auth(item, detail, slot=slot)
        session.finish(
            success=False,
            detail={**result_detail, "refresh": refresh_result, "needs_auth": True},
        )
        return
    _mark_refresh_empty_failure(
        item,
        slot=slot,
        refresh_result=refresh_result,
        session=session,
        result_detail=result_detail,
        detail=detail,
    )


def _finish_refresh_success(
    item: BatchItem,
    *,
    refresh_result: dict[str, Any],
    session,
    result_detail: dict[str, Any],
    base_msg: str,
    phase: str = "done",
) -> None:
    if not _refresh_has_articles(refresh_result):
        detail = _zero_article_failure_message(
            item,
            slot=str(item.auth_slot or resolve_slot_from_url(item.entry_url) or ""),
            refresh_result=refresh_result,
        )
        _mark_refresh_empty_failure(
            item,
            slot=str(item.auth_slot or resolve_slot_from_url(item.entry_url) or ""),
            refresh_result=refresh_result,
            session=session,
            result_detail=result_detail,
            detail=detail,
        )
        return
    item.status = "done"
    item.phase = phase
    item.message = base_msg
    session.finish(success=True, detail={**result_detail, "refresh": refresh_result})


def _exception_needs_auth(exc: BaseException, *, entry_url: str = "") -> dict[str, Any] | None:
    platform_match = detect_platform(entry_url) if entry_url else None
    if platform_match and not platform_match.requires_cookie:
        return None
    info = classify_exception_as_auth(exc)
    if "不存在" in str(exc) or "已停用" in str(exc):
        return None
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


def _assign_item_group(item: BatchItem, batch: OnboardingBatch) -> None:
    _assign_feed_group(item.feed_id, item.group_id or batch.group_id)


def _reassign_completed_item_groups(batch: OnboardingBatch) -> None:
    for item in batch.items:
        if not item.feed_id:
            continue
        if item.status not in ("done", "needs_auth"):
            continue
        _assign_item_group(item, batch)


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


async def _refresh_onboarded_feed(
    feed_client,
    feed_id: str,
    *,
    days: int | None = None,
) -> dict[str, Any]:
    from onboarding.source_onboarding_refresh import ONBOARD_REFRESH_DAYS, refresh_onboarded_feed

    return await refresh_onboarded_feed(
        feed_client,
        feed_id,
        days=max(1, int(days or ONBOARD_REFRESH_DAYS)),
        proof=False,
    )


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
    refresh_days: int = 3
    _task: asyncio.Task | None = field(default=None, repr=False)
    _sem: asyncio.Semaphore | None = field(default=None, repr=False)
    _wake: asyncio.Event | None = field(default=None, repr=False)

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
_active_batch_id: str | None = None
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


def _needs_coding_agent(entry_url: str) -> bool:
    return detect_platform(entry_url.strip()) is None


_needs_cursor_agent = _needs_coding_agent


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
                from onboarding.async_blocking import run_blocking

                display_name = await run_blocking(
                    _refresh_reused_platform_display_name, item
                )
                if batch.cancelled or session.cancelled:
                    raise OnboardingCancelled("接入任务已取消")
                if display_name:
                    session.name = display_name
                    item.message = f"数据源已存在，已更新显示名为「{display_name}」，正在刷新…"
                    session.log("display_name", name=display_name)
                attach_msg = _attach_existing_feed(feed_id=feed_id, group_id=item.group_id or batch.group_id)
                sync_runtime_cookies()
                refresh_result: dict[str, Any] | None = None
                async for refresh_event in refresh_with_auto_repair(
                    slug=item.slug,
                    do_refresh=lambda fid=feed_id, d=batch.refresh_days: _refresh_onboarded_feed(
                        feed_client, fid, days=d
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
                    repaired = bool(refresh_result.get("auto_repaired"))
                    base_msg = str(refresh_result.get("message") or attach_msg)
                    if display_name:
                        base_msg = f"显示名「{display_name}」· {base_msg}"
                    if repaired:
                        base_msg = f"自动修复后{base_msg}"
                    _finish_refresh_success(
                        item,
                        refresh_result=refresh_result,
                        session=session,
                        result_detail={
                            "attached": True,
                            "display_name": display_name,
                        },
                        base_msg=base_msg,
                        phase="attached",
                    )
                _assign_item_group(item, batch)
                if batch.reload:
                    await _schedule_reload(feed_client)
            except Exception as exc:
                auth = _exception_needs_auth(exc, entry_url=item.entry_url)
                if auth:
                    _mark_needs_auth(item, str(exc), slot=auth.get("slot"))
                    _assign_item_group(item, batch)
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

                    # runtime 已判定半成功：跳过首拉，与单次接入一致
                    if data.get("needs_auth"):
                        _mark_needs_auth(
                            item,
                            str(data.get("auth_error") or "需要登录授权"),
                        )
                        _assign_item_group(item, batch)
                        session.finish(
                            success=True,
                            detail={**data, "needs_auth": True},
                        )
                        if batch.reload:
                            await _schedule_reload(feed_client)
                        break

                    try:
                        refresh_result: dict[str, Any] | None = None
                        async for refresh_event in refresh_with_auto_repair(
                            slug=item.slug,
                            do_refresh=lambda fid=item.feed_id, d=batch.refresh_days: _refresh_onboarded_feed(
                                feed_client, fid, days=d
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
                            repaired = bool(refresh_result.get("auto_repaired"))
                            base_msg = str(
                                refresh_result.get("message")
                                or f"已接入并更新 {item.feed_id}"
                            )
                            if repaired:
                                base_msg = f"自动修复后{base_msg}"
                            _finish_refresh_success(
                                item,
                                refresh_result=refresh_result,
                                session=session,
                                result_detail=data,
                                base_msg=base_msg,
                                phase="done",
                            )
                        _assign_item_group(item, batch)
                        if batch.reload:
                            await _schedule_reload(feed_client)
                    except FeedError as exc:
                        auth = _exception_needs_auth(exc, entry_url=item.entry_url)
                        if auth:
                            _mark_needs_auth(item, str(exc), slot=auth.get("slot"))
                            _assign_item_group(item, batch)
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
                        item.message = _user_facing_refresh_failure_message(exc)
                        session.cleanup_partial_skill(feed_id=item.feed_id)
                        session.finish(
                            success=False,
                            detail={**data, "refresh_error": str(exc), "cleaned": True},
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
                item.message = "接入未完成（Agent 未返回结果）；半成品已清理，请重试。"
                session.cleanup_partial_skill(feed_id=item.feed_id)
                session.finish(success=False, detail={"error": item.error, "cleaned": True})
        except OnboardingCancelled:
            item.status = "cancelled"
            item.phase = "cancelled"
            item.message = "已取消"
            session.cleanup_partial_skill(feed_id=item.feed_id)
            session.finish(success=False, detail={"cancelled": True})
        except LLMError as exc:
            auth = _exception_needs_auth(exc, entry_url=item.entry_url)
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
                session.cleanup_partial_skill(feed_id=item.feed_id)
                session.finish(success=False, detail={"error": str(exc), "cleaned": True})
        except Exception as exc:
            auth = _exception_needs_auth(exc, entry_url=item.entry_url)
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
                session.cleanup_partial_skill(feed_id=item.feed_id)
                session.finish(success=False, detail={"error": item.error, "cleaned": True})
        finally:
            unregister_session(session.job_id)


async def _run_batch(batch: OnboardingBatch, feed_client) -> None:
    """共享并发池调度；中途 append 的 queued item 会继续被派发。"""
    global _active_batch_id
    batch._sem = asyncio.Semaphore(batch.max_concurrency)
    batch._wake = asyncio.Event()
    spawned: set[int] = set()
    tasks: set[asyncio.Task] = set()

    def _spawn_queued() -> None:
        for item in batch.items:
            if item.status != "queued":
                continue
            key = id(item)
            if key in spawned:
                continue
            spawned.add(key)
            tasks.add(
                asyncio.create_task(
                    _run_item(batch, item, sem=batch._sem, feed_client=feed_client)
                )
            )

    try:
        while True:
            if batch.cancelled:
                for item in batch.items:
                    if item.status == "queued":
                        item.status = "cancelled"
                        item.message = "已取消"
                for task in list(tasks):
                    if not task.done():
                        task.cancel()
                if tasks:
                    await asyncio.gather(*tasks, return_exceptions=True)
                break

            _spawn_queued()
            live = {task for task in tasks if not task.done()}
            unspawned = any(
                item.status == "queued" and id(item) not in spawned for item in batch.items
            )
            if unspawned:
                continue
            if not live:
                break

            assert batch._wake is not None
            batch._wake.clear()
            wake_task = asyncio.create_task(batch._wake.wait())
            try:
                await asyncio.wait(
                    live | {wake_task},
                    return_when=asyncio.FIRST_COMPLETED,
                )
            finally:
                if not wake_task.done():
                    wake_task.cancel()
                    try:
                        await wake_task
                    except asyncio.CancelledError:
                        pass
    finally:
        if batch.reload and batch.completed > 0:
            await _schedule_reload(feed_client)
            if _reload_task:
                try:
                    await _reload_task
                except Exception:
                    pass
            _reassign_completed_item_groups(batch)
        if batch.cancelled:
            batch.status = "cancelled"
        elif batch.needs_auth > 0 and batch.failed == 0:
            batch.status = "needs_auth"
        else:
            batch.status = "done"
        with _batch_lock:
            if _active_batch_id == batch.batch_id:
                _active_batch_id = None
        batch._wake = None


def get_batch(batch_id: str) -> OnboardingBatch | None:
    with _batch_lock:
        return _batches.get(batch_id)


def get_active_batch() -> OnboardingBatch | None:
    with _batch_lock:
        if not _active_batch_id:
            return None
        batch = _batches.get(_active_batch_id)
        if batch is None or batch.status != "running" or batch.cancelled:
            return None
        return batch


def _existing_identity_keys(batch: OnboardingBatch) -> set[str]:
    keys: set[str] = set()
    for item in batch.items:
        url = (item.entry_url or "").strip()
        if not url:
            continue
        try:
            keys.add(source_identity_key(url))
        except Exception:
            keys.add(url)
    return keys


async def append_to_batch(
    batch: OnboardingBatch,
    entry_urls: list[str],
    *,
    feed_client,
    group_id: str | None = None,
) -> OnboardingBatch:
    if batch.status != "running" or batch.cancelled or batch._wake is None:
        raise ValueError("当前接入任务已结束，请重试")

    urls = parse_entry_urls(entry_urls)
    if not urls:
        raise ValueError("请至少提供一个有效链接")

    seen_slugs = {item.slug for item in batch.items if item.slug}
    existing_keys = _existing_identity_keys(batch)
    gid = (group_id or "").strip() or None

    for url in urls:
        try:
            key = source_identity_key(url)
        except Exception:
            key = url
        if key in existing_keys:
            batch.items.append(
                BatchItem(
                    entry_url=url,
                    status="skipped",
                    skip_reason="已在当前接入任务中",
                    message="已在当前接入任务中",
                    group_id=gid,
                )
            )
            continue
        item = _prepare_item(url, seen_slugs)
        item.group_id = gid
        if item.entry_url:
            try:
                existing_keys.add(source_identity_key(item.entry_url))
            except Exception:
                existing_keys.add(item.entry_url)
        batch.items.append(item)

    needs_agent = any(
        item.status == "queued"
        and not item.reuse_existing
        and _needs_coding_agent(item.entry_url)
        for item in batch.items
    )
    if needs_agent and not has_agent_credentials():
        raise LLMError(
            "请先在设置页配置对话模型 API Key，或配置 Cursor API Key（未知站接入需要其一）",
            status_code=400,
        )

    if batch._wake is not None:
        batch._wake.set()
    return batch


async def start_batch(
    *,
    entry_urls: list[str],
    feed_client,
    max_concurrency: int | None = None,
    auto_validate: bool = True,
    reload: bool = True,
    group_id: str | None = None,
    auto_repair: bool = True,
    days: int = 3,
) -> OnboardingBatch:
    global _active_batch_id

    active = get_active_batch()
    if active is not None:
        try:
            return await append_to_batch(
                active,
                entry_urls,
                feed_client=feed_client,
                group_id=group_id,
            )
        except ValueError as exc:
            if "已结束" not in str(exc):
                raise
            # 活跃 batch 刚收尾：继续走新建

    urls = parse_entry_urls(entry_urls)
    if not urls:
        raise ValueError("请至少提供一个有效链接")

    seen_slugs: set[str] = set()
    gid = (group_id or "").strip() or None
    items = [_prepare_item(url, seen_slugs) for url in urls]
    for item in items:
        item.group_id = gid
    queued = [item for item in items if item.status == "queued"]

    if queued and not has_agent_credentials():
        needs_agent = any(_needs_coding_agent(item.entry_url) for item in queued)
        if needs_agent:
            raise LLMError(
                "请先在设置页配置对话模型 API Key，或配置 Cursor API Key（未知站接入需要其一）",
                status_code=400,
            )

    batch = OnboardingBatch(
        batch_id=_new_batch_id(),
        items=items,
        auto_validate=auto_validate,
        reload=reload,
        max_concurrency=min(10, max(1, max_concurrency or DEFAULT_MAX_CONCURRENCY)),
        group_id=gid,
        auto_repair=auto_repair,
        refresh_days=max(1, min(30, int(days))),
    )

    with _batch_lock:
        _batches[batch.batch_id] = batch
        _active_batch_id = batch.batch_id

    if not queued:
        batch.status = "done"
        with _batch_lock:
            if _active_batch_id == batch.batch_id:
                _active_batch_id = None
        return batch

    batch._task = asyncio.create_task(_run_batch(batch, feed_client))
    return batch


async def cancel_batch(batch_id: str) -> bool:
    global _active_batch_id

    batch = get_batch(batch_id)
    if batch is None or batch.status != "running":
        return False

    batch.cancelled = True
    # 立刻腾出「活跃 batch」槽位，避免终止后新接入仍挂到旧任务上
    with _batch_lock:
        if _active_batch_id == batch.batch_id:
            _active_batch_id = None
    for item in batch.items:
        if item.status == "queued":
            item.status = "cancelled"
            item.message = "已取消"
        elif item.status == "running" and item.job_id:
            await cancel_agent_run(item.job_id)
            from onboarding.source_onboarding_log import cancel_job

            cancel_job(item.job_id)
    if batch._wake is not None:
        batch._wake.set()
    return True
