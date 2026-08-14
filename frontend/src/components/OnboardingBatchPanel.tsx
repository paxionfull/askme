import { useMemo, useState } from "react";
import type { AuthPrecheckItem, OnboardBatchItem, OnboardBatchStatus } from "../api";
import { isAuthErrorMessage } from "./AddSourceModal";
import AuthHandoffPanel from "./AuthHandoffPanel";
import TopJobBanner from "./TopJobBanner";
import { useLocale } from "../i18n/LocaleContext";
import { formatMessage } from "../i18n/messages";

interface OnboardingBatchPanelProps {
  batch: OnboardBatchStatus;
  onStop: () => void;
  onClose: () => void;
  onAuthRetry?: (urls: string[]) => void;
}

function itemLabel(item: OnboardBatchItem): string {
  return item.name?.trim() || item.slug || item.entry_url;
}

function statusIcon(
  status: OnboardBatchItem["status"],
  phase: string | undefined,
  repairIcon: string,
): string {
  if (status === "running" && String(phase || "").startsWith("auto_repair")) {
    return repairIcon;
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
      if (item.phase === "auth_ineffective" || item.phase === "refresh_empty") return false;
      if (item.status === "needs_auth") return true;
      if (item.status !== "failed") return false;
      const msg = `${item.error || ""} ${item.message || ""}`;
      return isAuthErrorMessage(msg);
    })
    .map((item) => item.entry_url)
    .filter(Boolean);
}

function collectAuthHandoffItems(
  batch: OnboardBatchStatus,
  cookieHintDefault: string,
): AuthPrecheckItem[] {
  const bySlot = new Map<string, AuthPrecheckItem>();
  for (const item of batch.items) {
    if (item.phase === "auth_ineffective" || item.phase === "refresh_empty") continue;
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
      cookie_hint: item.cookie_hint || cookieHintDefault,
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
  const { t, locale } = useLocale();
  const [expanded, setExpanded] = useState(true);
  const [authCookies, setAuthCookies] = useState<Record<string, string>>({});
  const [savedSlots, setSavedSlots] = useState<Set<string>>(() => new Set());
  const running = batch.status === "running";
  const authFailedUrls = collectAuthFailedUrls(batch);
  const cookieHintDefault = t("onboardBatchCookieHint");
  const handoffItems = useMemo(
    () => collectAuthHandoffItems(batch, cookieHintDefault),
    [batch, cookieHintDefault],
  );
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
      title={t("onboardBatchTitle")}
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
              className="ui-btn ui-btn-ghost px-2 py-1 text-xs hover:bg-[var(--paper-raised)]"
            >
              {allAuthSaved
                ? formatMessage(locale, "onboardBatchAuthDone", { count: authFailedUrls.length })
                : formatMessage(locale, "onboardBatchRetryAuth", { count: authFailedUrls.length })}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="rounded border border-current/20 bg-[var(--paper-raised)]/60 px-2 py-1 text-xs hover:bg-[var(--paper-raised)]"
          >
            {expanded ? t("onboardBatchCollapse") : t("onboardBatchExpand")}
          </button>
          {running ? (
            <button
              type="button"
              onClick={onStop}
              className="ui-btn ui-btn-ghost px-2 py-1 text-xs hover:bg-[var(--paper-raised)]"
            >
              {t("onboardBatchStopAll")}
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
                    {statusIcon(item.status, item.phase, t("onboardBatchRepairIcon"))}
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={item.entry_url}>
                    {itemLabel(item)}
                  </span>
                  <span className="shrink-0 opacity-80">
                    {item.status === "skipped"
                      ? item.skip_reason || t("onboardBatchSkipped")
                      : item.message || item.status}
                  </span>
                </li>
              ))}
            </ul>
            {!running && pendingHandoff.length > 0 ? (
              <div className="space-y-3 rounded-md border border-current/15 bg-[var(--paper-raised)]/50 p-3 text-[var(--ink)]">
                <p className="text-xs font-medium">{t("onboardBatchAuthHint")}</p>
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
                    title={formatMessage(locale, "onboardBatchAuthTitle", {
                      label: item.slot_label || item.slot || "",
                    })}
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
