import { Link } from "react-router-dom";
import { useLocale } from "../i18n/LocaleContext";

export type PrepStepState = "done" | "current" | "locked" | "running" | "idle";

interface PrepStep {
  id: string;
  label: string;
  state: PrepStepState;
  detail?: string;
}

interface LibraryPrepStripProps {
  steps: PrepStep[];
  hint: string;
  primaryAction?: {
    label: string;
    disabled?: boolean;
    title?: string;
    onClick: () => void;
  };
  doneLink?: boolean;
}

function StepMark({ state }: { state: PrepStepState }) {
  if (state === "done") {
    return (
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--success-soft)] text-[11px] font-semibold text-[var(--success)]"
        aria-hidden
      >
        ✓
      </span>
    );
  }
  if (state === "running" || state === "current") {
    return (
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-[var(--accent)] ${
          state === "running" ? "animate-pulse bg-[var(--accent-soft)]" : "bg-[var(--accent-soft)]"
        }`}
        aria-hidden
      >
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
      </span>
    );
  }
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--rule)] text-[11px] text-[var(--ink-muted)]"
      aria-hidden
    >
      ○
    </span>
  );
}

export default function LibraryPrepStrip({
  steps,
  hint,
  primaryAction,
  doneLink,
}: LibraryPrepStripProps) {
  const { t } = useLocale();
  return (
    <div className="border-b border-[var(--rule)] bg-[var(--paper-raised)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <nav aria-label={t("prepProgressAria")} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1.5">
          {steps.map((step, index) => {
            const muted = step.state === "done" || step.state === "locked" || step.state === "idle";
            const emphasis = step.state === "current" || step.state === "running";
            return (
              <div key={step.id} className="flex items-center gap-1">
                {index > 0 ? (
                  <span
                    className={`mx-0.5 hidden h-px w-4 sm:block ${
                      steps[index - 1]?.state === "done" ? "bg-[var(--success)]/40" : "bg-[var(--rule)]"
                    }`}
                    aria-hidden
                  />
                ) : null}
                <div
                  className={`flex items-center gap-1.5 rounded-[var(--radius-control)] px-1.5 py-0.5 ${
                    emphasis ? "bg-[var(--accent-soft)]" : ""
                  }`}
                >
                  <StepMark state={step.state} />
                  <div className="min-w-0">
                    <p
                      className={`text-sm leading-5 ${
                        emphasis
                          ? "font-semibold text-[var(--ink)]"
                          : muted
                            ? "text-[var(--ink-muted)]"
                            : "text-[var(--ink)]"
                      }`}
                    >
                      {step.label}
                      {step.detail ? (
                        <span className="ml-1 font-normal text-[var(--ink-muted)]">{step.detail}</span>
                      ) : null}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </nav>

        {primaryAction ? (
          <button
            type="button"
            disabled={primaryAction.disabled}
            title={primaryAction.title}
            onClick={primaryAction.onClick}
            className="ui-btn ui-btn-primary shrink-0 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {primaryAction.label}
          </button>
        ) : null}

        {doneLink ? (
          <Link
            to="/"
            className="ui-btn ui-btn-primary shrink-0 px-3 py-1.5 text-sm no-underline"
          >
            {t("prepGoBrief")}
          </Link>
        ) : null}
      </div>
      <p className="mt-1.5 text-sm leading-5 text-[var(--ink-muted)]">{hint}</p>
    </div>
  );
}
