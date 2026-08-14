from pydantic import BaseModel, Field


class LlmConfigInput(BaseModel):
    model: str = ""
    api_key: str = ""
    api_base: str = ""
    embedding_model: str = ""
    max_tokens: int | None = Field(default=None, ge=256, le=128000)


class BuildIndexRequest(BaseModel):
    days: int = Field(default=1, ge=1, le=30)
    feed_ids: list[str] = Field(default_factory=list)
    llm_config: LlmConfigInput | None = None
    stream: bool = False


class ChatMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant|system)$")
    content: str = Field(..., min_length=1)


class SummarizeRequest(BaseModel):
    days: int = Field(default=1, ge=1, le=30)
    feed_ids: list[str] = Field(default_factory=list)
    group_ids: list[str] = Field(default_factory=list)
    stream: bool = True
    llm_config: LlmConfigInput | None = None
    use_cached_context: bool = True


class ArticleScopeItem(BaseModel):
    feed_id: str = Field(..., min_length=1)
    article_id: str = Field(..., min_length=1)
    title: str = ""
    url: str = ""


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(..., min_length=1)
    system_prompt: str = ""
    summary: str = ""
    days: int = Field(default=1, ge=1, le=30)
    feed_ids: list[str] = Field(default_factory=list)
    article_scope: list[ArticleScopeItem] = Field(default_factory=list)
    summarize_scope: bool = False
    stream: bool = True
    enable_thinking: bool = False
    use_rag: bool = True
    llm_config: LlmConfigInput | None = None


class LlmStatusRequest(BaseModel):
    llm_config: LlmConfigInput | None = None


class LlmModelsRequest(BaseModel):
    api_base: str = ""
    api_key: str = Field(..., min_length=1)


class RecentArticlesRequest(BaseModel):
    days: int = Field(default=1, ge=1, le=30)
    feed_ids: list[str] = Field(default_factory=list)
    enrich: bool = False
    stream: bool = True
    list_limit: int | None = Field(default=None, ge=1, le=100)
    progress_message: str = ""
    group_id: str = ""


class OnboardSourceRequest(BaseModel):
    entry_url: str = Field(..., min_length=1)
    slug: str | None = None
    name: str | None = None
    hints: str = ""
    list_api_hint: str = ""
    stream: bool = True
    auto_validate: bool = True
    reload: bool = True
    auto_repair: bool = True
    llm_config: LlmConfigInput | None = None
    group_id: str | None = None


class OnboardBatchRequest(BaseModel):
    entry_urls: list[str] = Field(..., min_length=1, max_length=20)
    max_concurrency: int = Field(default=5, ge=1, le=10)
    auto_validate: bool = True
    reload: bool = True
    auto_repair: bool = True
    group_id: str | None = None


class RefreshGroupRequest(BaseModel):
    group_id: str = Field(..., min_length=1)
    days: int = Field(default=1, ge=1, le=30)


class RefreshAllRequest(BaseModel):
    days: int = Field(default=1, ge=1, le=30)
    feed_ids: list[str] = Field(default_factory=list)


class FeedRenameRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)


class RepairSourceRequest(BaseModel):
    feedback: str = Field(..., min_length=1)
    issue_types: list[str] = Field(default_factory=list)
    sample_url: str = ""
    stream: bool = True
    auto_validate: bool = True
    reload: bool = True


class FeedGroupInput(BaseModel):
    id: str = ""
    name: str = Field(..., min_length=1, max_length=40)
    feed_ids: list[str] = Field(default_factory=list)
    digest_skill_id: str | None = None
    auto_refresh: bool = True


class FeedGroupsRequest(BaseModel):
    groups: list[FeedGroupInput] = Field(default_factory=list)
    group_order: list[str] = Field(default_factory=list)
    default_digest_skill: str | None = None


class DigestSkillInput(BaseModel):
    id: str = Field(..., min_length=1)
    skill_md: str | None = None
    profile: dict | None = None

class DiscoverySkillExportInput(BaseModel):
    skill_ids: list[str] = Field(default_factory=list, max_length=50)
    platform_feed_ids: list[str] = Field(default_factory=list, max_length=50)


class PlatformAccountImportItem(BaseModel):
    feed_id: str = ""
    platform: str = ""
    account_key: str = ""
    user_type: str = ""
    entry_url: str = ""
    posts_url: str = ""
    display_name: str = ""
    list_api_path: str = ""
    slug: str = ""
    xsec_token: str = ""
    group_id: str | None = None


class DiscoverySkillFileInput(BaseModel):
    path: str = Field(..., min_length=1)
    content: str = ""


class DiscoverySkillImportItem(BaseModel):
    skill_id: str = ""
    slug: str = ""
    feed_id: str = ""
    name: str = ""
    files: list[DiscoverySkillFileInput] = Field(default_factory=list)


class DiscoverySkillImportInput(BaseModel):
    skills: list[DiscoverySkillImportItem] = Field(default_factory=list, max_length=50)
    platform_accounts: list[PlatformAccountImportItem] = Field(default_factory=list, max_length=50)
    overwrite: bool = False
    group_id: str | None = None


class DiscoverySkillZipParseInput(BaseModel):
    zip_base64: str = Field(..., min_length=1)


class ChatSkillInput(BaseModel):
    skill_md: str = Field(..., min_length=1)


class SkillConfigInput(BaseModel):
    default_digest_skill: str | None = None
    chat_system_prompt: str | None = None
