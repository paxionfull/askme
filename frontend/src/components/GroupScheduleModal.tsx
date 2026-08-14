import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchFeedSchedulerConfig,
  updateFeedSchedulerConfig,
  type ScheduleTime,
} from "../api";
import {
  clampEveryHours,
  notifySchedulesUpdated,
  parseDrafts,
  removeGroupFromSchedules,
  timeValue,
  toDrafts,
  validateSchedules,
  type ScheduleDraft,
} from "../utils/feedScheduler";

interface GroupScheduleModalProps {
  open: boolean;
  groupId: string | null;
  groupName: string;
  onClose: () => void;
  onSaved?: (schedules: ScheduleTime[]) => void;
}

export default function GroupScheduleModal({
  open,
  groupId,
  groupName,
  onClose,
  onSaved,
}: GroupScheduleModalProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<ScheduleDraft[]>([]);

  const loadDrafts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const config = await fetchFeedSchedulerConfig();
      setDrafts(toDrafts(config.schedules ?? []));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载定时失败");
      setDrafts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !groupId) return;
    void loadDrafts();
  }, [open, groupId, loadDrafts]);

  const visibleDrafts = useMemo(() => {
    if (!groupId) return [];
    return drafts.filter((item) => (item.group_ids ?? []).includes(groupId));
  }, [drafts, groupId]);

  function updateDraft(id: string, patch: Partial<ScheduleTime>) {
    setDrafts((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function handleAddSchedule() {
    if (!groupId) return;
    setDrafts((current) => [
      ...current,
      {
        id: `new-${Date.now()}`,
        kind: "daily",
        hour: 9,
        minute: 0,
        second: 0,
        every_hours: 6,
        group_ids: [groupId],
      },
    ]);
  }

  function handleRemoveFromGroup(scheduleId: string) {
    if (!groupId) return;
    setDrafts((current) => removeGroupFromSchedules(current, scheduleId, groupId));
  }

  async function handleSave() {
    if (!groupId) return;
    const parsed = parseDrafts(drafts);
    const validationError = validateSchedules(parsed);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await updateFeedSchedulerConfig({ schedules: parsed });
      const saved = result.schedules ?? [];
      notifySchedulesUpdated(saved);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (!open || !groupId) return null;

  return (
    <div
      className="ui-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="group-schedule-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="ui-modal ui-modal-md">
        <div className="ui-modal-header">
          <h2 id="group-schedule-title" className="ui-modal-title">
            设置定时 · {groupName}
          </h2>
          <p className="ui-modal-desc">
            仅编辑本组已加入的定时；不展示同一条定时里的其他分组。修改时刻/间隔会作用于整条定时，「删除」仅将本组从该定时移除。
          </p>
          <div className="mt-3 flex justify-end">
            <button type="button" onClick={handleAddSchedule} className="ui-btn text-xs">
              添加定时
            </button>
          </div>
        </div>

        <div className="ui-modal-body">
          {loading ? (
            <p className="text-sm text-[var(--ink-muted)]">加载中…</p>
          ) : visibleDrafts.length === 0 ? (
            <p className="text-sm text-[var(--ink-muted)]">
              本组尚未加入任何定时，点上方「添加定时」。
            </p>
          ) : (
            <ul className="space-y-2">
              {visibleDrafts.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-nowrap items-center gap-2 rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--accent)_35%,var(--rule))] bg-[color-mix(in_srgb,var(--accent-soft)_45%,var(--paper-raised))] px-2.5 py-2 text-sm"
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

                  <button
                    type="button"
                    onClick={() => handleRemoveFromGroup(item.id)}
                    className="ml-auto shrink-0 rounded border border-transparent px-2 py-0.5 text-xs text-[var(--ink-muted)] hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                  >
                    删除
                  </button>
                </li>
              ))}
            </ul>
          )}

          {error ? <p className="mt-3 text-sm text-red-800">{error}</p> : null}
        </div>

        <div className="ui-modal-footer">
          <button type="button" disabled={saving} onClick={onClose} className="ui-btn text-sm">
            取消
          </button>
          <button
            type="button"
            disabled={saving || loading}
            onClick={() => void handleSave()}
            className="ui-btn ui-btn-primary text-sm disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
