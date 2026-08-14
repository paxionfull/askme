import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchFeedSchedulerConfig,
  fetchFeeds,
  updateFeedSchedulerConfig,
  type FeedGroup,
  type FeedSchedulerConfig,
  type ScheduleTime,
} from "../api";
import { UNGROUPED_GROUP_ID, countUngroupedFeeds, resolveGroupDisplayName } from "../utils/feedLayout";
import { useFeedRefresh } from "../contexts/FeedRefreshContext";
import {
  SCHEDULES_UPDATED_EVENT,
  clampEveryHours,
  formatScheduleSummary,
  notifySchedulesUpdated,
  parseDrafts,
  schedulesEqual,
  timeValue,
  toDrafts,
  validateSchedules,
  type ScheduleDraft,
} from "../utils/feedScheduler";
import { useLocale } from "../i18n/LocaleContext";
import { formatMessage } from "../i18n/messages";
import { useModalA11y } from "../hooks/useModalA11y";

function formatLastRun(timestamp: number | null | undefined, locale: import("../i18n/locale").Locale): string {
  if (!timestamp) return "—";
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(locale === "zh" ? "zh-CN" : "en-US");
}

function formatNextRun(iso: string | null | undefined, locale: import("../i18n/locale").Locale): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(locale === "zh" ? "zh-CN" : "en-US");
}

