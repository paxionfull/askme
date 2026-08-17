"""Askme 接入 Agent 的本地工具（读/写/替换/检索/HTTP 侦察/校验/shell）。"""

from __future__ import annotations

import asyncio
import json
import re
import shlex
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

from paths import PROJECT_ROOT, SKILLS_LIB, SKILLS_ROOT

MAX_READ_CHARS = 80_000
MAX_SHELL_OUTPUT_CHARS = 24_000
MAX_PROBE_BODY_CHARS = 12_000
DEFAULT_SHELL_TIMEOUT_S = 90
VALIDATE_SHELL_TIMEOUT_S = 180
DEFAULT_PROBE_TIMEOUT_S = 12

_SENSITIVE_NAME_RE = re.compile(
    r"(^|/)\.env($|\.)|(^|/)integrations\.json$|(^|/)credentials|(^|/)secrets?",
    re.IGNORECASE,
)
_BLOCKED_SHELL_RE = re.compile(
    r"(?:\brm\s+-rf\b|\bsudo\b|\bchmod\s+777\b|>\s*/|\bmkfs\b|\bdd\s+if=)",
    re.IGNORECASE,
)
_JS_CHALLENGE_RE = re.compile(
    r"(cloudflare|cf-challenge|attention required|just a moment|"
    r"安全检测|正在进行安全检测|are you a robot|perimeterx|_pxhd|"
    r"enable javascript|captcha|access denied)",
    re.IGNORECASE,
)
_LOGIN_WALL_RE = re.compile(
    r"(请先登录|login required|sign in to continue|/login|accounts\.google|"
    r"passport\.|oauth)",
    re.IGNORECASE,
)
_API_URL_RE = re.compile(
    r"""https?://[^\s"'<>\\]+|/api/[a-zA-Z0-9_./\-?=&%]+""",
    re.IGNORECASE,
)
_NEXT_DATA_RE = re.compile(
    r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>',
    re.IGNORECASE | re.DOTALL,
)

DEFAULT_PROBE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}


@dataclass
class ToolBudget:
    """工具配额与阶段状态（单次 agent run 内共享）。"""

    phase: str = "recon"
    shell_used: int = 0
    shell_limit: int = 10
    recent_shells: list[str] = field(default_factory=list)
    blocker: dict[str, str] | None = None
    stop_requested: bool = False
    validate_ok: bool | None = None
    validate_detail: str = ""

    def shell_remaining(self) -> int:
        return max(0, self.shell_limit - self.shell_used)


PHASE_SHELL_LIMITS = {
    "recon": 10,
    "select": 0,
    "implement": 6,
    "validate": 8,
}

PHASE_ORDER = ("recon", "select", "implement", "validate")

TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "set_phase",
            "description": (
                "Advance workflow phase. Order: recon → select → implement → validate. "
                "Call when the current phase gate is satisfied."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "phase": {
                        "type": "string",
                        "enum": list(PHASE_ORDER),
                    },
                    "note": {"type": "string"},
                },
                "required": ["phase"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "http_probe",
            "description": (
                "Fetch a URL with browser-like headers. Returns status, content-type, "
                "truncated body, and signals (js_challenge, login_wall, json, api candidates). "
                "Prefer this over run_shell curl for reconnaissance."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "method": {"type": "string", "enum": ["GET", "HEAD"]},
                    "headers_json": {
                        "type": "string",
                        "description": "Optional JSON object of extra headers",
                    },
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_validate",
            "description": (
                "Run discovery_validate.py for the current slug using the project venv Python. "
                "Prefer this over hand-written shell validate commands."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "slug": {
                        "type": "string",
                        "description": "Optional; defaults to the task slug",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "report_blocker",
            "description": (
                "Stop the agent after declaring a blocker. "
                "For auth_required/js_challenge: ONLY after a COMPLETE discovery skill "
                "(discover.py with FEED_ID/fetch_list_page/fetch_article_detail + "
                "source.yaml requires_cookie/auth_slot). Detail pages must raise "
                "ASKME_AUTH_REQUIRED when Cookie is missing. "
                "no_list_source may be used without a complete skill."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "kind": {
                        "type": "string",
                        "enum": [
                            "auth_required",
                            "js_challenge",
                            "no_list_source",
                            "other",
                        ],
                    },
                    "detail": {"type": "string"},
                    "auth_slot": {"type": "string"},
                },
                "required": ["kind", "detail"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read a text file under the Askme project root.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Project-relative or absolute path",
                    },
                    "offset": {
                        "type": "integer",
                        "description": "1-based start line (optional)",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max lines to return (optional)",
                    },
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": (
                "Create or overwrite a file under the target discovery skill "
                "(or allowed platform _lib for platform repairs)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "str_replace",
            "description": "Replace an exact substring in an allowed writable file.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "old_string": {"type": "string"},
                    "new_string": {"type": "string"},
                    "replace_all": {"type": "boolean"},
                },
                "required": ["path", "old_string", "new_string"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "grep",
            "description": "Search file contents under skills/ (ripgrep-like, Python).",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {"type": "string"},
                    "path": {
                        "type": "string",
                        "description": "Directory or file under skills/",
                    },
                    "glob": {"type": "string"},
                    "head_limit": {"type": "integer"},
                },
                "required": ["pattern"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_shell",
            "description": (
                "Run a shell command in the project root (quota-limited). "
                "Prefer http_probe for HTTP recon and run_validate for validation. "
                "Bare python/python3 is rewritten to backend/.venv/bin/python when present."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string"},
                    "timeout_s": {"type": "integer"},
                },
                "required": ["command"],
            },
        },
    },
]


class ToolError(Exception):
    """工具执行失败（返回给模型，不中断整个 agent）。"""


def preferred_python() -> str:
    venv = PROJECT_ROOT / "backend" / ".venv" / "bin" / "python"
    if venv.is_file():
        return str(venv)
    return "python3"


def _resolve_under_root(path: str, *, root: Path = PROJECT_ROOT) -> Path:
    raw = (path or "").strip()
    if not raw:
        raise ToolError("path 不能为空")
    candidate = Path(raw)
    if not candidate.is_absolute():
        candidate = root / candidate
    resolved = candidate.resolve()
    try:
        resolved.relative_to(root.resolve())
    except ValueError as exc:
        raise ToolError(f"路径越界，必须在项目根内: {path}") from exc
    return resolved


def _is_sensitive(path: Path) -> bool:
    rel = str(path.relative_to(PROJECT_ROOT.resolve())).replace("\\", "/")
    return bool(_SENSITIVE_NAME_RE.search(rel))


def allowed_write_roots(slug: str) -> list[Path]:
    roots = [(SKILLS_ROOT / "discovery" / f"{slug}-discovery").resolve()]
    if slug.endswith("-platform"):
        platform_id = slug[: -len("-platform")]
        lib = (SKILLS_ROOT / "discovery" / "_lib").resolve()
        roots.append((lib / f"{platform_id}_common.py").resolve())
        roots.append((lib / f"{platform_id}_scaffold").resolve())
    return roots


def _ensure_writable(path: Path, *, slug: str) -> None:
    resolved = path.resolve()
    for root in allowed_write_roots(slug):
        if root.is_file():
            if resolved == root:
                return
            continue
        try:
            resolved.relative_to(root)
            return
        except ValueError:
            continue
    raise ToolError(
        f"禁止写入该路径（仅允许目标 skill 目录"
        f"{' 与对应平台 _lib' if slug.endswith('-platform') else ''}）: {path}"
    )


