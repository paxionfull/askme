import type { ReactNode } from "react";

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
  progress: "border-blue-200 bg-blue-50 text-blue-800",
  success: "border-green-200 bg-green-50 text-green-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  error: "border-red-200 bg-red-50 text-red-700",
  neutral: "border-slate-200 bg-slate-100 text-slate-700",
};

const BAR_TRACK: Record<TopJobTone, string> = {
  progress: "bg-blue-200/80",
  success: "bg-green-200/80",
  warning: "bg-amber-200/80",
  error: "bg-red-200/80",
  neutral: "bg-slate-300/60",
};

const BAR_FILL: Record<TopJobTone, string> = {
  progress: "bg-blue-600",
  success: "bg-green-600",
  warning: "bg-amber-600",
  error: "bg-red-600",
  neutral: "bg-slate-700",
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
  const showBar = tone === "progress" && (total > 0 || indeterminate);
  const percent =
    total > 0 ? Math.min(100, Math.round((current / total) * 100)) : indeterminate ? 15 : 0;

  return (
    <div className={`border-b px-4 py-2 text-sm ${TONE_CLASS[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {title ? <span className="shrink-0 font-medium">{title}</span> : null}
            {title ? <span className="shrink-0 opacity-60">·</span> : null}
            <span className={`min-w-0 flex-1 ${message.includes("\n") ? "whitespace-pre-wrap" : "truncate"}`}>
              {message}
            </span>
          </div>
          {detail}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {tone === "progress" && total > 0 && (
            <span className="text-xs opacity-70">
              {current}/{total}
            </span>
          )}
          {actions}
          {onClose && (
            <button type="button" onClick={onClose} className="text-xs underline">
              关闭
            </button>
          )}
        </div>
      </div>
      {showBar && (
        <div className={`mt-2 h-1.5 w-full overflow-hidden rounded-full ${BAR_TRACK[tone]}`}>
          <div
            className={`h-full rounded-full transition-all duration-300 ${BAR_FILL[tone]}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </div>
  );
}
