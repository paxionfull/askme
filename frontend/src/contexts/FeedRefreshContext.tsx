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
  FEEDS_NEED_RELOAD_KEY,
  fetchFeedSchedulerConfig,
  refreshAllFeeds,
  refreshFeed,
  refreshGroupFeeds,
  waitForRefreshAllComplete,
  type FeedSchedulerConfig,
  type RefreshFeedFailure,
  type RefreshProgress,
} from "../api";

function formatFailures(failures: RefreshFeedFailure[]): string {
  return [
    `以下 ${failures.length} 个数据源更新失败（多为网络无法访问、超时或站点拦截）：`,
    ...failures.map(
      (item) => `· ${item.feed_name || item.feed_id}：${item.error || "未知错误"}`,
    ),
  ].join("\n");
}

export function isRefreshAuthError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("askme_auth_required") ||
    text.includes("需要登录") ||
    text.includes("重新登录授权") ||
    text.includes("重新登录") ||
    text.includes("会话失效") ||
    text.includes("公众号后台") ||
    text.includes("slave_sid") ||
    (text.includes("cookie") && (text.includes("授权") || text.includes("访客")))
  );
}

const DISMISSED_REFRESH_KEY = "askme.refreshResult.dismissedRunAt";

function readDismissedRunAt(): number | null {
  try {
    const raw = sessionStorage.getItem(DISMISSED_REFRESH_KEY);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeDismissedRunAt(runAt: number | null | undefined) {
  try {
    if (runAt == null) {
      sessionStorage.removeItem(DISMISSED_REFRESH_KEY);
      return;
    }
    sessionStorage.setItem(DISMISSED_REFRESH_KEY, String(runAt));
  } catch {
    // ignore
  }
}

function formatProgressMessage(status: FeedSchedulerConfig): string {
  const item = status.refresh_progress;
  if (!item || item.total <= 0) {
    return status.refresh_progress?.scope === "group"
      ? `正在更新分组「${status.refresh_progress.group_name || ""}」…`
      : "正在更新全部数据源…";
  }
  if (item.scope === "group") {
    const label = item.group_name || "分组";
    return `正在更新「${label}」${item.current}/${item.total}：${item.feed_name || "…"}`;
  }
  return `正在更新 ${item.current}/${item.total}：${item.feed_name || "…"}`;
}

interface FeedRefreshContextValue {
  refreshingAll: boolean;
  refreshingGroupId: string | null;
  refreshingFeedId: string | null;
  refreshBusy: boolean;
  progress: RefreshProgress | null;
  statusMessage: string;
  resultMessage: string;
  error: string;
  failures: RefreshFeedFailure[];
  bannerTitle: string;
  /** 刷新因鉴权失败时，可供「去授权」重开添加源弹窗的入口 URL */
  authFailureUrls: string[];
  /** 批量刷新鉴权失败但无 entry_url 时，引导去设置页 */
  authFailureDetected: boolean;
  startRefreshAll: (days?: number) => Promise<void>;
  startRefreshGroup: (groupId: string, groupName: string, days?: number) => Promise<void>;
  startRefreshFeed: (
    feedId: string,
    feedName?: string,
    days?: number,
    entryUrl?: string,
  ) => Promise<void>;
  clearResult: () => void;
}

const FeedRefreshContext = createContext<FeedRefreshContextValue | null>(null);

export function FeedRefreshProvider({ children }: { children: ReactNode }) {
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [refreshingGroupId, setRefreshingGroupId] = useState<string | null>(null);
  const [refreshingFeedId, setRefreshingFeedId] = useState<string | null>(null);
  const [progress, setProgress] = useState<RefreshProgress | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [resultMessage, setResultMessage] = useState("");
  const [error, setError] = useState("");
  const [failures, setFailures] = useState<RefreshFeedFailure[]>([]);
  const [bannerTitle, setBannerTitle] = useState("更新数据源");
  const [authFailureUrls, setAuthFailureUrls] = useState<string[]>([]);
  const [authFailureDetected, setAuthFailureDetected] = useState(false);

  const jobInFlightRef = useRef(false);
  const generationRef = useRef(0);
  const lastShownRunAtRef = useRef<number | null>(null);
  const applyFinishedStatusRef = useRef<(status: FeedSchedulerConfig, fallback: string) => void>(
    () => {},
  );

  const refreshBusy =
    refreshingAll || Boolean(refreshingGroupId) || Boolean(refreshingFeedId);

  const markFeedsNeedReload = useCallback(() => {
    try {
      sessionStorage.setItem(FEEDS_NEED_RELOAD_KEY, "1");
    } catch {
      // ignore
    }
  }, []);

  const applyFinishedStatus = useCallback(
    (status: FeedSchedulerConfig, fallbackMessage: string) => {
      const summary = status.last_refresh_message || fallbackMessage;
      const nextFailures = status.last_refresh_failed ?? [];
      const feedCount = status.last_feed_count ?? 0;
      setProgress(status.refresh_progress ?? null);
      setFailures(nextFailures);
      markFeedsNeedReload();
      lastShownRunAtRef.current = status.last_run_at ?? null;

      const failureDetail =
        nextFailures.length > 0 ? formatFailures(nextFailures) : "";

      if (feedCount === 0 && nextFailures.length > 0) {
        setResultMessage("");
        setStatusMessage("");
        setError(failureDetail || summary);
        setAuthFailureUrls([]);
        setAuthFailureDetected(nextFailures.some((item) => isRefreshAuthError(item.error || "")));
        return;
      }

      setResultMessage(summary);
      setStatusMessage("");
      setError(failureDetail);
      setAuthFailureUrls([]);
      setAuthFailureDetected(nextFailures.some((item) => isRefreshAuthError(item.error || "")));
    },
    [markFeedsNeedReload],
  );

  applyFinishedStatusRef.current = applyFinishedStatus;

  const watchUntilComplete = useCallback(async (fallbackMessage: string, generation: number) => {
    const status = await waitForRefreshAllComplete((current) => {
      if (generation !== generationRef.current) return;
      setProgress(current.refresh_progress ?? null);
      if (current.refresh_running) {
        setStatusMessage(formatProgressMessage(current));
        setRefreshingAll(true);
        const item = current.refresh_progress;
        if (item?.scope === "group" && item.group_id) {
          setRefreshingGroupId(item.group_id);
        }
      }
    });
    if (generation !== generationRef.current) return;
    applyFinishedStatusRef.current(status, fallbackMessage);
  }, []);

  const beginWatch = useCallback(
    async (options: {
      scope: "all" | "group";
      groupId?: string;
      start: () => Promise<{ message: string }>;
      startingMessage: string;
      title: string;
    }) => {
      if (jobInFlightRef.current) {
        throw new Error("已有更新任务进行中，请稍后再试");
      }

      const generation = ++generationRef.current;
      jobInFlightRef.current = true;
      setError("");
      setResultMessage("");
      setFailures([]);
      setAuthFailureUrls([]);
      setAuthFailureDetected(false);
      setBannerTitle(options.title);
      setStatusMessage(options.startingMessage);
      setProgress(null);
      setRefreshingFeedId(null);

      if (options.scope === "group" && options.groupId) {
        setRefreshingAll(false);
        setRefreshingGroupId(options.groupId);
      } else {
        setRefreshingGroupId(null);
        setRefreshingAll(true);
      }

      try {
        const start = await options.start();
        if (generation !== generationRef.current) return;
        setStatusMessage(start.message || options.startingMessage);
        await watchUntilComplete(start.message || options.startingMessage, generation);
      } catch (err) {
        if (generation !== generationRef.current) return;
        const message = err instanceof Error ? err.message : "更新失败";
        setStatusMessage("");
        setResultMessage("");
        setError(message);
        if (isRefreshAuthError(message)) {
          setAuthFailureDetected(true);
        }
      } finally {
        if (generation === generationRef.current) {
          setRefreshingAll(false);
          setRefreshingGroupId(null);
          jobInFlightRef.current = false;
        }
      }
    },
    [watchUntilComplete],
  );

  const startRefreshAll = useCallback(async (days = 1) => {
    await beginWatch({
      scope: "all",
      start: () => refreshAllFeeds(days),
      startingMessage: "正在启动更新全部数据源…",
      title: "更新全部",
    });
  }, [beginWatch]);

  const startRefreshGroup = useCallback(
    async (groupId: string, groupName: string, days = 1) => {
      await beginWatch({
        scope: "group",
        groupId,
        start: () => refreshGroupFeeds(groupId, days),
        startingMessage: `正在启动更新分组「${groupName}」…`,
        title: "更新分组",
      });
    },
    [beginWatch],
  );

  const startRefreshFeed = useCallback(
    async (feedId: string, feedName?: string, days = 1, entryUrl?: string) => {
      if (jobInFlightRef.current) {
        throw new Error("已有更新任务进行中，请稍后再试");
      }

      const generation = ++generationRef.current;
      jobInFlightRef.current = true;
      const label = (feedName || "").trim() || feedId;
      const retryUrl = (entryUrl || "").trim();
      setError("");
      setResultMessage("");
      setFailures([]);
      setAuthFailureUrls([]);
      setAuthFailureDetected(false);
      setProgress(null);
      setRefreshingAll(false);
      setRefreshingGroupId(null);
      setRefreshingFeedId(feedId);
      setBannerTitle("刷新数据源");
      setStatusMessage(`正在从官网拉取「${label}」最新文章…`);

      try {
        const result = await refreshFeed(feedId, days);
        if (generation !== generationRef.current) return;
        markFeedsNeedReload();
        setStatusMessage("");
        setResultMessage(result.message || `「${label}」刷新完成`);
      } catch (err) {
        if (generation !== generationRef.current) return;
        const message = err instanceof Error ? err.message : "刷新失败";
        setStatusMessage("");
        setResultMessage("");
        setError(message);
        if (isRefreshAuthError(message)) {
          setAuthFailureDetected(true);
          setAuthFailureUrls(retryUrl ? [retryUrl] : []);
        }
      } finally {
        if (generation === generationRef.current) {
          setRefreshingFeedId(null);
          jobInFlightRef.current = false;
        }
      }
    },
    [markFeedsNeedReload],
  );

  const clearResult = useCallback(() => {
    setResultMessage("");
    setError("");
    setFailures([]);
    setStatusMessage("");
    setAuthFailureUrls([]);
    setAuthFailureDetected(false);
    writeDismissedRunAt(lastShownRunAtRef.current);
  }, []);

  // 刷新后 / 挂载时恢复「更新全部 / 分组」进度；并展示未关闭的定时失败结果
  useEffect(() => {
    let alive = true;

    async function resumeIfRunning() {
      try {
        const status = await fetchFeedSchedulerConfig();
        if (!alive) return;

        if (status.refresh_running) {
          if (jobInFlightRef.current) return;

          const generation = ++generationRef.current;
          jobInFlightRef.current = true;
          const progressItem = status.refresh_progress;
          if (progressItem?.scope === "group" && progressItem.group_id) {
            setRefreshingGroupId(progressItem.group_id);
            setRefreshingAll(false);
            setBannerTitle("更新分组");
          } else {
            setRefreshingGroupId(null);
            setRefreshingAll(true);
            setBannerTitle("更新全部");
          }
          setRefreshingFeedId(null);
          setProgress(progressItem ?? null);
          setStatusMessage(formatProgressMessage(status));
          setError("");
          setResultMessage("");

          try {
            await watchUntilComplete(formatProgressMessage(status), generation);
          } finally {
            if (generation === generationRef.current) {
              setRefreshingAll(false);
              setRefreshingGroupId(null);
              jobInFlightRef.current = false;
            }
          }
          return;
        }

        // 定时任务结束后：把失败结果带到横幅（同一轮关闭后不再弹）
        const failed = status.last_refresh_failed ?? [];
        const runAt = status.last_run_at ?? null;
        const dismissed = readDismissedRunAt();
        if (failed.length === 0) return;
        if (runAt != null && dismissed != null && Math.abs(dismissed - runAt) < 1) return;
        if (jobInFlightRef.current) return;

        setBannerTitle("定时更新有失败");
        applyFinishedStatusRef.current(
          status,
          status.last_refresh_message || "上次定时更新有失败",
        );
      } catch {
        // ignore
      }
    }

    void resumeIfRunning();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only resume
  }, []);
  return (
    <FeedRefreshContext.Provider
      value={{
        refreshingAll,
        refreshingGroupId,
        refreshingFeedId,
        refreshBusy,
        progress,
        statusMessage,
        resultMessage,
        error,
        failures,
        bannerTitle,
        authFailureUrls,
        authFailureDetected,
        startRefreshAll,
        startRefreshGroup,
        startRefreshFeed,
        clearResult,
      }}
    >
      {children}
    </FeedRefreshContext.Provider>
  );
}

export function useFeedRefresh() {
  const ctx = useContext(FeedRefreshContext);
  if (!ctx) {
    throw new Error("useFeedRefresh must be used within FeedRefreshProvider");
  }
  return ctx;
}
