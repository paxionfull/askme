import type { Feed } from "../api";

const PLATFORM_LABELS: Record<string, string> = {
  weixin: "微信",
  zhihu: "知乎",
  xiaohongshu: "小红书",
  x: "X",
  reddit: "Reddit",
};

export function isPlatformFeed(feed: Pick<Feed, "platform_account" | "id"> | null | undefined): boolean {
  if (!feed) return false;
  if (feed.platform_account) return true;
  const id = feed.id || "";
  return (
    /:weixin:/.test(id) ||
    /^website:zhihu:/.test(id) ||
    /^website:xiaohongshu:/.test(id) ||
    /^website:x(?::|$)/.test(id) ||
    /^website:reddit(?::|$)/.test(id)
  );
}

export function platformLabel(platform?: string): string {
  const key = (platform || "").trim().toLowerCase();
  return PLATFORM_LABELS[key] || platform || "平台";
}

export function deleteFeedMessage(feed: Feed): string {
  const name = feed.name || feed.id;
  if (isPlatformFeed(feed)) {
    const label = platformLabel(feed.platform);
    return (
      `确定从列表移除「${name}」？\n\n` +
      `这是${label}平台账号，只会移除该账号登记，不会删除共享的${label}平台 skill，其它同平台账号不受影响。` +
      `之后可通过相同链接重新接入。`
    );
  }
  return (
    `确定从列表移除「${name}」？\n\n` +
    `默认仅隐藏数据源，本地 discovery skill 会保留，之后可通过相同链接重新接入。`
  );
}

export function deleteFeedSuccessMessage(result: {
  skill_removed?: boolean;
  platform_account?: boolean;
}): string {
  if (result.platform_account) {
    return "已从列表移除该账号（平台 skill 保留，其它账号不受影响）";
  }
  if (result.skill_removed) {
    return "已移除数据源并删除本地 skill";
  }
  return "已从列表移除数据源（skill 已保留）";
}
