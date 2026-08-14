"""数据源接入任务：运行登记、取消、JSONL 日志。

日志策略：结构化任务时间线（决策/结果），不记流式心跳。
- 不写 cursor_assistant_chunk
- status：phase/message 去重，并跳过裸 RUNNING
- cursor_tool：running 不落盘，完成时写一条（可带短摘要）
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

from paths import DATA_DIR

LOGS_DIR = DATA_DIR / "onboarding-logs"
MAX_LOG_FIELD_CHARS = 12000
PROMPT_LOG_PREVIEW_CHARS = 500
TOOL_SUMMARY_CHARS = 200

# 不落盘的 Cursor 运行态文案（仍可通过 SSE 推给前端；结果见 cursor_finish）
_STATUS_SKIP_MESSAGES = frozenset({"RUNNING", "running", "FINISHED", "finished"})


class OnboardingCancelled(Exception):
    """用户或客户端中断接入任务。"""


class OnboardingSession:
    def __init__(
        self,
        *,
        job_id: str,
        entry_url: str,
        slug: str,
        name: str = "",
        kind: str = "onboard",
    ) -> None:
        self.job_id = job_id
        self.entry_url = entry_url
        self.slug = slug
        self.name = name
        self.kind = kind
        self.cancelled = False
        self.files_written = False
        self.completed = False
        self.started_at = _now_iso()
        self._last_status_key: tuple[str, str] | None = None
        self._pending_tools: dict[str, bool] = {}
        self.tools_logged = 0
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        self._log_path = LOGS_DIR / f"{job_id}.jsonl"
        self.log(
            "start",
            entry_url=entry_url,
            slug=slug,
            name=name,
            started_at=self.started_at,
            kind=kind,
        )

    def cancel(self, *, reason: str = "user") -> None:
        if self.completed:
            return
        self.cancelled = True
        self.log("cancel_requested", reason=reason)

    def check_cancelled(self) -> None:
        if self.cancelled:
            raise OnboardingCancelled("接入任务已取消")

    def mark_files_written(self) -> None:
        self.files_written = True
        self.log("files_written", slug=self.slug)

    def finish(self, *, success: bool, detail: dict[str, Any] | None = None) -> None:
        self.completed = True
        payload: dict[str, Any] = {"success": success}
        if detail:
            payload["detail"] = _truncate_value(detail)
        self.log("finish", **payload)

    def log(self, event: str, **payload: Any) -> None:
        record = {
            "ts": _now_iso(),
            "job_id": self.job_id,
            "event": event,
            **_truncate_payload(payload),
        }
        with self._log_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    def log_status(self, phase: str, message: str) -> bool:
        """落盘有意义的 status；跳过重复与裸 RUNNING。返回是否写入。"""
        msg = str(message or "").strip()
        if not msg or msg in _STATUS_SKIP_MESSAGES:
            return False
        key = (str(phase or ""), msg)
        if key == self._last_status_key:
            return False
        self._last_status_key = key
        self.log("status", phase=key[0], message=msg)
        return True

    def log_tool(self, name: str, status: str, *, summary: str = "") -> bool:
        """工具 running 不写；完成/失败写一条。返回是否写入。"""
        tool = str(name or "tool").strip() or "tool"
        st = str(status or "").strip().lower() or "unknown"
        if st in {"running", "in_progress", "pending", "start", "started"}:
            self._pending_tools[tool] = True
            return False
        self._pending_tools.pop(tool, None)
        payload: dict[str, Any] = {"name": tool, "status": st}
        text = str(summary or "").strip()
        if text:
            payload["summary"] = text[:TOOL_SUMMARY_CHARS]
        self.log("cursor_tool", **payload)
        self.tools_logged += 1
        return True

    def log_prompt(self, prompt: str, *, slug: str = "", **extra: Any) -> None:
        text = str(prompt or "")
        payload: dict[str, Any] = {
            "chars": len(text),
            "preview": text[:PROMPT_LOG_PREVIEW_CHARS],
        }
        if slug:
            payload["slug"] = slug
        payload.update(extra)
        self.log("cursor_prompt", **payload)

    def cleanup_partial_skill(self, *, feed_id: str | None = None) -> None:
        """接入失败/取消时清理本任务可能留下的 skill 目录。

        Cursor Agent 可能在 mark_files_written 之前就已写出部分文件，
        因此不能只依赖 files_written 标志。

        不删除：修复任务、平台级 skill、仓库内置网站 skill。
        """
        if self.kind == "repair":
            return
        slug = str(self.slug or "").strip()
        if not slug:
            return
        if slug.endswith("-platform"):
            return
        # 与 .gitignore 白名单对齐的内置网站 skill，禁止 onboard 失败时误删
        if slug in {"jiqizhixin", "qbitai"}:
            return

        from onboarding.source_skill_writer import remove_discovery_skill_dir, skill_dir_for

        skill_dir = skill_dir_for(slug)
        if not skill_dir.is_dir():
            return
        if remove_discovery_skill_dir(slug):
            self.log("cleanup", removed=str(skill_dir), files_written=self.files_written)
            try:
                from feed.feed_registry import feed_registry

                for candidate in (
                    (feed_id or "").strip(),
                    f"website:{slug}",
                ):
                    if candidate:
                        feed_registry.purge_feed(candidate)
            except Exception:
                pass
        self.files_written = False

    @property
    def log_path(self) -> Path:
        return self._log_path


_active: dict[str, OnboardingSession] = {}
_lock = Lock()


def new_job_id() -> str:
    return uuid.uuid4().hex[:12]


def create_session(
    *,
    entry_url: str,
    slug: str,
    name: str = "",
    kind: str = "onboard",
) -> OnboardingSession:
    session = OnboardingSession(
        job_id=new_job_id(),
        entry_url=entry_url,
        slug=slug,
        name=name,
        kind=kind,
    )
    register_session(session)
    return session


def register_session(session: OnboardingSession) -> None:
    with _lock:
        _active[session.job_id] = session


def unregister_session(job_id: str) -> None:
    with _lock:
        _active.pop(job_id, None)


def get_session(job_id: str) -> OnboardingSession | None:
    with _lock:
        return _active.get(job_id)


def cancel_job(job_id: str, *, reason: str = "user") -> bool:
    with _lock:
        session = _active.get(job_id)
        if session is None:
            return False
        session.cancel(reason=reason)
        return True


def list_recent_logs(*, limit: int = 30) -> list[dict[str, Any]]:
    if not LOGS_DIR.is_dir():
        return []
    files = sorted(LOGS_DIR.glob("*.jsonl"), key=lambda path: path.stat().st_mtime, reverse=True)
    summaries: list[dict[str, Any]] = []
    for path in files[:limit]:
        summary = _summarize_log_file(path)
        if summary:
            summaries.append(summary)
    return summaries


def read_log(job_id: str) -> list[dict[str, Any]]:
    path = LOGS_DIR / f"{job_id}.jsonl"
    if not path.is_file():
        return []
    records: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            records.append({"ts": _now_iso(), "event": "parse_error", "raw": line[:500]})
    return records


def _summarize_log_file(path: Path) -> dict[str, Any] | None:
    start: dict[str, Any] | None = None
    last_event = ""
    success: bool | None = None
    cancelled = False
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        event = str(record.get("event", ""))
        last_event = event
        if event == "start":
            start = record
        elif event == "finish":
            success = bool(record.get("success"))
        elif event in {"cancelled", "cancel_requested"}:
            cancelled = True
    if start is None:
        return None
    return {
        "job_id": start.get("job_id", path.stem),
        "entry_url": start.get("entry_url", ""),
        "slug": start.get("slug", ""),
        "name": start.get("name", ""),
        "started_at": start.get("started_at") or start.get("ts", ""),
        "updated_at": datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat(),
        "last_event": last_event,
        "success": success,
        "cancelled": cancelled,
        "log_file": str(path),
    }


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _truncate_value(value: Any) -> Any:
    if isinstance(value, str):
        if len(value) <= MAX_LOG_FIELD_CHARS:
            return value
        return value[:MAX_LOG_FIELD_CHARS] + f"\n…[truncated {len(value) - MAX_LOG_FIELD_CHARS} chars]"
    if isinstance(value, dict):
        return {key: _truncate_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_truncate_value(item) for item in value[:50]]
    return value


def _truncate_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: _truncate_value(value) for key, value in payload.items()}