def tool_read_file(
    path: str,
    *,
    offset: int | None = None,
    limit: int | None = None,
) -> str:
    target = _resolve_under_root(path)
    if _is_sensitive(target):
        raise ToolError(f"禁止读取敏感文件: {path}")
    if not target.is_file():
        raise ToolError(f"文件不存在: {path}")
    text = target.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines(keepends=True)
    start = 0
    if offset is not None and int(offset) > 1:
        start = max(0, int(offset) - 1)
    end = len(lines)
    if limit is not None and int(limit) > 0:
        end = min(len(lines), start + int(limit))
    chunk = "".join(lines[start:end])
    if len(chunk) > MAX_READ_CHARS:
        chunk = chunk[:MAX_READ_CHARS] + f"\n…[truncated {len(chunk) - MAX_READ_CHARS} chars]"
    header = f"# {target.relative_to(PROJECT_ROOT)} lines {start + 1}-{end}\n"
    return header + chunk


def tool_write_file(path: str, content: str, *, slug: str) -> str:
    target = _resolve_under_root(path)
    _ensure_writable(target, slug=slug)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return f"wrote {len(content)} chars → {target.relative_to(PROJECT_ROOT)}"


def tool_str_replace(
    path: str,
    old_string: str,
    new_string: str,
    *,
    slug: str,
    replace_all: bool = False,
) -> str:
    target = _resolve_under_root(path)
    _ensure_writable(target, slug=slug)
    if not target.is_file():
        raise ToolError(f"文件不存在: {path}")
    text = target.read_text(encoding="utf-8")
    if old_string not in text:
        raise ToolError("old_string 未在文件中找到")
    count = text.count(old_string)
    if not replace_all and count > 1:
        raise ToolError(
            f"old_string 出现 {count} 次；请提供唯一上下文，或设 replace_all=true"
        )
    if replace_all:
        updated = text.replace(old_string, new_string)
        n = count
    else:
        updated = text.replace(old_string, new_string, 1)
        n = 1
    target.write_text(updated, encoding="utf-8")
    return f"replaced {n} occurrence(s) in {target.relative_to(PROJECT_ROOT)}"


def tool_grep(
    pattern: str,
    *,
    path: str = "skills",
    glob: str = "",
    head_limit: int = 40,
) -> str:
    root = _resolve_under_root(path or "skills")
    try:
        root.relative_to(SKILLS_ROOT.resolve())
    except ValueError as exc:
        raise ToolError("grep 仅允许在 skills/ 下搜索") from exc
    try:
        regex = re.compile(pattern)
    except re.error as exc:
        raise ToolError(f"无效正则: {exc}") from exc

    matches: list[str] = []
    limit = max(1, min(200, int(head_limit or 40)))
    glob_pat = (glob or "").strip()

    def _iter_files() -> list[Path]:
        if root.is_file():
            return [root]
        if glob_pat:
            return sorted(root.rglob(glob_pat))
        return [p for p in root.rglob("*") if p.is_file()]

    for file_path in _iter_files():
        if not file_path.is_file():
            continue
        if _is_sensitive(file_path):
            continue
        if file_path.suffix.lower() in {".pyc", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".zip"}:
            continue
        try:
            text = file_path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for i, line in enumerate(text.splitlines(), start=1):
            if regex.search(line):
                rel = file_path.relative_to(PROJECT_ROOT)
                matches.append(f"{rel}:{i}:{line[:240]}")
                if len(matches) >= limit:
                    return "\n".join(matches)
    return "\n".join(matches) if matches else "(no matches)"


def _normalize_shell_python(command: str) -> str:
    """把裸 python/python3 换成仓库 venv，减少环境踩坑。"""
    py = preferred_python()
    parts = command.strip()
    for prefix in ("python3 ", "python "):
        if parts.startswith(prefix):
            return f"{py} {parts[len(prefix):]}"
    if parts in {"python", "python3"}:
        return py
    return command


