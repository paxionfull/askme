import { NavLink, Outlet } from "react-router-dom";
import OnboardingBatchPanel from "../../components/OnboardingBatchPanel";
import TopJobBanner from "../../components/TopJobBanner";
import { DigestProvider, useDigest } from "../../contexts/DigestContext";
import { ChatProvider } from "../../contexts/ChatContext";
import { FeedRefreshProvider, useFeedRefresh } from "../../contexts/FeedRefreshContext";
import { OnboardingProvider, useOnboarding } from "../../contexts/OnboardingContext";
import { isLlmConfigured, useSettings } from "../../hooks/useSettings";

const navItems = [
  { to: "/", label: "库", end: true },
  { to: "/chat", label: "对话", end: false },
  { to: "/skills", label: "Skill", end: false },
  { to: "/settings", label: "设置", end: false },
];

function FeedRefreshBanner() {
  const {
    refreshBusy,
    statusMessage,
    resultMessage,
    error,
    progress,
    bannerTitle,
    authFailureUrls,
    authFailureDetected,
    clearResult,
  } = useFeedRefresh();
  const { requestAuthRetry } = useOnboarding();

  if (refreshBusy && statusMessage) {
    return (
      <TopJobBanner
        tone="progress"
        title={bannerTitle}
        message={statusMessage}
        current={progress?.current}
        total={progress?.total}
        indeterminate={!progress || progress.total <= 0}
      />
    );
  }

  if (!refreshBusy && (resultMessage || error)) {
    const message = [resultMessage, error].filter(Boolean).join("\n\n");
    const showAuth = Boolean(error) && (authFailureUrls.length > 0 || authFailureDetected);
    return (
      <TopJobBanner
        tone={error ? "warning" : "success"}
        title={bannerTitle}
        message={message}
        onClose={clearResult}
        actions={
          showAuth ? (
            authFailureUrls.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  const urls = [...authFailureUrls];
                  clearResult();
                  requestAuthRetry(urls);
                }}
                className="rounded border border-current/20 bg-[var(--paper-raised)]/60 px-2 py-1 text-xs hover:bg-[var(--paper-raised)]"
              >
                去授权并重试
              </button>
            ) : (
              <NavLink
                to="/settings"
                onClick={clearResult}
                className="rounded border border-current/20 bg-[var(--paper-raised)]/60 px-2 py-1 text-xs hover:bg-[var(--paper-raised)]"
              >
                去设置授权
              </NavLink>
            )
          ) : null
        }
      />
    );
  }

  return null;
}

function DigestJobBanner() {
  const {
    loadingBodies,
    loadingIndex,
    bodyProgress,
    indexProgress,
    indexStatusMessage,
  } = useDigest();

  if (loadingBodies) {
    return (
      <TopJobBanner
        tone="progress"
        title="拉取正文"
        message={bodyProgress.message || "正在拉取正文…"}
        current={bodyProgress.current}
        total={bodyProgress.total}
        indeterminate={bodyProgress.total <= 0}
      />
    );
  }

  if (loadingIndex) {
    return (
      <TopJobBanner
        tone="progress"
        title="建立索引"
        message={
          indexProgress.message || indexStatusMessage || "正在建立向量索引…"
        }
        current={indexProgress.current}
        total={indexProgress.total}
        indeterminate={indexProgress.total <= 0}
      />
    );
  }

  return null;
}

