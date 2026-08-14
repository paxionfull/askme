"""API 请求体（仅路由层使用的补充模型；通用模型见 schemas.py）。"""
from __future__ import annotations

from pydantic import BaseModel, Field


class ScheduleTimeRequest(BaseModel):
    kind: str = "daily"
    hour: int = Field(default=8, ge=0, le=23)
    minute: int = Field(default=0, ge=0, le=59)
    second: int = Field(default=0, ge=0, le=59)
    every_hours: int = Field(default=6, ge=1, le=24)
    group_ids: list[str] = Field(default_factory=list)


class FeedSchedulerConfigRequest(BaseModel):
    schedules: list[ScheduleTimeRequest] = Field(default_factory=list)


class ZhihuCookieRequest(BaseModel):
    cookie: str = Field(..., min_length=1)


class CredentialUpsertRequest(BaseModel):
    slot: str = Field(..., min_length=1)
    cookie: str = Field(..., min_length=1)
    label: str = ""
    id: str | None = None


class AuthPrecheckRequest(BaseModel):
    entry_urls: list[str] = Field(default_factory=list)


class LoginSessionRequest(BaseModel):
    slot: str = ""
    login_url: str = ""
    label: str = ""
    entry_url: str = ""


class CancelOnboardRequest(BaseModel):
    job_id: str = Field(..., min_length=1)


class CursorApiKeyRequest(BaseModel):
    api_key: str = Field(..., min_length=1)


class LlmSettingsRequest(BaseModel):
    model: str = ""
    embedding_model: str = ""
    api_key: str = ""
    api_base: str = ""
    max_tokens: int | None = Field(default=None, ge=256, le=128000)
    thinking_style: str = ""
    embedding_api_key: str = ""
    embedding_api_base: str = ""