def tool_set_phase(phase: str, *, budget: ToolBudget, note: str = "") -> str:
    target = (phase or "").strip().lower()
    if target not in PHASE_ORDER:
        raise ToolError(f"无效 phase: {phase}；允许: {', '.join(PHASE_ORDER)}")
    cur = budget.phase
    if cur not in PHASE_ORDER:
        cur = "recon"
    if PHASE_ORDER.index(target) < PHASE_ORDER.index(cur):
        raise ToolError(f"不能回退 phase（当前 {cur} → 请求 {target}）")
    budget.phase = target
    budget.shell_used = 0
    budget.shell_limit = PHASE_SHELL_LIMITS.get(target, 6)
    budget.recent_shells.clear()
    extra = f" note={note}" if note.strip() else ""
    return (
        f"phase={target} shell_quota={budget.shell_limit}{extra}. "
        f"Continue with tools appropriate for this phase."
    )


def tool_report_blocker(
    kind: str,
    detail: str,
    *,
    budget: ToolBudget,
    slug: str = "",
    auth_slot: str = "",
) -> str:
    from onboarding.source_skill_writer import is_complete_discovery_skill

    k = (kind or "other").strip().lower()
    if k not in {"auth_required", "js_challenge", "no_list_source", "other"}:
        k = "other"

    # 与 Cursor 一致：鉴权/反爬须先写完整 skill，再靠 validate 撞 ASKME_AUTH_REQUIRED
    if k in {"auth_required", "js_challenge"}:
        safe = (slug or "").strip()
        if not safe or not is_complete_discovery_skill(safe):
            raise ToolError(
                "auth_required/js_challenge 要求先写完整 discovery skill："
                f"skills/discovery/{safe or '<slug>'}-discovery/scripts/discover.py "
                "须含 FEED_ID / fetch_list_page / fetch_article_detail；"
                "source.yaml 须含 requires_cookie 与 auth_slot。"
                "列表可用 sitemap 或公开 API；详情缺 Cookie 时在 discover.py 抛 "
                "ASKME_AUTH_REQUIRED:slot=...。"
                "写完后再调用 report_blocker，或直接 run_validate。"
            )

    payload = {
        "kind": k,
        "detail": (detail or "").strip()[:2000],
        "auth_slot": (auth_slot or "").strip(),
    }
    budget.blocker = payload
    budget.stop_requested = True
    return "blocker_recorded " + json.dumps(payload, ensure_ascii=False)


def tool_http_probe(
    url: str,
    *,
    method: str = "GET",
    headers_json: str = "",
) -> str:
    raw_url = (url or "").strip()
    if not raw_url:
        raise ToolError("url 不能为空")
    parsed = urlparse(raw_url)
    if parsed.scheme not in {"http", "https"}:
        raise ToolError("仅允许 http/https URL")

    headers = dict(DEFAULT_PROBE_HEADERS)
    if headers_json.strip():
        try:
            extra = json.loads(headers_json)
        except json.JSONDecodeError as exc:
            raise ToolError(f"headers_json 不是合法 JSON: {exc}") from exc
        if not isinstance(extra, dict):
            raise ToolError("headers_json 必须是对象")
        for key, value in extra.items():
            headers[str(key)] = str(value)

    m = (method or "GET").upper()
    if m not in {"GET", "HEAD"}:
        raise ToolError("method 仅支持 GET/HEAD")

    req = urllib.request.Request(raw_url, headers=headers, method=m)
    status = 0
    content_type = ""
    body = ""
    final_url = raw_url
    try:
        with urllib.request.urlopen(req, timeout=DEFAULT_PROBE_TIMEOUT_S) as resp:
            status = int(getattr(resp, "status", 0) or resp.getcode() or 0)
            content_type = str(resp.headers.get("Content-Type") or "")
            final_url = str(resp.geturl() or raw_url)
            if m != "HEAD":
                raw = resp.read(MAX_PROBE_BODY_CHARS + 1)
                body = raw.decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        status = int(exc.code or 0)
        content_type = str(exc.headers.get("Content-Type") or "") if exc.headers else ""
        try:
            raw = exc.read(MAX_PROBE_BODY_CHARS + 1) if m != "HEAD" else b""
            body = raw.decode("utf-8", errors="replace")
        except Exception:
            body = ""
    except Exception as exc:
        raise ToolError(f"http_probe 失败: {exc}") from exc

    truncated = len(body) > MAX_PROBE_BODY_CHARS
    if truncated:
        body = body[:MAX_PROBE_BODY_CHARS]

    js_challenge = bool(_JS_CHALLENGE_RE.search(body + "\n" + content_type))
    login_wall = bool(_LOGIN_WALL_RE.search(body))
    looks_json = "json" in content_type.lower() or body.lstrip().startswith(("{", "["))
    has_next_data = bool(_NEXT_DATA_RE.search(body))

    api_candidates: list[str] = []
    for match in _API_URL_RE.findall(body):
        cand = match.strip().rstrip("\\.,);]")
        if cand.startswith("/"):
            cand = urljoin(final_url, cand)
        if cand not in api_candidates:
            api_candidates.append(cand)
        if len(api_candidates) >= 12:
            break

    result = {
        "url": raw_url,
        "final_url": final_url,
        "status": status,
        "content_type": content_type,
        "body_chars": len(body),
        "truncated": truncated,
        "signals": {
            "js_challenge": js_challenge,
            "login_wall": login_wall,
            "looks_json": looks_json,
            "has_next_data": has_next_data,
        },
        "api_url_candidates": api_candidates,
        "body_preview": body[:4000],
    }
    hint = ""
    if js_challenge:
        hint = (
            " HINT: JS/security challenge detected. Do not burn shell quota. "
            "If list APIs are unreachable, write source.yaml auth fields if cookie-based, "
            "or call report_blocker(kind=js_challenge|no_list_source)."
        )
    elif login_wall:
        hint = " HINT: Possible login wall — consider ASKME_AUTH_REQUIRED + auth_slot."
    return json.dumps(result, ensure_ascii=False) + hint


