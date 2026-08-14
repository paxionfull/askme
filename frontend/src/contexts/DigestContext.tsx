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
  cancelBodiesJob,
  cancelSummarizeJob,
  fetchBodiesJobStatus,
  fetchCachedSummary,
  fetchFeeds,
  fetchIndexJobStatus,
  fetchRagStatus,
  fetchRecentArticles,
  fetchSummarizeJobStatus,
  startBodiesJob,
  startIndexJob,
  waitForContentJob,
  waitForSummarizeJob,
  type ContentJobStatus,
  type Feed,
  type FeedGroup,
  type RecentArticlesResponse,
  type SummarizeBody,
  streamSummarize,
} from "../api";
import { getLlmConfigPayload, useSettings, type DefaultDays, normalizeDefaultDays } from "../hooks/useSettings";
import { useLocale } from "../i18n/LocaleContext";
import { formatMessage } from "../i18n/messages";
import { UNGROUPED_GROUP_ID } from "../utils/feedLayout";
import { INDEX_RETENTION_DAYS } from "../utils/indexBuild";

type SummaryPhase = "idle" | "loading_articles" | "generating";

export interface SummaryGroupOption {
  id: string;
  name: string;
  feedCount: number;
  feedIds: string[];
  digestSkillId?: string | null;
}

const SELECTED_GROUPS_KEY = "askme.digest.selectedGroupIds";
const DAYS_KEY = "askme.digest.days";
const SUMMARIZE_JOB_SYNC_KEY = "askme.summarizeJobTick";
const SUMMARIZE_JOB_CHANNEL = "askme.summarizeJob";

function loadStoredDays(fallback: DefaultDays): DefaultDays {
  try {
    const raw = localStorage.getItem(DAYS_KEY);
    if (raw === null) return fallback;
    return normalizeDefaultDays(Number(raw));
  } catch {
    return fallback;
  }
}

