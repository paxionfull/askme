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
  cancelOnboardBatch,
  cancelOnboardSource,
  FEEDS_NEED_RELOAD_KEY,
  fetchOnboardBatch,
  startOnboardBatch,
  streamRepairSource,
  type OnboardBatchStatus,
  type OnboardSourceResult,
} from "../api";

const LAST_ONBOARD_FEED_KEY = "askme.lastOnboardedFeedId";
const ACTIVE_BATCH_KEY = "askme.activeOnboardBatchId";
const BATCH_POLL_MS = 800;

function readPersistedBatchId(): string | null {
  try {
    return sessionStorage.getItem(ACTIVE_BATCH_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

function persistBatchId(batchId: string | null) {
  try {
    if (batchId) {
      sessionStorage.setItem(ACTIVE_BATCH_KEY, batchId);
    } else {
      sessionStorage.removeItem(ACTIVE_BATCH_KEY);
    }
  } catch {
    // ignore quota / private mode
  }
}

export type SkillJobKind = "onboard" | "repair";

export interface OnboardingJob {
  kind: SkillJobKind;
  jobId: string;
  entryUrl: string;
  slug?: string;
  running: boolean;
  phase: string;
  message: string;
  error: string;
  result: OnboardSourceResult | null;
}

interface OnboardingContextValue {
  job: OnboardingJob | null;
  batch: OnboardBatchStatus | null;
  authRetryUrls: string[];
  startBatchOnboarding: (entryUrls: string[], groupId?: string) => Promise<void>;
  startSkillRepair: (
    slug: string,
    payload: { feedback: string; issueTypes: string[]; sampleUrl: string },
  ) => Promise<void>;
  requestAuthRetry: (urls: string[]) => void;
  clearAuthRetry: () => void;
  stopOnboarding: () => void;
  stopBatch: () => void;
  clearJob: () => void;
  clearBatch: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<OnboardingJob | null>(null);
  const [batch, setBatch] = useState<OnboardBatchStatus | null>(null);
  const [authRetryUrls, setAuthRetryUrls] = useState<string[]>([]);

  const repairInFlightRef = useRef(false);
  const batchPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const batchIdRef = useRef<string | null>(null);
  const batchCompletedRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const repairJobIdRef = useRef<string | null>(null);

  const clearBatchPoll = useCallback(() => {
    if (batchPollRef.current) {
      clearInterval(batchPollRef.current);
      batchPollRef.current = null;
    }
  }, []);

  const markFeedsNeedReload = useCallback(() => {
    sessionStorage.setItem(FEEDS_NEED_RELOAD_KEY, "1");
  }, []);

  const pollBatchOnce = useCallback(
    async (batchId: string) => {
      try {
        const status = await fetchOnboardBatch(batchId);
        setBatch(status);
        persistBatchId(batchId);

        if (status.completed > batchCompletedRef.current) {
          batchCompletedRef.current = status.completed;
          markFeedsNeedReload();
          const lastDone = [...status.items].reverse().find((item) => item.status === "done" && item.feed_id);
          if (lastDone?.feed_id) {
            sessionStorage.setItem(LAST_ONBOARD_FEED_KEY, lastDone.feed_id);
          }
        }

        if (status.status !== "running") {
          clearBatchPoll();
          batchIdRef.current = null;
          markFeedsNeedReload();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        if (message.includes("不存在") || message.includes("已结束")) {
          clearBatchPoll();
          batchIdRef.current = null;
          persistBatchId(null);
          setBatch(null);
        }
        // 临时网络错误：保留当前面板，下一轮继续轮询
      }
    },
    [clearBatchPoll, markFeedsNeedReload],
  );

  const startBatchPolling = useCallback(
    (batchId: string, options?: { completedBaseline?: number }) => {
      clearBatchPoll();
      batchIdRef.current = batchId;
      batchCompletedRef.current = options?.completedBaseline ?? 0;
      persistBatchId(batchId);
      void pollBatchOnce(batchId);
      batchPollRef.current = setInterval(() => {
        void pollBatchOnce(batchId);
      }, BATCH_POLL_MS);
    },
    [clearBatchPoll, pollBatchOnce],
  );

  useEffect(() => () => clearBatchPoll(), [clearBatchPoll]);

  // 刷新页面后恢复批量接入进度条
  useEffect(() => {
    const batchId = readPersistedBatchId();
    if (!batchId || batchIdRef.current) return;
    let cancelled = false;

    void (async () => {
      try {
        const status = await fetchOnboardBatch(batchId);
        if (cancelled) return;
        setBatch(status);
        if (status.status === "running") {
          startBatchPolling(batchId, { completedBaseline: status.completed });
        } else {
          batchIdRef.current = null;
          markFeedsNeedReload();
        }
      } catch {
        if (!cancelled) {
          persistBatchId(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [markFeedsNeedReload, startBatchPolling]);

  const stopBatch = useCallback(() => {
    const batchId = batchIdRef.current ?? batch?.batch_id ?? readPersistedBatchId();
    if (batchId) {
      void cancelOnboardBatch(batchId)
        .then((status) => {
          setBatch(status);
          persistBatchId(batchId);
        })
        .catch(() => {});
    }
    clearBatchPoll();
    batchIdRef.current = null;
    setBatch((current) =>
      current
        ? {
            ...current,
            status: "cancelled",
            message: "批量接入已停止",
          }
        : current,
    );
  }, [batch?.batch_id, clearBatchPoll]);

  const clearBatch = useCallback(() => {
    if (batchIdRef.current) return;
    if (batch?.status === "running") return;
    persistBatchId(null);
    setBatch(null);
  }, [batch?.status]);

  const startBatchOnboarding = useCallback(
    async (entryUrls: string[], groupId?: string) => {
      const urls = entryUrls.map((url) => url.trim()).filter(Boolean);
      if (urls.length === 0) return;
      if (batchIdRef.current || repairInFlightRef.current) return;

      try {
        const initial = await startOnboardBatch({
          entry_urls: urls,
          max_concurrency: 5,
          auto_validate: true,
          reload: true,
          group_id: groupId,
        });
        setBatch(initial);
        persistBatchId(initial.batch_id || null);
        if (initial.status === "running") {
          startBatchPolling(initial.batch_id);
        } else {
          markFeedsNeedReload();
        }
      } catch (err) {
        persistBatchId(null);
        setBatch({
          batch_id: "",
          status: "done",
          total: urls.length,
          completed: 0,
          failed: urls.length,
          skipped: 0,
          running: 0,
          queued: 0,
          message: err instanceof Error ? err.message : "批量接入启动失败",
          items: urls.map((entry_url) => ({
            entry_url,
            slug: "",
            name: "",
            status: "failed",
            phase: "error",
            message: err instanceof Error ? err.message : "批量接入启动失败",
            error: err instanceof Error ? err.message : "批量接入启动失败",
          })),
        });
      }
    },
    [markFeedsNeedReload, startBatchPolling],
  );

  const resetRepairInFlight = useCallback(() => {
    repairInFlightRef.current = false;
    abortRef.current = null;
    repairJobIdRef.current = null;
  }, []);

  const stopOnboarding = useCallback(() => {
    const jobId = repairJobIdRef.current;
    if (jobId) {
      void cancelOnboardSource(jobId).catch(() => {});
    }
    abortRef.current?.abort();
    resetRepairInFlight();
    setJob((current) =>
      current
        ? {
            ...current,
            running: false,
            phase: "cancelled",
            message: "已停止修复",
            error: "",
          }
        : current,
    );
  }, [resetRepairInFlight]);

  const startSkillRepair = useCallback(
    async (
      slug: string,
      payload: { feedback: string; issueTypes: string[]; sampleUrl: string },
    ) => {
      const safeSlug = slug.trim();
      if (!safeSlug || !payload.feedback.trim()) return;
      if (repairInFlightRef.current || batchIdRef.current) return;

      const controller = new AbortController();
      abortRef.current = controller;
      repairInFlightRef.current = true;
      repairJobIdRef.current = null;

      setJob({
        kind: "repair",
        jobId: "",
        entryUrl: safeSlug,
        slug: safeSlug,
        running: true,
        phase: "start",
        message: "Cursor 修复启动中…",
        error: "",
        result: null,
      });

      await streamRepairSource(
        safeSlug,
        {
          feedback: payload.feedback,
          issue_types: payload.issueTypes,
          sample_url: payload.sampleUrl || undefined,
          auto_validate: true,
          reload: true,
        },
        (status) => {
          if (status.job_id) {
            repairJobIdRef.current = String(status.job_id);
          }
          setJob((current) =>
            current
              ? {
                  ...current,
                  jobId: status.job_id ? String(status.job_id) : current.jobId,
                  phase: status.phase ? String(status.phase) : current.phase,
                  message: status.message ? String(status.message) : current.message,
                }
              : current,
          );
        },
        () => {},
        (message) => {
          resetRepairInFlight();
          setJob((current) =>
            current
              ? { ...current, running: false, phase: "error", error: message }
              : {
                  kind: "repair",
                  jobId: repairJobIdRef.current ?? "",
                  entryUrl: safeSlug,
                  slug: safeSlug,
                  running: false,
                  phase: "error",
                  message: "",
                  error: message,
                  result: null,
                },
          );
        },
        (result) => {
          resetRepairInFlight();
          markFeedsNeedReload();
          if (result.feed_id) {
            sessionStorage.setItem(LAST_ONBOARD_FEED_KEY, result.feed_id);
          }
          setJob({
            kind: "repair",
            jobId: result.job_id ?? repairJobIdRef.current ?? "",
            entryUrl: safeSlug,
            slug: safeSlug,
            running: false,
            phase: "done",
            message: `已修复 ${result.feed_id || safeSlug}`,
            error: "",
            result,
          });
        },
        {
          signal: controller.signal,
          onCancelled: (detail, jobId) => {
            resetRepairInFlight();
            setJob({
              kind: "repair",
              jobId: jobId ?? repairJobIdRef.current ?? "",
              entryUrl: safeSlug,
              slug: safeSlug,
              running: false,
              phase: "cancelled",
              message: detail || "已停止修复",
              error: "",
              result: null,
            });
          },
        },
      );

      resetRepairInFlight();
      setJob((current) => (current?.running ? { ...current, running: false } : current));
    },
    [markFeedsNeedReload, resetRepairInFlight],
  );

  const clearJob = useCallback(() => {
    if (repairInFlightRef.current) return;
    setJob(null);
  }, []);

  const requestAuthRetry = useCallback((urls: string[]) => {
    const unique = [...new Set(urls.map((url) => url.trim()).filter(Boolean))];
    setAuthRetryUrls(unique);
  }, []);

  const clearAuthRetry = useCallback(() => {
    setAuthRetryUrls([]);
  }, []);

  return (
    <OnboardingContext.Provider
      value={{
        job,
        batch,
        authRetryUrls,
        startBatchOnboarding,
        startSkillRepair,
        requestAuthRetry,
        clearAuthRetry,
        stopOnboarding,
        stopBatch,
        clearJob,
        clearBatch,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error("useOnboarding must be used within OnboardingProvider");
  }
  return context;
}

export function consumeLastOnboardedFeedId(): string | null {
  const feedId = sessionStorage.getItem(LAST_ONBOARD_FEED_KEY);
  if (feedId) {
    sessionStorage.removeItem(LAST_ONBOARD_FEED_KEY);
  }
  return feedId;
}
