import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import {
  buildRagIndex,
  fetchCachedSummary,
  fetchFeeds,
  fetchRecentArticles,
  streamSummarize,
  type Feed,
  type FeedGroup,
  type SummarizeBody,
} from "../api";
import { getLlmConfigPayload, useSettings, type DefaultDays } from "../hooks/useSettings";
import { useStoredFlag } from "../hooks/useStoredFlag";
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

function reconcileSelectedIds(options: SummaryGroupOption[], stored: string[] | null): string[] {
  const valid = new Set(options.map((option) => option.id));
  const fromStored = (stored ?? []).filter((id) => valid.has(id));
  if (fromStored.length > 0) {
    return fromStored;
  }
  return options.map((option) => option.id);
}

interface DigestContextValue {
  days: DefaultDays;
  setDays: (days: DefaultDays) => void;
  summaryGroupOptions: SummaryGroupOption[];
  selectedGroupIds: string[];
  toggleSummaryGroup: (groupId: string) => void;
  selectAllSummaryGroups: () => void;
  reloadSummaryGroups: () => Promise<void>;
  loadingBodies: boolean;
  loadingIndex: boolean;
  loadError: string;
  truncated: boolean;
  metaCount: number;
  bodyCount: number;
  cachedCount: number;
  fetchedCount: number;
  bodiesReady: boolean;
  indexReady: boolean;
  indexChunkCount: number;
  indexStatusMessage: string;
  summary: string;
  thinking: string;
  generating: boolean;
  statusMessage: string;
  summaryError: string;
  digestBusy: boolean;
  loadBodies: () => Promise<void>;
  buildIndex: () => Promise<void>;
  startSummarize: () => Promise<void>;
  clearErrors: () => void;
  enableDeepThinking: boolean;
  setEnableDeepThinking: (value: boolean) => void;
}

const DigestContext = createContext<DigestContextValue | null>(null);