async def tool_run_validate(
    *,
    slug: str,
    budget: ToolBudget | None = None,
    cancel_check=None,
) -> str:
    safe = (slug or "").strip()
    if not safe:
        raise ToolError("slug 不能为空")
    script = SKILLS_LIB / "discovery_validate.py"
    if not script.is_file():
        raise ToolError(f"找不到校验脚本: {script}")
    py = preferred_python()
    cmd = f"{shlex.quote(py)} {shlex.quote(str(script))} {shlex.quote(safe)}"
    text = await tool_run_shell(
        cmd,
        timeout_s=VALIDATE_SHELL_TIMEOUT_S,
        cancel_check=cancel_check,
        budget=None,  # validate 不计入 shell 配额
    )
    ok = text.startswith("exit_code=0")
    if budget is not None:
        budget.validate_ok = ok
        budget.validate_detail = text[:2000]
    return text


async def tool_run_shell(
    command: str,
    *,
    timeout_s: int | None = None,
    cancel_check=None,
    budget: ToolBudget | None = None,
) -> str:
    cmd = _normalize_shell_python((command or "").strip())
    if not cmd:
        raise ToolError("command 不能为空")
    if _BLOCKED_SHELL_RE.search(cmd):
        raise ToolError("命令包含被禁止的危险模式")

    try:
        shlex.split(cmd)
    except ValueError as exc:
        raise ToolError(f"命令解析失败: {exc}") from exc

    if budget is not None:
        if budget.shell_remaining() <= 0:
            raise ToolError(
                f"当前 phase={budget.phase} 的 run_shell 配额已用尽"
                f"（limit={budget.shell_limit}）。改用 http_probe / run_validate，"
                f"或 set_phase 进入下一阶段。"
            )
        norm = " ".join(cmd.split())
        if norm in budget.recent_shells[-5:]:
            raise ToolError(
                "拒绝重复执行相同 shell 命令。请换策略，或改用 http_probe / report_blocker。"
            )

    timeout = int(timeout_s or DEFAULT_SHELL_TIMEOUT_S)
    if "discovery_validate.py" in cmd:
        timeout = max(timeout, VALIDATE_SHELL_TIMEOUT_S)
    timeout = max(5, min(300, timeout))

    if cancel_check:
        cancel_check()

    proc = await asyncio.create_subprocess_shell(
        cmd,
        cwd=str(PROJECT_ROOT),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError as exc:
        proc.kill()
        await proc.wait()
        raise ToolError(f"命令超时（{timeout}s）: {cmd}") from exc

    if cancel_check:
        cancel_check()

    if budget is not None:
        budget.shell_used += 1
        budget.recent_shells.append(" ".join(cmd.split()))
        if len(budget.recent_shells) > 20:
            budget.recent_shells = budget.recent_shells[-20:]

    out = (stdout_b or b"").decode("utf-8", errors="replace")
    err = (stderr_b or b"").decode("utf-8", errors="replace")
    combined = out
    if err.strip():
        combined = (combined + ("\n" if combined else "") + f"[stderr]\n{err}").strip()
    if len(combined) > MAX_SHELL_OUTPUT_CHARS:
        combined = (
            combined[:MAX_SHELL_OUTPUT_CHARS]
            + f"\n…[truncated {len(combined) - MAX_SHELL_OUTPUT_CHARS} chars]"
        )
    code = proc.returncode if proc.returncode is not None else -1
    quota = ""
    if budget is not None:
        quota = f"\nshell_quota_remaining={budget.shell_remaining()} phase={budget.phase}"
    return f"exit_code={code}\n{combined or '(no output)'}{quota}"


async def dispatch_tool(
    name: str,
    arguments: dict[str, Any],
    *,
    slug: str,
    cancel_check=None,
    budget: ToolBudget | None = None,
) -> str:
    try:
        if name == "set_phase":
            if budget is None:
                raise ToolError("set_phase 需要 budget")
            return tool_set_phase(
                str(arguments.get("phase") or ""),
                budget=budget,
                note=str(arguments.get("note") or ""),
            )
        if name == "report_blocker":
            if budget is None:
                raise ToolError("report_blocker 需要 budget")
            return tool_report_blocker(
                str(arguments.get("kind") or "other"),
                str(arguments.get("detail") or ""),
                budget=budget,
                slug=slug,
                auth_slot=str(arguments.get("auth_slot") or ""),
            )
        if name == "http_probe":
            return tool_http_probe(
                str(arguments.get("url") or ""),
                method=str(arguments.get("method") or "GET"),
                headers_json=str(arguments.get("headers_json") or ""),
            )
        if name == "run_validate":
            target = str(arguments.get("slug") or slug or "").strip() or slug
            return await tool_run_validate(
                slug=target,
                budget=budget,
                cancel_check=cancel_check,
            )
        if name == "read_file":
            return tool_read_file(
                str(arguments.get("path") or ""),
                offset=arguments.get("offset"),
                limit=arguments.get("limit"),
            )
        if name == "write_file":
            return tool_write_file(
                str(arguments.get("path") or ""),
                str(arguments.get("content") or ""),
                slug=slug,
            )
        if name == "str_replace":
            return tool_str_replace(
                str(arguments.get("path") or ""),
                str(arguments.get("old_string") or ""),
                str(arguments.get("new_string") or ""),
                slug=slug,
                replace_all=bool(arguments.get("replace_all")),
            )
        if name == "grep":
            return tool_grep(
                str(arguments.get("pattern") or ""),
                path=str(arguments.get("path") or "skills"),
                glob=str(arguments.get("glob") or ""),
                head_limit=int(arguments.get("head_limit") or 40),
            )
        if name == "run_shell":
            return await tool_run_shell(
                str(arguments.get("command") or ""),
                timeout_s=arguments.get("timeout_s"),
                cancel_check=cancel_check,
                budget=budget,
            )
        raise ToolError(f"未知工具: {name}")
    except ToolError:
        raise
    except Exception as exc:
        raise ToolError(f"{name} 失败: {exc}") from exc


def parse_tool_arguments(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if not raw:
        return {}
    if isinstance(raw, str):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return {"_raw": raw}
        return data if isinstance(data, dict) else {"_raw": data}
    return {}
