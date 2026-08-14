import type { Feed } from "../api";

export function isPlatformFeed(feed: Pick<Feed, "platform_account" | "id"> | null | undefined): boolean {
  if (!feed) return false;
  return Boolean(feed.platform_account);
}

export function platformLabel(platform?: string): string {
  const key = (platform || "").trim();
  return key || "平台";
}

export function deleteFeedMessage(feed: Feed): string {
  const name = feed.name || feed.id;
  if (isPlatformFeed(feed)) {
    const label = platformLabel(feed.platform);
    return (
      `确定删除「${name}」？\n\n` +
      `这是${label}平台账号，只会删除该账号登记，不会删除共享的${label}平台 skill，其它同平台账号不受影响。` +
      `之后可通过相同链接重新接入。`
    );
  }
  return (
    `确定删除「${name}」？\n\n` +
    `默认保留本地 discovery skill，之后可通过相同链接重新接入。`
  );
}

export function deleteFeedSuccessMessage(result: {
  skill_removed?: boolean;
  platform_account?: boolean;
}): string {
  if (result.platform_account) {
    return "已删除该账号（平台 skill 保留，其它账号不受影响）";
  }
  if (result.skill_removed) {
    return "已删除数据源并删除本地 skill";
  }
  return "已删除数据源（skill 已保留）";
}
