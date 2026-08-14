import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchFeedSchedulerConfig,
  updateFeedSchedulerConfig,
  type FeedSchedulerConfig,
  type ScheduleTime,
} from "../api";
import { useFeedRefresh } from "../contexts/FeedRefreshContext";
import { useDigest } from "../contexts/DigestContext";

interface ScheduleDraft extends ScheduleTime {
  id: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatScheduleLabel(schedule: ScheduleTime): string {
  return `${pad2(schedule.hour)}:${pad2(schedule.minute)}:${pad2(schedule.second)}`;
}

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

function schedulesEqual(a: ScheduleTime[], b: ScheduleTime[]): boolean {
  if (a.length !== b.length) return false;
  const sortKey = (item: ScheduleTime) =>
    `${item.hour}:${item.minute}:${item.second}`;
  const left = [...a].map(sortKey).sort();
  const right = [...b].map(sortKey).sort();
  return left.every((value, index) => value === right[index]);
}

function toDrafts(schedules: ScheduleTime[]): ScheduleDraft[] {
  return schedules.map((schedule, index) => ({
    ...schedule,
    id: `${schedule.hour}-${schedule.minute}-${schedule.second}-${index}`,
  }));
}

function clampTimePart(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.trunc(value)));
}

function parseDrafts(drafts: ScheduleDraft[]): ScheduleTime[] {
  return drafts.map((item) => ({
    hour: clampTimePart(item.hour, 23),
    minute: clampTimePart(item.minute, 59),
    second: clampTimePart(item.second, 59),
  }));
}

export default function FeedSchedulerSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const {
    refreshBusy,
    progress: liveProgress,
    statusMessage,
    resultMessage,
    error: refreshError,
    startRefreshAll,
  } = useFeedRefresh();
  const { days } = useDigest();

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
      const config = await fetchFeedSchedulerConfig();
      applyServerConfig(config);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载定时设置失败");
    } finally {
      setLoading(false);
    }
  }, [applyServerConfig]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

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

  function updateDraft(id: string, patch: Partial<ScheduleTime>) {
    setDrafts((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
    setSaved(false);
  }

  function handleAddSchedule() {
    setDrafts((current) => [
      ...current,
      {
        id: `new-${Date.now()}`,
        hour: 8,
        minute: 0,
        second: 0,
      },
    ]);
    setSaved(false);
  }

  function handleRemoveSchedule(id: string) {
    setDrafts((current) => current.filter((item) => item.id !== id));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const result = await updateFeedSchedulerConfig({
        schedules: draftSchedules,
      });
      applyServerConfig(result);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleRefreshAllNow() {
    setError("");
    setSaved(false);
    try {
      if (isDirty) {
        const savedConfig = await updateFeedSchedulerConfig({
          schedules: draftSchedules,
        });
        applyServerConfig(savedConfig);
      }
      await startRefreshAll(days);
      const latest = await fetchFeedSchedulerConfig();
      applyServerConfig(latest);
    } catch (err) {
      setError(err instanceof Error ? err.message : "立即更新失败");
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">订阅定时更新</h2>
          <p className="mt-1 text-xs text-slate-500">
            每天在指定时刻刷新各网站数据源文章列表。未添加定时则需手动在「数据源」刷新。
            配置保存在服务端 data/feed_scheduler.json，时区为 Asia/Shanghai。
          </p>
        </div>
        <button
          type="button"
          onClick={handleAddSchedule}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          添加定时
        </button>
        <button
          type="button"
          disabled={refreshBusy}
          onClick={() => void handleRefreshAllNow()}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {refreshBusy ? "更新中..." : "立即更新"}
        </button>
      </div>

      {showProgressBar && refreshProgress && (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
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
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-slate-900 transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-slate-500">加载中...</p>
      ) : (
        <>
          {drafts.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">暂无定时，点击「添加定时」创建。</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {drafts.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  <span className="text-slate-600">每天</span>
                  <label className="flex items-center gap-1 text-xs text-slate-500">
                    时
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={item.hour}
                      onChange={(e) =>
                        updateDraft(item.id, { hour: Number(e.target.value) })
                      }
                      className="w-14 rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
                    />
                  </label>
                  <span className="text-slate-400">:</span>
                  <label className="flex items-center gap-1 text-xs text-slate-500">
                    分
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={item.minute}
                      onChange={(e) =>
                        updateDraft(item.id, { minute: Number(e.target.value) })
                      }
                      className="w-14 rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
                    />
                  </label>
                  <span className="text-slate-400">:</span>
                  <label className="flex items-center gap-1 text-xs text-slate-500">
                    秒
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={item.second}
                      onChange={(e) =>
                        updateDraft(item.id, { second: Number(e.target.value) })
                      }
                      className="w-14 rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
                    />
                  </label>
                  <span className="ml-1 font-mono text-xs text-slate-500">
                    {formatScheduleLabel(item)}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveSchedule(item.id)}
                    className="ml-auto rounded border border-red-200 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50"
                  >
                    删除
                  </button>
                </li>
              ))}
            </ul>
          )}

          {status && status.next_runs && status.next_runs.length > 0 && (
            <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <div className="font-medium text-slate-700">下次执行</div>
              <ul className="mt-1 space-y-1">
                {status.next_runs.map((item) => (
                  <li key={`${item.hour}-${item.minute}-${item.second}`}>
                    {formatScheduleLabel(item)} → {formatNextRun(item.next_run)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {status && (
            <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <div>上次执行：{formatLastRun(status.last_run_at)}</div>
              {(status.last_feed_count ?? 0) > 0 && (
                <div>上次刷新订阅数：{status.last_feed_count}</div>
              )}
              {status.last_error && (
                <div className="mt-1 text-red-600">上次错误：{status.last_error}</div>
              )}
              {(status.last_refresh_failed?.length ?? 0) > 0 && (
                <div className="mt-1 whitespace-pre-wrap text-amber-700">
                  {[
                    `上次失败 ${status.last_refresh_failed!.length} 个：`,
                    ...status.last_refresh_failed!.map(
                      (item) => `· ${item.feed_name || item.feed_id}：${item.error || "未知错误"}`,
                    ),
                  ].join("\n")}
                </div>
              )}
            </div>
          )}

          {error && <p className="mt-3 whitespace-pre-wrap text-sm text-red-600">{error}</p>}
          {refreshError && (
            <p className="mt-3 whitespace-pre-wrap text-sm text-amber-800">{refreshError}</p>
          )}
          {statusMessage && <p className="mt-3 text-sm text-blue-700">{statusMessage}</p>}
          {resultMessage && !statusMessage && (
            <p className="mt-3 text-sm text-green-700">{resultMessage}</p>
          )}
          {saved && !isDirty && <p className="mt-3 text-sm text-green-700">定时设置已保存</p>}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              disabled={saving || !isDirty}
              onClick={() => void handleSave()}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
