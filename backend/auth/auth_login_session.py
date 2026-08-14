"""本机弹出浏览器登录窗，自动读取 Cookie（Playwright）。

说明：普通网页 iframe 无法读取跨域 HttpOnly Cookie；因此用本机浏览器
窗口完成登录（优先系统 Chrome/Edge，其次 Playwright Chromium），前端轮询会话状态。
"""

from __future__ import annotations

import asyncio
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal

from auth.auth_signals import resolve_slot_from_url
from auth.credential_store import cookie_satisfies_slot, get_slot_meta, upsert_credential

SessionStatus = Literal["starting", "waiting_login", "capturing", "done", "error", "cancelled"]


@dataclass
class LoginSession:
    session_id: str
    slot: str
    login_url: str
    label: str
    status: SessionStatus = "starting"
    message: str = "正在打开登录窗口…"
    error: str = ""
    cookie: str = ""
    masked: str = ""
    credential_id: str = ""
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    _cancel: threading.Event = field(default_factory=threading.Event, repr=False)
    _thread: threading.Thread | None = field(default=None, repr=False)
    _browser: Any = field(default=None, repr=False)

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "slot": self.slot,
            "login_url": self.login_url,
            "label": self.label,
            "status": self.status,
            "message": self.message,
            "error": self.error,
            "masked": self.masked,
            "credential_id": self.credential_id or None,
            "done": self.status in {"done", "error", "cancelled"},
        }


_sessions: dict[str, LoginSession] = {}
_lock = threading.Lock()


def _set_status(session: LoginSession, status: SessionStatus, message: str, *, error: str = "") -> None:
    session.status = status
    session.message = message
    session.error = error
    session.updated_at = time.time()


