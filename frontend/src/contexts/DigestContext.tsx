import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  fetchBodiesJobStatus,
  fetchCachedSummary,
  fetchFeeds,
  fetchIndexJobStatus,
  fetchRagStatus,
  fetchRecentArticles,
  startBodiesJob,
  startIndexJob,
  waitForContentJob,
  type ContentJobStatus,
  type Feed,
  type FeedGroup,
  type RecentArticlesResponse,
  type SummarizeBody,
  streamSummarize,
} from "../api";
import { getLlmConfigPayload, useSettings, type DefaultDays, normalizeDefaultDays } from "../hooks/useSettings";
import { UNGROUPED_GROUP_ID } from "../utils/feedLayout";

type SummaryPhase = "idle" | "loading_articles" | "generating";

export interface SummaryGroupOption {
  id: string;
  name: string;
  feedCount: number;
  digestSkillId?: string | null;
}

const SELECTED_GROUPS_KEY = "askme.digest.selectedGroupIds";

function buildSummaryGroupOptions(feeds: Feed[], groups: FeedGroup[]): SummaryGroupOption[] {
  const assigned = new Set(groups.flatMap((group) => group.feed_ids));
  const options: SummaryGroupOption[] = groups
    .map((group) => ({
      id: group.id,
      name: group.name,
      feedCount: group.feed_ids.length,
      digestSkillId: group.digest_skill_id,
    }))
    .filter((group) => group.feedCount > 0);

  const ungroupedCount = feeds.filter((feed) => !assigned.has(feed.id)).length;
  if (ungroupedCount > 0) {
    options.push({
      id: UNGROUPED_GROUP_ID,
      name: "未分组",
      feedCount: ungroupedCount,
    });
  }
  return options;
}

