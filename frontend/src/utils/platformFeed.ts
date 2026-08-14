import type { Feed } from "../api";
import type { Locale } from "../i18n/locale";
import { formatMessage } from "../i18n/messages";

export function isPlatformFeed(feed: Pick<Feed, "platform_account" | "id"> | null | undefined): boolean {
  if (!feed) return false;
  return Boolean(feed.platform_account);
}

export function platformLabel(locale: Locale, platform?: string): string {
  const key = (platform || "").trim();
  return key || formatMessage(locale, "platformDefault", {});
}

export function deleteFeedMessage(locale: Locale, feed: Feed): string {
  const name = feed.name || feed.id;
  if (isPlatformFeed(feed)) {
    const platform = platformLabel(locale, feed.platform);
    return formatMessage(locale, "deleteFeedPlatformMsg", { name, platform });
  }
  return formatMessage(locale, "deleteFeedDefaultMsg", { name });
}

export function deleteFeedSuccessMessage(
  locale: Locale,
  result: {
    skill_removed?: boolean;
    platform_account?: boolean;
  },
): string {
  if (result.platform_account) {
    return formatMessage(locale, "deleteFeedSuccessPlatform", {});
  }
  if (result.skill_removed) {
    return formatMessage(locale, "deleteFeedSuccessWithSkill", {});
  }
  return formatMessage(locale, "deleteFeedSuccessKeepSkill", {});
}

export function clearUngroupedMessage(locale: Locale, count: number): string {
  return formatMessage(locale, "clearUngroupedMsg", { count });
}

export function deleteGroupMessage(
  locale: Locale,
  name: string,
  feedCount: number,
): string {
  if (feedCount === 0) {
    return formatMessage(locale, "deleteGroupEmptyMsg", { name });
  }
  return formatMessage(locale, "deleteGroupWithFeedsMsg", { name, count: feedCount });
}
