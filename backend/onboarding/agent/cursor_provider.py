"""Cursor SDK 接入 Agent Provider。"""

from __future__ import annotations

import asyncio
import json
import os
import secrets
from collections.abc import AsyncIterator
from typing import Any

from core.llm import LLMError
from onboarding.source_onboarding_log import OnboardingCancelled, OnboardingSession
from onboarding.source_skill_writer import (
    is_complete_discovery_skill,
    remove_discovery_skill_dir,
    skill_dir_for,
)
from paths import DATA_DIR, PROJECT_ROOT

INTEGRATIONS_PATH = DATA_DIR / "integrations.json"
CURSOR_API_KEY = "cursor_api_key"

_BRIDGE_AUTH_TOKEN_DASH_ERR = "Missing value for --tool-callback-auth-token"
_BRIDGE_LAUNCH_RETRIES = 3
_bridge_auth_token_patched = False

_CURSOR_SDK_TASK_RETRY_BASE_DELAY_S = 2.0
_CURSOR_SDK_TASK_RETRY_MAX_DELAY_S = 60.0

_active_cursor_runs: dict[str, Any] = {}
_run_lock = asyncio.Lock()


def _safe_bridge_auth_token() -> str:
    for _ in range(32):
        token = secrets.token_urlsafe(32)
        if token and not token.startswith("-"):
            return token
    return "x" + secrets.token_urlsafe(32).lstrip("-")


def _patch_bridge_auth_token_generators() -> None:
    """避免 cursor-sdk 生成以 '-' 开头的 callback auth token。"""
    global _bridge_auth_token_patched
    if _bridge_auth_token_patched:
        return
    try:
        from cursor_sdk import _store_callback, _tool_callback
    except ImportError:
        return
    _tool_callback._new_auth_token = _safe_bridge_auth_token  # type: ignore[attr-defined]
    _store_callback._new_auth_token = _safe_bridge_auth_token  # type: ignore[attr-defined]
    _bridge_auth_token_patched = True


def _is_bridge_auth_token_argv_error(exc: BaseException) -> bool:
    return _BRIDGE_AUTH_TOKEN_DASH_ERR in str(exc)


def _cursor_sdk_error_text(exc: BaseException) -> str:
    message = getattr(exc, "message", None)
    if isinstance(message, str) and message.strip():
        return message.strip()
    return str(exc).strip()


def _is_cursor_sdk_infra_error(exc: BaseException) -> bool:
    """判定是否为可整任务重试的 Cursor SDK / Bridge 基建错误。"""
    if getattr(exc, "is_retryable", False):
        return True
    text = _cursor_sdk_error_text(exc).lower()
    if not text:
        return False
    needles = (
        "internal error",
        "bridge request failed with http 5",
        "bridge request failed with http 502",
        "bridge request failed with http 503",
        "bridge request failed with http 500",
        "bridge request failed with http 504",
        "bridge exited before discovery",
        "missing value for --tool-callback-auth-token",
        "timed out waiting for bridge",
        "bridge process",
        "connecterror",
        "remoteprotocolerror",
        "server disconnected",
        "connection reset",
    )
    return any(n in text for n in needles)


def _cursor_sdk_retry_delay_s(attempt: int) -> float:
    delay = _CURSOR_SDK_TASK_RETRY_BASE_DELAY_S * (2 ** max(0, attempt - 2))
    return min(delay, _CURSOR_SDK_TASK_RETRY_MAX_DELAY_S)


def _cleanup_incomplete_skill_after_infra_error(slug: str) -> bool:
    try:
        if skill_dir_for(slug).exists() and not is_complete_discovery_skill(slug):
            return remove_discovery_skill_dir(slug)
    except Exception:
        return False
    return False


