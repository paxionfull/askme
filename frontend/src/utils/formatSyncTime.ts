/** 文章发布时间：相对为主，便于队列扫读 */
export function formatRelativePublished(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfThat = new Date(date);
  startOfThat.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((startOfToday.getTime() - startOfThat.getTime()) / 86400000);
  if (dayDiff === 1) return "昨天";
  if (dayDiff === 2) return "前天";
  if (dayDiff < 7) return `${dayDiff} 天前`;

  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** sync_time 为 Unix 秒；展示上次列表刷新时间 */
export function formatFeedSyncTime(syncTime?: number | null): string {
  if (!syncTime || syncTime <= 0) return "尚未更新";
  const date = new Date(syncTime * 1000);
  if (Number.isNaN(date.getTime())) return "尚未更新";
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (sameDay) return `上次更新 ${time}`;
  const day = date.toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  });
  return `上次更新 ${day} ${time}`;
}
