"""本机弹出浏览器登录窗，自动读取 Cookie（Playwright）。

说明：普通网页 iframe 无法读取跨域 HttpOnly Cookie；因此用本机 Chromium
窗口完成登录（体验接近 WebView），前端轮询会话状态。
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


def _extract_mp_token(page) -> str:
    import re

    try:
        url = page.url or ""
    except Exception:
        url = ""
    m = re.search(r"[?&]token=(\d+)", url)
    if m:
        return m.group(1)
    try:
        found = page.evaluate(
            """() => {
              const html = document.documentElement.innerHTML || '';
              let m = html.match(/[?&]token=(\\d{6,})/);
              if (m) return m[1];
              m = html.match(/wx\\.cgiData\\.token\\s*=\\s*['\"]?(\\d+)/);
              return m ? m[1] : '';
            }"""
        )
        return str(found or "")
    except Exception:
        return ""


def _is_weixin_miniprogram(page) -> bool:
    try:
        url = (page.url or "").lower()
    except Exception:
        url = ""
    if "/wxamp" in url:
        return True
    try:
        title = (page.title() or "").strip()
    except Exception:
        title = ""
    return title == "小程序"


def _with_weixin_token(header: str, token: str) -> str:
    token = (token or "").strip()
    parts = [p.strip() for p in (header or "").split(";") if p.strip() and not p.strip().startswith("askme_mp_token=")]
    if token:
        parts.insert(0, f"askme_mp_token={token}")
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


def _page_logged_in(page) -> bool:
    """读取页面 __INITIAL_STATE__，判断是否真实登录（访客也会有 web_session）。"""
    try:
        return bool(
            page.evaluate(
                """() => {
                  try {
                    const s = window.__INITIAL_STATE__;
                    if (!s || !s.user) return false;
                    if (!s.user.loggedIn) return false;
                    const info = s.user.userInfo || {};
                    if (info.guest) return false;
                    return true;
                  } catch (e) {
                    return false;
                  }
                }"""
            )
        )
    except Exception:
        return False


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
    """优先 Playwright Chromium；缺失时回退本机 Chrome。"""
    try:
        return p.chromium.launch(headless=False)
    except Exception as first_exc:
        try:
            return p.chromium.launch(headless=False, channel="chrome")
        except Exception:
            try:
                return p.chromium.launch(headless=False, channel="msedge")
            except Exception:
                raise first_exc


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
            context = browser.new_context()
            page = context.new_page()
            _set_status(session, "waiting_login", "请在弹出的窗口中完成登录…")
            page.goto(session.login_url, wait_until="domcontentloaded", timeout=60000)

            deadline = time.time() + 10 * 60
            last_header = ""
            last_hint = ""
            while time.time() < deadline:
                if session._cancel.is_set():
                    _set_status(session, "cancelled", "已取消登录")
                    browser.close()
                    return
                cookies = context.cookies()
                header = _cookies_to_header(cookies)
                fields_ready = bool(header) and _cookie_ready(session.slot, header)
                if header and not fields_ready:
                    _try_seed_required_token(context, page, session)
                    cookies = context.cookies()
                    header = _cookies_to_header(cookies)
                    fields_ready = bool(header) and _cookie_ready(session.slot, header)

                # 小红书：必须等页面 loggedIn=true（访客也会有 web_session）
                if session.slot == "xiaohongshu":
                    page_ok = _page_logged_in(page)
                    if not page_ok:
                        hint = (
                            "已检测到访客 Cookie（含 web_session），请扫码/手机完成真实登录…"
                            if fields_ready
                            else "请在弹出的窗口中扫码或手机登录小红书…"
                        )
                        if hint != last_hint:
                            last_hint = hint
                            _set_status(session, "waiting_login", hint)
                        time.sleep(1.2)
                        continue
                    _set_status(session, "capturing", "已检测到登录态，正在校验并保存…")
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
                        time.sleep(1.2)
                        continue
                    browser.close()
                    return

                # 微信：必须公众号后台（非小程序），并写入 askme_mp_token
                if session.slot == "weixin":
                    if _is_weixin_miniprogram(page):
                        hint = "当前是【小程序】后台。请关闭后重新打开，登录页务必选择「公众号」再扫码。"
                        if hint != last_hint:
                            last_hint = hint
                            _set_status(session, "waiting_login", hint)
                        time.sleep(1.5)
                        continue
                    token = _extract_mp_token(page)
                    if not token:
                        # 尝试进首页带出 token
                        try:
                            if "cgi-bin" in ((page.url or "").lower()) and "login" not in (
                                (page.url or "").lower()
                            ):
                                page.goto(
                                    "https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN",
                                    wait_until="domcontentloaded",
                                    timeout=30000,
                                )
                                token = _extract_mp_token(page)
                        except Exception:
                            pass
                    header_with_token = _with_weixin_token(header, token)
                    if token and cookie_satisfies_slot(session.slot, header_with_token):
                        _set_status(session, "capturing", "已检测到公众号登录态，正在保存…")
                        session.cookie = header_with_token
                        try:
                            cred = upsert_credential(
                                slot=session.slot,
                                cookie=header_with_token,
                                label=session.label,
                                probe_url="https://mp.weixin.qq.com/",
                            )
                            session.credential_id = str(cred.get("id") or "")
                            session.masked = str(cred.get("masked") or "")
                            _set_status(session, "done", "登录成功，微信公众号凭证已保存")
                        except ValueError as exc:
                            _set_status(session, "waiting_login", f"登录未完成：{exc}")
                            time.sleep(1.2)
                            continue
                        browser.close()
                        return
                    hint = (
                        "请用【公众号】扫码登录后台（不要选小程序），进入首页后会自动保存…"
                        if not token
                        else "已拿到 token，仍在等待完整 Cookie…"
                    )
                    if hint != last_hint:
                        last_hint = hint
                        _set_status(session, "waiting_login", hint)
                    time.sleep(1.2)
                    continue

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
                            browser.close()
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
                time.sleep(1.2)

            browser.close()
            if session.status != "done":
                _set_status(session, "error", "登录超时，请重试或改用粘贴 Cookie", error="timeout")
    except Exception as exc:
        _set_status(session, "error", _friendly_launch_error(exc), error=str(exc))


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
        if slot_id == "xiaohongshu":
            url = "https://www.xiaohongshu.com"
        elif slot_id == "weixin":
            url = "https://mp.weixin.qq.com/"
        else:
            raise ValueError("缺少 login_url")
    # 微信始终打开公众号后台，避免用文章页捕获无效 Cookie
    if slot_id == "weixin":
        url = "https://mp.weixin.qq.com/"
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
    return session


def start_login_session_for_url(entry_url: str, *, label: str = "") -> LoginSession:
    from onboarding.source_platform_scaffold import detect_platform

    match = detect_platform(entry_url)
    slot = None
    if match and match.requires_cookie:
        slot = match.platform
    if not slot:
        slot = resolve_slot_from_url(entry_url)
    if not slot:
        raise ValueError("该链接未识别为需要登录的已知平台，请手动选择平台或粘贴 Cookie")
    meta = get_slot_meta(slot) or {}
    # 优先打开用户给出的主页/笔记链接；微信强制公众号后台
    if slot == "weixin":
        preferred = str(meta.get("login_url") or "https://mp.weixin.qq.com/")
    else:
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