def _cookies_to_header(cookies: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    seen: set[str] = set()
    for item in cookies:
        name = str(item.get("name") or "").strip()
        value = str(item.get("value") or "")
        if not name or name in seen:
            continue
        seen.add(name)
        parts.append(f"{name}={value}")
    return "; ".join(parts)


def _cookie_ready(slot: str, header: str) -> bool:
    return cookie_satisfies_slot(slot, header)


def _try_seed_required_token(context, page, session: LoginSession) -> None:
    """部分站点的签名令牌要访问业务 API 后才会写入 Cookie。

    仅在已出现登录会话 Cookie（如 unb/cookie2）且仍缺签名令牌时触发，
    避免匿名请求下发 _m_h5_tk 后被误判为已登录并关窗。
    """
    meta = get_slot_meta(session.slot) or {}
    token_spec = str(meta.get("required_token") or "").strip()
    if "_m_h5_tk" not in token_spec:
        return
    from auth.credential_store import missing_required_tokens

    header = _cookies_to_header(context.cookies())
    missing = missing_required_tokens(header, token_spec)
    # 尚无会话字段：等用户扫码，不预种令牌
    if "unb" in missing or "cookie2" in missing:
        return
    # 会话已齐，仅缺签名令牌时才种
    if "_m_h5_tk" not in missing:
        return
    seed_url = (
        "https://h5api.m.goofish.com/h5/mtop.taobao.idlemtopsearch.pc.search/1.0/"
        "?jsv=2.7.2&appKey=34839810&t=1&sign=x&v=1.0&type=originaljson"
        "&dataType=json&api=mtop.taobao.idlemtopsearch.pc.search&data=%7B%7D"
    )
    headers = {
        "Referer": "https://www.goofish.com/",
        "Origin": "https://www.goofish.com",
    }
    try:
        context.request.get(seed_url, headers=headers, timeout=15000)
    except Exception:
        pass
    try:
        page.evaluate(
            """async (url) => {
              try {
                await fetch(url, { credentials: 'include', mode: 'cors' });
              } catch (e) {}
            }""",
            seed_url,
        )
    except Exception:
        pass


def _friendly_launch_error(exc: Exception) -> str:
    text = str(exc)
    if "Executable doesn't exist" in text or "playwright install" in text.lower():
        return (
            "未找到登录用浏览器内核。请在本机执行：\n"
            "cd backend && .venv/bin/python -m playwright install chromium\n"
            "完成后重试「打开登录窗口」；也可先用下方粘贴 Cookie。"
        )
    return f"登录窗口异常: {exc}"


def _launch_browser(p):
    """优先本机 Chrome / Edge（登录页更不易被标「不安全」），再回退 Playwright Chromium。

    捆绑 Chromium 常被 X / Google 等判定为自动化环境，出现不安全或无法完成授权；
    知乎等站有时能过，并不代表 X 也能用同一内核登录。
    """
    launch_kwargs: dict[str, Any] = {
        "headless": False,
        # 降低自动化特征，减少登录页直接拦截
        "args": ["--disable-blink-features=AutomationControlled"],
    }
    errors: list[str] = []
    for channel in ("chrome", "msedge", None):
        try:
            kwargs = dict(launch_kwargs)
            if channel:
                kwargs["channel"] = channel
            return p.chromium.launch(**kwargs)
        except Exception as exc:
            errors.append(f"{channel or 'chromium'}: {exc}")
            continue
    detail = " | ".join(errors[-3:]) if errors else "unknown"
    raise RuntimeError(
        "无法启动本机 Chrome/Edge 或 Playwright Chromium。"
        f"请安装 Chrome，或执行 playwright install chromium。详情: {detail}"
    )


def _close_session_browser(session: LoginSession) -> None:
    browser = session._browser
    session._browser = None
    if browser is None:
        return
    try:
        browser.close()
    except Exception:
        pass


def _wait_or_cancel(session: LoginSession, seconds: float) -> bool:
    """等待一段时间；若已取消返回 True。"""
    return session._cancel.wait(timeout=max(0.05, seconds))


def _run_playwright_login(session: LoginSession) -> None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        _set_status(
            session,
            "error",
            "未安装 Playwright，请改用粘贴 Cookie，或执行: pip install playwright && python -m playwright install chromium",
            error="playwright_not_installed",
        )
        return

    try:
        with sync_playwright() as p:
            browser = _launch_browser(p)
            session._browser = browser
            if session._cancel.is_set():
                _set_status(session, "cancelled", "已取消登录")
                _close_session_browser(session)
                return
            context = browser.new_context(
                locale="zh-CN",
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/122.0.0.0 Safari/537.36"
                ),
            )
            page = context.new_page()
            _set_status(
                session,
                "waiting_login",
                "请在弹出的系统浏览器窗口中完成登录（优先本机 Chrome）…",
            )
            try:
                page.goto(session.login_url, wait_until="domcontentloaded", timeout=60000)
            except Exception:
                if session._cancel.is_set():
                    _set_status(session, "cancelled", "已取消登录")
                    _close_session_browser(session)
                    return
                raise

            deadline = time.time() + 10 * 60
            last_header = ""
            last_hint = ""
            while time.time() < deadline:
                if session._cancel.is_set():
                    _set_status(session, "cancelled", "已取消登录")
                    _close_session_browser(session)
                    return
                cookies = context.cookies()
                header = _cookies_to_header(cookies)
                fields_ready = bool(header) and _cookie_ready(session.slot, header)
                if header and not fields_ready:
                    _try_seed_required_token(context, page, session)
                    cookies = context.cookies()
                    header = _cookies_to_header(cookies)
                    fields_ready = bool(header) and _cookie_ready(session.slot, header)

                if header and header != last_header:
                    last_header = header
                    if fields_ready:
                        _set_status(session, "capturing", "已检测到登录态，正在保存…")
                        session.cookie = header
                        try:
                            cred = upsert_credential(
                                slot=session.slot,
                                cookie=header,
                                label=session.label,
                                probe_url=session.login_url,
                            )
                            session.credential_id = str(cred.get("id") or "")
                            session.masked = str(cred.get("masked") or "")
                            _set_status(session, "done", "登录成功，Cookie 已保存")
                        except ValueError as exc:
                            _set_status(session, "waiting_login", f"登录未完成：{exc}")
                        else:
                            _close_session_browser(session)
                            return
                    else:
                        meta = get_slot_meta(session.slot) or {}
                        token_spec = str(meta.get("required_token") or "").strip()
                        from auth.credential_store import missing_required_tokens

                        missing = missing_required_tokens(header, token_spec)
                        if missing:
                            hint = (
                                "请完成扫码/手机登录，确认后窗口会自动保存"
                                f"（仍缺：{', '.join(missing)}）"
                            )
                        else:
                            hint = "仍为访客态，请完成扫码/手机登录后再等待自动捕获"
                        _set_status(session, "waiting_login", hint)
                if _wait_or_cancel(session, 1.2):
                    _set_status(session, "cancelled", "已取消登录")
                    _close_session_browser(session)
                    return

            _close_session_browser(session)
            if session.status != "done":
                _set_status(session, "error", "登录超时，请重试或改用粘贴 Cookie", error="timeout")
    except Exception as exc:
        if session._cancel.is_set():
            _set_status(session, "cancelled", "已取消登录")
        else:
            _set_status(session, "error", _friendly_launch_error(exc), error=str(exc))
        _close_session_browser(session)


