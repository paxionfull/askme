"""Askme 自托管接入 Agent：用户 LLM + 本地 tools + 分阶段门禁。"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

import litellm

from core.llm import LLMError, ensure_configured, resolve_llm_config
from onboarding.agent.tools import (
    PHASE_SHELL_LIMITS,
    TOOL_DEFINITIONS,
    ToolBudget,
    dispatch_tool,
    parse_tool_arguments,
    preferred_python,
)
from onboarding.source_onboarding_log import OnboardingCancelled, OnboardingSession
from paths import ONBOARDING_SKILLS_ROOT, PROJECT_ROOT

MAX_AGENT_TURNS = 55
MAX_RESULT_PREVIEW = 4000

# 各阶段软上限（仍受总轮次约束）
PHASE_TURN_BUDGET = {
    "recon": 12,
    "select": 4,
    "implement": 20,
    "validate": 16,
}

_active_askme_runs: dict[str, dict[str, Any]] = {}
_run_lock = asyncio.Lock()

# 注意：字面量花括号必须写成 {{ }}，避免 str.format 误解析
_SYSTEM_PROMPT = """你是 Askme 数据源接入 / 修复 Agent，在本地仓库内编写或修复 discovery skill。

项目根目录: {project_root}
推荐 Python: {python_bin}
目标 slug: {slug}

## 分阶段流程（强制，用 set_phase 推进）
1. **recon**：用 http_probe 侦察入口页 / 疑似 API / sitemap；少用 run_shell。
   门禁：拿到可信列表源（JSON API / HTML 列表 / sitemap）的证据，或确认阻塞原因。
2. **select**：从任务 catalog 选 ≥2 个参考 skill（只读其 path）；写明 name+path。禁止 ls 全目录。
3. **implement**：只写 skills/discovery/{{slug}}-discovery/（discover.py / source.yaml / SKILL.md）。
   HTTP 必须用 skills/discovery/_lib/http_client；禁止 RSS；禁止 import backend。
4. **validate**：优先 run_validate；失败则按报错小改并重跑。遇到 ASKME_AUTH_REQUIRED 则停止。

## 难站（与 Cursor 同一模式：写好 skill + 等 Cookie）
- http_probe 出现 js_challenge / PerimeterX：不要空转 curl。
- **仍须写完整三件套**：列表优先 sitemap / 公开 API；详情用 Cookie，
  缺 Cookie 时 discover.py 抛 `ASKME_AUTH_REQUIRED:slot=...`；
  source.yaml 写 `requires_cookie` / `auth_slot` / `required_token`。
- 写完整后可 `run_validate`（预期 AUTH）或 `report_blocker(auth_required|js_challenge)`。
- **禁止**只写 source.yaml 就 report_blocker。
- 仅当完全找不到可用列表源时用 `report_blocker(no_list_source)`。

## 工具偏好
- 侦察：http_probe ≫ run_shell
- 校验：run_validate ≫ 手写 python … discovery_validate.py
- run_shell 有 phase 配额且禁止重复命令

