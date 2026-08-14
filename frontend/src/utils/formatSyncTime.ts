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
