import type { Locale } from "../i18n/locale";
import { formatMessage } from "../i18n/messages";

function dateLocale(locale: Locale): string {
  return locale === "zh" ? "zh-CN" : "en-US";
}

/** 文章发布时间：相对为主，便于队列扫读 */
export function formatRelativePublished(value: string, locale: Locale = "en"): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return formatMessage(locale, "timeJustNow", {});
  if (diffMin < 60) return formatMessage(locale, "timeMinutesAgo", { count: diffMin });
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return formatMessage(locale, "timeHoursAgo", { count: diffHour });

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfThat = new Date(date);
  startOfThat.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((startOfToday.getTime() - startOfThat.getTime()) / 86400000);
  if (dayDiff === 1) return formatMessage(locale, "timeYesterday", {});
  if (dayDiff === 2) return formatMessage(locale, "timeDayBeforeYesterday", {});
  if (dayDiff < 7) return formatMessage(locale, "timeDaysAgo", { count: dayDiff });

  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(dateLocale(locale), {
    month: "numeric",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** sync_time 为 Unix 秒；展示上次列表刷新时间 */
export function formatFeedSyncTime(syncTime: number | null | undefined, locale: Locale = "en"): string {
  if (!syncTime || syncTime <= 0) return formatMessage(locale, "commonNeverSynced", {});
  const date = new Date(syncTime * 1000);
  if (Number.isNaN(date.getTime())) return formatMessage(locale, "commonNeverSynced", {});
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = date.toLocaleTimeString(dateLocale(locale), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (sameDay) return formatMessage(locale, "timeLastSyncToday", { time });
  const day = date.toLocaleDateString(dateLocale(locale), {
    month: "numeric",
    day: "numeric",
  });
  return formatMessage(locale, "timeLastSync", { day, time });
}
