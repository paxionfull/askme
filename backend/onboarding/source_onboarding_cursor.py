"""通过 Cursor SDK 接入数据源（替代内部 LLM Agent）。"""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import AsyncIterator
from typing import Any

from feed.feed_registry import feed_registry
from core.llm import LLMError
from onboarding.onboarding_prompt_config import (
    DEFAULT_MAX_REPAIR_ATTEMPTS,
    PROMPT_CURSOR_RESULT_PREVIEW_CHARS,
)
from onboarding.source_onboarding_log import OnboardingCancelled, OnboardingSession
from onboarding.source_platform_scaffold import detect_platform
from onboarding.source_skill_writer import (
    is_complete_discovery_skill,
    remove_discovery_skill_dir,
    skill_dir_for,
    validate_slug,
)
from skills.skill_validate import run_validation
from paths import DATA_DIR, PROJECT_ROOT, SKILLS_LIB

VALIDATE_SCRIPT = SKILLS_LIB / "discovery_validate.py"
INTEGRATIONS_PATH = DATA_DIR / "integrations.json"
CURSOR_API_KEY = "cursor_api_key"

_active_cursor_runs: dict[str, Any] = {}
_run_lock = asyncio.Lock()


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


def _emit_status(
    session: OnboardingSession | None,
    *,
    phase: str,
    message: str,
) -> dict[str, Any]:
    if session:
        session.check_cancelled()
        session.log_status(phase, message)
    event: dict[str, Any] = {"event": "status", "phase": phase, "message": message}
    if session:
        event["job_id"] = session.job_id
    return event


def _tool_message(name: str, status: str) -> str:
    if name in {"shell", "Shell", "run_terminal_cmd"}:
        return "Cursor 正在终端执行命令…" if status == "running" else "命令执行完成"
    if name in {"edit", "Edit", "write", "Write", "search_replace", "Read", "read"}:
        return "Cursor 正在编辑文件…" if status == "running" else "文件操作完成"
    return f"Cursor 工具 {name} ({status})"


def _tool_call_summary(message: Any) -> str:
    """从 Cursor tool_call 消息尽量抽出可排障摘要。"""
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


def _build_cursor_prompt(
    *,
    slug: str,
    name: str,
    entry_url: str,
    hints: str,
    list_api_hint: str,
) -> str:
    return f"""你是 Askme 数据源接入 Agent。请在当前仓库内为以下网站创建 discovery skill，并验证通过。

## 必须使用的项目 skill（强制）
1. **第一步**使用 `/source-onboarding`（打开并遵循 `.cursor/skills/source-onboarding/SKILL.md`）
2. **动手前**阅读 `.cursor/skills/source-onboarding/CONTRACT.md`
3. 参考哪些已有 `*-discovery`、如何选 ≥2 个样例：以 source-onboarding skill 为准（勿照搬 URL/字段）

## 目标
- entry_url: {entry_url}
- slug: {slug}
- name: {name}
- feed_id: website:{slug}
- skill 目录: .cursor/skills/{slug}-discovery/

## 用户提示
- hints: {hints or "(无)"}
- list_api_hint: {list_api_hint or "(无)"}

## 完成标准
- `python .cursor/skills/_lib/discovery_validate.py {slug}` 必须通过
- 可用 `{PROJECT_ROOT}/backend/.venv/bin/python` 或 `python3`
- 完成后一句话说明 feed_id 与验证结果（若停在 ASKME_AUTH_REQUIRED，写出 slot）"""


