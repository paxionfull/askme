import { useMemo, useState } from "react";
import type { AuthPrecheckItem, OnboardBatchItem, OnboardBatchStatus } from "../api";
import { isAuthErrorMessage } from "./AddSourceModal";
import AuthHandoffPanel from "./AuthHandoffPanel";
import TopJobBanner from "./TopJobBanner";

interface OnboardingBatchPanelProps {
  batch: OnboardBatchStatus;
  onStop: () => void;
  onClose: () => void;
  onAuthRetry?: (urls: string[]) => void;
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
    case "needs_auth":
      return "🔑";
    default:
      return "○";
  }
}

function collectAuthFailedUrls(batch: OnboardBatchStatus): string[] {
  return batch.items
    .filter((item) => {
      if (item.status === "needs_auth") return true;
      if (item.status !== "failed") return false;
      const msg = `${item.error || ""} ${item.message || ""}`;
      return isAuthErrorMessage(msg);
    })
    .map((item) => item.entry_url)
    .filter(Boolean);
}

function collectAuthHandoffItems(batch: OnboardBatchStatus): AuthPrecheckItem[] {
  const bySlot = new Map<string, AuthPrecheckItem>();
  for (const item of batch.items) {
    const msg = `${item.error || ""} ${item.message || ""}`;
    const needs =
      item.status === "needs_auth" ||
      (item.status === "failed" && isAuthErrorMessage(msg));
    if (!needs) continue;
    const slot = (item.auth_slot || "").trim();
    if (!slot || bySlot.has(slot)) continue;
    bySlot.set(slot, {
      entry_url: item.entry_url,
      requires_auth: true,
      platform: slot,
      slot,
      slot_label: slot,
      login_url: item.login_url || item.entry_url,
      cookie_hint:
        item.cookie_hint || "粘贴该站点登录后的完整 Cookie（须含业务令牌，访客/追踪字段无效）",
      configured: false,
      can_proceed: false,
    });
  }
  return [...bySlot.values()];
}

export default function OnboardingBatchPanel({
  batch,
  onStop,
  onClose,
  onAuthRetry,
}: OnboardingBatchPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [authCookies, setAuthCookies] = useState<Record<string, string>>({});
  const [savedSlots, setSavedSlots] = useState<Set<string>>(() => new Set());
  const running = batch.status === "running";
  const authFailedUrls = collectAuthFailedUrls(batch);
  const handoffItems = useMemo(() => collectAuthHandoffItems(batch), [batch]);
  const tone = running
    ? "progress"
    : batch.failed > 0
      ? "warning"
      : authFailedUrls.length > 0
        ? "warning"
        : "success";
  const finished =
    batch.completed + batch.failed + (batch.skipped ?? 0) + (batch.needs_auth ?? 0);

  const pendingHandoff = handoffItems.filter((item) => item.slot && !savedSlots.has(item.slot));
  const allAuthSaved =
    handoffItems.length > 0 && handoffItems.every((item) => item.slot && savedSlots.has(item.slot));

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
          {!running && authFailedUrls.length > 0 && onAuthRetry ? (
            <button
              type="button"
              onClick={() => onAuthRetry(authFailedUrls)}
              className="rounded border border-current/20 bg-[var(--paper-raised)]/60 px-2 py-1 text-xs hover:bg-[var(--paper-raised)]"
            >
              {allAuthSaved
                ? `授权完成，重试接入 (${authFailedUrls.length})`
                : `去授权并重试 (${authFailedUrls.length})`}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="rounded border border-current/20 bg-[var(--paper-raised)]/60 px-2 py-1 text-xs hover:bg-[var(--paper-raised)]"
          >
            {expanded ? "收起" : "展开"}
          </button>
          {running ? (
            <button
              type="button"
              onClick={onStop}
              className="rounded border border-current/20 bg-[var(--paper-raised)]/60 px-2 py-1 text-xs hover:bg-[var(--paper-raised)]"
            >
              停止全部
            </button>
          ) : null}
        </div>
      }
      detail={
        expanded ? (
          <div className="mt-2 space-y-3">
            <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
              {batch.items.map((item) => (
                <li
                  key={`${item.entry_url}-${item.slug}-${item.job_id ?? "pending"}`}
                  className="flex gap-2"
                >
                  <span className="w-4 shrink-0 text-center">
                    {statusIcon(item.status, item.phase)}
                  </span>
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
            {!running && pendingHandoff.length > 0 ? (
              <div className="space-y-3 rounded-md border border-current/15 bg-[var(--paper-raised)]/50 p-3 text-[var(--ink)]">
                <p className="text-xs font-medium">
                  以下站点需要登录授权，完成后 Cookie 会写入「设置 → 授权」，再点上方重试接入。
                </p>
                {pendingHandoff.map((item) => (
                  <AuthHandoffPanel
                    key={item.slot || item.entry_url}
                    item={item}
                    cookieDraft={authCookies[item.slot || ""] || ""}
                    onCookieChange={(value) =>
                      setAuthCookies((current) => ({
                        ...current,
                        [item.slot || ""]: value,
                      }))
                    }
                    onSaved={() => {
                      const slot = item.slot || "";
                      if (!slot) return;
                      setSavedSlots((current) => new Set(current).add(slot));
                      setAuthCookies((current) => ({ ...current, [slot]: "" }));
                    }}
                    title={`请授权：${item.slot_label || item.slot}`}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null
      }
    />
  );
}