function loadStoredGroupIds(): string[] | null {
  try {
    const raw = localStorage.getItem(SELECTED_GROUPS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : null;
  } catch {
    return null;
  }
}

function persistGroupIds(ids: string[]) {
  localStorage.setItem(SELECTED_GROUPS_KEY, JSON.stringify(ids));
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function reconcileSelectedIds(
  options: SummaryGroupOption[],
  stored: string[] | null,
  current: string[] = [],
): string[] {
  const valid = new Set(options.map((option) => option.id));
  const fromStored = (stored ?? []).filter((id) => valid.has(id));
  // 单选：只保留第一个有效分组；无历史则默认首个有文章的分组
  const next =
    fromStored.length > 0
      ? [fromStored[0]]
      : options.length > 0
        ? [options[0].id]
        : [];
  return arraysEqual(next, current) ? current : next;
}

interface DigestContextValue {
  days: DefaultDays;
  setDays: (days: DefaultDays) => void;
  summaryGroupOptions: SummaryGroupOption[];
  selectedGroupIds: string[];
  selectedGroupId: string | null;
  setSelectedSummaryGroup: (groupId: string) => void;
  reloadSummaryGroups: () => Promise<void>;
  loadingBodies: boolean;
  loadingBodiesGroupId: string | null;
  loadingIndex: boolean;
  loadError: string;
  truncated: boolean;
  metaCount: number;
  bodyCount: number;
  cachedCount: number;
  fetchedCount: number;
  bodyProgress: { current: number; total: number; message: string };
  bodiesReady: boolean;
  indexReady: boolean;
  indexChunkCount: number;
  indexStatusMessage: string;
  indexProgress: { current: number; total: number; message: string };
  summary: string;
  thinking: string;
  generating: boolean;
  summaryPhase: string;
  statusMessage: string;
  summaryError: string;
  digestBusy: boolean;
  loadBodies: (options?: {
    feedIds?: string[];
    groupId?: string;
    groupName?: string;
    listLimit?: number;
  }) => Promise<{
    article_count: number;
    meta_count?: number;
    cached_count?: number;
    fetched_count?: number;
  } | null>;
  buildIndex: () => Promise<void>;
  startSummarize: () => Promise<void>;
  clearErrors: () => void;
}

const DigestContext = createContext<DigestContextValue | null>(null);

export function DigestProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const [days, setDaysState] = useState<DefaultDays>(normalizeDefaultDays(settings.defaultDays));
  const setDays = useCallback((value: DefaultDays) => {
    setDaysState(normalizeDefaultDays(value));
  }, []);
  const [summaryGroupOptions, setSummaryGroupOptions] = useState<SummaryGroupOption[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [loadingBodies, setLoadingBodies] = useState(false);
  const [loadingBodiesGroupId, setLoadingBodiesGroupId] = useState<string | null>(null);
  const [loadingIndex, setLoadingIndex] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [metaCount, setMetaCount] = useState(0);
  const [bodyCount, setBodyCount] = useState(0);
  const [cachedCount, setCachedCount] = useState(0);
  const [fetchedCount, setFetchedCount] = useState(0);
  const [bodyProgress, setBodyProgress] = useState({ current: 0, total: 0, message: "" });
  const [bodiesLoadedForDays, setBodiesLoadedForDays] = useState<number | null>(null);
  const [indexBuiltForDays, setIndexBuiltForDays] = useState<number | null>(null);
  const [indexChunkCount, setIndexChunkCount] = useState(0);
  const [indexStatusMessage, setIndexStatusMessage] = useState("");
  const [indexProgress, setIndexProgress] = useState({ current: 0, total: 0, message: "" });

  const [summary, setSummary] = useState("");
  const [thinking, setThinking] = useState("");
  const [generating, setGenerating] = useState(false);
  const [phase, setPhase] = useState<SummaryPhase>("idle");
  const [summaryPhase, setSummaryPhase] = useState("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [summaryError, setSummaryError] = useState("");

  const summaryRef = useRef("");
  const thinkingRef = useRef("");
  const generatingRef = useRef(false);
  const indexBuildInFlightRef = useRef(false);
  const indexBuildGenerationRef = useRef(0);
  const bodiesInFlightRef = useRef(false);

  const bodiesReady = bodiesLoadedForDays === days && bodyCount > 0;
  const indexReady = indexBuiltForDays === days && indexChunkCount > 0;
  const digestBusy = loadingBodies || loadingIndex || generating;

  const reloadSummaryGroups = useCallback(async () => {
    try {
      const data = await fetchFeeds();
      const options = buildSummaryGroupOptions(data.feeds, data.groups);
      setSummaryGroupOptions(options);
      setSelectedGroupIds((current) => {
        const next = reconcileSelectedIds(
          options,
          current.length > 0 ? current : loadStoredGroupIds(),
          current,
        );
        if (!arraysEqual(next, current)) {
          persistGroupIds(next);
        }
        return next;
      });
    } catch {
      setSummaryGroupOptions([]);
      setSelectedGroupIds([]);
    }
  }, []);

  useEffect(() => {
    setDays(normalizeDefaultDays(settings.defaultDays));
  }, [settings.defaultDays, setDays]);

  useEffect(() => {
    void reloadSummaryGroups();
  }, [reloadSummaryGroups]);

  useEffect(() => {
    let cancelled = false;

    async function syncScopeFromBackend() {
      setBodiesLoadedForDays(null);
      setBodyCount(0);
      setMetaCount(0);
      setCachedCount(0);
      setFetchedCount(0);
      setTruncated(false);
      if (!indexBuildInFlightRef.current) {
        setIndexBuiltForDays(null);
        setIndexChunkCount(0);
      }

      try {
        const data = await fetchRecentArticles(days, undefined, false);
        if (cancelled) return;

        const items = data.articles ?? [];
        const bodyItems = items.filter((item) => item.has_body);
        setMetaCount(data.meta_count ?? items.length);
        if (bodyItems.length > 0) {
          setBodiesLoadedForDays(days);
          setBodyCount(bodyItems.length);
        }

        const rag = await fetchRagStatus(days);
        if (cancelled || indexBuildInFlightRef.current) return;
        if (rag.ready && rag.chunk_count > 0) {
          setIndexBuiltForDays(days);
          setIndexChunkCount(rag.chunk_count);
        }
      } catch {
        // 忽略恢复失败，用户可手动重新加载
      }
    }

    void syncScopeFromBackend();
    return () => {
      cancelled = true;
    };
  }, [days]);

  const selectedGroupIdsKey = selectedGroupIds.join("\0");

  const loadCachedSummary = useCallback(async () => {
    if (generatingRef.current) {
      return;
    }
    if (selectedGroupIds.length === 0) {
      setSummary("");
      summaryRef.current = "";
      return;
    }
    try {
      const data = await fetchCachedSummary(days, undefined, selectedGroupIds);
      if (generatingRef.current) {
        return;
      }
      setSummary(data.summary ?? "");
      summaryRef.current = data.summary ?? "";
    } catch {
      if (generatingRef.current) {
        return;
      }
      setSummary("");
      summaryRef.current = "";
    }
  }, [days, selectedGroupIds, selectedGroupIdsKey]);

  useEffect(() => {
    void loadCachedSummary();
  }, [loadCachedSummary]);

  const setSelectedSummaryGroup = useCallback((groupId: string) => {
    const next = groupId ? [groupId] : [];
    persistGroupIds(next);
    setSelectedGroupIds(next);
  }, []);

  const resetIndexState = useCallback(() => {
    if (indexBuildInFlightRef.current) {
      return;
    }
    setIndexBuiltForDays(null);
    setIndexChunkCount(0);
  }, []);

  const applyBodiesDone = useCallback(
    async (status: ContentJobStatus, scoped: boolean) => {
      if (status.status === "error") {
        if (!scoped) {
          setBodiesLoadedForDays(null);
          setBodyCount(0);
        }
        setLoadError(status.error || status.message || "拉取正文失败");
        return null;
      }
      const data = (status.result || null) as RecentArticlesResponse | null;
      if (!data) {
        if (!scoped) {
          setBodiesLoadedForDays(null);
          setBodyCount(0);
        }
        setLoadError(status.error || "拉取正文失败");
        return null;
      }
      if (!scoped) {
        setTruncated(data.truncated);
        setMetaCount(data.meta_count ?? data.article_count);
        setBodyCount(data.article_count);
        setCachedCount(data.cached_count ?? 0);
        setFetchedCount(data.fetched_count ?? 0);
        if (data.article_count > 0) {
          setBodiesLoadedForDays(days);
        } else {
          setBodiesLoadedForDays(null);
          setLoadError(
            data.meta_count
              ? "未能拉取到含正文的文章，请先刷新数据源订阅"
              : "所选时间范围内暂无文章",
          );
        }
        await loadCachedSummary();
      }
      return data;
    },
    [days, loadCachedSummary],
  );

  const watchBodiesJob = useCallback(
    async (scoped: boolean) => {
      const finalStatus = await waitForContentJob(fetchBodiesJobStatus, (status) => {
        setLoadingBodies(true);
        setBodyProgress({
          current: status.current ?? 0,
          total: status.total ?? 0,
          message: status.message || "正在拉取正文…",
        });
        if (!scoped) {
          if (typeof status.cached_count === "number") {
            setCachedCount(status.cached_count);
          }
          if (typeof status.fetched_count === "number") {
            setFetchedCount(status.fetched_count);
          }
        }
        const groupId = String((status.params as { group_id?: string } | undefined)?.group_id || "");
        setLoadingBodiesGroupId(groupId || null);
      });
      const data = await applyBodiesDone(finalStatus, scoped);
      setBodyProgress({ current: 0, total: 0, message: "" });
      setLoadingBodies(false);
      setLoadingBodiesGroupId(null);
      bodiesInFlightRef.current = false;
      return data;
    },
    [applyBodiesDone],
  );

  const loadBodies = useCallback(
    async (options?: {
      feedIds?: string[];
      groupId?: string;
      groupName?: string;
      listLimit?: number;
    }) => {
      if (bodiesInFlightRef.current) return null;
      bodiesInFlightRef.current = true;

      const feedIds = options?.feedIds;
      const scoped = Boolean(feedIds?.length);
      const groupId = options?.groupId ?? null;
      const groupName = options?.groupName?.trim() || "";
      const listLimit = options?.listLimit;
      const progressLabel = groupName
        ? `正在拉取分组「${groupName}」列表内文章正文…`
        : "正在拉取正文…";

      setLoadingBodies(true);
      setLoadingBodiesGroupId(groupId);
      setLoadError("");
      setSummaryError("");
      setBodyProgress({ current: 0, total: 0, message: progressLabel });
      if (!scoped) {
        resetIndexState();
      }
      try {
        const started = await startBodiesJob({
          days,
          feedIds,
          listLimit,
          progressMessage: progressLabel,
          groupId: groupId || undefined,
        });
        if (started.status === "running" || started.started === false) {
          // already running or just started — always poll to completion
          return await watchBodiesJob(scoped);
        }
        return await applyBodiesDone(started, scoped);
      } catch (err) {
        if (!scoped) {
          setBodiesLoadedForDays(null);
          setBodyCount(0);
        }
        setLoadError(err instanceof Error ? err.message : "拉取正文失败");
        setBodyProgress({ current: 0, total: 0, message: "" });
        setLoadingBodies(false);
        setLoadingBodiesGroupId(null);
        bodiesInFlightRef.current = false;
        return null;
      }
    },
    [applyBodiesDone, days, resetIndexState, watchBodiesJob],
  );

  const watchIndexJob = useCallback(async () => {
    const generation = indexBuildGenerationRef.current;
    const finalStatus = await waitForContentJob(fetchIndexJobStatus, (status) => {
      if (generation !== indexBuildGenerationRef.current) return;
      setLoadingIndex(true);
      setIndexProgress({
        current: status.current ?? 0,
        total: status.total ?? 0,
        message: status.message || "正在建立向量索引…",
      });
      setIndexStatusMessage(status.message || "正在建立向量索引，可切换页面…");
    });
    if (generation !== indexBuildGenerationRef.current) return;
    if (finalStatus.status === "error") {
      // 失败时保留已有索引（近 3 天历史不因本次失败被清掉）
      setLoadError(finalStatus.error || finalStatus.message || "建立索引失败");
    } else {
      try {
        const rag = await fetchRagStatus(days);
        if (generation !== indexBuildGenerationRef.current) return;
        setIndexChunkCount(rag.chunk_count);
        setIndexBuiltForDays(rag.chunk_count > 0 ? days : null);
      } catch {
        const result = finalStatus.result as { chunk_count?: number } | null;
        setIndexChunkCount(result?.chunk_count ?? 0);
        setIndexBuiltForDays((result?.chunk_count ?? 0) > 0 ? days : null);
      }
    }
    setIndexStatusMessage("");
    setIndexProgress({ current: 0, total: 0, message: "" });
    indexBuildInFlightRef.current = false;
    setLoadingIndex(false);
  }, [days]);

  /** 索引按可选最大时间范围（近 3 天）维护；无新正文时按 0 篇增量处理 */
  const INDEX_RETENTION_DAYS = 3;

  const buildIndex = useCallback(async () => {
    if (indexBuildInFlightRef.current) return;

    ++indexBuildGenerationRef.current;
    indexBuildInFlightRef.current = true;
    setLoadingIndex(true);
    setLoadError("");
    setIndexProgress({ current: 0, total: 0, message: "正在建立向量索引…" });
    setIndexStatusMessage("正在建立向量索引，可切换页面…");
    try {
      const llmConfig = getLlmConfigPayload();
      if (!llmConfig.embedding_model?.trim()) {
        throw new Error("请先在设置页选择并保存 Embedding 模型");
      }
      await startIndexJob(INDEX_RETENTION_DAYS, llmConfig);
      await watchIndexJob();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "建立索引失败");
      setIndexStatusMessage("");
      setIndexProgress({ current: 0, total: 0, message: "" });
      indexBuildInFlightRef.current = false;
      setLoadingIndex(false);
    }
  }, [watchIndexJob]);

  // 刷新后恢复正文 / 索引进度条
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [bodiesStatus, indexStatus] = await Promise.all([
          fetchBodiesJobStatus(),
          fetchIndexJobStatus(),
        ]);
        if (cancelled) return;
        if (bodiesStatus.status === "running" && !bodiesInFlightRef.current) {
          bodiesInFlightRef.current = true;
          const scoped = Boolean(
            Array.isArray((bodiesStatus.params as { feed_ids?: string[] } | undefined)?.feed_ids) &&
              ((bodiesStatus.params as { feed_ids?: string[] }).feed_ids?.length ?? 0) > 0,
          );
          void watchBodiesJob(scoped);
        }
        if (indexStatus.status === "running" && !indexBuildInFlightRef.current) {
          indexBuildInFlightRef.current = true;
          ++indexBuildGenerationRef.current;
          setLoadingIndex(true);
          void watchIndexJob();
        }
      } catch {
        // ignore resume failures
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [watchBodiesJob, watchIndexJob]);

  const startSummarize = useCallback(async () => {
    if (selectedGroupIds.length === 0) {
      setSummaryError("请先选择一个分组");
      return;
    }

    setGenerating(true);
    generatingRef.current = true;
    setPhase("generating");
    setSummaryPhase("start");
    setStatusMessage("正在准备生成概览…");
    setSummaryError("");
    setSummary("");
    setThinking("");
    summaryRef.current = "";
    thinkingRef.current = "";

    const body: SummarizeBody = {
      group_ids: selectedGroupIds,
      days,
      stream: true,
      enable_thinking: false,
      use_cached_context: true,
      llm_config: getLlmConfigPayload(),
    };

    await streamSummarize(
      body,
      (token) => {
        summaryRef.current += token;
        setSummary(summaryRef.current);
      },
      () => {
        generatingRef.current = false;
        setGenerating(false);
        setPhase("idle");
        setSummaryPhase("idle");
        setStatusMessage("");
        setThinking("");
        thinkingRef.current = "";
        void loadCachedSummary();
      },
      (message) => {
        generatingRef.current = false;
        setSummaryError(message);
        setGenerating(false);
        setPhase("idle");
        setSummaryPhase("idle");
        setStatusMessage("");
        setThinking("");
        thinkingRef.current = "";
      },
      (status) => {
        if (status.message) {
          setStatusMessage(status.message);
        }
        if (status.phase) {
          setSummaryPhase(status.phase);
        }
        if (status.phase === "generating" || status.phase === "classify" || status.phase === "cluster" || status.phase === "render") {
          setPhase("generating");
        } else if (status.phase === "loading_articles") {
          setPhase("loading_articles");
        }
      },
      (chunk) => {
        thinkingRef.current += chunk;
        setThinking(thinkingRef.current);
      },
    );
  }, [
    days,
    loadCachedSummary,
    selectedGroupIds,
  ]);

  const clearErrors = useCallback(() => {
    setLoadError("");
    setSummaryError("");
  }, []);

  return (
    <DigestContext.Provider
      value={{
        days,
        setDays,
        summaryGroupOptions,
        selectedGroupIds,
        selectedGroupId: selectedGroupIds[0] ?? null,
        setSelectedSummaryGroup,
        reloadSummaryGroups,
        loadingBodies,
        loadingBodiesGroupId,
        loadingIndex,
        loadError,
        truncated,
        metaCount,
        bodyCount,
        cachedCount,
        fetchedCount,
        bodyProgress,
        bodiesReady,
        indexReady,
        indexChunkCount,
        indexStatusMessage,
        indexProgress,
        summary,
        thinking,
        generating,
        summaryPhase,
        statusMessage: generating
          ? statusMessage || (phase === "generating" ? "正在生成概览…" : "")
          : "",
        summaryError,
        digestBusy,
        loadBodies,
        buildIndex,
        startSummarize,
        clearErrors,
      }}
    >
      {children}
    </DigestContext.Provider>
  );
}

export function useDigest() {
  const context = useContext(DigestContext);
  if (!context) {
    throw new Error("useDigest must be used within DigestProvider");
  }
  return context;
}