def start_login_session(
    *,
    slot: str,
    login_url: str = "",
    label: str = "",
) -> LoginSession:
    slot_id = (slot or "").strip().lower()
    if not slot_id:
        raise ValueError("缺少 slot")
    meta = get_slot_meta(slot_id) or {}
    url = (login_url or "").strip() or str(meta.get("login_url") or "")
    if not url:
        # 尝试从 slot 猜
        if slot_id == "x":
            url = "https://x.com/i/flow/login"
        else:
            raise ValueError("缺少 login_url")
    if slot_id == "x":
        # 强制官方登录流，避免打开博主主页时被拦 / 显示不安全
        url = str(meta.get("login_url") or "https://x.com/i/flow/login")
    display = (label or "").strip() or str(meta.get("label") or slot_id)

    session = LoginSession(
        session_id=uuid.uuid4().hex[:12],
        slot=slot_id,
        login_url=url,
        label=display,
    )
    thread = threading.Thread(
        target=_run_playwright_login,
        args=(session,),
        name=f"askme-login-{session.session_id}",
        daemon=True,
    )
    session._thread = thread
    with _lock:
        _sessions[session.session_id] = session
    thread.start()
    return session


def get_login_session(session_id: str) -> LoginSession | None:
    with _lock:
        return _sessions.get(session_id)


def cancel_login_session(session_id: str) -> LoginSession | None:
    session = get_login_session(session_id)
    if not session:
        return None
    session._cancel.set()
    if session.status not in {"done", "error", "cancelled"}:
        _set_status(session, "cancelled", "已取消登录")
    # 立刻关掉扫码窗口（不等轮询线程下一次醒来）
    _close_session_browser(session)
    return session


def start_login_session_for_url(entry_url: str, *, label: str = "") -> LoginSession:
    from onboarding.source_platform_scaffold import detect_platform

    match = detect_platform(entry_url)
    slot = None
    if match and match.requires_cookie:
        slot = match.platform
    elif not (match and match.platform and not match.requires_cookie):
        slot = resolve_slot_from_url(entry_url)
    if not slot:
        raise ValueError("该链接未识别为需要登录的已知平台，请手动选择平台或粘贴 Cookie")
    meta = get_slot_meta(slot) or {}
    # 优先打开用户给出的主页/笔记链接
    preferred = (entry_url or "").strip() or str(meta.get("login_url") or "")
    return start_login_session(
        slot=slot,
        login_url=preferred,
        label=label or str(meta.get("label") or slot),
    )


async def wait_login_session(session_id: str, *, timeout: float = 1.0) -> LoginSession | None:
    """供异步轮询轻量等待。"""
    session = get_login_session(session_id)
    if not session:
        return None
    await asyncio.sleep(min(timeout, 0.5))
    return get_login_session(session_id)
