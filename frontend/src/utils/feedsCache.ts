import type { Feed, FeedGroup } from "../api";

const FEEDS_CACHE_KEY = "askme.feeds.cache.v1";

export interface FeedsCacheSnapshot {
  feeds: Feed[];
  groups: FeedGroup[];
  groupOrder: string[];
  defaultDigestSkill: string;
  savedAt: number;
}

export function readFeedsCache(): FeedsCacheSnapshot | null {
  try {
    const raw = sessionStorage.getItem(FEEDS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FeedsCacheSnapshot>;
    if (!Array.isArray(parsed.feeds)) return null;
    return {
      feeds: parsed.feeds,
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      groupOrder: Array.isArray(parsed.groupOrder) ? parsed.groupOrder : [],
      defaultDigestSkill:
        typeof parsed.defaultDigestSkill === "string" ? parsed.defaultDigestSkill : "general-digest",
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0,
    };
  } catch {
    return null;
  }
}

export function writeFeedsCache(snapshot: Omit<FeedsCacheSnapshot, "savedAt">): void {
  try {
    const payload: FeedsCacheSnapshot = { ...snapshot, savedAt: Date.now() };
    sessionStorage.setItem(FEEDS_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota / private mode
  }
}

export function hydrateFeedsState(): FeedsCacheSnapshot | null {
  return readFeedsCache();
}
