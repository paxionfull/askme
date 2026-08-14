import { streamPost, type SseCitationItem, type SseStatus } from "./utils/sse";

export const FEEDS_NEED_RELOAD_KEY = "askme.feedsNeedReload";

export type CitationItem = SseCitationItem;

export interface Feed {
  id: string;
  name: string;
  cover: string;
  intro: string;
  entry_url?: string;
  sync_time?: number;
  status?: number;
  group_id?: string;
}

export interface FeedGroup {
  id: string;
  name: string;
  feed_ids: string[];
  digest_skill_id?: string | null;
}

export interface FeedsResponse {
  feeds: Feed[];
  groups: FeedGroup[];
  group_order: string[];
  default_digest_skill?: string;
}

export interface Article {
  id: string;
  title: string;
  url: string;
  content_html: string;
  image: string;
  published_at: string;
  author: string;
  has_body?: boolean;
  plain_text?: string;
}

export interface RecentArticle {
  id: string;
  title: string;
  url: string;
  published_at: string;
  author: string;
  feed_id: string;
  feed_name: string;
  has_body?: boolean;
}

export interface RecentArticlesResponse {
  articles: RecentArticle[];
  context_text: string;
  truncated: boolean;
  article_count: number;
  meta_count?: number;
  cached_count?: number;
  fetched_count?: number;
}

export interface StoredArticleBody {
  id: string;
  feed_id: string;
  title: string;
  url: string;
  published_at: string;
  feed_name: string;
  content_html: string;
  plain_text?: string;
  body_status?: "ok" | "anti_bot" | "auth_required" | "parse_failed" | "transient_error";
  body_detail?: string;
}

export interface LlmStatus {
  configured: boolean;
  model: string;
  source?: "client" | "env";
}

export interface LlmConfigPayload {
  model: string;
  embedding_model: string;
  api_key: string;
  api_base: string;
}

export interface ChatMessagePayload {
  role: "user" | "assistant" | "system";
  content: string;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const detail = data.detail;
    throw new Error(
      typeof detail === "string" ? detail : detail ? JSON.stringify(detail) : "请求失败",
    );
  }

  return response.json();
}

export function fetchFeeds() {
  return request<FeedsResponse>("/api/feeds");
}

export function deleteFeed(feedId: string, removeSkill = false) {
  const params = new URLSearchParams({ remove_skill: String(removeSkill) });
  return request<{ ok: boolean; feed_id: string; skill_removed?: boolean }>(`/api/feeds/${encodeURIComponent(feedId)}?${params}`, {
    method: "DELETE",
  });
}

export function renameFeed(feedId: string, name: string) {
  return request<{ ok: boolean; feed_id: string; name: string }>(
    `/api/feeds/${encodeURIComponent(feedId)}/name`,
    {
      method: "PUT",
      body: JSON.stringify({ name }),
    },
  );
}

export function saveFeedGroups(
  groups: FeedGroup[],
  groupOrder: string[] = [],
  defaultDigestSkill?: string,
) {
  return request<{
    ok: boolean;
    groups: FeedGroup[];
    group_order: string[];
    default_digest_skill?: string;
  }>("/api/feeds/groups", {
    method: "PUT",
    body: JSON.stringify({
      groups,
      group_order: groupOrder,
      default_digest_skill: defaultDigestSkill,
    }),
  });
}

export function refreshFeed(feedId: string, days = 1) {
  const params = new URLSearchParams({ days: String(days) });
  return request<{
    ok: boolean;
    article_count: number;
    new_article_count?: number;
    has_new_content?: boolean;
    fetching_history?: boolean;
    message: string;
  }>(`/api/feeds/${encodeURIComponent(feedId)}/refresh?${params}`, {
    method: "POST",
  });
}

export interface RefreshAllFeedsResponse {
  started: boolean;
  message: string;
  scope?: string;
  group_id?: string;
  group_name?: string;
  feed_count?: number;
  days?: number;
}

export function refreshAllFeeds(days = 1) {
  return request<RefreshAllFeedsResponse>("/api/feeds/refresh-all", {
    method: "POST",
    body: JSON.stringify({ days }),
  });
}

