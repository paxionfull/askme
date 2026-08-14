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
import { useLocale } from "../i18n/LocaleContext";
import { formatMessage } from "../i18n/messages";

const LAST_ONBOARD_FEED_KEY = "askme.lastOnboardedFeedId";
const ACTIVE_BATCH_KEY = "askme.activeOnboardBatchId";
const ACTIVE_BATCH_SNAPSHOT_KEY = "askme.activeOnboardBatchSnapshot";
const BATCH_POLL_MS = 800;
/** 连续「任务不存在」次数达到阈值后才放弃轮询（避免切换天数/后端短暂 reload 立刻清栏） */
const BATCH_GONE_MAX_MISSES = 5;
const BATCH_GONE_DETAIL = "批量任务不存在或已结束";

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

function readPersistedBatchSnapshot(): OnboardBatchStatus | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_BATCH_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OnboardBatchStatus;
    if (!parsed || typeof parsed !== "object" || !parsed.batch_id) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persistBatchSnapshot(batch: OnboardBatchStatus | null) {
  try {
    if (batch && batch.status === "running" && batch.batch_id) {
      sessionStorage.setItem(ACTIVE_BATCH_SNAPSHOT_KEY, JSON.stringify(batch));
    } else {
      sessionStorage.removeItem(ACTIVE_BATCH_SNAPSHOT_KEY);
    }
  } catch {
    // ignore quota / private mode
  }
}

