/**
 * DEV-only Brief layout probe — T2b inset ladder.
 * Same chrome: 28rem float, underline forest tabs, no jump link.
 * Variants only differ by top/bottom inset (how short the float feels).
 * Does not change DESIGN / ChatPage.
 */
import { useState, type CSSProperties, type ReactNode } from "react";

type TabId = "summary" | "ask";

type SchemeId = "T2b-0" | "T2b-1" | "T2b-2" | "T2b-3" | "T2b-4";

type Scheme = {
  id: SchemeId;
  label: string;
  note: string;
  insetTop: string;
  insetRight: string;
  insetBottom: string;
};

/** All variants share T2b look; only vertical shrink changes. */
const WIDTH = "28rem";

const SCHEMES: Scheme[] = [
  {
    id: "T2b-0",
    label: "T2b-0 · 轻收",
    note: "上下 1.5rem — 略离开舞台边。",
    insetTop: "1.5rem",
    insetRight: "1.1rem",
    insetBottom: "1.5rem",
  },
  {
    id: "T2b-1",
    label: "T2b-1 · 中收",
    note: "上下 1.85rem。",
    insetTop: "1.85rem",
    insetRight: "1.1rem",
    insetBottom: "1.85rem",
  },
  {
    id: "T2b-2",
    label: "T2b-2 · 当前偏爱档",
    note: "上下 2.25rem — 你刚调过的高度。",
    insetTop: "2.25rem",
    insetRight: "1.1rem",
    insetBottom: "2.25rem",
  },
  {
    id: "T2b-3",
    label: "T2b-3 · 再矮",
    note: "上下 2.75rem。",
    insetTop: "2.75rem",
    insetRight: "1.1rem",
    insetBottom: "2.75rem",
  },
  {
    id: "T2b-4",
    label: "T2b-4 · 最矮",
    note: "上下 3.25rem — 浮层最「悬浮」。",
    insetTop: "3.25rem",
    insetRight: "1.1rem",
    insetBottom: "3.25rem",
  },
];

const HISTORY = [
  { date: "Aug 21", active: true },
  { date: "Aug 20", active: false },
  { date: "Aug 19", active: false },
  { date: "Aug 18", active: false },
];

const SECTIONS = [
  {
    title: "重点关注",
    items: ["OpenAI pauses RL training for two weeks", "Anthropic hits new revenue run-rate"],
  },
  {
    title: "产品与发布",
    items: ["Cursor ships layout polish", "Vercel edge config updates"],
  },
  {
    title: "研究速览",
    items: ["Long-context evals", "Local RAG latency notes"],
  },
];

const SUMMARY = `今日简报缓存：OpenAI 暂停强化学习训练两周，官方称用于评估安全与算力调度；Anthropic 年化营收再创新高，企业合同占比上升。

产品侧 Cursor 与 Vercel 有小版本更新，偏工具链与边缘配置。建议先扫「重点关注」两条，再决定是否对单一事件追问细节。

各变体仅上下收口不同，Tab / 宽度 / 主题色相同。`;

const ASK_THREAD = [
  { role: "user" as const, text: "Why did OpenAI pause RL training?" },
  {
    role: "assistant" as const,
    text: "Cached brief points to a two-week pause for safety evaluation and compute scheduling—not a model withdrawal. No new training run announced in this digest window.",
  },
  { role: "user" as const, text: "Anything I should watch next?" },
  {
    role: "assistant" as const,
    text: "Watch for a follow-up on when training resumes, and whether Anthropic’s enterprise mix shifts competitive pressure in the same week.",
  },
];

