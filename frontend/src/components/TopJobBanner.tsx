import type { ReactNode } from "react";
import { useT } from "../i18n/LocaleContext";

export type TopJobTone = "progress" | "success" | "warning" | "error" | "neutral";

interface TopJobBannerProps {
  tone: TopJobTone;
  title?: string;
  message: string;
  current?: number;
  total?: number;
  indeterminate?: boolean;
  detail?: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
}

const TONE_CLASS: Record<TopJobTone, string> = {
  progress: "border-[var(--rule)] bg-[var(--paper)] text-[var(--ink)]",
  success: "border-[var(--rule)] bg-[var(--success-soft)] text-[var(--success)]",
  warning: "border-[var(--rule)] bg-[var(--warning-soft)] text-[var(--warning-text)]",
  error: "border-[var(--rule)] bg-[var(--error-soft)] text-[var(--danger-text)]",
  neutral: "border-[var(--rule)] bg-[var(--paper)] text-[var(--ink-muted)]",
};

const BAR_TRACK: Record<TopJobTone, string> = {
  progress: "bg-[color-mix(in_srgb,var(--rule)_80%,white)]",
  success: "bg-[color-mix(in_srgb,var(--success)_20%,white)]",
  warning: "bg-[color-mix(in_srgb,var(--warning)_18%,white)]",
  error: "bg-[var(--danger-track)]",
  neutral: "bg-[var(--rule)]",
};

const BAR_FILL: Record<TopJobTone, string> = {
  progress: "bg-[var(--accent)]",
  success: "bg-[var(--success)]",
  warning: "bg-[var(--warning)]",
  error: "bg-[var(--danger)]",
  neutral: "bg-[var(--ink-muted)]",
};

export default function TopJobBanner({
  tone,
  title,
  message,
  current = 0,
  total = 0,
  indeterminate = false,
  detail,
  actions,
  onClose,
}: TopJobBannerProps) {
  const t = useT();
  const showBar = tone === "progress" && (total > 0 || indeterminate);
  const percent =
    total > 0 ? Math.min(100, Math.round((current / total) * 100)) : indeterminate ? 15 : 0;
  const liveRegionProps =
    tone === "error"
      ? { role: "alert" as const, "aria-live": "assertive" as const }
      : tone === "progress" || tone === "warning"
        ? { role: "status" as const, "aria-live": "polite" as const }
        : { role: "status" as const, "aria-live": "polite" as const };
  const progressLabel = title ? `${title}: ${message}` : message;

  return (
    <div className={`border-b px-4 py-2 text-sm ${TONE_CLASS[tone]}`} {...liveRegionProps}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {title ? <span className="shrink-0 font-medium">{title}</span> : null}
            {title ? <span className="shrink-0 opacity-60" aria-hidden="true">·</span> : null}
            <span className={`min-w-0 flex-1 ${message.includes("\n") ? "whitespace-pre-wrap" : "truncate"}`}>
              {message}
            </span>
          </div>
          {detail}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {tone === "progress" && total > 0 && (
            <span className="text-xs opacity-70" aria-hidden="true">
              {current}/{total}
            </span>
          )}
          {actions}
          {onClose && (
            <button type="button" onClick={onClose} className="ui-btn ui-btn-ghost px-2.5 text-xs">
              {t("close")}
            </button>
          )}
        </div>
      </div>
      {showBar && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={indeterminate ? undefined : percent}
          aria-label={progressLabel}
          className={`mt-2 h-1.5 w-full overflow-hidden rounded-full ${BAR_TRACK[tone]}`}
        >
          <div
            className={`h-full rounded-full transition-all duration-300 ${BAR_FILL[tone]}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </div>
  );
}
