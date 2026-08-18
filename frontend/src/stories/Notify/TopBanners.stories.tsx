import type { Meta, StoryObj } from "@storybook/react";
import type { OnboardBatchStatus } from "../../api";
import OnboardingBatchPanel from "../../components/OnboardingBatchPanel";
import TopJobBanner from "../../components/TopJobBanner";
import { useLocale } from "../../i18n/LocaleContext";
import { formatMessage } from "../../i18n/messages";
import { CatalogNote, SampleCard } from "../_decorators/CatalogChrome";
import { noop } from "../_fixtures/catalog";

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

function TopBannersGallery() {
  const { t, locale } = useLocale();
  const isZh = locale === "zh";
  const appears = isZh ? "出现在：顶栏通知" : "Appears in: Top banners";

  return (
    <div className="flex flex-col gap-4">
      <CatalogNote>
        {isZh
          ? "顶栏通知的各种进度 / 成功 / 失败态（与 Live 同源组件）。"
          : "Top banner progress / success / failure states (same as Live)."}
      </CatalogNote>

      <SampleCard label={isZh ? "LLM 未配置" : "LLM not configured"} appearsIn={appears}>
        <TopJobBanner
          tone="warning"
          title={t("llmNotConfiguredTitle")}
          message={t("llmNotConfiguredMessage")}
        />
      </SampleCard>

      <SampleCard label={isZh ? "更新源 · 进度" : "Updating sources · progress"} appearsIn={appears}>
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
      </SampleCard>

      <SampleCard label={isZh ? "更新源 · 不确定进度" : "Updating · indeterminate"} appearsIn={appears}>
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
      </SampleCard>

      <SampleCard label={isZh ? "更新完成" : "Update success"} appearsIn={appears}>
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
      </SampleCard>

      <SampleCard label={isZh ? "定时更新失败" : "Scheduled update failed"} appearsIn={appears}>
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
      </SampleCard>

      <SampleCard label={isZh ? "更新失败 · 需授权" : "Update failed · authorize"} appearsIn={appears}>
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
      </SampleCard>

      <SampleCard label={isZh ? "生成简报" : "Generating brief"} appearsIn={appears}>
        <TopJobBanner
          tone="progress"
          title={t("generatingDigest")}
          message={t("generatingDigestMessage")}
          indeterminate
          detail={<div className="mt-1 text-xs opacity-80">{t("phaseLabel")}: outline</div>}
          actions={
            <button type="button" className="ui-btn text-xs">
              {t("stop")}
            </button>
          }
        />
      </SampleCard>

      <SampleCard label={isZh ? "拉取正文" : "Fetching articles"} appearsIn={appears}>
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
      </SampleCard>

      <SampleCard label={isZh ? "建立索引" : "Building index"} appearsIn={appears}>
        <TopJobBanner
          tone="progress"
          title={t("buildingIndex")}
          message={t("buildingIndexMessage")}
          current={40}
          total={100}
        />
      </SampleCard>

      <SampleCard label={isZh ? "接入中" : "Connecting source"} appearsIn={appears}>
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
      </SampleCard>

      <SampleCard label={isZh ? "修复 Skill" : "Repairing skill"} appearsIn={appears}>
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
      </SampleCard>

      <SampleCard label={isZh ? "接入已停止" : "Connection stopped"} appearsIn={appears}>
        <TopJobBanner
          tone="neutral"
          title={t("onboardingStopped")}
          message={isZh ? "日志 #job-42" : "Log #job-42"}
          onClose={noop}
        />
      </SampleCard>

      <SampleCard label={isZh ? "接入失败" : "Connection failed"} appearsIn={appears}>
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
      </SampleCard>

      <SampleCard label={isZh ? "接入成功" : "Source connected"} appearsIn={appears}>
        <TopJobBanner
          tone="success"
          title={t("onboardingSuccess")}
          message={formatMessage(locale, "onboardingResultDetail", {
            feedId: "website:example",
            skillDir: "example-discovery",
          })}
          onClose={noop}
        />
      </SampleCard>

      <SampleCard label={isZh ? "批量接入 · 进行中" : "Batch onboarding · running"} appearsIn={appears}>
        <OnboardingBatchPanel
          batch={{
            ...SAMPLE_BATCH_RUNNING,
            message: isZh ? "正在接入 2/3…" : SAMPLE_BATCH_RUNNING.message,
          }}
          onStop={noop}
          onClose={noop}
        />
      </SampleCard>

      <SampleCard label={isZh ? "批量接入 · 有失败" : "Batch done · with failures"} appearsIn={appears}>
        <OnboardingBatchPanel
          batch={{
            ...SAMPLE_BATCH_WARNING,
            message: isZh ? "已完成，存在失败" : SAMPLE_BATCH_WARNING.message,
          }}
          onStop={noop}
          onClose={noop}
          onAuthRetry={noop}
        />
      </SampleCard>
    </div>
  );
}

const meta = {
  title: "Notify/TopBanners",
  parameters: {
    docs: {
      description: {
        story: "Appears in: top job / onboarding banners across Brief, Sources, Settings.",
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const AllStates: Story = {
  render: () => <TopBannersGallery />,
};