export function refreshGroupFeeds(groupId: string, days = 1) {
  return request<RefreshAllFeedsResponse>("/api/feeds/refresh-group", {
    method: "POST",
    body: JSON.stringify({ group_id: groupId, days }),
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForRefreshAllComplete(
  onProgress?: (status: FeedSchedulerConfig) => void | Promise<void>,
  pollIntervalMs = 800,
): Promise<FeedSchedulerConfig> {
  while (true) {
    const status = await fetchFeedSchedulerConfig();
    if (onProgress) {
      await onProgress(status);
    }
    if (!status.refresh_running) {
      return status;
    }
    await sleep(pollIntervalMs);
  }
}

export function fetchArticles(
  feedId: string,
  limit?: number,
  includeContent = false,
  fresh = false,
  days?: number,
) {
  const params = new URLSearchParams({
    include_content: String(includeContent),
    fresh: String(fresh),
    _t: String(Date.now()),
  });
  if (limit != null && limit > 0) {
    params.set("limit", String(limit));
  }
  if (days != null) {
    params.set("days", String(days));
  }
  return request<Article[]>(`/api/feeds/${encodeURIComponent(feedId)}/articles?${params}`);
}

export function fetchArticleContent(feedId: string, articleId: string) {
  return request<Article>(`/api/feeds/${encodeURIComponent(feedId)}/articles/${encodeURIComponent(articleId)}`);
}

export function fetchLlmStatus(llmConfig?: LlmConfigPayload) {
  if (llmConfig?.api_key) {
    return request<LlmStatus>("/api/llm/status", {
      method: "POST",
      body: JSON.stringify({ llm_config: llmConfig }),
    });
  }
  return request<LlmStatus>("/api/llm/status");
}

export function fetchLlmModels(apiBase: string, apiKey: string) {
  return request<{ models: string[] }>("/api/llm/models", {
    method: "POST",
    body: JSON.stringify({ api_base: apiBase, api_key: apiKey }),
  });
}

export function fetchRecentArticles(days: number, feedIds?: string[], enrich = false) {
  const params = new URLSearchParams({
    days: String(days),
    enrich: String(enrich),
  });
  for (const id of feedIds ?? []) {
    params.append("feed_ids", id);
  }
  return request<RecentArticlesResponse>(`/api/articles/recent?${params}`);
}

export function streamFetchRecentArticles(
  days: number,
  enrich: boolean,
  onStatus: (status: SseStatus) => void,
  onResult: (result: RecentArticlesResponse) => void,
  onDone: () => void,
  onError: (message: string) => void,
  feedIds?: string[],
  listLimit?: number,
) {
  return streamPost(
    "/api/articles/recent",
    {
      days,
      feed_ids: feedIds ?? [],
      enrich,
      stream: true,
      ...(listLimit && listLimit > 0 ? { list_limit: listLimit } : {}),
    },
    () => {},
    onDone,
    onError,
    onStatus,
    undefined,
    undefined,
    undefined,
    (data) => onResult(data as unknown as RecentArticlesResponse),
  );
}

export interface ContentJobStatus {
  job_id?: string | null;
  kind?: string;
  status: "idle" | "running" | "done" | "error" | string;
  current?: number;
  total?: number;
  message?: string;
  error?: string | null;
  result?: RecentArticlesResponse | Record<string, unknown> | null;
  cached_count?: number;
  fetched_count?: number;
  params?: Record<string, unknown>;
  started?: boolean;
}

export function startBodiesJob(options: {
  days: number;
  feedIds?: string[];
  listLimit?: number;
  progressMessage?: string;
  groupId?: string;
}) {
  return request<ContentJobStatus>("/api/articles/bodies/jobs", {
    method: "POST",
    body: JSON.stringify({
      days: options.days,
      feed_ids: options.feedIds ?? [],
      enrich: true,
      list_limit: options.listLimit,
      progress_message: options.progressMessage ?? "",
      group_id: options.groupId ?? "",
    }),
  });
}

export function fetchBodiesJobStatus() {
  return request<ContentJobStatus>("/api/articles/bodies/jobs/current");
}

export function startIndexJob(days: number, llmConfig: LlmConfigPayload, feedIds?: string[]) {
  return request<ContentJobStatus>("/api/rag/index/jobs", {
    method: "POST",
    body: JSON.stringify({
      days,
      feed_ids: feedIds ?? [],
      llm_config: llmConfig,
    }),
  });
}

export function fetchIndexJobStatus() {
  return request<ContentJobStatus>("/api/rag/index/jobs/current");
}

export async function waitForContentJob(
  fetchStatus: () => Promise<ContentJobStatus>,
  onProgress?: (status: ContentJobStatus) => void | Promise<void>,
  pollIntervalMs = 800,
): Promise<ContentJobStatus> {
  while (true) {
    const status = await fetchStatus();
    if (onProgress) {
      await onProgress(status);
    }
    if (status.status !== "running") {
      return status;
    }
    await sleep(pollIntervalMs);
  }
}

export interface BuildIndexResponse {
  article_count: number;
  chunk_count: number;
  new_chunks: number;
}

export function buildRagIndex(days: number, llmConfig: LlmConfigPayload, feedIds?: string[]) {
  return request<BuildIndexResponse>("/api/rag/index", {
    method: "POST",
    body: JSON.stringify({
      days,
      feed_ids: feedIds ?? [],
      llm_config: llmConfig,
    }),
  });
}

export function streamBuildRagIndex(
  days: number,
  llmConfig: LlmConfigPayload,
  onStatus: (status: SseStatus) => void,
  onResult: (result: BuildIndexResponse) => void,
  onDone: () => void,
  onError: (message: string) => void,
  feedIds?: string[],
) {
  return streamPost(
    "/api/rag/index",
    {
      days,
      feed_ids: feedIds ?? [],
      llm_config: llmConfig,
      stream: true,
    },
    () => {},
    onDone,
    onError,
    onStatus,
    undefined,
    undefined,
    undefined,
    (data) => onResult(data as unknown as BuildIndexResponse),
  );
}

export function fetchStoredArticleBody(feedId: string, articleId: string, fetch = true) {
  const params = new URLSearchParams({
    feed_id: feedId,
    article_id: articleId,
    fetch: String(fetch),
  });
  return request<StoredArticleBody>(`/api/articles/body?${params}`);
}

export interface SummarizeBody {
  prompt?: string;
  days: number;
  feed_ids?: string[];
  group_ids?: string[];
  stream?: boolean;
  enable_thinking?: boolean;
  llm_config?: LlmConfigPayload;
  use_cached_context?: boolean;
}

export interface ChatBody {
  messages: ChatMessagePayload[];
  system_prompt?: string;
  summary?: string;
  days: number;
  feed_ids?: string[];
  article_scope?: ArticleScopeItem[];
  summarize_scope?: boolean;
  stream?: boolean;
  enable_thinking?: boolean;
  use_rag?: boolean;
  llm_config?: LlmConfigPayload;
}

export const SCOPED_SUMMARIZE_DEFAULT_MESSAGE = "请对选定文章的正文生成精简摘要";

export interface RagStatusResponse {
  ready: boolean;
  chunk_count: number;
  days: number;
}

export function fetchRagStatus(days: number, feedIds?: string[]) {
  const params = new URLSearchParams({ days: String(days) });
  for (const id of feedIds ?? []) {
    params.append("feed_ids", id);
  }
  return request<RagStatusResponse>(`/api/rag/status?${params}`);
}

export interface ArticleScopeItem {
  feed_id: string;
  article_id: string;
  title?: string;
  url?: string;
}

export interface CachedSummaryResponse {
  summary: string;
  article_count: number;
  truncated: boolean;
  updated_at: number | null;
  article_refs?: ArticleScopeItem[];
}

export function fetchCachedSummary(days: number, feedIds?: string[], groupIds?: string[]) {
  const params = new URLSearchParams({ days: String(days) });
  for (const id of feedIds ?? []) {
    params.append("feed_ids", id);
  }
  for (const id of groupIds ?? []) {
    params.append("group_ids", id);
  }
  return request<CachedSummaryResponse>(`/api/digest/summary?${params}`);
}

export function clearCachedSummary(days: number, feedIds?: string[]) {
  const params = new URLSearchParams({ days: String(days) });
  for (const id of feedIds ?? []) {
    params.append("feed_ids", id);
  }
  return request<{ ok: boolean }>(`/api/digest/summary?${params}`, { method: "DELETE" });
}

export interface ScheduleTime {
  hour: number;
  minute: number;
  second: number;
}

export interface ScheduleNextRun extends ScheduleTime {
  next_run?: string | null;
}

export interface RefreshProgress {
  current: number;
  total: number;
  feed_id?: string;
  feed_name: string;
  last_completed_feed_id?: string;
  completed_feed_ids?: string[];
  scope?: string;
  group_id?: string;
  group_name?: string;
}

export interface RefreshFeedFailure {
  feed_id: string;
  feed_name: string;
  error: string;
}

export interface FeedSchedulerConfig {
  schedules: ScheduleTime[];
  enabled: boolean;
  next_runs?: ScheduleNextRun[];
  refresh_running?: boolean;
  refresh_progress?: RefreshProgress;
  last_run_at?: number | null;
  last_error?: string | null;
  last_feed_count?: number;
  last_refresh_message?: string | null;
  last_refresh_failed?: RefreshFeedFailure[];
}

export interface ZhihuCookieStatus {
  configured: boolean;
  masked: string;
}

export function fetchFeedSchedulerConfig() {
  return request<FeedSchedulerConfig>("/api/settings/feed-scheduler");
}

export function updateFeedSchedulerConfig(body: {
  schedules: ScheduleTime[];
}) {
  return request<FeedSchedulerConfig>("/api/settings/feed-scheduler", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function fetchZhihuCookieStatus() {
  return request<ZhihuCookieStatus>("/api/settings/zhihu-cookie");
}

export function saveZhihuCookie(cookie: string) {
  return request<{ ok: boolean; configured: boolean; masked: string }>(
    "/api/settings/zhihu-cookie",
    {
      method: "PUT",
      body: JSON.stringify({ cookie }),
    },
  );
}

export function verifyZhihuCookie() {
  return request<{ ok: boolean; message: string }>("/api/settings/zhihu-cookie/verify", {
    method: "POST",
  });
}

export interface CursorApiKeyStatus {
  configured: boolean;
  masked: string;
}

export function fetchCursorApiKeyStatus() {
  return request<CursorApiKeyStatus>("/api/settings/cursor-api-key");
}

export function saveCursorApiKey(apiKey: string) {
  return request<{ ok: boolean; configured: boolean; masked: string }>(
    "/api/settings/cursor-api-key",
    {
      method: "PUT",
      body: JSON.stringify({ api_key: apiKey }),
    },
  );
}

export function streamSummarize(
  body: SummarizeBody,
  onToken: (content: string) => void,
  onDone: () => void,
  onError: (message: string) => void,
  onStatus?: (status: SseStatus) => void,
  onThinking?: (content: string) => void,
) {
  return streamPost(
    "/api/summarize",
    { ...body, stream: true },
    onToken,
    onDone,
    onError,
    onStatus,
    onThinking,
  );
}

export function streamChat(
  body: ChatBody,
  onToken: (content: string) => void,
  onDone: () => void,
  onError: (message: string) => void,
  onStatus?: (status: SseStatus) => void,
  onThinking?: (content: string) => void,
  onCitations?: (items: CitationItem[]) => void,
  onPromptPreview?: (system: string) => void,
  signal?: AbortSignal,
) {
  return streamPost(
    "/api/chat",
    { ...body, stream: true },
    onToken,
    onDone,
    onError,
    onStatus,
    onThinking,
    onCitations,
    onPromptPreview,
    undefined,
    undefined,
    undefined,
    signal,
  );
}

export interface RepairSourceBody {
  feedback: string;
  issue_types?: string[];
  sample_url?: string;
  stream?: boolean;
  auto_validate?: boolean;
  reload?: boolean;
}

export interface OnboardSourceBody {
  entry_url: string;
  slug?: string;
  name?: string;
  hints?: string;
  list_api_hint?: string;
  stream?: boolean;
  auto_validate?: boolean;
  reload?: boolean;
  llm_config?: LlmConfigPayload;
}

export interface OnboardSourceResult {
  ok: boolean;
  slug: string;
  feed_id: string;
  skill_dir: string;
  feed_count?: number;
  job_id?: string;
  analysis?: Record<string, unknown>;
  validation?: Record<string, unknown>;
}

export type OnboardBatchItemStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "cancelled"
  | "skipped";

export interface OnboardBatchItem {
  entry_url: string;
  slug: string;
  name: string;
  status: OnboardBatchItemStatus;
  phase: string;
  message: string;
  error?: string | null;
  feed_id?: string | null;
  job_id?: string | null;
  skip_reason?: string | null;
}

export interface OnboardBatchStatus {
  batch_id: string;
  status: "running" | "done" | "cancelled";
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  running: number;
  queued: number;
  message: string;
  items: OnboardBatchItem[];
}

export function startOnboardBatch(body: {
  entry_urls: string[];
  max_concurrency?: number;
  auto_validate?: boolean;
  reload?: boolean;
  group_id?: string;
}) {
  return request<OnboardBatchStatus>("/api/sources/onboard/batch", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchOnboardBatch(batchId: string) {
  return request<OnboardBatchStatus>(`/api/sources/onboard/batch/${encodeURIComponent(batchId)}`);
}

export function cancelOnboardBatch(batchId: string) {
  return request<OnboardBatchStatus>(`/api/sources/onboard/batch/${encodeURIComponent(batchId)}/cancel`, {
    method: "POST",
  });
}

export function parseOnboardUrls(text: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const part of text.split(/[\n,]+/)) {
    const url = part.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

export const ONBOARD_BATCH_MAX_SIZE = 20;

export interface OnboardLogSummary {
  job_id: string;
  entry_url: string;
  slug: string;
  name: string;
  started_at: string;
  updated_at: string;
  last_event: string;
  success: boolean | null;
  cancelled: boolean;
  log_file: string;
}

export function cancelOnboardSource(jobId: string) {
  return request<{ ok: boolean; job_id: string }>("/api/sources/onboard/cancel", {
    method: "POST",
    body: JSON.stringify({ job_id: jobId }),
  });
}

export function listOnboardLogs(limit = 30) {
  return request<{ ok: boolean; logs: OnboardLogSummary[] }>(
    `/api/sources/onboard/logs?limit=${encodeURIComponent(String(limit))}`,
  );
}

export function getOnboardLog(jobId: string) {
  return request<{ ok: boolean; job_id: string; records: Record<string, unknown>[] }>(
    `/api/sources/onboard/logs/${encodeURIComponent(jobId)}`,
  );
}

export interface StreamOnboardOptions {
  signal?: AbortSignal;
  onCancelled?: (detail: string, jobId?: string) => void;
}

export function streamRepairSource(
  slug: string,
  body: RepairSourceBody,
  onStatus: (status: SseStatus) => void,
  onDone: () => void,
  onError: (message: string) => void,
  onResult?: (data: OnboardSourceResult) => void,
  options?: StreamOnboardOptions,
) {
  return streamPost(
    `/api/sources/${encodeURIComponent(slug)}/repair`,
    { ...body, stream: true },
    () => {},
    onDone,
    onError,
    onStatus,
    undefined,
    undefined,
    undefined,
    onResult as ((data: Record<string, unknown>) => void) | undefined,
    undefined,
    options?.onCancelled,
    options?.signal,
  );
}

export function streamOnboardSource(
  body: OnboardSourceBody,
  onStatus: (status: SseStatus) => void,
  onDone: () => void,
  onError: (message: string) => void,
  onResult?: (data: OnboardSourceResult) => void,
  onAnalysis?: (data: Record<string, unknown>) => void,
  options?: StreamOnboardOptions,
) {
  return streamPost(
    "/api/sources/onboard",
    { ...body, stream: true },
    () => {},
    onDone,
    onError,
    onStatus,
    undefined,
    undefined,
    undefined,
    onResult as ((data: Record<string, unknown>) => void) | undefined,
    onAnalysis,
    options?.onCancelled,
    options?.signal,
  );
}

export function validateSourceSkill(slug: string) {
  return request<Record<string, unknown>>(`/api/sources/${encodeURIComponent(slug)}/validate`, {
    method: "POST",
  });
}

export function reloadFeedSkills() {
  return request<{ ok: boolean; feed_count: number; feeds: string[] }>("/api/feeds/reload-skills", {
    method: "POST",
  });
}

export interface SkillItem {
  id: string;
  name: string;
  category: string;
  description?: string;
  builtin?: boolean;
  readonly?: boolean;
  deletable?: boolean;
  is_default?: boolean;
  skill_content?: string;
  system_prompt?: string;
  path?: string;
  skill_md?: string;
  default_prompt?: string;
  has_source_yaml?: boolean;
}

export interface SkillsCatalog {
  discovery: SkillItem[];
  digest: SkillItem[];
  chat: SkillItem;
  other: SkillItem[];
  default_digest_skill?: string;
}

export interface DigestSkillDetail {
  id: string;
  name: string;
  description: string;
  skill_content: string;
  skill_md?: string;
  builtin: boolean;
  readonly?: boolean;
  path?: string;
}

export interface SkillFileContent {
  path: string;
  content: string;
}

export interface SkillDetail extends SkillItem {
  skill_md?: string;
  source_yaml?: string | null;
  files?: SkillFileContent[];
}

export function fetchDiscoverySkillDetail(skillId: string) {
  return request<SkillDetail>(`/api/skills/discovery/${encodeURIComponent(skillId)}`);
}

export function fetchOtherSkillDetail(skillId: string) {
  return request<SkillDetail>(`/api/skills/other/${encodeURIComponent(skillId)}`);
}

export function deleteDiscoverySkill(skillId: string) {
  return request<{ ok: boolean; id: string; feed_id?: string | null }>(
    `/api/skills/discovery/${encodeURIComponent(skillId)}`,
    { method: "DELETE" },
  );
}

export function deleteOtherSkill(skillId: string) {
  return request<{ ok: boolean; id: string }>(`/api/skills/other/${encodeURIComponent(skillId)}`, {
    method: "DELETE",
  });
}

export function fetchSkillsCatalog() {
  return request<SkillsCatalog>("/api/skills");
}

export function fetchDigestSkillDetail(skillId: string) {
  return request<DigestSkillDetail>(`/api/skills/digest/${encodeURIComponent(skillId)}`);
}

export function fetchDigestSkills() {
  return request<{ skills: DigestSkillDetail[]; default_digest_skill: string }>("/api/skills/digest");
}

export function saveDigestSkill(skill: { id: string; skill_md: string }) {
  return request<DigestSkillDetail>(`/api/skills/digest/${encodeURIComponent(skill.id)}`, {
    method: "PUT",
    body: JSON.stringify(skill),
  });
}

export function createDigestSkill(skill: { id: string; skill_md: string }) {
  return request<DigestSkillDetail>("/api/skills/digest", {
    method: "POST",
    body: JSON.stringify(skill),
  });
}

export function deleteDigestSkill(skillId: string) {
  return request<{ ok: boolean }>(`/api/skills/digest/${encodeURIComponent(skillId)}`, {
    method: "DELETE",
  });
}

export function fetchChatSkill() {
  return request<SkillItem>("/api/skills/chat");
}

export function saveChatSkill(skill: { skill_md: string }) {
  return request<SkillItem>("/api/skills/chat", {
    method: "PUT",
    body: JSON.stringify(skill),
  });
}

export function saveSkillConfig(payload: { default_digest_skill?: string; chat_system_prompt?: string }) {
  return request<{ ok: boolean; default_digest_skill?: string }>("/api/skills/config", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}