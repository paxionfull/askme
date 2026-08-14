import { buildSections } from "./feedLayout";
import type { Feed, FeedGroup } from "../api";

const SELECTED_FEED_KEY = "askme.selectedFeedId";

export function getStoredSelectedFeedId(): string | null {
  try {
    const value = localStorage.getItem(SELECTED_FEED_KEY);
    return value?.trim() || null;
  } catch {
    return null;
  }
}

export function setStoredSelectedFeedId(feedId: string | null) {
  try {
    if (!feedId) {
      localStorage.removeItem(SELECTED_FEED_KEY);
      return;
    }
    localStorage.setItem(SELECTED_FEED_KEY, feedId);
  } catch {
    // ignore
  }
}

/** 优先上次选中；否则分组顺序里第一个非空组的第一个源；再不选 */
export function resolveDefaultFeedId(
  feeds: Feed[],
  groups: FeedGroup[],
  groupOrder: string[],
  preferredId?: string | null,
): string | null {
  const ids = new Set(feeds.map((feed) => feed.id));
  if (preferredId && ids.has(preferredId)) return preferredId;

  const stored = getStoredSelectedFeedId();
  if (stored && ids.has(stored)) return stored;

  const sections = buildSections(feeds, groups, groupOrder);
  for (const section of sections) {
    if (section.feeds.length > 0) {
      return section.feeds[0].id;
    }
  }
  return feeds[0]?.id ?? null;
}
