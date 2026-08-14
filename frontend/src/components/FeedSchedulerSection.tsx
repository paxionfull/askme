import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchFeedSchedulerConfig,
  fetchFeeds,
  updateFeedSchedulerConfig,
  type FeedGroup,
  type FeedSchedulerConfig,
  type ScheduleTime,
} from "../api";
import { UNGROUPED_GROUP_ID, countUngroupedFeeds } from "../utils/feedLayout";
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

function formatLastRun(timestamp: number | null | undefined): string {
  if (!timestamp) return "—";
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN");
}

function formatNextRun(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("zh-CN");
}

export default function FeedSchedulerSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [groups, setGroups] = useState<FeedGroup[]>([]);
  const [ungroupedCount, setUngroupedCount] = useState(0);
  const [openPopId, setOpenPopId] = useState<string | null>(null);
  const [draftGroupIds, setDraftGroupIds] = useState<string[]>([]);
  const popRef = useRef<HTMLDivElement>(null);
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
      setError(err instanceof Error ? err.message : "加载定时设置失败");
    } finally {
      setLoading(false);
    }
  }, [applyServerConfig]);

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
        name: "未分组",
        feedCount: ungroupedCount,
      },
    ];
  }, [groups, ungroupedCount]);

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
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [applyServerConfig]);

  useEffect(() => {
    if (loading || !status || !isDirty) return;
    const validationError = validateSchedules(draftSchedules);
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
      setError("请至少选择一个分组");
      return;
    }
    updateDraft(id, { group_ids: [...draftGroupIds] });
    setOpenPopId(null);
    setError("");
  }

  const nextHint = (() => {
    if (!status) return "";
    if (drafts.length === 0) return "尚未添加定时。";
    const summaries = draftSchedules.map(formatScheduleSummary).join(" · ");
    const next =
      status.next_runs?.[0]?.next_run != null
        ? `下次：${formatNextRun(status.next_runs[0].next_run)}`
        : "";
    const last = status.last_run_at
      ? `上次：${formatLastRun(status.last_run_at)}${
          (status.last_feed_count ?? 0) > 0 ? ` · 成功 ${status.last_feed_count} 个源` : ""
        }`
      : "";
    return [`已设 ${drafts.length} 条：${summaries}`, next, last].filter(Boolean).join("　　");
  })();

  return (
    <section className="rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-sm font-semibold">定时更新</h2>
        <button type="button" onClick={handleAddSchedule} className="ui-btn text-sm">
          添加定时
        </button>
      </div>

      {showProgressBar && refreshProgress ? (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-xs text-[var(--ink-muted)]">
            <span>
              {statusMessage ||
                (refreshProgress.feed_name
                  ? `正在更新：${refreshProgress.feed_name}`
                  : "更新中…")}
            </span>
            <span>
              {refreshProgress.current}/{refreshProgress.total}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--rule)]">
            <div
              className="h-full rounded-full bg-[var(--ink)] transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          {refreshBusy ? (
            <button type="button" onClick={stopRefresh} className="ui-btn mt-2 text-xs">
              停止更新
            </button>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <p className="mt-4 text-sm text-[var(--ink-muted)]">加载中...</p>
      ) : (
        <>
          {drafts.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--ink-muted)]">还没有定时，点右上角「添加定时」。</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {drafts.map((item) => {
                const n = (item.group_ids ?? []).length;
                const groupsLabel = n > 0 ? `已选 ${n} 组` : "选择分组";
                const popOpen = openPopId === item.id;
                return (
                  <li
                    key={item.id}
                    className="relative flex flex-nowrap items-center gap-2 rounded-[var(--radius-control)] border border-[var(--rule)] bg-[color-mix(in_srgb,var(--paper)_55%,var(--paper-raised))] px-2.5 py-2 text-sm"
                  >
                    <select
                      aria-label="定时类型"
                      value={item.kind === "interval" ? "interval" : "daily"}
                      onChange={(e) =>
                        updateDraft(item.id, {
                          kind: e.target.value === "interval" ? "interval" : "daily",
                        })
                      }
                      className="ui-input max-w-[4.6rem] shrink-0 px-2 py-1 text-xs"
                    >
                      <option value="daily">每天</option>
                      <option value="interval">每隔</option>
                    </select>

                    <div className="flex min-w-0 shrink items-center gap-1">
                      {item.kind === "interval" ? (
                        <>
                          <input
                            type="number"
                            min={1}
                            max={24}
                            step={1}
                            aria-label="间隔小时"
                            value={item.every_hours ?? 6}
                            onChange={(e) =>
                              updateDraft(item.id, {
                                every_hours: clampEveryHours(Number(e.target.value)),
                              })
                            }
                            className="ui-input w-14 px-2 py-1 text-xs"
                          />
                          <span className="shrink-0 text-xs text-[var(--ink-muted)]">小时</span>
                        </>
                      ) : (
                        <input
                          type="time"
                          aria-label="每天时刻"
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
                          role="dialog"
                          className="absolute right-0 top-full z-30 mt-1 w-56 rounded-[var(--radius-control)] border border-[var(--rule)] bg-[var(--paper-raised)] p-2.5 shadow-md"
                        >
                          <p className="mb-2 text-xs text-[var(--ink-muted)]">选择要更新的分组</p>
                          <div className="max-h-44 space-y-1 overflow-y-auto">
                            {groupOptions.length === 0 ? (
                              <p className="text-xs text-[var(--ink-muted)]">暂无分组</p>
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
                                    <span className="shrink-0 text-[10px] text-[var(--ink-muted)]">
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
                              取消
                            </button>
                            <button
                              type="button"
                              onClick={() => confirmGroupsPop(item.id)}
                              className="ui-btn ui-btn-primary px-2 py-1 text-xs"
                            >
                              完成
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemoveSchedule(item.id)}
                      className="shrink-0 rounded border border-transparent px-2 py-0.5 text-xs text-[var(--ink-muted)] hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                    >
                      删除
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
                <span className="ml-2 text-[var(--ink-muted)]">保存中…</span>
              ) : saved && !isDirty ? (
                <span className="ml-2 text-[var(--success)]">已保存</span>
              ) : null}
            </p>
          ) : null}

          {(error || refreshError || resultMessage) && (
            <p
              className={`mt-3 text-sm ${
                error || refreshError ? "text-red-800" : "text-[var(--ink-muted)]"
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