function isBatchGoneError(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  if (text === BATCH_GONE_DETAIL) return true;
  // 兼容旧代理文案，但避免宽泛匹配「不存在」「已结束」误伤其它错误
  return text.includes("批量任务不存在");
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
  const { t, locale } = useLocale();
  const [job, setJob] = useState<OnboardingJob | null>(null);
  const [batch, setBatch] = useState<OnboardBatchStatus | null>(null);
  const [authRetryUrls, setAuthRetryUrls] = useState<string[]>([]);

  const repairInFlightRef = useRef(false);
  const batchPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const batchIdRef = useRef<string | null>(null);
  const batchCompletedRef = useRef(0);
  const batchPollInFlightRef = useRef(false);
  const batchGoneMissesRef = useRef(0);
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

  const applyBatchStatus = useCallback((status: OnboardBatchStatus) => {
    setBatch(status);
    persistBatchId(status.batch_id || null);
    persistBatchSnapshot(status.status === "running" ? status : null);
  }, []);

  const pollBatchOnce = useCallback(
    async (batchId: string) => {
      if (batchPollInFlightRef.current) return;
      batchPollInFlightRef.current = true;
      try {
        const status = await fetchOnboardBatch(batchId);
        batchGoneMissesRef.current = 0;
        applyBatchStatus(status);

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
        if (isBatchGoneError(message)) {
          batchGoneMissesRef.current += 1;
          const tracking = batchIdRef.current === batchId;
          if (tracking && batchGoneMissesRef.current < BATCH_GONE_MAX_MISSES) {
            // 保留任务栏：切换天数/后端短暂不可用时常见瞬时 404
            setBatch((current) => {
              if (!current || current.batch_id !== batchId) return current;
              if (current.status !== "running") return current;
              const next = {
                ...current,
                message: formatMessage(locale, "onboardBatchRetrySync", {
                  current: batchGoneMissesRef.current,
                  max: BATCH_GONE_MAX_MISSES,
                }),
              };
              persistBatchSnapshot(next);
              return next;
            });
            return;
          }

          clearBatchPoll();
          batchIdRef.current = null;
          persistBatchId(null);
          persistBatchSnapshot(null);
          setBatch((current) => {
            if (current && current.batch_id === batchId) {
              return {
                ...current,
                status: "cancelled",
                message: t("onboardBatchSyncInterrupted"),
                running: 0,
                queued: 0,
              };
            }
            return null;
          });
          return;
        }
        // 临时网络错误：保留当前面板，下一轮继续轮询
      } finally {
        batchPollInFlightRef.current = false;
      }
    },
    [applyBatchStatus, clearBatchPoll, locale, markFeedsNeedReload, t],
  );

  const startBatchPolling = useCallback(
    (batchId: string, options?: { completedBaseline?: number }) => {
      clearBatchPoll();
      batchIdRef.current = batchId;
      batchCompletedRef.current = options?.completedBaseline ?? 0;
      batchGoneMissesRef.current = 0;
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
      const snapshot = readPersistedBatchSnapshot();
      if (snapshot?.batch_id === batchId && snapshot.status === "running") {
        setBatch(snapshot);
      }

      for (let attempt = 0; attempt < BATCH_GONE_MAX_MISSES; attempt += 1) {
        if (cancelled) return;
        try {
          const status = await fetchOnboardBatch(batchId);
          if (cancelled) return;
          applyBatchStatus(status);
          if (status.status === "running") {
            startBatchPolling(batchId, { completedBaseline: status.completed });
          } else {
            batchIdRef.current = null;
            markFeedsNeedReload();
          }
          return;
        } catch (err) {
          const message = err instanceof Error ? err.message : "";
          if (!isBatchGoneError(message)) {
            // 网络抖动：保留快照并继续轮询，避免任务栏直接消失
            if (snapshot?.batch_id === batchId && snapshot.status === "running") {
              startBatchPolling(batchId, { completedBaseline: snapshot.completed });
              return;
            }
            break;
          }
          await new Promise((resolve) => window.setTimeout(resolve, BATCH_POLL_MS));
        }
      }

      if (cancelled) return;
      if (snapshot?.batch_id === batchId && snapshot.status === "running") {
        // 后端确实找不到任务：展示可关闭的中断态，避免任务栏「无声消失」
        persistBatchId(null);
        persistBatchSnapshot(null);
        setBatch({
          ...snapshot,
          status: "cancelled",
          message: t("onboardBatchSyncInterrupted"),
          running: 0,
          queued: 0,
        });
        return;
      }
      persistBatchId(null);
      persistBatchSnapshot(null);
    })();

    return () => {
      cancelled = true;
    };
  }, [applyBatchStatus, locale, markFeedsNeedReload, startBatchPolling, t]);

  const stopBatch = useCallback(() => {
    const batchId = batchIdRef.current ?? batch?.batch_id ?? readPersistedBatchId();
    if (batchId) {
      void cancelOnboardBatch(batchId)
        .then((status) => {
          applyBatchStatus(status);
        })
        .catch(() => {});
    }
    clearBatchPoll();
    batchIdRef.current = null;
    persistBatchSnapshot(null);
    setBatch((current) =>
      current
        ? {
            ...current,
            status: "cancelled",
            message: t("onboardBatchStopped"),
          }
        : current,
    );
  }, [applyBatchStatus, batch?.batch_id, clearBatchPoll, t]);

  const clearBatch = useCallback(() => {
    if (batchIdRef.current) return;
    if (batch?.status === "running") return;
    persistBatchId(null);
    persistBatchSnapshot(null);
    setBatch(null);
  }, [batch?.status]);

  const startBatchOnboarding = useCallback(
    async (entryUrls: string[], groupId?: string) => {
      const urls = entryUrls.map((url) => url.trim()).filter(Boolean);
      if (urls.length === 0) return;
      // 修复任务进行中时不启动接入；已有 batch 则由后端合并追加
      if (repairInFlightRef.current) return;

      try {
        const initial = await startOnboardBatch({
          entry_urls: urls,
          max_concurrency: 5,
          auto_validate: true,
          reload: true,
          group_id: groupId,
        });
        applyBatchStatus(initial);
        if (initial.status === "running") {
          if (batchIdRef.current !== initial.batch_id) {
            startBatchPolling(initial.batch_id);
          } else {
            // 同一 batch 追加：保持轮询，刷新一次状态
            batchIdRef.current = initial.batch_id;
          }
        } else {
          batchIdRef.current = null;
          markFeedsNeedReload();
        }
      } catch (err) {
        // 追加失败时保留原进行中的 batch 轮询
        if (!batchIdRef.current) {
          persistBatchId(null);
          persistBatchSnapshot(null);
          setBatch({
            batch_id: "",
            status: "done",
            total: urls.length,
            completed: 0,
            failed: urls.length,
            skipped: 0,
            running: 0,
            queued: 0,
            message: err instanceof Error ? err.message : t("onboardBatchStartFailed"),
            items: urls.map((entry_url) => ({
              entry_url,
              slug: "",
              name: "",
              status: "failed",
              phase: "error",
              message: err instanceof Error ? err.message : t("onboardBatchStartFailed"),
              error: err instanceof Error ? err.message : t("onboardBatchStartFailed"),
            })),
          });
        }
      }
    },
    [applyBatchStatus, markFeedsNeedReload, startBatchPolling, t],
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
            message: t("onboardRepairStopped"),
            error: "",
          }
        : current,
    );
  }, [resetRepairInFlight, t]);

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
        message: t("onboardRepairStarting"),
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
            message: formatMessage(locale, "onboardRepairDone", {
              id: result.feed_id || safeSlug,
            }),
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
              message: detail || t("onboardRepairStopped"),
              error: "",
              result: null,
            });
          },
        },
      );

      resetRepairInFlight();
      setJob((current) => (current?.running ? { ...current, running: false } : current));
    },
    [locale, markFeedsNeedReload, resetRepairInFlight, t],
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
