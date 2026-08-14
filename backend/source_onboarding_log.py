"""数据源接入任务：运行登记、取消、JSONL 日志。"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

LOGS_DIR = Path(__file__).resolve().parent.parent / "data" / "onboarding-logs"
MAX_LOG_FIELD_CHARS = 8000


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
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        self._log_path = LOGS_DIR / f"{job_id}.jsonl"
        self.log(
            "start",
            entry_url=entry_url,
            slug=slug,
            name=name,
            started_at=self.started_at,
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

    def cleanup_partial_skill(self) -> None:
        """接入失败/取消时清理本任务可能留下的 skill 目录。

        Cursor Agent 可能在 mark_files_written 之前就已写出部分文件，
        因此不能只依赖 files_written 标志。
        """
        if self.kind == "repair":
            return
        from source_skill_writer import remove_discovery_skill_dir, skill_dir_for

        skill_dir = skill_dir_for(self.slug)
        if not skill_dir.is_dir():
            return
        if remove_discovery_skill_dir(self.slug):
            self.log("cleanup", removed=str(skill_dir), files_written=self.files_written)
            try:
                from feed_registry import feed_registry

                feed_registry.purge_feed(f"website:{self.slug}")
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
