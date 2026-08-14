"""设置：凭证、Cookie、Cursor Key、LLM、调度。"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from api.deps import (
    CURSOR_API_KEY,
    ZHIHU_FEED_IDS,
    _get_saved_zhihu_cookie,
    _load_integrations,
    _mask_cookie,
    _save_integrations,
    _set_runtime_cursor_api_key,
    feed_client,
)
from api.models import (
    CredentialUpsertRequest,
    CursorApiKeyRequest,
    FeedSchedulerConfigRequest,
    LlmSettingsRequest,
    LoginSessionRequest,
    ZhihuCookieRequest,
)
from auth.auth_login_session import (
    cancel_login_session,
    get_login_session,
    start_login_session,
    start_login_session_for_url,
)
from auth.credential_store import (
    delete_credential,
    list_credentials,
    list_slots,
    sync_runtime_cookies,
    upsert_credential,
)
from core.llm import (
    LLMError,
    clear_stored_llm_config,
    get_llm_status,
    has_stored_llm_settings,
    load_stored_llm_config,
    save_stored_llm_config,
)
from feed.feed_errors import FeedError
from feed.feed_scheduler import feed_scheduler
from onboarding.source_onboarding_cursor import load_cursor_api_key, mask_cursor_api_key

router = APIRouter(tags=["settings"])

@router.get("/api/settings/credentials")
async def get_credentials():
    return {"credentials": list_credentials(), "slots": list_slots()}


@router.put("/api/settings/credentials")
async def save_credential(body: CredentialUpsertRequest):
    try:
        item = upsert_credential(
            slot=body.slot,
            cookie=body.cookie,
            label=body.label,
            cred_id=body.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "credential": item}


@router.delete("/api/settings/credentials/{cred_id}")
async def remove_credential(cred_id: str):
    try:
        delete_credential(cred_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True}


@router.post("/api/settings/credentials/{cred_id}/verify")
async def verify_credential(cred_id: str):
    cred = next((item for item in list_credentials(include_cookie=True) if item["id"] == cred_id), None)
    if not cred:
        raise HTTPException(status_code=404, detail="凭证不存在")
    sync_runtime_cookies()
    if cred["slot"] == "zhihu":
        return await verify_zhihu_cookie()
    return {"ok": True, "message": f"已保存「{cred['label']}」，暂无自动校验"}


@router.post("/api/settings/credentials/login-session")
async def create_login_session(body: LoginSessionRequest):
    try:
        if body.entry_url.strip():
            session = start_login_session_for_url(
                body.entry_url.strip(),
                label=body.label,
            )
        else:
            session = start_login_session(
                slot=body.slot,
                login_url=body.login_url,
                label=body.label,
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return session.to_dict()


@router.get("/api/settings/credentials/login-session/{session_id}")
async def read_login_session(session_id: str):
    session = get_login_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="登录会话不存在")
    return session.to_dict()


@router.post("/api/settings/credentials/login-session/{session_id}/cancel")
async def stop_login_session(session_id: str):
    session = cancel_login_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="登录会话不存在")
    return session.to_dict()


@router.get("/api/settings/zhihu-cookie")
async def get_zhihu_cookie_status():
    cookie = _get_saved_zhihu_cookie()
    return {
        "configured": bool(cookie),
        "masked": _mask_cookie(cookie) if cookie else "",
    }


@router.put("/api/settings/zhihu-cookie")
async def save_zhihu_cookie(body: ZhihuCookieRequest):
    cookie = body.cookie.strip()
    try:
        item = upsert_credential(slot="zhihu", cookie=cookie, label="知乎")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "configured": True, "masked": item.get("masked") or _mask_cookie(cookie)}


@router.post("/api/settings/zhihu-cookie/verify")
async def verify_zhihu_cookie():
    cookie = _get_saved_zhihu_cookie()
    if not cookie:
        raise HTTPException(status_code=400, detail="请先保存知乎 Cookie")
    sync_runtime_cookies()

    checked: list[str] = []
    for feed_id in ZHIHU_FEED_IDS:
        try:
            await feed_client.refresh_feed(feed_id)
            checked.append(feed_id)
        except FeedError as exc:
            if exc.status_code == 404:
                continue
            raise HTTPException(status_code=400, detail=f"知乎校验失败: {exc}") from exc
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"知乎校验失败: {exc}") from exc

    if not checked:
        raise HTTPException(status_code=400, detail="未找到知乎数据源，请先确认技能已加载")
    return {"ok": True, "message": f"知乎 Cookie 可用（已校验 {len(checked)} 个数据源）"}


@router.get("/api/settings/cursor-api-key")
async def get_cursor_api_key_status():
    api_key = load_cursor_api_key()
    return {
        "configured": bool(api_key),
        "masked": mask_cursor_api_key(api_key) if api_key else "",
    }


@router.put("/api/settings/cursor-api-key")
async def save_cursor_api_key(body: CursorApiKeyRequest):
    api_key = body.api_key.strip()
    if len(api_key) < 8:
        raise HTTPException(status_code=400, detail="Cursor API Key 过短")
    data = _load_integrations()
    data[CURSOR_API_KEY] = api_key
    _save_integrations(data)
    _set_runtime_cursor_api_key(api_key)
    return {"ok": True, "configured": True, "masked": mask_cursor_api_key(api_key)}


@router.get("/api/settings/llm")
async def get_llm_settings():
    """返回服务端持久化的 LLM 配置（本机多浏览器共用）。"""
    persisted = has_stored_llm_settings()
    item = load_stored_llm_config()
    status = get_llm_status()
    # 从未落盘时，回退到运行时默认值（环境变量）；用户主动清空后不再回退
    if not persisted and not item.get("api_key") and status.get("configured"):
        from core.llm import LLM_API_BASE, LLM_API_KEY, LLM_EMBEDDING_MODEL, LLM_MAX_TOKENS, LLM_MODEL

        item = {
            "model": LLM_MODEL,
            "embedding_model": LLM_EMBEDDING_MODEL,
            "api_key": LLM_API_KEY,
            "api_base": LLM_API_BASE,
            "max_tokens": LLM_MAX_TOKENS,
            "thinking_style": item.get("thinking_style") or "",
            "embedding_api_key": item.get("embedding_api_key") or "",
            "embedding_api_base": item.get("embedding_api_base") or "",
        }
    return {
        "configured": bool(item.get("api_key") and item.get("model")),
        "persisted": persisted,
        "model": item.get("model") or "",
        "embedding_model": item.get("embedding_model") or "",
        "api_key": item.get("api_key") or "",
        "api_base": item.get("api_base") or "",
        "max_tokens": item.get("max_tokens") or 8192,
        "source": status.get("source") or "none",
        "thinking_style": item.get("thinking_style") or "",
        "embedding_api_key": item.get("embedding_api_key") or "",
        "embedding_api_base": item.get("embedding_api_base") or "",
    }


@router.put("/api/settings/llm")
async def put_llm_settings(body: LlmSettingsRequest):
    try:
        item = save_stored_llm_config(body.model_dump())
    except LLMError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return {
        "ok": True,
        "configured": True,
        "persisted": True,
        "model": item["model"],
        "embedding_model": item["embedding_model"],
        "api_key": item["api_key"],
        "api_base": item["api_base"],
        "max_tokens": item["max_tokens"],
        "thinking_style": item.get("thinking_style") or "",
        "embedding_api_key": item.get("embedding_api_key") or "",
        "embedding_api_base": item.get("embedding_api_base") or "",
    }


@router.delete("/api/settings/llm")
async def delete_llm_settings():
    """清空对话模型与 Embedding 的全部已保存配置。"""
    item = clear_stored_llm_config()
    return {
        "ok": True,
        "configured": False,
        "persisted": True,
        "model": item["model"],
        "embedding_model": item["embedding_model"],
        "api_key": item["api_key"],
        "api_base": item["api_base"],
        "max_tokens": item["max_tokens"],
        "thinking_style": item.get("thinking_style") or "",
        "embedding_api_key": item.get("embedding_api_key") or "",
        "embedding_api_base": item.get("embedding_api_base") or "",
    }


@router.get("/api/settings/feed-scheduler")
async def get_feed_scheduler_config():
    return feed_scheduler.get_status()


@router.put("/api/settings/feed-scheduler")
async def update_feed_scheduler_config(body: FeedSchedulerConfigRequest):
    try:
        schedules = [item.model_dump() for item in body.schedules]
        return feed_scheduler.update_config(
            schedules=schedules,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

