"""LLM 状态与模型列表。"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from core.llm import LLMError, fetch_available_models, get_llm_status
from schemas import LlmModelsRequest, LlmStatusRequest

router = APIRouter(tags=["llm"])

@router.get("/api/llm/status")
async def llm_status_get():
    return get_llm_status()


@router.post("/api/llm/status")
async def llm_status_post(body: LlmStatusRequest | None = None):
    override = body.llm_config.model_dump() if body and body.llm_config else None
    return get_llm_status(override)


@router.post("/api/llm/models")
async def llm_models(body: LlmModelsRequest):
    try:
        models = await fetch_available_models(body.api_base, body.api_key)
        return {"models": models}
    except LLMError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"获取模型列表失败: {exc}") from exc