export default function LayoutProbePage() {
  const [schemeId, setSchemeId] = useState<SchemeId>("T2b-4");
  const scheme = SCHEMES.find((s) => s.id === schemeId) ?? SCHEMES[4];
  const [tab, setTab] = useState<TabId>("summary");

  return (
    <div
      className="flex h-screen flex-col overflow-hidden"
      style={{
        background: "var(--paper)",
        color: "var(--ink)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <header
        className="shrink-0 border-b px-4 py-3"
        style={{ borderColor: "var(--rule)", background: "var(--paper-raised)" }}
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="m-0 text-[1.125rem] font-semibold tracking-[-0.03em]">
              Layout probe · T2b inset ladder
            </h1>
            <p
              className="mt-1 m-0 max-w-[70ch] text-[0.8125rem] leading-5"
              style={{ color: "var(--ink-muted)" }}
            >
              全部 = T2b（28rem · 下划线森林 Tab · 无 jump）。只比上下收矮程度。
            </p>
          </div>
          <p className="m-0 text-[0.75rem] font-medium" style={{ color: "var(--ink-muted)" }}>
            {scheme.label} · inset {scheme.insetTop}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {SCHEMES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSchemeId(s.id)}
              className="rounded-[var(--radius-control)] border px-3 py-1.5 text-[0.8125rem] font-medium"
              style={{
                borderColor: schemeId === s.id ? "var(--accent)" : "var(--rule)",
                background: schemeId === s.id ? "var(--accent-soft)" : "var(--paper-raised)",
                color: schemeId === s.id ? "var(--accent)" : "var(--ink)",
                boxShadow:
                  schemeId === s.id
                    ? "0 0 0 2px color-mix(in srgb, var(--accent) 25%, transparent)"
                    : "none",
              }}
            >
              {s.id.replace("T2b-", "")}
            </button>
          ))}
        </div>
        <p className="mt-2 m-0 text-[0.75rem]" style={{ color: "var(--ink-muted)" }}>
          {scheme.note}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden p-3">
        <StageFrame>
          <NavRail />
          <HistoryRail />
          <DigestPane />
          <FloatingTabPanel scheme={scheme} tab={tab} onTab={setTab} />
        </StageFrame>
      </div>
    </div>
  );
}

function StageFrame({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative flex h-full min-h-[28rem] overflow-hidden rounded-[var(--radius-panel)] border"
      style={{
        borderColor: "var(--rule)",
        background: "var(--paper)",
        boxShadow: "0 1px 2px color-mix(in srgb, var(--ink) 6%, transparent)",
      }}
    >
      {children}
    </div>
  );
}

function NavRail() {
  return (
    <aside
      className="flex w-[9.5rem] shrink-0 flex-col border-r"
      style={{ borderColor: "var(--rule)", background: "var(--paper-raised)" }}
    >
      <div className="border-b px-3 py-3" style={{ borderColor: "var(--rule)" }}>
        <div className="text-[0.9375rem] font-semibold tracking-[-0.02em]">Askme</div>
      </div>
      <nav className="flex flex-col gap-0.5 p-2 text-[0.8125rem]">
        {[
          { label: "Brief", active: true },
          { label: "Sources", active: false },
          { label: "Settings", active: false },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-[var(--radius-control)] px-2 py-1.5 font-medium"
            style={{
              background: item.active ? "var(--paper)" : "transparent",
              color: item.active ? "var(--ink)" : "var(--ink-muted)",
            }}
          >
            {item.label}
          </div>
        ))}
      </nav>
    </aside>
  );
}

function HistoryRail() {
  return (
    <aside
      className="flex w-[11rem] shrink-0 flex-col border-r"
      style={{ borderColor: "var(--rule)", background: "var(--paper-raised)" }}
    >
      <div
        className="border-b px-3 py-2.5 text-[0.75rem] font-semibold"
        style={{ borderColor: "var(--rule)", color: "var(--ink-muted)" }}
      >
        History
      </div>
      <ul className="m-0 list-none space-y-0.5 overflow-auto p-2">
        {HISTORY.map((h) => (
          <li
            key={h.date}
            className="rounded-[var(--radius-control)] px-2 py-1.5 text-[0.8125rem]"
            style={{
              background: h.active ? "var(--paper)" : "transparent",
              color: h.active ? "var(--ink)" : "var(--ink-muted)",
              fontWeight: h.active ? 600 : 500,
            }}
          >
            {h.date}
          </li>
        ))}
      </ul>
    </aside>
  );
}

