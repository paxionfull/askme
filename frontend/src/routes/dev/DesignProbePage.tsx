/**
 * Design-doc probe — DEV only.
 * Built from PRODUCT.md + DESIGN.md tokens/rules, not by cloning ChatPage.
 * Open /dev/design-probe and judge whether the docs still feel like Askme.
 */
import type { ReactNode } from "react";

export default function DesignProbePage() {
  return (
    <div className="min-h-screen bg-[var(--surface)] text-[var(--ink)]">
      <header className="border-b border-[var(--border)] bg-[var(--surface-raised)] px-6 py-4">
        <h1 className="app-page-title m-0">Design probe</h1>
        <p className="mt-1 max-w-[65ch] text-[0.8125rem] leading-5 text-[var(--ink-muted)]">
          Three surfaces generated from PRODUCT + DESIGN only. If these feel like Askme
          (Linear chrome · Reader calm · Vercel face), the docs are doing their job. If
          they feel generic, the docs need sharper constraints—not more polish on Brief.
        </p>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[0.75rem] text-[var(--ink-muted)]">
          <li>Geist · 2rem controls · 5–6px radius</li>
          <li>Indigo only on primary action</li>
          <li>No card stacks · no eyebrow kickers</li>
          <li>EN copy · flat hairlines</li>
        </ul>
      </header>

      <main className="mx-auto grid max-w-[1500px] gap-8 px-6 py-8 lg:grid-cols-3">
        <ProbeSourcesEmpty />
        <ProbeSettingsApi />
        <ProbeReadingList />
      </main>
    </div>
  );
}

function ProbeShell({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="flex min-h-[28rem] flex-col overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--surface-raised)]">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <h2 className="m-0 text-[0.9375rem] font-semibold tracking-[-0.02em] text-[var(--ink)]">
          {title}
        </h2>
        <p className="mt-1 m-0 text-[0.75rem] leading-5 text-[var(--ink-muted)]">{hint}</p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

/** Surface A — Sources empty (Operate activation) */
function ProbeSourcesEmpty() {
  return (
    <ProbeShell title="A · Sources empty" hint="Follow → add sources. Dense chrome, one primary CTA.">
      <div className="flex flex-1 flex-col px-4 py-5">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h3 className="m-0 text-[1.25rem] font-semibold tracking-[-0.03em]">Sources</h3>
          <button type="button" className="ui-btn ui-btn-primary" disabled>
            Add source
          </button>
        </div>
        <div className="flex flex-1 flex-col items-start justify-center py-10">
          <p className="m-0 max-w-[36ch] text-[0.875rem] leading-6 text-[var(--ink)]">
            No sources yet. Add a site you follow so Askme can build your next brief.
          </p>
          <p className="mt-2 m-0 max-w-[40ch] text-[0.8125rem] leading-5 text-[var(--ink-muted)]">
            Keys stay on this machine. No cloud account required.
          </p>
          <button type="button" className="ui-btn ui-btn-primary mt-5">
            Add your first source
          </button>
        </div>
        <p className="mt-auto border-t border-[var(--border)] pt-3 text-[0.6875rem] font-semibold tracking-[-0.01em] text-[var(--ink-muted)]">
          Askme · local
        </p>
      </div>
    </ProbeShell>
  );
}

/** Surface B — Settings API strip (Vercel-calm form density) */
function ProbeSettingsApi() {
  return (
    <ProbeShell title="B · Settings · API" hint="Configure LLM. Sparse accent; flat panel; 2rem fields.">
      <div className="flex flex-1 flex-col px-4 py-5">
        <h3 className="m-0 text-[1.25rem] font-semibold tracking-[-0.03em]">API Key</h3>
        <p className="mt-1 m-0 text-[0.8125rem] leading-5 text-[var(--ink-muted)]">
          Stored locally. Used for briefs and Ask.
        </p>

        <form
          className="mt-5 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          <label className="ui-field">
            <span className="ui-field-label">Provider</span>
            <select className="ui-select w-full" defaultValue="openai" aria-label="Provider">
              <option value="openai">OpenAI-compatible</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </label>
          <label className="ui-field">
            <span className="ui-field-label">API Key</span>
            <input
              type="password"
              className="ui-input w-full"
              placeholder="sk-…"
              autoComplete="off"
              defaultValue=""
            />
          </label>
          <label className="ui-field">
            <span className="ui-field-label">Model</span>
            <input type="text" className="ui-input w-full" defaultValue="gpt-4.1-mini" />
          </label>
          <div className="mt-2 flex items-center gap-2">
            <button type="submit" className="ui-btn ui-btn-primary">
              Save
            </button>
            <button type="button" className="ui-btn ui-btn-ghost">
              Test
            </button>
            <span className="ml-auto text-[0.75rem] font-medium text-[var(--success)]">
              Configured
            </span>
          </div>
        </form>
      </div>
    </ProbeShell>
  );
}

/** Surface C — Reading list (Reader content-first, not a dashboard) */
function ProbeReadingList() {
  const rows = [
    { title: "OpenAI pauses RL training for two weeks", meta: "3 articles · Focus" },
    { title: "Anthropic run-rate crosses $65B", meta: "3 articles · Focus" },
    { title: "Qwen3.8-27B tops open rankings", meta: "Models" },
    { title: "How Claude accelerates protein design", meta: "Models" },
    { title: "Unitree lists on STAR Market", meta: "Other" },
  ];

  return (
    <ProbeShell
      title="C · Brief reading strip"
      hint="Content-first list. Hairlines, not cards. Accent only on primary."
    >
      <div className="flex flex-1 flex-col">
        <div className="flex items-baseline justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
          <div>
            <h3 className="m-0 text-[1.25rem] font-semibold tracking-[-0.03em]">
              August 21, 2026
            </h3>
            <p className="mt-1 m-0 text-[0.75rem] text-[var(--ink-muted)]">
              12 articles · 4 sources
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[0.8125rem] font-medium text-[var(--success)]">Ready</span>
            <button type="button" className="ui-btn">
              Regenerate
            </button>
          </div>
        </div>
        <ul className="m-0 list-none flex-1 overflow-y-auto px-2 py-1">
          {rows.map((row) => (
            <li
              key={row.title}
              className="group flex items-start justify-between gap-2 border-b border-[var(--border)] px-2 py-2.5 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="m-0 text-[0.875rem] font-medium leading-[1.45] tracking-[-0.011em] text-[var(--ink)]">
                  {row.title}
                </p>
                <p className="mt-0.5 m-0 text-[0.75rem] text-[var(--ink-muted)]">{row.meta}</p>
              </div>
              <button
                type="button"
                className="ui-chip-btn shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              >
                Add to Ask
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t border-[var(--border)] px-4 py-3">
          <button type="button" className="ui-btn ui-btn-primary w-full sm:w-auto">
            Enable Ask
          </button>
          <p className="mt-2 m-0 text-[0.75rem] leading-5 text-[var(--ink-muted)]">
            Then ask a follow-up about what you just read.
          </p>
        </div>
      </div>
    </ProbeShell>
  );
}
