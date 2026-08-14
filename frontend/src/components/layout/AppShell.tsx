import { NavLink, Outlet } from "react-router-dom";
import { DigestProvider, useDigest } from "../../contexts/DigestContext";
import { ChatProvider } from "../../contexts/ChatContext";
import { OnboardingProvider, useOnboarding } from "../../contexts/OnboardingContext";
import { isLlmConfigured, useSettings } from "../../hooks/useSettings";

const navItems = [
  { to: "/", label: "数据源", end: true },
  { to: "/chat", label: "对话", end: false },
  { to: "/skills", label: "Skill管理", end: false },
  { to: "/settings", label: "设置", end: false },
];

function OnboardingBanner() {
  const { job, clearJob, stopOnboarding } = useOnboarding();
  if (!job) return null;

  if (job.running) {
    return (
      <div className="flex items-center justify-between border-b border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-800">
        <div className="min-w-0 flex-1">
          <span className="font-medium">Cursor 接入中</span>
          <span className="mx-2 text-blue-600">·</span>
          <span>{job.message || "处理中…"}</span>
          {job.jobId && <span className="ml-2 text-xs text-blue-600/70">#{job.jobId}</span>}
          <span className="ml-2 block truncate text-xs text-blue-600/80 sm:inline">{job.entryUrl}</span>
        </div>
        <button
          type="button"
          onClick={stopOnboarding}
          className="ml-3 shrink-0 rounded border border-blue-300 bg-white px-2 py-1 text-xs text-blue-800 hover:bg-blue-100"
        >
          停止
        </button>
      </div>
    );
  }

  if (job.phase === "cancelled") {
    return (
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-100 px-4 py-2 text-sm text-slate-700">
        <span>
          {job.message || "接入已停止"}
          {job.jobId ? ` · 日志 #${job.jobId}` : ""}
        </span>
        <button type="button" onClick={clearJob} className="text-xs underline">
          关闭
        </button>
      </div>
    );
  }

  if (job.error) {
    return (
      <div className="flex items-center justify-between border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
        <span>
          接入失败：{job.error}
          {job.jobId ? ` · 日志 #${job.jobId}` : ""}
        </span>
        <button type="button" onClick={clearJob} className="text-xs underline">
          关闭
        </button>
      </div>
    );
  }

  if (job.result) {
    return (
      <div className="flex items-center justify-between border-b border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
        <span>
          已接入 {job.result.feed_id}（{job.result.skill_dir}）
        </span>
        <button type="button" onClick={clearJob} className="text-xs underline">
          关闭
        </button>
      </div>
    );
  }

  return null;
}

function AppShellContent() {
  const { settings } = useSettings();
  const { generating, loadingBodies, loadingIndex, indexStatusMessage } = useDigest();
  const { job } = useOnboarding();
  const llmConfigured = isLlmConfigured(settings);
  const sourcesInProgress = loadingBodies || loadingIndex || Boolean(job?.running);
  const chatInProgress = generating;

  return (
    <div className="flex h-screen flex-col">
      {!llmConfigured && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          LLM 未配置，请在「设置」页填写 API Key 和模型名称。
        </div>
      )}

      <OnboardingBanner />

      {loadingIndex && indexStatusMessage && (
        <div className="border-b border-slate-200 bg-slate-100 px-4 py-2 text-sm text-slate-600">
          {indexStatusMessage}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-16 shrink-0 flex-col border-r border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-2 py-3 text-center">
            <span className="text-xs font-semibold text-slate-700">Askme</span>
          </div>
          <nav className="flex flex-1 flex-col gap-1 p-2">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `relative rounded-lg px-2 py-2 text-center text-xs ${
                    isActive
                      ? "bg-slate-900 font-medium text-white"
                      : "text-slate-600 hover:bg-slate-100"
                  }`
                }
              >
                {item.label}
                {item.to === "/" && sourcesInProgress && (
                  <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-400" />
                )}
                {item.to === "/chat" && chatInProgress && (
                  <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-400" />
                )}
              </NavLink>
            ))}
          </nav>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export default function AppShell() {
  return (
    <OnboardingProvider>
      <DigestProvider>
        <ChatProvider>
          <AppShellContent />
        </ChatProvider>
      </DigestProvider>
    </OnboardingProvider>
  );
}