def load_cursor_api_key() -> str:
    env_key = os.getenv("CURSOR_API_KEY", "").strip()
    if env_key:
        return env_key
    if not INTEGRATIONS_PATH.is_file():
        return ""
    try:
        data = json.loads(INTEGRATIONS_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return ""
    return str(data.get(CURSOR_API_KEY, "")).strip()


def mask_cursor_api_key(key: str) -> str:
    value = key.strip()
    if len(value) <= 8:
        return "***"
    return f"{value[:4]}...{value[-4:]}"


async def cancel_cursor_run(job_id: str) -> bool:
    async with _run_lock:
        handle = _active_cursor_runs.get(job_id)
    if handle is None:
        return False
    run = handle.get("run")
    if run is None:
        return True
    try:
        if run.supports("cancel"):
            await run.cancel()
            return True
    except Exception:
        pass
    return False


def _tool_message(name: str, status: str) -> str:
    if name in {"shell", "Shell", "run_terminal_cmd"}:
        return "Cursor 正在终端执行命令…" if status == "running" else "命令执行完成"
    if name in {"edit", "Edit", "write", "Write", "search_replace", "Read", "read"}:
        return "Cursor 正在编辑文件…" if status == "running" else "文件操作完成"
    return f"Cursor 工具 {name} ({status})"


def _tool_call_summary(message: Any) -> str:
    for attr in ("args", "arguments", "input", "params", "command", "path", "query"):
        val = getattr(message, attr, None)
        if val is None or val == "" or val == {}:
            continue
        if isinstance(val, str):
            return val.strip()
        try:
            return json.dumps(val, ensure_ascii=False)
        except (TypeError, ValueError):
            return str(val)
    raw = getattr(message, "raw", None) or getattr(message, "data", None)
    if isinstance(raw, dict):
        for key in ("command", "path", "file_path", "target_file", "query", "pattern"):
            if raw.get(key):
                return str(raw[key])
        try:
            return json.dumps(raw, ensure_ascii=False)
        except (TypeError, ValueError):
            pass
    return ""


async def run_cursor_agent(
    *,
    prompt: str,
    slug: str,
    session: OnboardingSession | None,
    emit_status,
) -> AsyncIterator[dict[str, Any]]:
    """运行 Cursor Local Agent，yield status/tool 事件，最后 yield agent_done。"""
    api_key = load_cursor_api_key()
    if not api_key:
        raise LLMError(
            "请先在设置页配置 Cursor API Key（Dashboard → Integrations）",
            status_code=400,
        )

    try:
        from cursor_sdk import AsyncClient, CursorAgentError, LocalAgentOptions
    except ImportError as exc:
        detail = str(exc).strip()
        hint = (
            "未安装 cursor-sdk，请在 backend 执行: "
            "pip install --index-url https://pypi.org/simple cursor-sdk"
        )
        if "binary wheel" in detail.lower() or "source distribution" in detail.lower():
            hint = (
                "cursor-sdk 需要 macOS 11+ 的原生 Python（arm64 或 x86_64，且 platform.mac_ver 不能停留在 10.16）。"
                "请用 python.org 或 Homebrew 的 Python 3.11+ 重建 backend/.venv，再执行: "
                "pip install cursor-sdk"
            )
        raise LLMError(hint, status_code=500) from exc

    if session:
        session.log_prompt(prompt, slug=slug)

    _patch_bridge_auth_token_generators()
    job_id = session.job_id if session else ""

    task_attempt = 0
    while True:
        task_attempt += 1
        if session:
            session.check_cancelled()

        if task_attempt == 1:
            yield emit_status(
                session, phase="cursor", message="正在启动 Cursor Agent（auto）…"
            )
        else:
            delay = _cursor_sdk_retry_delay_s(task_attempt)
            yield emit_status(
                session,
                phase="cursor_retry",
                message=(
                    f"Cursor SDK 基建错误，{delay:.0f}s 后整任务重试"
                    f"（第 {task_attempt} 次）…"
                ),
            )
            if session:
                session.log(
                    "cursor_sdk_retry",
                    attempt=task_attempt,
                    delay_s=delay,
                )
            await asyncio.sleep(delay)
            if session:
                session.check_cancelled()
            yield emit_status(
                session,
                phase="cursor",
                message=f"正在重新启动 Cursor Agent（第 {task_attempt} 次）…",
            )

        try:
            client = None
            launch_error: BaseException | None = None
            for launch_attempt in range(1, _BRIDGE_LAUNCH_RETRIES + 1):
                try:
                    client = await AsyncClient.launch_bridge(
                        workspace=str(PROJECT_ROOT)
                    )
                    break
                except Exception as exc:
                    launch_error = exc
                    if launch_attempt < _BRIDGE_LAUNCH_RETRIES and (
                        _is_bridge_auth_token_argv_error(exc)
                        or _is_cursor_sdk_infra_error(exc)
                    ):
                        continue
                    raise
            if client is None:
                raise launch_error or RuntimeError("Cursor bridge launch failed")

            async with client:
                async with await client.agents.create(
                    model="auto",
                    api_key=api_key,
                    local=LocalAgentOptions(
                        cwd=str(PROJECT_ROOT),
                        setting_sources=["project"],
                    ),
                ) as agent:
                    if session:
                        session.log(
                            "cursor_agent",
                            agent_id=agent.agent_id,
                            attempt=task_attempt,
                        )

                    run = await agent.send(prompt)
                    async with _run_lock:
                        _active_cursor_runs[job_id] = {"run": run}

                    try:
                        async for message in run.messages():
                            if session:
                                session.check_cancelled()

                            msg_type = getattr(message, "type", "")
                            if msg_type == "tool_call":
                                tool_name = str(
                                    getattr(message, "name", "tool") or "tool"
                                )
                                tool_status = str(
                                    getattr(message, "status", "running") or "running"
                                )
                                yield emit_status(
                                    session,
                                    phase="cursor_tool",
                                    message=_tool_message(tool_name, tool_status),
                                )
                                if session:
                                    session.log_tool(
                                        tool_name,
                                        tool_status,
                                        summary=_tool_call_summary(message),
                                    )
                            elif msg_type == "assistant":
                                pass
                            elif msg_type == "status":
                                status_text = getattr(message, "message", "") or getattr(
                                    message, "status", ""
                                )
                                if status_text:
                                    yield emit_status(
                                        session,
                                        phase="cursor",
                                        message=str(status_text),
                                    )

                        result = await run.wait()
                    finally:
                        async with _run_lock:
                            _active_cursor_runs.pop(job_id, None)

                    if session:
                        session.log(
                            "cursor_finish",
                            status=result.status,
                            duration_ms=result.duration_ms,
                            tools_logged=session.tools_logged,
                            result_preview=(result.result or "")[:2000],
                            attempt=task_attempt,
                        )

                    if session and session.cancelled:
                        raise OnboardingCancelled("任务已取消")

                    if result.status == "cancelled":
                        raise OnboardingCancelled("Cursor Agent 已取消")
                    if result.status != "finished":
                        detail = (result.result or result.status or "unknown").strip()
                        raise LLMError(
                            f"Cursor Agent 未完成: {detail}", status_code=502
                        )

                    yield {
                        "event": "agent_done",
                        "engine": "cursor_sdk",
                        "agent_id": agent.agent_id,
                        "run_id": run.id,
                        "attempts": task_attempt,
                        "result_text": (result.result or ""),
                    }
                    return
        except OnboardingCancelled:
            raise
        except CursorAgentError as exc:
            if not _is_cursor_sdk_infra_error(exc):
                raise LLMError(
                    f"Cursor SDK 错误: {exc.message}", status_code=502
                ) from exc
            cleaned = _cleanup_incomplete_skill_after_infra_error(slug)
            if session:
                session.log(
                    "cursor_sdk_infra_error",
                    attempt=task_attempt,
                    error=_cursor_sdk_error_text(exc),
                    cleaned_incomplete_skill=cleaned,
                )
            continue
        except LLMError as exc:
            detail = str(exc)
            retryable = False
            if detail.startswith("Cursor SDK 错误:") and _is_cursor_sdk_infra_error(exc):
                retryable = True
            elif detail.startswith("Cursor Agent 未完成:"):
                retryable = _is_cursor_sdk_infra_error(exc) or any(
                    n in detail.lower()
                    for n in (
                        "internal error",
                        "http 502",
                        "http 503",
                        "http 500",
                        "http 504",
                        "bridge",
                    )
                )
            if not retryable:
                raise
            cleaned = _cleanup_incomplete_skill_after_infra_error(slug)
            if session:
                session.log(
                    "cursor_sdk_infra_error",
                    attempt=task_attempt,
                    error=detail,
                    cleaned_incomplete_skill=cleaned,
                )
            continue
        except Exception as exc:
            if not _is_cursor_sdk_infra_error(exc):
                raise
            cleaned = _cleanup_incomplete_skill_after_infra_error(slug)
            if session:
                session.log(
                    "cursor_sdk_infra_error",
                    attempt=task_attempt,
                    error=_cursor_sdk_error_text(exc),
                    cleaned_incomplete_skill=cleaned,
                )
            continue