function persistDays(days: DefaultDays) {
  try {
    localStorage.setItem(DAYS_KEY, String(days));
  } catch {
    // ignore quota / private mode
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function notifySummarizeJobSync() {
  try {
    localStorage.setItem(SUMMARIZE_JOB_SYNC_KEY, String(Date.now()));
  } catch {
    // ignore quota / private mode
  }
  try {
    const channel = new BroadcastChannel(SUMMARIZE_JOB_CHANNEL);
    channel.postMessage("ping");
    channel.close();
  } catch {
    // ignore unsupported environments
  }
}

function buildSummaryGroupOptions(
  feeds: Feed[],
  groups: FeedGroup[],
  ungroupedLabel: string,
): SummaryGroupOption[] {
  const assigned = new Set(groups.flatMap((group) => group.feed_ids));
  const ungroupedFeedIds = feeds.filter((feed) => !assigned.has(feed.id)).map((feed) => feed.id);
  // 空分组也展示：新建后即可在简报页绑定整理规则；有源后再生成
  const options: SummaryGroupOption[] = groups.map((group) => ({
    id: group.id,
    name: group.name,
    feedCount: group.feed_ids.length,
    feedIds: [...group.feed_ids],
    digestSkillId: group.digest_skill_id,
  }));

  if (ungroupedFeedIds.length > 0) {
    options.push({
      id: UNGROUPED_GROUP_ID,
      name: ungroupedLabel,
      feedCount: ungroupedFeedIds.length,
      feedIds: ungroupedFeedIds,
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
  /** 当前选中分组 + 时间范围内的文章数（列表篇数） */
  scopeArticleCount: number | null;
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
  buildIndex: (feedIds?: string[]) => Promise<void>;
  startSummarize: () => Promise<void>;
  stopSummarize: () => void;
  stopBodies: () => void;
  clearErrors: () => void;
}

const DigestContext = createContext<DigestContextValue | null>(null);

export function DigestProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const { t, locale } = useLocale();
  const [days, setDaysState] = useState<DefaultDays>(() =>
    loadStoredDays(normalizeDefaultDays(settings.defaultDays)),
  );
  const setDays = useCallback((value: DefaultDays) => {
    const next = normalizeDefaultDays(value);
    setDaysState(next);
    persistDays(next);
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
  const [scopeArticleCount, setScopeArticleCount] = useState<number | null>(null);
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
  const summarizeSnapshotRef = useRef("");
  const summarizeStreamingRef = useRef(false);
  const summarizeAbortRef = useRef<AbortController | null>(null);
  const summarizeInFlightRef = useRef(false);
  const summarizePollGenerationRef = useRef(0);
  const indexBuildInFlightRef = useRef(false);
  const indexBuildGenerationRef = useRef(0);
  const bodiesInFlightRef = useRef(false);
  const syncedDefaultDaysRef = useRef(settings.defaultDays);

  const bodiesReady = bodiesLoadedForDays === days && bodyCount > 0;
  const indexReady = indexBuiltForDays === days && indexChunkCount > 0;
  const digestBusy = loadingBodies || loadingIndex || generating;

  const reloadSummaryGroups = useCallback(async () => {
    try {
      const data = await fetchFeeds();
      const options = buildSummaryGroupOptions(data.feeds, data.groups, t("addSourceUngrouped"));
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
  }, [t]);

  // 设置页修改「默认时间范围」时同步；首屏不覆盖已持久化的当前选择
  useEffect(() => {
    if (syncedDefaultDaysRef.current === settings.defaultDays) return;
    syncedDefaultDaysRef.current = settings.defaultDays;
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
  const selectedScopeFeedIdsKey = selectedGroupIds
    .map((id) => summaryGroupOptions.find((group) => group.id === id)?.feedIds.join(",") ?? "")
    .join("|");

  useEffect(() => {
    let cancelled = false;
    const selected = summaryGroupOptions.find((group) => group.id === selectedGroupIds[0]);
    const feedIds = selected?.feedIds ?? [];

    if (!selected || feedIds.length === 0) {
      setScopeArticleCount(selected ? 0 : null);
      return;
    }

    void fetchRecentArticles(days, feedIds, false)
      .then((data) => {
        if (cancelled) return;
        setScopeArticleCount(data.meta_count ?? data.articles?.length ?? 0);
      })
      .catch(() => {
        if (!cancelled) setScopeArticleCount(null);
      });

    return () => {
      cancelled = true;
    };
    // selectedGroupIds / summaryGroupOptions 通过 key 追踪；loadingBodies 结束后刷新篇数
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional key-based deps
  }, [days, selectedGroupIdsKey, selectedScopeFeedIdsKey, loadingBodies]);

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
      if (status.status === "cancelled") {
        const data = (status.result || null) as RecentArticlesResponse | null;
        if (data && !scoped) {
          setTruncated(data.truncated);
          setMetaCount(data.meta_count ?? data.article_count);
          setBodyCount(data.article_count);
          setCachedCount(data.cached_count ?? 0);
          setFetchedCount(data.fetched_count ?? 0);
          if (data.article_count > 0) {
            setBodiesLoadedForDays(days);
          }
        }
        setLoadError("");
        return data;
      }
      if (status.status === "error") {
        if (!scoped) {
          setBodiesLoadedForDays(null);
          setBodyCount(0);
        }
        setLoadError(status.error || status.message || t("digestFetchBodiesFailed"));
        return null;
      }
      const data = (status.result || null) as RecentArticlesResponse | null;
      if (!data) {
        if (!scoped) {
          setBodiesLoadedForDays(null);
          setBodyCount(0);
        }
        setLoadError(status.error || t("digestFetchBodiesFailed"));
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
            data.meta_count ? t("digestNoBodiesFetched") : t("digestNoArticlesInRange"),
          );
        }
        await loadCachedSummary();
      }
      return data;
    },
    [days, loadCachedSummary, t],
  );

  const watchBodiesJob = useCallback(
    async (scoped: boolean) => {
      const finalStatus = await waitForContentJob(fetchBodiesJobStatus, (status) => {
        setLoadingBodies(true);
        setBodyProgress({
          current: status.current ?? 0,
          total: status.total ?? 0,
          message: status.message || t("digestFetchingBodies"),
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
    [applyBodiesDone, t],
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
        ? formatMessage(locale, "digestFetchingGroupBodies", { name: groupName })
        : t("digestFetchingBodies");

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
        setLoadError(err instanceof Error ? err.message : t("digestFetchBodiesFailed"));
        setBodyProgress({ current: 0, total: 0, message: "" });
        setLoadingBodies(false);
        setLoadingBodiesGroupId(null);
        bodiesInFlightRef.current = false;
        return null;
      }
    },
    [applyBodiesDone, days, locale, resetIndexState, t, watchBodiesJob],
  );

  const watchIndexJob = useCallback(async () => {
    const generation = indexBuildGenerationRef.current;
    const finalStatus = await waitForContentJob(fetchIndexJobStatus, (status) => {
      if (generation !== indexBuildGenerationRef.current) return;
      setLoadingIndex(true);
      setIndexProgress({
        current: status.current ?? 0,
        total: status.total ?? 0,
        message: status.message || t("digestBuildingIndex"),
      });
      setIndexStatusMessage(status.message || t("digestBuildingIndexBg"));
    });
    if (generation !== indexBuildGenerationRef.current) return;
    if (finalStatus.status === "error") {
      // 失败时保留已有索引（近 3 天历史不因本次失败被清掉）
      setLoadError(finalStatus.error || finalStatus.message || t("digestIndexFailed"));
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
  }, [days, t]);

  const buildIndex = useCallback(async (feedIds?: string[]) => {
    if (indexBuildInFlightRef.current) return;

    ++indexBuildGenerationRef.current;
    indexBuildInFlightRef.current = true;
    setLoadingIndex(true);
    setLoadError("");
    setIndexProgress({ current: 0, total: 0, message: t("digestBuildingIndex") });
    setIndexStatusMessage(t("digestBuildingIndexBg"));
    try {
      const llmConfig = getLlmConfigPayload();
      if (!llmConfig.embedding_model?.trim()) {
        throw new Error(t("sourcesNeedEmbedding"));
      }
      const hasEmbeddingKey =
        llmConfig.embedding_api_key?.trim() || llmConfig.api_key?.trim();
      if (!hasEmbeddingKey) {
        throw new Error(t("indexEmbedMessageWithModel"));
      }
      const scopedIds = (feedIds ?? []).map((id) => id.trim()).filter(Boolean);
      await startIndexJob(
        INDEX_RETENTION_DAYS,
        llmConfig,
        scopedIds.length > 0 ? scopedIds : undefined,
      );
      await watchIndexJob();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t("digestIndexFailed"));
      setIndexStatusMessage("");
      setIndexProgress({ current: 0, total: 0, message: "" });
      indexBuildInFlightRef.current = false;
      setLoadingIndex(false);
    }
  }, [t, watchIndexJob]);

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

  const resetSummarizeUi = useCallback(
    (options?: { restoreSnapshot?: boolean }) => {
      generatingRef.current = false;
      summarizeInFlightRef.current = false;
      summarizeAbortRef.current = null;
      summarizeStreamingRef.current = false;
      setGenerating(false);
      setPhase("idle");
      setSummaryPhase("idle");
      setStatusMessage("");
      setThinking("");
      thinkingRef.current = "";
      if (options?.restoreSnapshot) {
        summaryRef.current = summarizeSnapshotRef.current;
        setSummary(summarizeSnapshotRef.current);
      }
    },
    [],
  );

  const applySummarizeJobProgress = useCallback((status: ContentJobStatus) => {
    setGenerating(true);
    generatingRef.current = true;
    if (status.phase) {
      setSummaryPhase(status.phase);
      if (
        status.phase === "generating" ||
        status.phase === "classify" ||
        status.phase === "cluster" ||
        status.phase === "render"
      ) {
        setPhase("generating");
      } else if (status.phase === "loading_articles") {
        setPhase("loading_articles");
      }
    }
    if (status.message) {
      setStatusMessage(status.message);
    }
  }, []);

  const watchSummarizeJob = useCallback(
    async (generation: number) => {
      const finalStatus = await waitForSummarizeJob((status) => {
        if (generation !== summarizePollGenerationRef.current) return;
        applySummarizeJobProgress(status);
      });
      if (generation !== summarizePollGenerationRef.current) return;

      if (finalStatus.status === "cancelled") {
        resetSummarizeUi({ restoreSnapshot: true });
        await loadCachedSummary();
        return;
      }
      if (finalStatus.status === "error") {
        resetSummarizeUi({ restoreSnapshot: true });
        setSummaryError(finalStatus.error || finalStatus.message || t("digestSummaryFailed"));
        await loadCachedSummary();
        return;
      }

      resetSummarizeUi();
      await loadCachedSummary();
    },
    [applySummarizeJobProgress, loadCachedSummary, resetSummarizeUi, t],
  );

  const tryAttachSummarizeJob = useCallback(
    async (options?: { retry?: boolean }) => {
      if (summarizeInFlightRef.current) {
        return;
      }

      const attempt = async (): Promise<boolean> => {
        if (summarizeInFlightRef.current) {
          return true;
        }
        try {
          const status = await fetchSummarizeJobStatus();
          if (status.status !== "running") {
            return false;
          }
          summarizeInFlightRef.current = true;
          const generation = ++summarizePollGenerationRef.current;
          applySummarizeJobProgress(status);
          void watchSummarizeJob(generation);
          return true;
        } catch {
          return false;
        }
      };

      if (await attempt()) {
        return;
      }
      if (!options?.retry) {
        return;
      }

      for (let index = 0; index < 12; index += 1) {
        await sleep(250);
        if (await attempt()) {
          return;
        }
      }
    },
    [applySummarizeJobProgress, watchSummarizeJob],
  );

  const stopSummarize = useCallback(() => {
    summarizeAbortRef.current?.abort();
    void cancelSummarizeJob().catch(() => {});
  }, []);

  const stopBodies = useCallback(() => {
    void cancelBodiesJob().catch(() => {});
  }, []);

  const startSummarize = useCallback(async () => {
    if (selectedGroupIds.length === 0) {
      setSummaryError(t("digestSelectGroupFirst"));
      return;
    }
    const selected = summaryGroupOptions.find((group) => group.id === selectedGroupIds[0]);
    if (!selected?.digestSkillId) {
      setSummaryError(t("digestNoRuleBound"));
      return;
    }
    if (scopeArticleCount === 0) {
      setSummaryError(t("digestNoArticlesForBrief"));
      return;
    }
    if (summarizeInFlightRef.current) {
      return;
    }

    try {
      const existing = await fetchSummarizeJobStatus();
      if (existing.status === "running") {
        summarizeInFlightRef.current = true;
        const generation = ++summarizePollGenerationRef.current;
        applySummarizeJobProgress(existing);
        await watchSummarizeJob(generation);
        return;
      }
    } catch {
      // 忽略状态查询失败，继续尝试启动新任务
    }

    summarizeInFlightRef.current = true;
    summarizeSnapshotRef.current = summaryRef.current;
    summarizeStreamingRef.current = false;

    setGenerating(true);
    generatingRef.current = true;
    setPhase("generating");
    setSummaryPhase("start");
    setStatusMessage(t("digestPreparingOverview"));
    setSummaryError("");
    setThinking("");
    thinkingRef.current = "";
    notifySummarizeJobSync();

    const controller = new AbortController();
    summarizeAbortRef.current = controller;

    const body: SummarizeBody = {
      group_ids: selectedGroupIds,
      days,
      stream: true,
      use_cached_context: true,
      llm_config: getLlmConfigPayload(),
    };

    const finishAfterStream = async (restoreSnapshot: boolean) => {
      resetSummarizeUi({ restoreSnapshot });
      await loadCachedSummary();
    };

    await streamSummarize(
      body,
      (token) => {
        if (!summarizeStreamingRef.current) {
          summarizeStreamingRef.current = true;
          summaryRef.current = "";
        }
        summaryRef.current += token;
        setSummary(summaryRef.current);
      },
      () => {
        void finishAfterStream(false);
      },
      (message) => {
        void (async () => {
          if (message.includes("已有概览生成任务进行中")) {
            const generation = ++summarizePollGenerationRef.current;
            try {
              const status = await fetchSummarizeJobStatus();
              if (status.status === "running") {
                applySummarizeJobProgress(status);
                await watchSummarizeJob(generation);
                return;
              }
            } catch {
              // fall through
            }
          }
          resetSummarizeUi({ restoreSnapshot: true });
          setSummaryError(message);
          await loadCachedSummary();
        })();
      },
      (status) => {
        if (status.message) {
          setStatusMessage(status.message);
        }
        if (status.phase) {
          setSummaryPhase(status.phase);
        }
        if (
          status.phase === "generating" ||
          status.phase === "classify" ||
          status.phase === "cluster" ||
          status.phase === "render"
        ) {
          setPhase("generating");
        } else if (status.phase === "loading_articles") {
          setPhase("loading_articles");
        }
      },
      (chunk) => {
        thinkingRef.current += chunk;
        setThinking(thinkingRef.current);
      },
      {
        signal: controller.signal,
        onCancelled: () => {
          void finishAfterStream(true);
        },
      },
    );
  }, [
    applySummarizeJobProgress,
    days,
    loadCachedSummary,
    resetSummarizeUi,
    scopeArticleCount,
    selectedGroupIds,
    summaryGroupOptions,
    t,
    watchSummarizeJob,
  ]);

  // 新标签页 / 刷新后恢复概览生成进度；跨标签页即时同步
  useEffect(() => {
    void tryAttachSummarizeJob();

    const onSync = () => {
      void tryAttachSummarizeJob({ retry: true });
    };

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(SUMMARIZE_JOB_CHANNEL);
      channel.onmessage = onSync;
    } catch {
      // ignore
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key === SUMMARIZE_JOB_SYNC_KEY) {
        onSync();
      }
    };
    window.addEventListener("storage", onStorage);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void tryAttachSummarizeJob();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    const pollTimer = window.setInterval(() => {
      if (!summarizeInFlightRef.current && document.visibilityState === "visible") {
        void tryAttachSummarizeJob();
      }
    }, 2000);

    return () => {
      channel?.close();
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(pollTimer);
    };
  }, [tryAttachSummarizeJob]);

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
        scopeArticleCount,
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
          ? statusMessage || (phase === "generating" ? t("digestGeneratingOverview") : "")
          : "",
        summaryError,
        digestBusy,
        loadBodies,
        buildIndex,
        startSummarize,
        stopSummarize,
        stopBodies,
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
