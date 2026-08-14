import { useState } from "react";
import type { OnboardBatchItem, OnboardBatchStatus } from "../api";
import TopJobBanner from "./TopJobBanner";

interface OnboardingBatchPanelProps {
  batch: OnboardBatchStatus;
  onStop: () => void;
  onClose: () => void;
}

function itemLabel(item: OnboardBatchItem): string {
  return item.name?.trim() || item.slug || item.entry_url;
}

function statusIcon(status: OnboardBatchItem["status"], phase?: string): string {
  if (status === "running" && String(phase || "").startsWith("auto_repair")) {
    return "修";
  }
  switch (status) {
    case "done":
      return "✓";
    case "failed":
      return "✗";
    case "running":
      return "⟳";
    case "skipped":
      return "⊘";
    case "cancelled":
      return "—";
    default:
      return "○";
  }
}

export default function OnboardingBatchPanel({ batch, onStop, onClose }: OnboardingBatchPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const running = batch.status === "running";
  const tone = running ? "progress" : batch.failed > 0 ? "warning" : "success";
  const finished = batch.completed + batch.failed + (batch.skipped ?? 0);

  return (
    <TopJobBanner
      tone={tone}
      title="批量接入"
      message={`${batch.message}${batch.batch_id ? ` · #${batch.batch_id}` : ""}`}
      current={finished}
      total={batch.total}
      indeterminate={running && batch.total <= 0}
      onClose={running ? undefined : onClose}
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="rounded border border-current/20 bg-white/60 px-2 py-1 text-xs hover:bg-white"
          >
            {expanded ? "收起" : "展开"}
          </button>
          {running ? (
            <button
              type="button"
              onClick={onStop}
              className="rounded border border-current/20 bg-white/60 px-2 py-1 text-xs hover:bg-white"
            >
              停止全部
            </button>
          ) : null}
        </div>
      }
      detail={
        expanded ? (
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs">
            {batch.items.map((item) => (
              <li
                key={`${item.entry_url}-${item.slug}-${item.job_id ?? "pending"}`}
                className="flex gap-2"
              >
                <span className="w-4 shrink-0 text-center">{statusIcon(item.status, item.phase)}</span>
                <span className="min-w-0 flex-1 truncate" title={item.entry_url}>
                  {itemLabel(item)}
                </span>
                <span className="shrink-0 opacity-80">
                  {item.status === "skipped"
                    ? item.skip_reason || "已跳过"
                    : item.message || item.status}
                </span>
              </li>
            ))}
          </ul>
        ) : null
      }
    />
  );
}
