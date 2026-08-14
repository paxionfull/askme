import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  cancelOnboardSource,
  FEEDS_NEED_RELOAD_KEY,
  streamOnboardSource,
  type OnboardSourceResult,
} from "../api";

const LAST_ONBOARD_FEED_KEY = "askme.lastOnboardedFeedId";

export interface OnboardingJob {
  jobId: string;
  entryUrl: string;
  running: boolean;
  phase: string;
  message: string;
  error: string;
  result: OnboardSourceResult | null;
}

interface OnboardingContextValue {
  job: OnboardingJob | null;
  startOnboarding: (entryUrl: string) => Promise<void>;
  stopOnboarding: () => void;
  clearJob: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<OnboardingJob | null>(null);
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const jobIdRef = useRef<string | null>(null);

  const resetInFlight = useCallback(() => {
    inFlightRef.current = false;
    abortRef.current = null;
    jobIdRef.current = null;
  }, []);

  const stopOnboarding = useCallback(() => {
    const jobId = jobIdRef.current;
    if (jobId) {
      void cancelOnboardSource(jobId).catch(() => {});
    }
    abortRef.current?.abort();
    inFlightRef.current = false;
    setJob((current) =>
      current
        ? {
            ...current,
            running: false,
            phase: "cancelled",
            message: "已停止接入",
            error: "",
          }
        : current,
    );
    resetInFlight();
  }, [resetInFlight]);

  const startOnboarding = useCallback(
    async (entryUrl: string) => {
      const url = entryUrl.trim();
      if (!url) return;
      if (inFlightRef.current) {
        setJob((current) =>
          current?.running
            ? current
            : {
                jobId: "",
                entryUrl: url,
                running: false,
                phase: "error",
                message: "",
                error: "已有接入任务在进行中",
                result: null,
              },
        );
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      inFlightRef.current = true;
      jobIdRef.current = null;

      setJob({
        jobId: "",
        entryUrl: url,
        running: true,
        phase: "start",
        message: "Cursor 接入启动中…",
        error: "",
        result: null,
      });

      await streamOnboardSource(
        {
          entry_url: url,
          auto_validate: true,
          reload: true,
        },
        (status) => {
          if (status.job_id) {
            jobIdRef.current = status.job_id;
          }
          setJob((current) =>
            current
              ? {
                  ...current,
                  jobId: status.job_id ?? current.jobId,
                  phase: status.phase ?? current.phase,
                  message: status.message ?? current.message,
                }
              : current,
          );
        },
        () => {
          resetInFlight();
          setJob((current) => (current ? { ...current, running: false } : current));
        },
        (message) => {
          resetInFlight();
          setJob((current) =>
            current
              ? { ...current, running: false, phase: "error", error: message }
              : {
                  jobId: jobIdRef.current ?? "",
                  entryUrl: url,
                  running: false,
                  phase: "error",
                  message: "",
                  error: message,
                  result: null,
                },
          );
        },
        (result) => {
          resetInFlight();
          sessionStorage.setItem(FEEDS_NEED_RELOAD_KEY, "1");
          sessionStorage.setItem(LAST_ONBOARD_FEED_KEY, result.feed_id);
          setJob({
            jobId: result.job_id ?? jobIdRef.current ?? "",
            entryUrl: url,
            running: false,
            phase: "done",
            message: `已接入 ${result.feed_id}`,
            error: "",
            result,
          });
        },
        () => {},
        {
          signal: controller.signal,
          onCancelled: (detail, jobId) => {
            resetInFlight();
            setJob({
              jobId: jobId ?? jobIdRef.current ?? "",
              entryUrl: url,
              running: false,
              phase: "cancelled",
              message: detail || "已停止接入",
              error: "",
              result: null,
            });
          },
        },
      );
    },
    [resetInFlight],
  );

  const clearJob = useCallback(() => {
    if (inFlightRef.current) return;
    setJob(null);
  }, []);

  return (
    <OnboardingContext.Provider value={{ job, startOnboarding, stopOnboarding, clearJob }}>
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
