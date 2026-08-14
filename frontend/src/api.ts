import { streamPost, type SseCitationItem, type SseStatus } from "./utils/sse";
import { UNGROUPED_GROUP_ID } from "./utils/feedLayout";
import { appFetch } from "./demo/demoTransport";

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
  /** 平台多账号数据源，删除时不会移除平台 skill */
  platform_account?: boolean;
  platform?: string;
}

export interface FeedGroup {
  id: string;
  name: string;
  feed_ids: string[];
  digest_skill_id?: string | null;
  /** 是否参与定时自动更新；缺省 true 兼容旧数据 */
  auto_refresh?: boolean;
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
  max_tokens?: number;
}

export interface ChatMessagePayload {
  role: "user" | "assistant" | "system";
  content: string;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await appFetch(path, {
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
  return request<{
    ok: boolean;
    feed_id: string;
    skill_removed?: boolean;
    platform_account?: boolean;
  }>(`/api/feeds/${encodeURIComponent(feedId)}?${params}`, {
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

export function refreshFeed(feedId: string, days = 1, signal?: AbortSignal) {
  const params = new URLSearchParams({ days: String(days) });
  return request<RefreshAllFeedsResponse>(
    `/api/feeds/${encodeURIComponent(feedId)}/refresh?${params}`,
    {
      method: "POST",
      signal,
    },
  );
}

export interface RefreshAllFeedsResponse {
  started: boolean;
  message: string;
  scope?: string;
  group_id?: string;
  group_name?: string;
  feed_count?: number;
  feed_id?: string;
  days?: number;
  merged?: boolean;
  added?: number;
  queued?: number;
  total?: number;
}

export function refreshAllFeeds(days = 1, feedIds?: string[]) {
  return request<RefreshAllFeedsResponse>("/api/feeds/refresh-all", {
    method: "POST",
    body: JSON.stringify({ days, feed_ids: feedIds ?? [] }),
  });
}

export function refreshGroupFeeds(groupId: string, days = 1) {
  return request<RefreshAllFeedsResponse>("/api/feeds/refresh-group", {
    method: "POST",
    body: JSON.stringify({ group_id: groupId, days }),
  });
}

export function cancelRefreshFeeds() {
  return request<{ ok: boolean; message: string }>("/api/feeds/refresh/cancel", {
    method: "POST",
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
  status: "idle" | "running" | "done" | "error" | "cancelled" | string;
  phase?: string;
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

export function cancelBodiesJob() {
  return request<{ ok: boolean; message: string }>("/api/articles/bodies/jobs/cancel", {
    method: "POST",
  });
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

export interface IndexBuildPreviewResponse {
  days: number;
  feed_count: number | null;
  meta_count: number;
  article_count: number;
}

export function fetchIndexBuildPreview(days: number, feedIds?: string[]) {
  const params = new URLSearchParams({ days: String(days) });
  for (const id of feedIds ?? []) {
    params.append("feed_ids", id);
  }
  return request<IndexBuildPreviewResponse>(`/api/rag/index/preview?${params}`);
}

export function fetchSummarizeJobStatus() {
  return request<ContentJobStatus>("/api/summarize/jobs/current");
}

export function cancelSummarizeJob() {
  return request<{ ok: boolean }>("/api/summarize/jobs/cancel", { method: "POST" });
}

export async function waitForSummarizeJob(
  onProgress?: (status: ContentJobStatus) => void | Promise<void>,
  pollIntervalMs = 800,
): Promise<ContentJobStatus> {
  return waitForContentJob(fetchSummarizeJobStatus, onProgress, pollIntervalMs);
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
  days: number;
  feed_ids?: string[];
  group_ids?: string[];
  stream?: boolean;
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
  digest_tree?: DigestTree | null;
}

export type DigestTreeArticle = {
  feed_id: string;
  article_id: string;
  title: string;
  url: string;
};

export type DigestTreeEvent = {
  title: string;
  articles: DigestTreeArticle[];
};

export type DigestTreeSection = {
  id: string;
  name: string;
  kind: string;
  events: DigestTreeEvent[];
};

export type DigestTreePartition = {
  group_id: string;
  group_name: string;
  sections: DigestTreeSection[];
};

export type DigestTree = {
  version: number;
  partitions?: DigestTreePartition[];
  sections?: DigestTreeSection[];
};

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
  kind?: "daily" | "interval";
  hour: number;
  minute: number;
  second: number;
  every_hours?: number;
  group_ids?: string[];
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
  queued?: number;
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
  last_refresh_cancelled?: boolean;
}

export interface ZhihuCookieStatus {
  configured: boolean;
  masked: string;
}

export interface AuthSlot {
  id: string;
  label: string;
  login_url: string;
  cookie_hint: string;
}

export interface CredentialItem {
  id: string;
  label: string;
  slot: string;
  slot_label?: string;
  masked: string;
  created_at?: number;
  updated_at?: number;
}

export interface AuthPrecheckItem {
  entry_url: string;
  requires_auth: boolean;
  platform?: string | null;
  slot?: string | null;
  slot_label?: string;
  login_url?: string;
  cookie_hint?: string;
  configured: boolean;
  credential_id?: string | null;
  credential_label?: string | null;
  masked?: string;
  can_proceed: boolean;
}

export interface AuthPrecheckResult {
  items: AuthPrecheckItem[];
  missing_slots: string[];
  can_proceed: boolean;
  slots: AuthSlot[];
}

export interface LoginSessionStatus {
  session_id: string;
  slot: string;
  login_url: string;
  label: string;
  status: "starting" | "waiting_login" | "capturing" | "done" | "error" | "cancelled";
  message: string;
  error?: string;
  masked?: string;
  credential_id?: string | null;
  done: boolean;
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

export function fetchCredentials() {
  return request<{ credentials: CredentialItem[]; slots: AuthSlot[] }>("/api/settings/credentials");
}

export function saveCredential(body: {
  slot: string;
  cookie: string;
  label?: string;
  id?: string;
}) {
  return request<{ ok: boolean; credential: CredentialItem }>("/api/settings/credentials", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function deleteCredential(credId: string) {
  return request<{ ok: boolean }>(`/api/settings/credentials/${encodeURIComponent(credId)}`, {
    method: "DELETE",
  });
}

export function verifyCredential(credId: string) {
  return request<{ ok: boolean; message: string }>(
    `/api/settings/credentials/${encodeURIComponent(credId)}/verify`,
    { method: "POST" },
  );
}

export function precheckSourceAuth(entryUrls: string[]) {
  return request<AuthPrecheckResult>("/api/sources/auth-precheck", {
    method: "POST",
    body: JSON.stringify({ entry_urls: entryUrls }),
  });
}

export function startCredentialLoginSession(body: {
  slot?: string;
  login_url?: string;
  label?: string;
  entry_url?: string;
}) {
  return request<LoginSessionStatus>("/api/settings/credentials/login-session", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchCredentialLoginSession(sessionId: string) {
  return request<LoginSessionStatus>(
    `/api/settings/credentials/login-session/${encodeURIComponent(sessionId)}`,
  );
}

export function cancelCredentialLoginSession(sessionId: string) {
  return request<LoginSessionStatus>(
    `/api/settings/credentials/login-session/${encodeURIComponent(sessionId)}/cancel`,
    { method: "POST" },
  );
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

export interface LlmSettingsResponse {
  configured: boolean;
  persisted?: boolean;
  model: string;
  embedding_model: string;
  api_key: string;
  api_base: string;
  max_tokens: number;
  source?: string;
  thinking_style: string;
  embedding_api_key: string;
  embedding_api_base: string;
}

export function fetchLlmSettings() {
  return request<LlmSettingsResponse>("/api/settings/llm");
}

export function saveLlmSettings(payload: {
  model: string;
  embedding_model: string;
  api_key: string;
  api_base: string;
  max_tokens: number;
  thinking_style: string;
  embedding_api_key: string;
  embedding_api_base: string;
}) {
  return request<LlmSettingsResponse & { ok: boolean }>("/api/settings/llm", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function clearLlmSettings() {
  return request<LlmSettingsResponse & { ok: boolean }>("/api/settings/llm", {
    method: "DELETE",
  });
}

export function streamSummarize(
  body: SummarizeBody,
  onToken: (content: string) => void,
  onDone: () => void,
  onError: (message: string) => void,
  onStatus?: (status: SseStatus) => void,
  onThinking?: (content: string) => void,
  options?: { signal?: AbortSignal; onCancelled?: (detail: string) => void },
) {
  return streamPost(
    "/api/summarize",
    { ...body, stream: true },
    onToken,
    onDone,
    onError,
    onStatus,
    onThinking,
    undefined,
    undefined,
    undefined,
    undefined,
    options?.onCancelled,
    options?.signal,
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
  options?: { onCancelled?: (detail: string, jobId?: string) => void },
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
    options?.onCancelled,
    signal,
  );
}

export interface ChatJobStatus {
  job_id: string | null;
  status: "idle" | "running" | "done" | "error" | "cancelled";
  phase?: string;
  message?: string;
  content: string;
  thinking: string;
  citations: CitationItem[] | null;
  prompt_preview?: { system?: string } | null;
  error: string | null;
  result?: { has_summary?: boolean } | null;
}

export function fetchChatJobStatus() {
  return request<ChatJobStatus>("/api/chat/jobs/current");
}

export function cancelChatJob() {
  return request<{ ok: boolean }>("/api/chat/jobs/cancel", { method: "POST" });
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
  | "skipped"
  | "needs_auth";

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
  auth_slot?: string | null;
  login_url?: string | null;
  cookie_hint?: string | null;
}

export interface OnboardBatchStatus {
  batch_id: string;
  status: "running" | "done" | "cancelled" | "needs_auth";
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  needs_auth?: number;
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
  days?: number;
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
  has_profile?: boolean;
  feed_id?: string;
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
  input_mode?: string;
  profile?: DigestProfile | null;
  has_profile?: boolean;
  builtin: boolean;
  readonly?: boolean;
  path?: string;
}

export type DigestProfile = {
  version: number;
  input_mode: "titles" | "full";
  focus: {
    enabled: boolean;
    criteria: string;
    max_events: number;
    exclusive: boolean;
  };
  categories: Array<{ id: string; name: string; criteria: string }>;
  ignore: { criteria: string };
  cluster: { enabled: boolean };
};

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

export interface DiscoverySkillImportResult {
  ok: boolean;
  imported: Array<{
    slug: string;
    skill_id: string;
    feed_id: string;
    name: string;
    overwritten: boolean;
  }>;
  imported_platform_accounts?: Array<{
    feed_id: string;
    platform?: string;
    account_key?: string;
    name?: string;
    overwritten: boolean;
  }>;
  group_id: string;
  needs_auth?: string[];
}

export interface PlatformAccountImportPayload {
  feed_id: string;
  platform?: string;
  account_key?: string;
  user_type?: string;
  entry_url?: string;
  posts_url?: string;
  display_name?: string;
  list_api_path?: string;
  slug?: string;
  xsec_token?: string;
  group_id?: string | null;
}

export interface DiscoverySkillZipPackage {
  skills: DiscoverySkillImportPayload[];
  platform_accounts: PlatformAccountImportPayload[];
  count: number;
  platform_account_count: number;
}

export async function exportDiscoverySkills(
  skillIds: string[],
  platformFeedIds: string[] = [],
): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch("/api/skills/discovery/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      skill_ids: skillIds,
      platform_feed_ids: platformFeedIds,
    }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const detail = data.detail;
    throw new Error(typeof detail === "string" ? detail : detail ? JSON.stringify(detail) : "导出失败");
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename=\"?([^\";]+)\"?/i);
  const filename = match?.[1] || "askme-skills.zip";
  return { blob, filename };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export interface DiscoverySkillImportPayload {
  skill_id: string;
  slug?: string;
  feed_id?: string;
  name?: string;
  files: Array<{ path: string; content: string }>;
}

export async function importDiscoverySkills(
  skills: DiscoverySkillImportPayload[],
  overwrite = false,
  groupId?: string,
  platformAccounts: PlatformAccountImportPayload[] = [],
) {
  const response = await fetch("/api/skills/discovery/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      skills,
      platform_accounts: platformAccounts,
      overwrite,
      group_id: groupId && groupId !== UNGROUPED_GROUP_ID ? groupId : null,
    }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const detail = data.detail;
    throw new Error(typeof detail === "string" ? detail : detail ? JSON.stringify(detail) : "导入失败");
  }
  return response.json() as Promise<DiscoverySkillImportResult>;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export async function parseDiscoverySkillZip(file: File): Promise<DiscoverySkillZipPackage> {
  const buffer = await file.arrayBuffer();
  const response = await fetch("/api/skills/discovery/parse-zip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ zip_base64: arrayBufferToBase64(buffer) }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const detail = data.detail;
    throw new Error(typeof detail === "string" ? detail : detail ? JSON.stringify(detail) : "解析 zip 失败");
  }
  const data = (await response.json()) as DiscoverySkillZipPackage;
  return {
    skills: data.skills || [],
    platform_accounts: data.platform_accounts || [],
    count: data.count ?? (data.skills || []).length,
    platform_account_count: data.platform_account_count ?? (data.platform_accounts || []).length,
  };
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

export function saveDigestSkill(skill: {
  id: string;
  skill_md?: string;
  profile?: DigestProfile;
}) {
  return request<DigestSkillDetail>(`/api/skills/digest/${encodeURIComponent(skill.id)}`, {
    method: "PUT",
    body: JSON.stringify(skill),
  });
}

export function createDigestSkill(skill: {
  id: string;
  skill_md?: string;
  profile?: DigestProfile;
}) {
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

export function restoreDigestSkill(skillId: string) {
  return request<{ ok: boolean }>(`/api/skills/digest/${encodeURIComponent(skillId)}/restore`, {
    method: "POST",
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