export function DigestProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const [days, setDays] = useState<DefaultDays>(settings.defaultDays);
  const [summaryGroupOptions, setSummaryGroupOptions] = useState<SummaryGroupOption[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [loadingBodies, setLoadingBodies] = useState(false);
  const [loadingIndex, setLoadingIndex] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [metaCount, setMetaCount] = useState(0);
  const [bodyCount, setBodyCount] = useState(0);
  const [cachedCount, setCachedCount] = useState(0);
  const [fetchedCount, setFetchedCount] = useState(0);
  const [bodiesLoadedForDays, setBodiesLoadedForDays] = useState<number | null>(null);
  const [indexBuiltForDays, setIndexBuiltForDays] = useState<number | null>(null);
  const [indexChunkCount, setIndexChunkCount] = useState(0);
  const [indexStatusMessage, setIndexStatusMessage] = useState("");

  const [summary, setSummary] = useState("");
  const [thinking, setThinking] = useState("");
  const [generating, setGenerating] = useState(false);
  const [phase, setPhase] = useState<SummaryPhase>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [summaryError, setSummaryError] = useState("");

  const summaryRef = useRef("");
  const thinkingRef = useRef("");
  const indexBuildInFlightRef = useRef(false);
  const indexBuildGenerationRef = useRef(0);
  const [enableDeepThinking, setEnableDeepThinking] = useStoredFlag("askme.digest.enableThinking");

  const bodiesReady = bodiesLoadedForDays === days && bodyCount > 0;
  const indexReady = indexBuiltForDays === days && indexChunkCount > 0;
  const digestBusy = loadingBodies || loadingIndex || generating;

  const reloadSummaryGroups = useCallback(async () => {
    try {
      const data = await fetchFeeds();
      const options = buildSummaryGroupOptions(data.feeds, data.groups);
      setSummaryGroupOptions(options);
      setSelectedGroupIds((current) => {
        const next = reconcileSelectedIds(options, current.length > 0 ? current : loadStoredGroupIds());
        persistGroupIds(next);
        return next;
      });
    } catch {
      setSummaryGroupOptions([]);
      setSelectedGroupIds([]);
    }
  }, []);

  useEffect(() => {
    setDays(settings.defaultDays);
  }, [settings.defaultDays]);

  useEffect(() => {
    void reloadSummaryGroups();
  }, [reloadSummaryGroups]);

  useEffect(() => {
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
  }, [days]);

  const loadCachedSummary = useCallback(async () => {
    if (selectedGroupIds.length === 0) {
      setSummary("");
      summaryRef.current = "";
      return;
    }
    try {
      const data = await fetchCachedSummary(days, undefined, selectedGroupIds);
      setSummary(data.summary ?? "");
      summaryRef.current = data.summary ?? "";
    } catch {
      setSummary("");
      summaryRef.current = "";
    }
  }, [days, selectedGroupIds]);

  useEffect(() => {
    void loadCachedSummary();
  }, [loadCachedSummary]);

  const toggleSummaryGroup = useCallback((groupId: string) => {
    setSelectedGroupIds((current) => {
      const next = current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId];
      persistGroupIds(next);
      return next;
    });
  }, []);

  const selectAllSummaryGroups = useCallback(() => {
    setSelectedGroupIds((current) => {
      const allIds = summaryGroupOptions.map((option) => option.id);
      const next = current.length === allIds.length ? [] : allIds;
      persistGroupIds(next);
      return next;
    });
  }, [summaryGroupOptions]);

  const resetIndexState = useCallback(() => {
    if (indexBuildInFlightRef.current) {
      return;
    }
    setIndexBuiltForDays(null);
    setIndexChunkCount(0);
  }, []);

  const loadBodies = useCallback(async () => {
    setLoadingBodies(true);
    setLoadError("");
    setSummaryError("");
    resetIndexState();
    try {
      const data = await fetchRecentArticles(days, undefined, true);
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
            ? "未能加载到含正文的文章，请先刷新数据源订阅"
            : "所选时间范围内暂无文章",
        );
      }
      await loadCachedSummary();
    } catch (err) {
      setBodiesLoadedForDays(null);
      setBodyCount(0);
      setLoadError(err instanceof Error ? err.message : "加载正文失败");
    } finally {
      setLoadingBodies(false);
    }
  }, [days, loadCachedSummary, resetIndexState]);

  const buildIndex = useCallback(async () => {
    if (bodiesLoadedForDays !== days || bodyCount <= 0) return;
    if (indexBuildInFlightRef.current) return;

    const generation = ++indexBuildGenerationRef.current;
    indexBuildInFlightRef.current = true;
    setLoadingIndex(true);
    setLoadError("");
    setIndexStatusMessage("正在建立向量索引，可切换页面…");
    try {
      const llmConfig = getLlmConfigPayload();
      if (!llmConfig.embedding_model?.trim()) {
        throw new Error("请先在设置页选择并保存 Embedding 模型");
      }
      const result = await buildRagIndex(days, llmConfig);
      if (generation !== indexBuildGenerationRef.current) {
        return;
      }
      setIndexChunkCount(result.chunk_count);
      setIndexBuiltForDays(days);
      setIndexStatusMessage("");
    } catch (err) {
      if (generation !== indexBuildGenerationRef.current) {
        return;
      }
      setIndexBuiltForDays(null);
      setIndexChunkCount(0);
      setLoadError(err instanceof Error ? err.message : "建立索引失败");
      setIndexStatusMessage("");
    } finally {
      if (generation === indexBuildGenerationRef.current) {
        indexBuildInFlightRef.current = false;
        setLoadingIndex(false);
      }
    }
  }, [bodyCount, bodiesLoadedForDays, days]);

  const startSummarize = useCallback(async () => {
    if (bodiesLoadedForDays !== days || bodyCount <= 0) return;
    if (selectedGroupIds.length === 0) {
      setSummaryError("请至少选择一个分组");
      return;
    }

    setGenerating(true);
    setPhase("generating");
    setStatusMessage("正在生成摘要...");
    setSummaryError("");
    setSummary("");
    setThinking("");
    summaryRef.current = "";
    thinkingRef.current = "";

    const body: SummarizeBody = {
      group_ids: selectedGroupIds,
      days,
      stream: true,
      enable_thinking: enableDeepThinking,
      use_cached_context: true,
      llm_config: getLlmConfigPayload(),
    };

    await streamSummarize(
      body,
      (token) => {
        summaryRef.current += token;
        flushSync(() => {
          setSummary(summaryRef.current);
        });
      },
      () => {
        setGenerating(false);
        setPhase("idle");
        setStatusMessage("");
        setThinking("");
        thinkingRef.current = "";
        void loadCachedSummary();
      },
      (message) => {
        setSummaryError(message);
        setGenerating(false);
        setPhase("idle");
        setStatusMessage("");
        setThinking("");
        thinkingRef.current = "";
      },
      (status) => {
        if (status.phase === "generating") {
          setPhase("generating");
          setStatusMessage(status.message ?? "正在生成摘要...");
        } else if (status.phase === "loading_articles") {
          setPhase("loading_articles");
          setStatusMessage(status.message ?? "正在加载文章正文...");
        }
      },
      (chunk) => {
        thinkingRef.current += chunk;
        flushSync(() => {
          setThinking(thinkingRef.current);
        });
      },
    );
  }, [
    bodyCount,
    bodiesLoadedForDays,
    days,
    enableDeepThinking,
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
        toggleSummaryGroup,
        selectAllSummaryGroups,
        reloadSummaryGroups,
        loadingBodies,
        loadingIndex,
        loadError,
        truncated,
        metaCount,
        bodyCount,
        cachedCount,
        fetchedCount,
        bodiesReady,
        indexReady,
        indexChunkCount,
        indexStatusMessage,
        summary,
        thinking,
        generating,
        statusMessage: generating
          ? statusMessage || (phase === "generating" ? "正在生成摘要..." : "")
          : "",
        summaryError,
        digestBusy,
        loadBodies,
        buildIndex,
        startSummarize,
        clearErrors,
        enableDeepThinking,
        setEnableDeepThinking,
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