function DigestPane() {
  return (
    <main className="min-w-0 flex-1 overflow-auto pr-5" style={{ background: "var(--paper)" }}>
      <div className="mx-auto max-w-[42rem] px-5 py-4">
        <h2 className="m-0 text-[1.25rem] font-semibold tracking-[-0.03em]">Thursday, Aug 21</h2>
        <p className="mt-1 m-0 text-[0.8125rem]" style={{ color: "var(--ink-muted)" }}>
          Ready · 14 articles · T2b inset ladder
        </p>
        <div className="mt-5 space-y-5">
          {SECTIONS.map((sec) => (
            <section key={sec.title} className="border-b pb-4" style={{ borderColor: "var(--rule)" }}>
              <h3 className="m-0 text-[0.9375rem] font-semibold tracking-[-0.01em]">{sec.title}</h3>
              <ul className="mt-2 m-0 list-none space-y-2 p-0">
                {sec.items.map((t) => (
                  <li
                    key={t}
                    className="text-[0.9375rem] leading-6"
                    style={{ fontFamily: "var(--font-reading)" }}
                  >
                    {t}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}

function FloatingTabPanel({
  scheme,
  tab,
  onTab,
}: {
  scheme: Scheme;
  tab: TabId;
  onTab: (t: TabId) => void;
}) {
  const floatStyle: CSSProperties = {
    position: "absolute",
    zIndex: 5,
    top: scheme.insetTop,
    right: scheme.insetRight,
    bottom: scheme.insetBottom,
    width: WIDTH,
    display: "flex",
    flexDirection: "column",
    background: "var(--paper-raised)",
    border: "1px solid var(--rule)",
    borderRadius: "var(--radius-panel)",
    boxShadow: "0 14px 40px color-mix(in srgb, var(--ink) 16%, transparent)",
    overflow: "hidden",
  };

  return (
    <div style={floatStyle} aria-label="Floating summary and ask tabs">
      <TabBar tab={tab} onTab={onTab} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {tab === "summary" ? <SummaryPane /> : <AskPane />}
      </div>
    </div>
  );
}

function TabBar({ tab, onTab }: { tab: TabId; onTab: (t: TabId) => void }) {
  const items: { id: TabId; label: string }[] = [
    { id: "summary", label: "Summary" },
    { id: "ask", label: "Ask" },
  ];

  return (
    <div
      className="flex shrink-0 gap-5 border-b px-4"
      style={{ borderColor: "var(--rule)" }}
      role="tablist"
    >
      {items.map((item) => {
        const active = tab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onTab(item.id)}
            className="relative py-2.5 text-[0.8125rem] font-semibold"
            style={{
              color: active ? "var(--accent)" : "var(--ink-muted)",
              background: "transparent",
              border: "none",
            }}
          >
            {item.label}
            {active ? (
              <span
                className="absolute inset-x-0 bottom-0 h-0.5"
                style={{ background: "var(--accent)" }}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function SummaryPane() {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 py-3.5">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-[0.75rem] font-semibold" style={{ color: "var(--ink-muted)" }}>
          Summarized by Askme
        </span>
        <span className="text-[0.6875rem]" style={{ color: "var(--ink-muted)" }}>
          Cached · 2:14 PM
        </span>
      </div>
      <p
        className="m-0 min-h-0 flex-1 overflow-auto whitespace-pre-wrap text-[0.9375rem] leading-6"
        style={{ fontFamily: "var(--font-reading)" }}
      >
        {SUMMARY}
      </p>
    </div>
  );
}

function AskPane() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-3.5">
        {ASK_THREAD.map((m, i) => (
          <div
            key={i}
            className="rounded-[var(--radius-control)] px-2.5 py-2 text-[0.8125rem] leading-5"
            style={{
              background: m.role === "user" ? "var(--accent-soft)" : "var(--paper)",
              color: "var(--ink)",
              marginLeft: m.role === "user" ? "1.5rem" : 0,
              marginRight: m.role === "assistant" ? "1.5rem" : 0,
              fontFamily: m.role === "assistant" ? "var(--font-reading)" : "var(--font-sans)",
            }}
          >
            {m.text}
          </div>
        ))}
      </div>
      <div
        className="flex shrink-0 gap-2 border-t px-3 py-2.5"
        style={{ borderColor: "var(--rule)" }}
      >
        <div
          className="h-8 min-w-0 flex-1 rounded-[var(--radius-control)] border px-2 text-[0.8125rem] leading-8"
          style={{ borderColor: "var(--rule)", color: "var(--ink-muted)" }}
        >
          Ask a follow-up…
        </div>
        <button
          type="button"
          className="h-8 shrink-0 rounded-[var(--radius-control)] px-3 text-[0.8125rem] font-medium"
          style={{ background: "var(--accent)", color: "var(--on-accent)" }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