function OnboardingBanner() {
  const {
    job,
    batch,
    clearJob,
    stopOnboarding,
    stopBatch,
    clearBatch,
    requestAuthRetry,
  } = useOnboarding();

  if (batch) {
    return (
      <OnboardingBatchPanel
        batch={batch}
        onStop={stopBatch}
        onClose={clearBatch}
        onAuthRetry={(urls) => {
          clearBatch();
          requestAuthRetry(urls);
        }}
      />
    );
  }

  if (!job) return null;

  if (job.running) {
    const isRepair = job.kind === "repair";
    const autoRepairing = !isRepair && String(job.phase || "").startsWith("auto_repair");
    return (
      <TopJobBanner
        tone="progress"
        title={
          isRepair ? "Cursor 修复中" : autoRepairing ? "接入后自动修复中" : "接入数据源"
        }
        message={job.message || "处理中…"}
        indeterminate
        detail={
          <div className="mt-1 truncate text-xs opacity-80">
            {isRepair ? job.slug || job.entryUrl : job.entryUrl}
            {job.jobId ? ` · #${job.jobId}` : ""}
          </div>
        }
        actions={
          <button
            type="button"
            onClick={stopOnboarding}
            className="rounded border border-current/20 bg-[var(--paper-raised)]/60 px-2 py-1 text-xs hover:bg-[var(--paper-raised)]"
          >
            停止
          </button>
        }
      />
    );
  }

  if (job.phase === "cancelled") {
    return (
      <TopJobBanner
        tone="neutral"
        title={job.kind === "repair" ? "修复已停止" : "接入已停止"}
        message={job.message || (job.jobId ? `日志 #${job.jobId}` : "已取消")}
        onClose={clearJob}
      />
    );
  }

  if (job.error) {
    const isRepair = job.kind === "repair";
    const needsAuth =
      !isRepair &&
      (job.error.includes("授权") ||
        job.error.toLowerCase().includes("cookie") ||
        job.error.includes("登录"));
    return (
      <TopJobBanner
        tone="error"
        title={isRepair ? "修复失败" : "接入失败"}
        message={`${job.error}${job.jobId ? ` · 日志 #${job.jobId}` : ""}`}
        onClose={clearJob}
        actions={
          needsAuth && job.entryUrl ? (
            <button
              type="button"
              onClick={() => {
                clearJob();
                requestAuthRetry([job.entryUrl]);
              }}
              className="rounded border border-current/20 bg-[var(--paper-raised)]/60 px-2 py-1 text-xs hover:bg-[var(--paper-raised)]"
            >
              去授权并重试
            </button>
          ) : undefined
        }
      />
    );
  }

  if (job.result) {
    const isRepair = job.kind === "repair";
    return (
      <TopJobBanner
        tone="success"
        title={isRepair ? "已修复" : "已接入"}
        message={`${job.result.feed_id}（${job.result.skill_dir}）`}
        onClose={clearJob}
      />
    );
  }

  return null;
}

function AppShellContent() {
  const { settings } = useSettings();
  const { generating, loadingBodies, loadingIndex } = useDigest();
  const { job, batch } = useOnboarding();
  const { refreshBusy } = useFeedRefresh();
  const llmConfigured = isLlmConfigured(settings);
  const sourcesInProgress =
    loadingBodies ||
    loadingIndex ||
    refreshBusy ||
    Boolean(job?.running) ||
    batch?.status === "running";
  const chatInProgress = generating;

  return (
    <div className="flex h-screen flex-col">
      {!llmConfigured && (
        <TopJobBanner
          tone="warning"
          title="LLM 未配置"
          message="请在「设置」页填写 API Key 和模型名称。"
        />
      )}

      <OnboardingBanner />
      <FeedRefreshBanner />
      <DigestJobBanner />

      <div className="flex min-h-0 flex-1 bg-[var(--paper)]">
        <aside className="flex w-[4.5rem] shrink-0 flex-col border-r border-[var(--rule)] bg-[var(--paper-raised)]">
          <div className="border-b border-[var(--rule)] px-2 py-4 text-center">
            <span className="text-[13px] font-semibold tracking-[0.04em] text-[var(--ink)]">
              Askme
            </span>
          </div>
          <nav className="flex flex-1 flex-col gap-0.5 p-2">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `relative rounded-md px-2 py-2.5 text-center text-[11px] leading-tight transition-colors ${
                    isActive
                      ? "bg-[var(--paper)] font-semibold text-[var(--ink)] shadow-[inset_3px_0_0_0_var(--accent)]"
                      : "font-medium text-[var(--ink-muted)] hover:bg-[var(--paper)] hover:text-[var(--ink)]"
                  }`
                }
              >
                {item.label}
                {item.to === "/" && sourcesInProgress && (
                  <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                )}
                {item.to === "/chat" && chatInProgress && (
                  <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                )}
              </NavLink>
            ))}
          </nav>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--paper)]">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export default function AppShell() {
  return (
    <OnboardingProvider>
      <FeedRefreshProvider>
        <DigestProvider>
          <ChatProvider>
            <AppShellContent />
          </ChatProvider>
        </DigestProvider>
      </FeedRefreshProvider>
    </OnboardingProvider>
  );
}
