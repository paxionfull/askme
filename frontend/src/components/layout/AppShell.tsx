import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import HelpModal from "../../components/HelpModal";
import OnboardingBatchPanel from "../../components/OnboardingBatchPanel";
import TopJobBanner from "../../components/TopJobBanner";
import { IconBrief, IconHelp, IconSettings, IconSources } from "../../components/icons/NavIcons";
import { DigestProvider, useDigest } from "../../contexts/DigestContext";
import { ChatProvider } from "../../contexts/ChatContext";
import { FeedRefreshProvider, useFeedRefresh } from "../../contexts/FeedRefreshContext";
import { OnboardingProvider, useOnboarding } from "../../contexts/OnboardingContext";
import { useLocale } from "../../i18n/LocaleContext";
import { formatMessage } from "../../i18n/messages";
import { isLlmConfigured, useSettings } from "../../hooks/useSettings";
import { settingsAuthPath } from "../../utils/authSlot";

const navItems = [
  { to: "/", labelKey: "navBrief" as const, end: true, Icon: IconBrief },
  { to: "/sources", labelKey: "navSources" as const, end: false, Icon: IconSources },
  { to: "/settings", labelKey: "navSettings" as const, end: false, Icon: IconSettings },
];

function FeedRefreshBanner() {
  const { t } = useLocale();
  const {
    refreshBusy,
    statusMessage,
    resultMessage,
    error,
    progress,
    bannerTitle,
    authFailureUrls,
    authFailureSlots,
    authFailureDetected,
    stopRefresh,
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
        actions={
          <button type="button" onClick={stopRefresh} className="ui-btn text-xs">
            {t("stop")}
          </button>
        }
      />
    );
  }

  if (!refreshBusy && (resultMessage || error)) {
    const message = [resultMessage, error].filter(Boolean).join("\n\n");
    const showAuth =
      Boolean(error) &&
      (authFailureSlots.length > 0 || authFailureUrls.length > 0 || authFailureDetected);
    const authSlot = authFailureSlots[0] || null;
    return (
      <TopJobBanner
        tone={error ? "warning" : "success"}
        title={bannerTitle}
        message={message}
        onClose={clearResult}
        actions={
          showAuth ? (
            authSlot ? (
              <NavLink to={settingsAuthPath(authSlot)} onClick={clearResult} className="ui-btn text-xs">
                {t("goAuthorize")}
              </NavLink>
            ) : authFailureUrls.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  const urls = [...authFailureUrls];
                  clearResult();
                  requestAuthRetry(urls);
                }}
                className="ui-btn text-xs"
              >
                {t("goAuthorizeRetry")}
              </button>
            ) : (
              <NavLink to={settingsAuthPath()} onClick={clearResult} className="ui-btn text-xs">
                {t("goCookie")}
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
  const { t } = useLocale();
  const {
    loadingBodies,
    loadingIndex,
    generating,
    summaryPhase,
    statusMessage,
    bodyProgress,
    indexProgress,
    indexStatusMessage,
    stopSummarize,
    stopBodies,
  } = useDigest();

  if (generating) {
    return (
      <TopJobBanner
        tone="progress"
        title={t("generatingDigest")}
        message={statusMessage || t("generatingDigestMessage")}
        indeterminate
        detail={
          summaryPhase && summaryPhase !== "idle" && summaryPhase !== "start" ? (
            <div className="mt-1 text-xs opacity-80">
              {t("phaseLabel")}: {summaryPhase}
            </div>
          ) : null
        }
        actions={
          <button type="button" onClick={stopSummarize} className="ui-btn text-xs">
            {t("stop")}
          </button>
        }
      />
    );
  }

  if (loadingBodies) {
    return (
      <TopJobBanner
        tone="progress"
        title={t("fetchingBodies")}
        message={bodyProgress.message || t("fetchingBodiesMessage")}
        current={bodyProgress.current}
        total={bodyProgress.total}
        indeterminate={bodyProgress.total <= 0}
        actions={
          <button type="button" onClick={stopBodies} className="ui-btn text-xs">
            {t("stop")}
          </button>
        }
      />
    );
  }

  if (loadingIndex) {
    return (
      <TopJobBanner
        tone="progress"
        title={t("buildingIndex")}
        message={indexProgress.message || indexStatusMessage || t("buildingIndexMessage")}
        current={indexProgress.current}
        total={indexProgress.total}
        indeterminate={indexProgress.total <= 0}
      />
    );
  }

  return null;
}

function OnboardingBanner() {
  const { t, locale } = useLocale();
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
          isRepair ? t("onboardingRepair") : autoRepairing ? t("onboardingAutoRepair") : t("onboardingSource")
        }
        message={job.message || t("loading")}
        indeterminate
        detail={
          <div className="mt-1 truncate text-xs opacity-80">
            {isRepair ? job.slug || job.entryUrl : job.entryUrl}
            {job.jobId ? ` · #${job.jobId}` : ""}
          </div>
        }
        actions={
          <button type="button" onClick={stopOnboarding} className="ui-btn text-xs">
            {t("stop")}
          </button>
        }
      />
    );
  }

  if (job.phase === "cancelled") {
    return (
      <TopJobBanner
        tone="neutral"
        title={job.kind === "repair" ? t("repairStopped") : t("onboardingStopped")}
        message={job.message || (job.jobId ? `${t("logLabel")} #${job.jobId}` : t("cancel"))}
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
        job.error.includes("登录") ||
        job.error.toLowerCase().includes("auth"));
    return (
      <TopJobBanner
        tone="error"
        title={isRepair ? t("repairFailed") : t("onboardingFailed")}
        message={`${job.error}${job.jobId ? ` · ${t("logLabel")} #${job.jobId}` : ""}`}
        onClose={clearJob}
        actions={
          needsAuth && job.entryUrl ? (
            <button
              type="button"
              onClick={() => {
                clearJob();
                requestAuthRetry([job.entryUrl]);
              }}
              className="ui-btn text-xs"
            >
              {t("goAuthorizeRetry")}
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
        title={isRepair ? t("repairSuccess") : t("onboardingSuccess")}
        message={formatMessage(locale, "onboardingResultDetail", {
          feedId: job.result.feed_id,
          skillDir: job.result.skill_dir,
        })}
        onClose={clearJob}
      />
    );
  }

  return null;
}

function LanguageToggle() {
  const { locale, setLocale, t } = useLocale();
  return (
    <div className="app-lang-toggle" role="group" aria-label={t("langSwitchLabel")}>
      <button
        type="button"
        className={locale === "en" ? "is-active" : ""}
        onClick={() => setLocale("en")}
        aria-pressed={locale === "en"}
      >
        {t("langEn")}
      </button>
      <button
        type="button"
        className={locale === "zh" ? "is-active" : ""}
        onClick={() => setLocale("zh")}
        aria-pressed={locale === "zh"}
      >
        {t("langZh")}
      </button>
    </div>
  );
}

function AppShellContent() {
  const { t } = useLocale();
  const { settings } = useSettings();
  const { generating, loadingBodies, loadingIndex } = useDigest();
  const { job, batch } = useOnboarding();
  const { refreshBusy } = useFeedRefresh();
  const [helpOpen, setHelpOpen] = useState(false);
  const llmConfigured = isLlmConfigured(settings);
  const sourcesInProgress =
    loadingBodies ||
    loadingIndex ||
    refreshBusy ||
    Boolean(job?.running) ||
    batch?.status === "running";
  const chatInProgress = generating;

  useEffect(() => {
    const openHelp = () => setHelpOpen(true);
    window.addEventListener("askme:open-help", openHelp);
    return () => window.removeEventListener("askme:open-help", openHelp);
  }, []);

  return (
    <div className="flex h-screen flex-col">
      <a href="#main-content" className="app-skip-link">
        {t("skipToMain")}
      </a>
      {!llmConfigured && (
        <TopJobBanner
          tone="warning"
          title={t("llmNotConfiguredTitle")}
          message={t("llmNotConfiguredMessage")}
        />
      )}

      <OnboardingBanner />
      <FeedRefreshBanner />
      <DigestJobBanner />

      <div className="flex min-h-0 flex-1 bg-[var(--surface)]">
        <aside className="app-sidebar" aria-label={t("appName")}>
          <div className="app-sidebar-brand">
            <img src="/logo.svg" alt="" width={24} height={24} />
            <span className="app-sidebar-wordmark">{t("appName")}</span>
          </div>
          <nav className="flex flex-1 flex-col py-2" aria-label={t("navMainLabel")}>
            {navItems.map(({ to, labelKey, end, Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) => `app-nav-link${isActive ? " is-active" : ""}`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="app-nav-label">{t(labelKey)}</span>
                {to === "/" && chatInProgress && <span className="app-nav-dot" aria-hidden="true" />}
                {to === "/sources" && sourcesInProgress && <span className="app-nav-dot" aria-hidden="true" />}
              </NavLink>
            ))}
            <div className="min-h-2 flex-1" aria-hidden="true" />
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="app-nav-link"
            >
              <IconHelp className="h-4 w-4 shrink-0" />
              <span className="app-nav-label">{t("navHelp")}</span>
            </button>
            <LanguageToggle />
          </nav>
        </aside>

        <main id="main-content" className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--surface)]">
          <Outlet />
        </main>
      </div>

      <nav className="app-bottom-nav" aria-label={t("navMainLabel")}>
        {navItems.map(({ to, labelKey, end, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={t(labelKey)}
            aria-label={t(labelKey)}
            className={({ isActive }) => `app-nav-link${isActive ? " is-active" : ""}`}
          >
            <Icon className="h-5 w-5 shrink-0" />
            <span className="app-nav-label">{t(labelKey)}</span>
            {to === "/" && chatInProgress && <span className="app-nav-dot" aria-hidden="true" />}
            {to === "/sources" && sourcesInProgress && <span className="app-nav-dot" aria-hidden="true" />}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          className="app-nav-link"
          title={t("navHelp")}
          aria-label={t("navHelp")}
        >
          <IconHelp className="h-5 w-5 shrink-0" />
          <span className="app-nav-label">{t("navHelp")}</span>
        </button>
        <LanguageToggle />
      </nav>

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
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
