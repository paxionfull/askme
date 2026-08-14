import { useMemo } from "react";
import { useLocale } from "../i18n/LocaleContext";
import type { MessageKey } from "../i18n/messages";

const DIGEST_STEP_KEYS = [
  { id: "prepare", labelKey: "digestStepPrepare" as MessageKey, phases: ["start", "loading_articles", "idle"] },
  { id: "classify", labelKey: "digestStepClassify" as MessageKey, phases: ["classify"] },
  { id: "cluster", labelKey: "digestStepCluster" as MessageKey, phases: ["cluster"] },
  { id: "render", labelKey: "digestStepRender" as MessageKey, phases: ["render", "generating"] },
] as const;

function stepIndexForPhase(phase: string): number {
  const normalized = phase || "start";
  const found = DIGEST_STEP_KEYS.findIndex((step) =>
    (step.phases as readonly string[]).includes(normalized),
  );
  if (found >= 0) return found;
  if (normalized === "start" || normalized === "loading_articles") return 0;
  return 0;
}

interface DigestGeneratingPanelProps {
  phase: string;
  message: string;
  hasPreview?: boolean;
}

export default function DigestGeneratingPanel({
  phase,
  message,
  hasPreview = false,
}: DigestGeneratingPanelProps) {
  const { t } = useLocale();
  const steps = useMemo(
    () => DIGEST_STEP_KEYS.map((step) => ({ ...step, label: t(step.labelKey) })),
    [t],
  );
  const activeIndex = stepIndexForPhase(phase);
  const progress = ((activeIndex + 0.45) / steps.length) * 100;

  return (
    <div
      className={`overflow-hidden rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper)] ${
        hasPreview ? "mb-4" : ""
      }`}
    >
      <div className="relative px-4 pb-4 pt-5">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-[linear-gradient(180deg,var(--accent-soft),transparent)]" />
        <div className="relative">
          <h3 className="text-base font-semibold tracking-tight text-[var(--ink)]">
            {t("digestGenTitle")}
          </h3>
          <p className="mt-1.5 min-h-[1.25rem] text-sm leading-5 text-[var(--ink-muted)]">
            {message || t("digestGenDefaultMsg")}
          </p>

          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--rule)_80%,transparent)]">
            <div
              className="digest-progress-bar h-full rounded-full bg-[var(--accent)] transition-[width] duration-500 ease-out"
              style={{ width: `${Math.min(Math.max(progress, 12), 92)}%` }}
            />
          </div>

          <ol className="mt-4 grid grid-cols-4 gap-1.5">
            {steps.map((step, index) => {
              const done = index < activeIndex;
              const active = index === activeIndex;
              return (
                <li
                  key={step.id}
                  className={`rounded-md px-1.5 py-2 text-center ${
                    active
                      ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                      : done
                        ? "text-[var(--ink)]"
                        : "text-[var(--ink-muted)]"
                  }`}
                >
                  <span
                    className={`mx-auto mb-1.5 block h-1.5 w-1.5 rounded-full ${
                      active
                        ? "digest-progress-dot bg-[var(--accent)]"
                        : done
                          ? "bg-[var(--ink)]"
                          : "bg-[var(--rule)]"
                    }`}
                  />
                  <span className="block text-[11px] font-medium">{step.label}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}
