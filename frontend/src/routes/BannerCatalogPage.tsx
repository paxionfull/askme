/**
 * Banner state catalog — commercial-style component gallery.
 * Renders the real TopJobBanner / OnboardingBatchPanel with AppShell-equivalent fixtures
 * so design/QA can review every tone without running live jobs.
 */
import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import type { OnboardBatchStatus } from "../api";
import OnboardingBatchPanel from "../components/OnboardingBatchPanel";
import TopJobBanner from "../components/TopJobBanner";
import { useLocale } from "../i18n/LocaleContext";
import { formatMessage } from "../i18n/messages";

type CatalogCardProps = {
  id: string;
  label: string;
  source: string;
  children: ReactNode;
};

function CatalogCard({ id, label, source, children }: CatalogCardProps) {
  return (
    <section id={id} className="scroll-mt-4 overflow-hidden rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)]">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--rule)] px-4 py-2.5">
        <h2 className="text-sm font-semibold text-[var(--ink)]">{label}</h2>
        <code className="text-[11px] text-[var(--ink-muted)]">{source}</code>
      </header>
      <div className="bg-[var(--surface)]">{children}</div>
    </section>
  );
}

function noop() {}

const SAMPLE_BATCH_RUNNING: OnboardBatchStatus = {
  batch_id: "batch-demo-1",
  status: "running",
  total: 3,
  completed: 1,
  failed: 0,
  skipped: 0,
  needs_auth: 0,
  running: 1,
  queued: 1,
  message: "Connecting 2/3…",
  items: [
    {
      entry_url: "https://example.com/a",
      slug: "a",
      name: "Example A",
      status: "done",
      phase: "done",
      message: "ok",
      job_id: "j1",
    },
    {
      entry_url: "https://example.com/b",
      slug: "b",
      name: "Example B",
      status: "running",
      phase: "discover",
      message: "Fetching…",
      job_id: "j2",
    },
    {
      entry_url: "https://example.com/c",
      slug: "c",
      name: "Example C",
      status: "queued",
      phase: "queued",
      message: "queued",
    },
  ],
};

const SAMPLE_BATCH_WARNING: OnboardBatchStatus = {
  batch_id: "batch-demo-2",
  status: "done",
  total: 2,
  completed: 1,
  failed: 1,
  skipped: 0,
  needs_auth: 0,
  running: 0,
  queued: 0,
  message: "Finished with failures",
  items: [
    {
      entry_url: "https://example.com/ok",
      slug: "ok",
      name: "OK source",
      status: "done",
      phase: "done",
      message: "ok",
    },
    {
      entry_url: "https://x.com/demo",
      slug: "x-demo",
      name: "X demo",
      status: "failed",
      phase: "auth",
      message: "Cookie required",
      error: "需要登录授权（cookie）",
      auth_slot: "x",
      login_url: "https://x.com/login",
      cookie_hint: "Paste Cookie",
    },
  ],
};

