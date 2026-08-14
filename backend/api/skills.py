"""Skill 管理：discovery / digest / chat / 全局配置。"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from api.deps import feed_client
from digest.digest_skill_registry import (
    delete_user_digest_skill,
    get_digest_skill_detail,
    list_digest_skills,
    save_user_digest_skill,
)
from feed.feed_registry import feed_registry
from schemas import ChatSkillInput, DigestSkillInput, SkillConfigInput
from skills.skill_config import load_skill_config, save_skill_config
from skills.skill_manager import (
    delete_discovery_skill,
    delete_other_skill,
    get_chat_skill,
    get_discovery_skill_detail,
    get_other_skill_detail,
    list_all_skills,
    save_chat_skill,
)

router = APIRouter(tags=["skills"])

@router.get("/api/skills")
async def list_skills():
    try:
        return list_all_skills()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"获取 skill 列表失败: {exc}") from exc


@router.get("/api/skills/digest")
async def list_digest_skill_catalog():
    return {"skills": list_digest_skills(), "default_digest_skill": feed_registry.default_digest_skill()}


@router.get("/api/skills/digest/{skill_id}")
async def get_digest_skill_detail_endpoint(skill_id: str):
    try:
        return get_digest_skill_detail(skill_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/api/skills/digest")
async def create_digest_skill(body: DigestSkillInput):
    try:
        return save_user_digest_skill(
            body.id,
            skill_md=body.skill_md,
            profile=body.profile,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/api/skills/digest/{skill_id}")
async def update_digest_skill(skill_id: str, body: DigestSkillInput):
    try:
        return save_user_digest_skill(
            skill_id,
            skill_md=body.skill_md,
            profile=body.profile,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/api/skills/digest/{skill_id}")
async def remove_digest_skill(skill_id: str):
    try:
        delete_user_digest_skill(skill_id)
        return {"ok": True}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/api/skills/discovery/{skill_id}")
async def get_discovery_skill(skill_id: str):
    try:
        return get_discovery_skill_detail(skill_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/api/skills/other/{skill_id}")
async def get_other_skill(skill_id: str):
    try:
        return get_other_skill_detail(skill_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/api/skills/discovery/{skill_id}")
async def remove_discovery_skill(skill_id: str):
    try:
        result = delete_discovery_skill(skill_id)
        feed_client.reload_skills()
        return {"ok": True, **result}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/api/skills/other/{skill_id}")
async def remove_other_skill(skill_id: str):
    try:
        result = delete_other_skill(skill_id)
        return {"ok": True, **result}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/api/skills/chat")
async def get_chat_skill_config():
    return get_chat_skill()


@router.put("/api/skills/chat")
async def save_chat_skill_config(body: ChatSkillInput):
    try:
        save_chat_skill(skill_md=body.skill_md)
        return get_chat_skill() | {"saved": True, "default_digest_skill": feed_registry.default_digest_skill()}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/api/skills/config")
async def save_skill_global_config(body: SkillConfigInput):
    try:
        if body.chat_system_prompt:
            save_skill_config({"chat_system_prompt": body.chat_system_prompt})
        if body.default_digest_skill:
            feed_registry.set_default_digest_skill(body.default_digest_skill)
        return {
            "ok": True,
            **load_skill_config(),
            "default_digest_skill": feed_registry.default_digest_skill(),
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