## 契约
先 read_file：skills/onboarding/source-onboarding/CONTRACT.md（必要时再读 SKILL.md）。
""".strip()

_PHASE_NUDGES = {
    "recon": (
        "【阶段提醒】仍在 recon。请用 http_probe 收集列表源证据（含 sitemap）；"
        "有可信 list 源后 set_phase(select)。"
        "若仅正文被反爬，仍进入 select/implement 写完整 skill（详情 ASKME_AUTH_REQUIRED）。"
    ),
    "select": (
        "【阶段提醒】在 select。从 catalog 明确写出 ≥2 个参考 skill 的 name 与 path，"
        "read_file 其 discover.py/source.yaml 后 set_phase(implement)。"
    ),
    "implement": (
        "【阶段提醒】在 implement。必须写完 discover.py + source.yaml + SKILL.md "
        "后再 set_phase(validate)。难站也要写完；禁止只写 yaml 就 blocker。"
    ),
    "validate": (
        "【阶段提醒】在 validate。调用 run_validate；"
        "ASKME_AUTH_REQUIRED 为预期半成功（等 Cookie），不要当代码 bug 死循环。"
    ),
}


def _tool_status_message(name: str, status: str) -> str:
    mapping = {
        "run_shell": ("Askme Agent 正在执行命令…", "命令执行完成"),
        "http_probe": ("Askme Agent 正在探测 URL…", "URL 探测完成"),
        "run_validate": ("Askme Agent 正在验证 skill…", "验证命令完成"),
        "set_phase": ("Askme Agent 切换阶段…", "阶段已更新"),
        "report_blocker": ("Askme Agent 记录阻塞…", "已记录阻塞"),
        "write_file": ("Askme Agent 正在写文件…", "文件操作完成"),
        "str_replace": ("Askme Agent 正在编辑文件…", "文件操作完成"),
        "read_file": ("Askme Agent 正在读文件…", "文件操作完成"),
        "grep": ("Askme Agent 正在搜索代码…", "搜索完成"),
    }
    if name in mapping:
        return mapping[name][0] if status == "running" else mapping[name][1]
    return f"Askme Agent 工具 {name} ({status})"


def _tool_summary(name: str, args: dict[str, Any]) -> str:
    if name == "run_shell":
        return str(args.get("command") or "")[:200]
    if name == "http_probe":
        return str(args.get("url") or "")[:200]
    if name == "run_validate":
        return str(args.get("slug") or "")[:200]
    if name == "set_phase":
        return str(args.get("phase") or "")[:200]
    if name == "report_blocker":
        return f"{args.get('kind')}: {args.get('detail')}"[:200]
    if name in {"read_file", "write_file", "str_replace"}:
        return str(args.get("path") or "")[:200]
    if name == "grep":
        return str(args.get("pattern") or "")[:200]
    try:
        return json.dumps(args, ensure_ascii=False)[:200]
    except (TypeError, ValueError):
        return name


def _message_to_dict(message: Any) -> dict[str, Any]:
    if isinstance(message, dict):
        return message
    if hasattr(message, "model_dump"):
        return message.model_dump(exclude_unset=False)
    data: dict[str, Any] = {
        "role": getattr(message, "role", "assistant"),
        "content": getattr(message, "content", None),
    }
    tool_calls = getattr(message, "tool_calls", None)
    if tool_calls:
        serialized = []
        for tc in tool_calls:
            if isinstance(tc, dict):
                serialized.append(tc)
                continue
            fn = getattr(tc, "function", None)
            serialized.append(
                {
                    "id": getattr(tc, "id", ""),
                    "type": getattr(tc, "type", "function"),
                    "function": {
                        "name": getattr(fn, "name", "") if fn else "",
                        "arguments": getattr(fn, "arguments", "") if fn else "",
                    },
                }
            )
        data["tool_calls"] = serialized
    return data


def _load_contract_excerpt() -> str:
    """只注入 CONTRACT 摘要，减少 token；全文仍可 read_file。"""
    contract = ONBOARDING_SKILLS_ROOT / "source-onboarding" / "CONTRACT.md"
    if not contract.is_file():
        return ""
    text = contract.read_text(encoding="utf-8")
    if len(text) > 6_000:
        text = text[:6_000] + "\n…[truncated; read_file for full CONTRACT.md]"
    return f"## CONTRACT.md（摘录）\n{text}"


async def cancel_askme_run(job_id: str) -> bool:
    async with _run_lock:
        handle = _active_askme_runs.get(job_id)
    if handle is None:
        return False
    event = handle.get("cancel_event")
    if isinstance(event, asyncio.Event):
        event.set()
    return True


async def run_askme_agent(
    *,
    prompt: str,
    slug: str,
    session: OnboardingSession | None,
    emit_status,
    llm_config: dict[str, Any] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """运行 Askme coding agent，最后 yield agent_done。"""
    config = resolve_llm_config(llm_config)
    ensure_configured(config)

    if session:
        session.log_prompt(prompt, slug=slug)
        session.log(
            "askme_agent",
            model=config.model,
            api_base=config.api_base or "",
        )

    yield emit_status(
        session,
        phase="askme",
        message=f"正在启动 Askme Agent（{config.model}）…",
    )

    system = _SYSTEM_PROMPT.format(
        project_root=str(PROJECT_ROOT),
        python_bin=preferred_python(),
        slug=slug,
    )
    excerpt = _load_contract_excerpt()
    if excerpt:
        system = f"{system}\n\n{excerpt}"

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system},
        {
            "role": "user",
            "content": (
                f"{prompt}\n\n"
                "请从 set_phase 不需要调用开始即可工作；当前默认 phase=recon。"
                "先 http_probe 入口 URL，再推进阶段。"
            ),
        },
    ]

    job_id = session.job_id if session else ""
    cancel_event = asyncio.Event()
    budget = ToolBudget(
        phase="recon",
        shell_limit=PHASE_SHELL_LIMITS["recon"],
    )
    async with _run_lock:
        _active_askme_runs[job_id] = {"cancel_event": cancel_event, "budget": budget}

    def _check_cancel() -> None:
        if cancel_event.is_set() or (session and session.cancelled):
            raise OnboardingCancelled("Askme Agent 已取消")
        if session:
            session.check_cancelled()

    final_text = ""
    turn = 0
    phase_turns: dict[str, int] = {"recon": 0, "select": 0, "implement": 0, "validate": 0}
    try:
        while turn < MAX_AGENT_TURNS:
            turn += 1
            _check_cancel()
            if budget.stop_requested:
                break

            phase = budget.phase if budget.phase in PHASE_TURN_BUDGET else "recon"
            phase_turns[phase] = phase_turns.get(phase, 0) + 1
            soft_cap = PHASE_TURN_BUDGET.get(phase, 15)
            if phase_turns[phase] == soft_cap:
                nudge = _PHASE_NUDGES.get(phase, "")
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            f"{nudge}\n"
                            f"本阶段已用 {phase_turns[phase]}/{soft_cap} 轮。"
                            "请尽快满足门禁并 set_phase，或 report_blocker。"
                        ),
                    }
                )
            elif phase_turns[phase] > soft_cap + 4 and phase == "recon":
                # recon 空转：强制要求 blocker，避免拖到总上限
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "recon 超时。若仍无列表源，必须立即 report_blocker"
                            "(kind=no_list_source|js_challenge|auth_required)。"
                        ),
                    }
                )

            kwargs: dict[str, Any] = {
                "model": config.model,
                "messages": messages,
                "tools": TOOL_DEFINITIONS,
                "tool_choice": "auto",
                "max_tokens": config.max_tokens,
                "timeout": 180,
                "api_key": config.api_key,
                "stream": False,
            }
            if config.api_base:
                kwargs["api_base"] = config.api_base

            try:
                response = await litellm.acompletion(**kwargs)
            except OnboardingCancelled:
                raise
            except Exception as exc:
                raise LLMError(f"Askme Agent LLM 请求失败: {exc}", status_code=502) from exc

            choice = response.choices[0]
            message = choice.message
            msg_dict = _message_to_dict(message)
            messages.append(msg_dict)

            tool_calls = msg_dict.get("tool_calls") or []
            content = (msg_dict.get("content") or "") or ""
            if content.strip():
                final_text = content.strip()

            if not tool_calls:
                break

            for tc in tool_calls:
                _check_cancel()
                if budget.stop_requested:
                    break
                fn = tc.get("function") if isinstance(tc, dict) else {}
                name = str((fn or {}).get("name") or "tool")
                args = parse_tool_arguments((fn or {}).get("arguments"))
                tool_id = str(tc.get("id") or name)

                yield emit_status(
                    session,
                    phase="askme_tool",
                    message=_tool_status_message(name, "running"),
                )
                if session:
                    session.log_tool(
                        name,
                        "running",
                        summary=_tool_summary(name, args),
                    )

                try:
                    result = await dispatch_tool(
                        name,
                        args,
                        slug=slug,
                        cancel_check=_check_cancel,
                        budget=budget,
                    )
                    status = "completed"
                except OnboardingCancelled:
                    raise
                except Exception as exc:
                    result = f"ERROR: {exc}"
                    status = "error"

                yield emit_status(
                    session,
                    phase="askme_tool",
                    message=_tool_status_message(name, status),
                )
                if session:
                    session.log_tool(
                        name,
                        status,
                        summary=_tool_summary(name, args),
                    )
                    if name == "set_phase" and status == "completed":
                        session.log("askme_phase", phase=budget.phase)

                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_id,
                        "content": result[:24_000],
                    }
                )
        else:
            if not budget.stop_requested:
                raise LLMError(
                    f"Askme Agent 超过最大轮次（{MAX_AGENT_TURNS}），"
                    "请换更强模型、补充 hints，或确认站点是否需登录/反爬",
                    status_code=502,
                )

        blocker = budget.blocker
        if session:
            session.log(
                "askme_finish",
                turns=turn,
                tools_logged=session.tools_logged,
                result_preview=final_text[:2000],
                phase=budget.phase,
                blocker=blocker,
                validate_ok=budget.validate_ok,
            )

        done: dict[str, Any] = {
            "event": "agent_done",
            "engine": "askme",
            "agent_id": f"askme:{config.model}",
            "run_id": job_id or "askme",
            "attempts": 1,
            "result_text": final_text[:MAX_RESULT_PREVIEW],
            "turns": turn,
            "phase": budget.phase,
            "blocker": blocker,
            "validate_ok": budget.validate_ok,
        }
        if blocker and blocker.get("kind") in {"auth_required", "js_challenge"}:
            done["needs_auth"] = True
        yield done
    finally:
        async with _run_lock:
            _active_askme_runs.pop(job_id, None)