export default function FeedSchedulerSection() {
  const { t, locale } = useLocale();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [groups, setGroups] = useState<FeedGroup[]>([]);
  const [ungroupedCount, setUngroupedCount] = useState(0);
  const [openPopId, setOpenPopId] = useState<string | null>(null);
  const [draftGroupIds, setDraftGroupIds] = useState<string[]>([]);
  const popRef = useRef<HTMLDivElement>(null);
  const groupsDialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(!!openPopId, () => setOpenPopId(null), groupsDialogRef);
  const {
    refreshBusy,
    progress: liveProgress,
    statusMessage,
    resultMessage,
    error: refreshError,
    stopRefresh,
  } = useFeedRefresh();

  const [drafts, setDrafts] = useState<ScheduleDraft[]>([]);
  const [status, setStatus] = useState<FeedSchedulerConfig | null>(null);

  const applyServerConfig = useCallback((config: FeedSchedulerConfig) => {
    setStatus(config);
    setDrafts(toDrafts(config.schedules ?? []));
  }, []);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [config, feedsData] = await Promise.all([
        fetchFeedSchedulerConfig(),
        fetchFeeds(),
      ]);
      applyServerConfig(config);
      setGroups(feedsData.groups ?? []);
      setUngroupedCount(countUngroupedFeeds(feedsData.feeds ?? [], feedsData.groups ?? []));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("scheduleErrLoad"));
    } finally {
      setLoading(false);
    }
  }, [applyServerConfig, t]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    function handleSchedulesUpdated(event: Event) {
      const detail = (event as CustomEvent<{ schedules?: ScheduleTime[] }>).detail;
      if (detail?.schedules) {
        setStatus((current) =>
          current ? { ...current, schedules: detail.schedules ?? [] } : current,
        );
        setDrafts(toDrafts(detail.schedules ?? []));
        setSaved(true);
        setError("");
      } else {
        void loadConfig();
      }
    }
    window.addEventListener(SCHEDULES_UPDATED_EVENT, handleSchedulesUpdated);
    return () => window.removeEventListener(SCHEDULES_UPDATED_EVENT, handleSchedulesUpdated);
  }, [loadConfig]);

  useEffect(() => {
    if (!openPopId) return;
    function handleClick(event: MouseEvent) {
      if (popRef.current?.contains(event.target as Node)) return;
      setOpenPopId(null);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openPopId]);

  const draftSchedules = useMemo(() => parseDrafts(drafts), [drafts]);

  const isDirty = useMemo(() => {
    if (!status) return false;
    return !schedulesEqual(status.schedules ?? [], draftSchedules);
  }, [status, draftSchedules]);

  const refreshProgress = liveProgress ?? status?.refresh_progress;
  const showProgressBar =
    (refreshBusy || status?.refresh_running) &&
    refreshProgress &&
    refreshProgress.total > 0;
  const progressPercent = showProgressBar
    ? Math.min(100, Math.round((refreshProgress.current / refreshProgress.total) * 100))
    : 0;

  const groupOptions = useMemo(() => {
    const named = groups
      .filter((group) => group.id !== UNGROUPED_GROUP_ID)
      .map((group) => ({
        id: group.id,
        name: group.name,
        feedCount: group.feed_ids?.length ?? 0,
      }));
    return [
      ...named,
      {
        id: UNGROUPED_GROUP_ID,
        name: resolveGroupDisplayName(UNGROUPED_GROUP_ID, "", t("addSourceUngrouped")),
        feedCount: ungroupedCount,
      },
    ];
  }, [groups, ungroupedCount, t]);

  const persistSchedules = useCallback(async (schedules: ScheduleTime[]) => {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const result = await updateFeedSchedulerConfig({ schedules });
      applyServerConfig(result);
      notifySchedulesUpdated(result.schedules ?? []);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("scheduleErrSave"));
    } finally {
      setSaving(false);
    }
  }, [applyServerConfig, t]);

  useEffect(() => {
    if (loading || !status || !isDirty) return;
    const validationError = validateSchedules(locale, draftSchedules);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    const timer = window.setTimeout(() => {
      void persistSchedules(draftSchedules);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draftSchedules, isDirty, loading, persistSchedules, status]);

  function updateDraft(id: string, patch: Partial<ScheduleTime>) {
    setDrafts((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
    setSaved(false);
  }

  function handleAddSchedule() {
    const defaultGroupId = groupOptions[0]?.id;
    setDrafts((current) => [
      ...current,
      {
        id: `new-${Date.now()}`,
        kind: "daily",
        hour: 8,
        minute: 0,
        second: 0,
        every_hours: 6,
        group_ids: defaultGroupId ? [defaultGroupId] : [],
      },
    ]);
    setSaved(false);
  }

  function handleRemoveSchedule(id: string) {
    setDrafts((current) => current.filter((item) => item.id !== id));
    if (openPopId === id) setOpenPopId(null);
    setSaved(false);
  }

  function openGroupsPop(item: ScheduleDraft) {
    const wasOpen = openPopId === item.id;
    if (wasOpen) {
      setOpenPopId(null);
      return;
    }
    setDraftGroupIds([...(item.group_ids ?? [])]);
    setOpenPopId(item.id);
  }

  function confirmGroupsPop(id: string) {
    if (draftGroupIds.length === 0) {
      setError(t("scheduleValidateGroups"));
      return;
    }
    updateDraft(id, { group_ids: [...draftGroupIds] });
    setOpenPopId(null);
    setError("");
  }

  const nextHint = (() => {
    if (!status) return "";
    if (drafts.length === 0) return t("scheduleEmpty");
    const summaries = draftSchedules
      .map((schedule) => formatScheduleSummary(locale, schedule))
      .join(locale === "zh" ? " · " : " · ");
    const next =
      status.next_runs?.[0]?.next_run != null
        ? formatMessage(locale, "scheduleNextRun", {
            time: formatNextRun(status.next_runs[0].next_run, locale),
          })
        : "";
    const last = status.last_run_at
      ? formatMessage(locale, "scheduleLastRun", {
          time: formatLastRun(status.last_run_at, locale),
        }) +
        ((status.last_feed_count ?? 0) > 0
          ? formatMessage(locale, "scheduleLastRunFeeds", { count: status.last_feed_count ?? 0 })
          : "")
      : "";
    return formatMessage(locale, "scheduleCountSummary", {
      count: drafts.length,
      summaries: [summaries, next, last].filter(Boolean).join(locale === "zh" ? "　　" : "  "),
    });
  })();

  return (
    <section className="rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-sm font-semibold">{t("scheduleTitle")}</h2>
        <button type="button" onClick={handleAddSchedule} className="ui-btn text-sm">
          {t("scheduleAdd")}
        </button>
      </div>

      {showProgressBar && refreshProgress ? (
        <div className="mt-3" role="status" aria-live="polite">
          <div className="mb-1 flex items-center justify-between text-xs text-[var(--ink-muted)]">
            <span>
              {statusMessage ||
                (refreshProgress.feed_name
                  ? formatMessage(locale, "scheduleUpdatingFeed", {
                      name: refreshProgress.feed_name,
                    })
                  : t("scheduleUpdating"))}
            </span>
            <span aria-hidden="true">
              {refreshProgress.current}/{refreshProgress.total}
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent}
            aria-label={
              statusMessage ||
              (refreshProgress.feed_name
                ? formatMessage(locale, "scheduleUpdatingFeed", {
                    name: refreshProgress.feed_name,
                  })
                : t("scheduleUpdating"))
            }
            className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--rule)]"
          >
            <div
              className="h-full rounded-full bg-[var(--ink)] transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          {refreshBusy ? (
            <button type="button" onClick={stopRefresh} className="ui-btn mt-2 text-xs">
              {t("scheduleStopRefresh")}
            </button>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <p className="mt-4 text-sm text-[var(--ink-muted)]">{t("loading")}</p>
      ) : (
        <>
          {drafts.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--ink-muted)]">{t("scheduleEmpty")}</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {drafts.map((item) => {
                const n = (item.group_ids ?? []).length;
                const groupsLabel =
                  n > 0
                    ? formatMessage(locale, "scheduleGroupsSelected", { count: n })
                    : t("scheduleSelectGroups");
                const popOpen = openPopId === item.id;
                return (
                  <li
                    key={item.id}
                    className="relative flex flex-nowrap items-center gap-2 rounded-[var(--radius-control)] border border-[var(--rule)] bg-[color-mix(in_srgb,var(--paper)_55%,var(--paper-raised))] px-2.5 py-2 text-sm"
                  >
                    <select
                      aria-label={t("scheduleTypeLabel")}
                      value={item.kind === "interval" ? "interval" : "daily"}
                      onChange={(e) =>
                        updateDraft(item.id, {
                          kind: e.target.value === "interval" ? "interval" : "daily",
                        })
                      }
                      className="ui-input max-w-[4.6rem] shrink-0 px-2 py-1 text-xs"
                    >
                      <option value="daily">{t("scheduleKindDaily")}</option>
                      <option value="interval">{t("scheduleKindInterval")}</option>
                    </select>

                    <div className="flex min-w-0 shrink items-center gap-1">
                      {item.kind === "interval" ? (
                        <>
                          <input
                            type="number"
                            min={1}
                            max={24}
                            step={1}
                            aria-label={t("scheduleIntervalHoursLabel")}
                            value={item.every_hours ?? 6}
                            onChange={(e) =>
                              updateDraft(item.id, {
                                every_hours: clampEveryHours(Number(e.target.value)),
                              })
                            }
                            className="ui-input w-14 px-2 py-1 text-xs"
                          />
                          <span className="shrink-0 text-xs text-[var(--ink-muted)]">
                            {t("scheduleHoursUnit")}
                          </span>
                        </>
                      ) : (
                        <input
                          type="time"
                          aria-label={t("scheduleDailyTimeLabel")}
                          value={timeValue(item.hour, item.minute)}
                          onChange={(e) => {
                            const [h, m] = e.target.value.split(":").map(Number);
                            updateDraft(item.id, {
                              hour: Math.min(23, Math.max(0, h || 0)),
                              minute: Math.min(59, Math.max(0, m || 0)),
                              second: 0,
                            });
                          }}
                          className="ui-input px-2 py-1 text-xs"
                        />
                      )}
                    </div>

                    <div className="relative min-w-0 flex-1" ref={popOpen ? popRef : undefined}>
                      <button
                        type="button"
                        onClick={() => openGroupsPop(item)}
                        className={`w-full rounded-[var(--radius-control)] border border-[var(--rule)] bg-[var(--paper-raised)] px-2.5 py-1 text-left text-xs hover:border-[var(--accent)] ${
                          n === 0 ? "text-[var(--accent)]" : "text-[var(--ink)]"
                        }`}
                      >
                        {groupsLabel}
                      </button>
                      {popOpen ? (
                        <div
                          ref={groupsDialogRef}
                          role="dialog"
                          aria-modal="true"
                          aria-labelledby="schedule-groups-dialog-title"
                          tabIndex={-1}
                          className="absolute right-0 top-full z-30 mt-1 w-56 rounded-[var(--radius-control)] border border-[var(--rule)] bg-[var(--paper-raised)] p-2.5 shadow-md"
                        >
                          <p id="schedule-groups-dialog-title" className="mb-2 text-xs text-[var(--ink-muted)]">
                            {t("schedulePickGroups")}
                          </p>
                          <div className="max-h-44 space-y-1 overflow-y-auto">
                            {groupOptions.length === 0 ? (
                              <p className="text-xs text-[var(--ink-muted)]">{t("scheduleNoGroups")}</p>
                            ) : (
                              groupOptions.map((opt) => {
                                const checked = draftGroupIds.includes(opt.id);
                                return (
                                  <label
                                    key={opt.id}
                                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs text-[var(--ink)] hover:bg-[var(--paper)]"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(e) => {
                                        setDraftGroupIds((current) =>
                                          e.target.checked
                                            ? [...current, opt.id]
                                            : current.filter((id) => id !== opt.id),
                                        );
                                      }}
                                    />
                                    <span className="min-w-0 flex-1 truncate">{opt.name}</span>
                                    <span className="shrink-0 text-[11px] text-[var(--ink-muted)]">
                                      {opt.feedCount}
                                    </span>
                                  </label>
                                );
                              })
                            )}
                          </div>
                          <div className="mt-2 flex justify-end gap-2 border-t border-[var(--rule)] pt-2">
                            <button
                              type="button"
                              onClick={() => setOpenPopId(null)}
                              className="ui-btn px-2 py-1 text-xs"
                            >
                              {t("cancel")}
                            </button>
                            <button
                              type="button"
                              onClick={() => confirmGroupsPop(item.id)}
                              className="ui-btn ui-btn-primary px-2 py-1 text-xs"
                            >
                              {t("scheduleDone")}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemoveSchedule(item.id)}
                      className="ui-btn ui-btn-ghost shrink-0 px-2 text-xs hover:border-[color-mix(in_srgb,var(--danger)_35%,var(--rule))] hover:bg-[var(--error-soft)] hover:text-[var(--danger-text)]"
                    >
                      {t("delete")}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {nextHint ? (
            <p className="mt-3 text-xs text-[var(--ink-muted)]">
              {nextHint}
              {saving ? (
                <span className="ml-2 text-[var(--ink-muted)]">{t("saving")}</span>
              ) : saved && !isDirty ? (
                <span className="ml-2 text-[var(--success)]">{t("scheduleSaved")}</span>
              ) : null}
            </p>
          ) : null}

          {(error || refreshError || resultMessage) && (
            <p
              role={error || refreshError ? "alert" : "status"}
              aria-live={error || refreshError ? "assertive" : "polite"}
              className={`mt-3 text-sm ${
                error || refreshError ? "text-[var(--danger-text)]" : "text-[var(--ink-muted)]"
              }`}
            >
              {error || refreshError || resultMessage}
            </p>
          )}
        </>
      )}
    </section>
  );
}