export default function BannerCatalogPage() {
  const { t, locale, setLocale } = useLocale();
  const isZh = locale === "zh";

  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <header className="sticky top-0 z-10 border-b border-[var(--rule)] bg-[var(--paper-raised)] px-5 py-4">
        <div className="mx-auto flex max-w-3xl flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--ink-muted)]">
              {isZh ? "组件图鉴 · 与 Live 同源" : "Component catalog · same as Live"}
            </p>
            <h1 className="mt-1 text-lg font-semibold">
              {isZh ? "顶栏任务通知（TopJobBanner）" : "Top job banners"}
            </h1>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-[var(--ink-muted)]">
              {isZh
                ? "使用生产组件 TopJobBanner / OnboardingBatchPanel，fixture 对齐 AppShell 真实挂载态。不跑任务即可评审。"
                : "Uses production TopJobBanner / OnboardingBatchPanel with AppShell-equivalent fixtures. Review without running jobs."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
            <Link to="/" className="ui-btn text-xs">
              {isZh ? "回应用" : "Back to app"}
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-5 py-5">
        <CatalogCard
          id="llm-warning"
          label={isZh ? "LLM 未配置 · warning" : "LLM not configured · warning"}
          source="AppShell · llmConfigured"
        >
          <TopJobBanner
            tone="warning"
            title={t("llmNotConfiguredTitle")}
            message={t("llmNotConfiguredMessage")}
          />
        </CatalogCard>

        <CatalogCard
          id="refresh-progress"
          label={isZh ? "更新源 · progress + Stop" : "Feed refresh · progress + Stop"}
          source="FeedRefreshBanner · refreshBusy"
        >
          <TopJobBanner
            tone="progress"
            title={t("feedRefreshSelectedTitle")}
            message={formatMessage(locale, "feedRefreshUpdatingProgress", {
              current: 3,
              total: 8,
              feed: "量子位",
              queue: "",
            })}
            current={3}
            total={8}
            actions={
              <button type="button" className="ui-btn text-xs">
                {t("stop")}
              </button>
            }
          />
        </CatalogCard>

        <CatalogCard
          id="refresh-progress-indeterminate"
          label={isZh ? "更新源 · 不确定进度" : "Feed refresh · indeterminate"}
          source="FeedRefreshBanner · total≤0"
        >
          <TopJobBanner
            tone="progress"
            title={t("feedRefreshTitle")}
            message={t("feedRefreshStartingAll")}
            indeterminate
            actions={
              <button type="button" className="ui-btn text-xs">
                {t("stop")}
              </button>
            }
          />
        </CatalogCard>

        <CatalogCard
          id="refresh-success"
          label={isZh ? "更新完成 · success + Close" : "Feed refresh · success + Close"}
          source="FeedRefreshBanner · resultMessage"
        >
          <TopJobBanner
            tone="success"
            title={t("feedRefreshTitle")}
            message={
              isZh
                ? "已更新 7 个数据源，1 个暂无新文章（耗时 5.2 秒）"
                : "Updated 7 sources, 1 with no new articles (5.2s)"
            }
            onClose={noop}
          />
        </CatalogCard>

        <CatalogCard
          id="refresh-scheduled-failed"
          label={isZh ? "定时更新失败 · warning + Close" : "Scheduled update failed · warning + Close"}
          source="FeedRefreshBanner · scheduled failures"
        >
          <TopJobBanner
            tone="warning"
            title={t("feedRefreshScheduledFailed")}
            message={
              isZh
                ? "已更新 7 个数据源，5 个暂无新文章，1 个失败（耗时 5.2 秒）\n\n1 sources failed to update (network, timeout, or blocking):\n· 量子位: 网络无法访问或请求超时（The read operation timed out）"
                : "Updated 7 sources, 5 with no new articles, 1 failed (5.2s)\n\n1 sources failed to update (network, timeout, or blocking):\n· QbitAI: network unreachable or timed out"
            }
            onClose={noop}
          />
        </CatalogCard>

        <CatalogCard
          id="refresh-auth"
          label={isZh ? "更新失败需授权 · warning + Authorize" : "Refresh auth failure · warning + Authorize"}
          source="FeedRefreshBanner · authFailure"
        >
          <TopJobBanner
            tone="warning"
            title={t("feedRefreshFailed")}
            message={
              isZh
                ? "以下 1 个数据源更新失败（多为网络无法访问、超时或站点拦截）：\n· X demo：需要登录授权"
                : "1 source failed to update:\n· X demo: login required"
            }
            onClose={noop}
            actions={
              <button type="button" className="ui-btn text-xs">
                {t("goAuthorize")}
              </button>
            }
          />
        </CatalogCard>

        <CatalogCard
          id="digest-generating"
          label={isZh ? "生成简报 · progress" : "Digest generating · progress"}
          source="DigestJobBanner · generating"
        >
          <TopJobBanner
            tone="progress"
            title={t("generatingDigest")}
            message={t("generatingDigestMessage")}
            indeterminate
            detail={
              <div className="mt-1 text-xs opacity-80">
                {t("phaseLabel")}: outline
              </div>
            }
            actions={
              <button type="button" className="ui-btn text-xs">
                {t("stop")}
              </button>
            }
          />
        </CatalogCard>

        <CatalogCard
          id="digest-bodies"
          label={isZh ? "拉取正文 · progress" : "Fetching bodies · progress"}
          source="DigestJobBanner · loadingBodies"
        >
          <TopJobBanner
            tone="progress"
            title={t("fetchingBodies")}
            message={t("fetchingBodiesMessage")}
            current={12}
            total={40}
            actions={
              <button type="button" className="ui-btn text-xs">
                {t("stop")}
              </button>
            }
          />
        </CatalogCard>

        <CatalogCard
          id="digest-index"
          label={isZh ? "建立索引 · progress" : "Building index · progress"}
          source="DigestJobBanner · loadingIndex"
        >
          <TopJobBanner
            tone="progress"
            title={t("buildingIndex")}
            message={t("buildingIndexMessage")}
            current={40}
            total={100}
          />
        </CatalogCard>

        <CatalogCard
          id="onboard-running"
          label={isZh ? "接入中 · progress + Stop" : "Onboarding · progress + Stop"}
          source="OnboardingBanner · job.running"
        >
          <TopJobBanner
            tone="progress"
            title={t("onboardingSource")}
            message={isZh ? "正在发现站点结构…" : "Discovering site structure…"}
            indeterminate
            detail={
              <div className="mt-1 truncate text-xs opacity-80">
                https://example.com/news · #job-42
              </div>
            }
            actions={
              <button type="button" className="ui-btn text-xs">
                {t("stop")}
              </button>
            }
          />
        </CatalogCard>

        <CatalogCard
          id="onboard-repair"
          label={isZh ? "修复 Skill · progress" : "Skill repair · progress"}
          source="OnboardingBanner · repair"
        >
          <TopJobBanner
            tone="progress"
            title={t("onboardingRepair")}
            message={isZh ? "正在根据反馈修复…" : "Applying repair from feedback…"}
            indeterminate
            detail={
              <div className="mt-1 truncate text-xs opacity-80">36kr-discovery · #repair-9</div>
            }
            actions={
              <button type="button" className="ui-btn text-xs">
                {t("stop")}
              </button>
            }
          />
        </CatalogCard>

        <CatalogCard
          id="onboard-cancelled"
          label={isZh ? "接入已停止 · neutral" : "Onboarding stopped · neutral"}
          source="OnboardingBanner · cancelled"
        >
          <TopJobBanner
            tone="neutral"
            title={t("onboardingStopped")}
            message={isZh ? "日志 #job-42" : "Log #job-42"}
            onClose={noop}
          />
        </CatalogCard>

        <CatalogCard
          id="onboard-error"
          label={isZh ? "接入失败 · error + 授权" : "Onboarding failed · error + auth"}
          source="OnboardingBanner · job.error"
        >
          <TopJobBanner
            tone="error"
            title={t("onboardingFailed")}
            message={
              isZh
                ? "需要登录授权（cookie） · 日志 #job-42"
                : "Login cookie required · log #job-42"
            }
            onClose={noop}
            actions={
              <button type="button" className="ui-btn text-xs">
                {t("goAuthorizeRetry")}
              </button>
            }
          />
        </CatalogCard>

        <CatalogCard
          id="onboard-success"
          label={isZh ? "接入成功 · success" : "Onboarding success · success"}
          source="OnboardingBanner · job.result"
        >
          <TopJobBanner
            tone="success"
            title={t("onboardingSuccess")}
            message={formatMessage(locale, "onboardingResultDetail", {
              feedId: "website:example",
              skillDir: "example-discovery",
            })}
            onClose={noop}
          />
        </CatalogCard>

        <CatalogCard
          id="batch-running"
          label={isZh ? "批量接入 · progress（展开列表）" : "Batch onboarding · progress"}
          source="OnboardingBatchPanel · running"
        >
          <OnboardingBatchPanel
            batch={{
              ...SAMPLE_BATCH_RUNNING,
              message: isZh ? "正在接入 2/3…" : SAMPLE_BATCH_RUNNING.message,
            }}
            onStop={noop}
            onClose={noop}
          />
        </CatalogCard>

        <CatalogCard
          id="batch-warning"
          label={isZh ? "批量接入结束 · warning + 授权" : "Batch done · warning + auth"}
          source="OnboardingBatchPanel · failed"
        >
          <OnboardingBatchPanel
            batch={{
              ...SAMPLE_BATCH_WARNING,
              message: isZh ? "已完成，存在失败" : SAMPLE_BATCH_WARNING.message,
            }}
            onStop={noop}
            onClose={noop}
            onAuthRetry={noop}
          />
        </CatalogCard>

        <p className="pb-8 text-center text-[11px] text-[var(--ink-muted)]">
          {isZh
            ? "路径 /dev/banners · 与 Live 共用 index.css / TopJobBanner"
            : "Route /dev/banners · shares Live index.css / TopJobBanner"}
        </p>
      </div>
    </div>
  );
}