async def run_cursor_skill_task(
    *,
    slug: str,
    prompt: str,
    auto_validate: bool,
    session: OnboardingSession | None,
    result_engine: str = "cursor_sdk",
    mark_files_written: bool = False,
    auto_repair: bool = True,
    max_repair_attempts: int = DEFAULT_MAX_REPAIR_ATTEMPTS,
) -> AsyncIterator[dict[str, Any]]:
    """运行 Cursor Agent 任务（接入或修复），完成后可选验证；验证失败可自动修复重试。"""
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

    safe_slug = validate_slug(slug)
    if session:
        session.log_prompt(prompt, slug=safe_slug)

    yield _emit_status(session, phase="cursor", message="正在启动 Cursor Agent（auto）…")

    try:
        async with await AsyncClient.launch_bridge(workspace=str(PROJECT_ROOT)) as client:
            async with await client.agents.create(
                model="auto",
                api_key=api_key,
                local=LocalAgentOptions(
                    cwd=str(PROJECT_ROOT),
                    setting_sources=["project"],
                ),
            ) as agent:
                if session:
                    session.log("cursor_agent", agent_id=agent.agent_id)

                run = await agent.send(prompt)
                async with _run_lock:
                    _active_cursor_runs[session.job_id if session else ""] = {"run": run}

                try:
                    async for message in run.messages():
                        if session:
                            session.check_cancelled()

                        msg_type = getattr(message, "type", "")
                        if msg_type == "tool_call":
                            tool_name = str(getattr(message, "name", "tool") or "tool")
                            tool_status = str(getattr(message, "status", "running") or "running")
                            yield _emit_status(
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
                            # 流式正文不落盘；结果见 cursor_finish.result_preview
                            pass
                        elif msg_type == "status":
                            status_text = getattr(message, "message", "") or getattr(
                                message, "status", ""
                            )
                            if status_text:
                                yield _emit_status(
                                    session,
                                    phase="cursor",
                                    message=str(status_text),
                                )

                    result = await run.wait()
                finally:
                    async with _run_lock:
                        _active_cursor_runs.pop(session.job_id if session else "", None)

                if session:
                    session.log(
                        "cursor_finish",
                        status=result.status,
                        duration_ms=result.duration_ms,
                        tools_logged=session.tools_logged,
                        result_preview=(result.result or "")[:2000],
                    )

                if session and session.cancelled:
                    raise OnboardingCancelled("任务已取消")

                if result.status == "cancelled":
                    raise OnboardingCancelled("Cursor Agent 已取消")
                if result.status != "finished":
                    detail = (result.result or result.status or "unknown").strip()
                    raise LLMError(f"Cursor Agent 未完成: {detail}", status_code=502)

                if mark_files_written and session and skill_dir_for(safe_slug).exists():
                    session.mark_files_written()

                validation: dict[str, Any] | None = None
                if auto_validate:
                    from auth.auth_signals import auth_error_should_skip_repair
                    from onboarding.source_skill_repair import (
                        build_validation_failure_feedback,
                        iter_auto_repair_agent,
                    )

                    last_error = ""
                    attempts = max(1, int(max_repair_attempts))
                    for attempt in range(attempts):
                        yield _emit_status(
                            session,
                            phase="validate" if attempt == 0 else "auto_repair",
                            message="正在验证 skill…"
                            if attempt == 0
                            else f"验证失败，正在根据报错自动修复（{attempt}/{attempts - 1}）…",
                        )
                        try:
                            validation = run_validation(safe_slug)
                            if session:
                                session.log("validation", ok=True, result=validation)
                            break
                        except Exception as exc:
                            last_error = str(exc)
                            if session:
                                session.log(
                                    "validation",
                                    ok=False,
                                    error=last_error,
                                    attempt=attempt + 1,
                                )
                            if auth_error_should_skip_repair(last_error):
                                raise LLMError(
                                    last_error
                                    if last_error.startswith("ASKME_AUTH_REQUIRED")
                                    else f"ASKME_AUTH_REQUIRED 验证需登录授权: {last_error}",
                                    status_code=400,
                                ) from exc
                            if attempt >= attempts - 1:
                                raise LLMError(
                                    f"Cursor 已执行但 skill 验证失败: {last_error}",
                                    status_code=502,
                                ) from exc
                            if not auto_repair:
                                raise LLMError(
                                    f"Cursor 已执行但 skill 验证失败（未开启自动修复）: {last_error}",
                                    status_code=502,
                                ) from exc
                            async for event in iter_auto_repair_agent(
                                slug=safe_slug,
                                feedback=build_validation_failure_feedback(
                                    last_error, slug=safe_slug
                                ),
                                error=last_error,
                                issue_types=["wrong_fields", "other"],
                                auto_validate=False,
                                session=session,
                            ):
                                if event.get("event") == "auto_repair_succeeded":
                                    continue
                                yield event

                result_data = {
                    "ok": True,
                    "slug": safe_slug,
                    "feed_id": f"website:{safe_slug}",
                    "skill_dir": f"{safe_slug}-discovery",
                    "analysis": {
                        "engine": result_engine,
                        "agent_id": agent.agent_id,
                        "run_id": run.id,
                        "cursor_result": (result.result or "")[:PROMPT_CURSOR_RESULT_PREVIEW_CHARS],
                    },
                    "validation": validation,
                }
                if session:
                    session.log("result", data=result_data)
                yield {
                    "event": "result",
                    "data": result_data,
                    **({"job_id": session.job_id} if session else {}),
                }
    except CursorAgentError as exc:
        raise LLMError(f"Cursor SDK 错误: {exc.message}", status_code=502) from exc


async def _run_cursor_onboarding(
    *,
    slug: str,
    name: str,
    entry_url: str,
    hints: str,
    list_api_hint: str,
    auto_validate: bool,
    session: OnboardingSession | None,
    auto_repair: bool = True,
) -> AsyncIterator[dict[str, Any]]:
    prompt = _build_cursor_prompt(
        slug=slug,
        name=name,
        entry_url=entry_url,
        hints=hints,
        list_api_hint=list_api_hint,
    )

    async for event in run_cursor_skill_task(
        slug=slug,
        prompt=prompt,
        auto_validate=auto_validate,
        session=session,
        result_engine="cursor_sdk",
        mark_files_written=True,
        auto_repair=auto_repair,
    ):
        yield event


async def run_onboarding_agent(
    *,
    slug: str,
    name: str,
    entry_url: str,
    hints: str = "",
    list_api_hint: str = "",
    llm_config: dict[str, Any] | None = None,
    auto_validate: bool = True,
    session: OnboardingSession | None = None,
    auto_repair: bool = True,
) -> AsyncIterator[dict[str, Any]]:
    """统一接入入口：已知平台走脚手架，其余走 Cursor SDK。"""
    del llm_config  # 不再使用 Askme 内部 LLM Agent
    safe_slug = validate_slug(slug)
    platform = detect_platform(entry_url.strip())
    feed_id = platform.feed_id if platform else f"website:{safe_slug}"

    if skill_dir_for(safe_slug).exists():
        if not is_complete_discovery_skill(safe_slug):
            # 上次接入失败留下的残缺目录，清掉后允许重试
            remove_discovery_skill_dir(safe_slug)
            try:
                feed_registry.purge_feed(feed_id)
            except Exception:
                pass
            if session:
                session.log("cleanup_incomplete", slug=safe_slug, feed_id=feed_id)
        elif feed_registry.is_hidden(feed_id) or (
            is_complete_discovery_skill(safe_slug) and skill_dir_for(safe_slug).exists()
        ):
            restored = False
            if feed_registry.is_hidden(feed_id):
                feed_registry.unhide_feed(feed_id)
                restored = True
                if session:
                    session.log("restore", feed_id=feed_id, slug=safe_slug)
                yield _emit_status(session, phase="restore", message="恢复已移除的数据源…")
            else:
                yield _emit_status(
                    session,
                    phase="attach",
                    message="数据源 skill 已存在，准备加入分组…",
                )
            result_data = {
                "ok": True,
                "slug": safe_slug,
                "feed_id": feed_id,
                "skill_dir": f"{safe_slug}-discovery",
                "restored": restored,
                "already_exists": not restored,
                "analysis": {"restored": restored, "already_exists": not restored},
                "validation": None,
            }
            if session:
                session.log("result", data=result_data)
            yield {
                "event": "result",
                "data": result_data,
                **({"job_id": session.job_id} if session else {}),
            }
            return

    if platform:
        from onboarding.source_platform_onboard import run_platform_onboarding

        async for event in run_platform_onboarding(
            platform=platform,
            slug=safe_slug,
            name=name.strip(),
            auto_validate=auto_validate,
            session=session,
            auto_repair=auto_repair,
        ):
            yield event
        return

    async for event in _run_cursor_onboarding(
        slug=safe_slug,
        name=name.strip(),
        entry_url=entry_url.strip(),
        hints=hints,
        list_api_hint=list_api_hint,
        auto_validate=auto_validate,
        session=session,
        auto_repair=auto_repair,
    ):
        yield event
