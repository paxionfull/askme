import type { ScheduleTime } from "../api";

export const SCHEDULES_UPDATED_EVENT = "askme:schedules-updated";

export interface ScheduleDraft extends ScheduleTime {
  id: string;
}

export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatScheduleSummary(schedule: ScheduleTime): string {
  if (schedule.kind === "interval") {
    return `每隔 ${schedule.every_hours ?? 6} 小时（自 0:00）`;
  }
  return `每天 ${pad2(schedule.hour)}:${pad2(schedule.minute)}`;
}

function clampTimePart(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.trunc(value)));
}

export function clampEveryHours(value: number): number {
  if (!Number.isFinite(value)) return 6;
  return Math.min(24, Math.max(1, Math.trunc(value)));
}

export function normalizeSchedule(item: ScheduleTime): ScheduleTime {
  const kind = item.kind === "interval" ? "interval" : "daily";
  const groupIds = Array.from(
    new Set((item.group_ids ?? []).map((id) => id.trim()).filter(Boolean)),
  );
  if (kind === "interval") {
    return {
      kind: "interval",
      hour: 0,
      minute: 0,
      second: 0,
      every_hours: clampEveryHours(item.every_hours ?? 6),
      group_ids: groupIds,
    };
  }
  return {
    kind: "daily",
    hour: clampTimePart(item.hour, 23),
    minute: clampTimePart(item.minute, 59),
    second: clampTimePart(item.second ?? 0, 59),
    every_hours: clampEveryHours(item.every_hours ?? 6),
    group_ids: groupIds,
  };
}

function scheduleKey(item: ScheduleTime): string {
  const n = normalizeSchedule(item);
  return [n.kind, n.hour, n.minute, n.second, n.every_hours, ...(n.group_ids ?? [])].join("|");
}

export function schedulesEqual(a: ScheduleTime[], b: ScheduleTime[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].map(scheduleKey).sort();
  const right = [...b].map(scheduleKey).sort();
  return left.every((value, index) => value === right[index]);
}

export function toDrafts(schedules: ScheduleTime[]): ScheduleDraft[] {
  return schedules.map((schedule, index) => ({
    ...normalizeSchedule(schedule),
    id: `sch-${index}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  }));
}

export function parseDrafts(drafts: ScheduleDraft[]): ScheduleTime[] {
  return drafts.map((item) => normalizeSchedule(item));
}

export function timeValue(hour: number, minute: number): string {
  return `${pad2(clampTimePart(hour, 23))}:${pad2(clampTimePart(minute, 59))}`;
}

export function validateSchedules(schedules: ScheduleTime[]): string | null {
  const bad = schedules.filter((item) => !(item.group_ids ?? []).length);
  if (bad.length > 0) return "每条定时都必须至少选择一个分组";
  return null;
}

export function removeGroupFromSchedules(
  schedules: ScheduleDraft[],
  scheduleId: string,
  groupId: string,
): ScheduleDraft[] {
  return schedules
    .map((item) => {
      if (item.id !== scheduleId) return item;
      return {
        ...item,
        group_ids: (item.group_ids ?? []).filter((id) => id !== groupId),
      };
    })
    .filter((item) => (item.group_ids ?? []).length > 0);
}

export function notifySchedulesUpdated(schedules: ScheduleTime[]) {
  window.dispatchEvent(
    new CustomEvent(SCHEDULES_UPDATED_EVENT, {
      detail: { schedules },
    }),
  );
}
