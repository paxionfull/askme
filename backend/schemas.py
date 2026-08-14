from pydantic import BaseModel, Field


class LlmConfigInput(BaseModel):
    model: str = ""
    api_key: str = ""
    api_base: str = ""
    embedding_model: str = ""


class BuildIndexRequest(BaseModel):
    days: int = Field(default=1, ge=1, le=30)
    feed_ids: list[str] = Field(default_factory=list)
    llm_config: LlmConfigInput | None = None


class ChatMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant|system)$")
    content: str = Field(..., min_length=1)


class SummarizeRequest(BaseModel):
    prompt: str = ""
    days: int = Field(default=1, ge=1, le=30)
    feed_ids: list[str] = Field(default_factory=list)
    group_ids: list[str] = Field(default_factory=list)
    stream: bool = True
    enable_thinking: bool = False
    llm_config: LlmConfigInput | None = None
    use_cached_context: bool = True


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(..., min_length=1)
    system_prompt: str = ""
    summary: str = ""
    days: int = Field(default=1, ge=1, le=30)
    feed_ids: list[str] = Field(default_factory=list)
    stream: bool = True
    enable_thinking: bool = False
    use_rag: bool = True
    llm_config: LlmConfigInput | None = None


class LlmStatusRequest(BaseModel):
    llm_config: LlmConfigInput | None = None


class LlmModelsRequest(BaseModel):
    api_base: str = ""
    api_key: str = Field(..., min_length=1)


class OnboardSourceRequest(BaseModel):
    entry_url: str = Field(..., min_length=1)
    slug: str | None = None
    name: str | None = None
    hints: str = ""
    list_api_hint: str = ""
    stream: bool = True
    auto_validate: bool = True
    reload: bool = True
    llm_config: LlmConfigInput | None = None


class FeedGroupInput(BaseModel):
    id: str = ""
    name: str = Field(..., min_length=1, max_length=40)
    feed_ids: list[str] = Field(default_factory=list)
    digest_skill_id: str | None = None


class FeedGroupsRequest(BaseModel):
    groups: list[FeedGroupInput] = Field(default_factory=list)
    group_order: list[str] = Field(default_factory=list)
    default_digest_skill: str | None = None


class DigestSkillInput(BaseModel):
    id: str = Field(..., min_length=1)
    skill_md: str = Field(..., min_length=1)


class ChatSkillInput(BaseModel):
    skill_md: str = Field(..., min_length=1)


class SkillConfigInput(BaseModel):
    default_digest_skill: str | None = None
    chat_system_prompt: str | None = None
