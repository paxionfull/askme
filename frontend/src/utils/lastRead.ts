const LAST_READ_KEY = "askme.lastReadByFeed";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type LastReadMap = Record<string, { articleId: string; at: number }>;

function readMap(): LastReadMap {
  try {
    const raw = localStorage.getItem(LAST_READ_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as LastReadMap;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeMap(map: LastReadMap) {
  try {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify(map));
  } catch {
    // ignore quota / private mode
  }
}

/** 记录某源最近阅读的文章（点标题或原文） */
export function markFeedArticleRead(feedId: string, articleId: string) {
  if (!feedId || !articleId) return;
  const map = readMap();
  map[feedId] = { articleId, at: Date.now() };
  writeMap(map);
}

/** 读取某源最近阅读文章 id；超过 7 天视为过期 */
export function getFeedLastReadArticleId(feedId: string | null): string | null {
  if (!feedId) return null;
  const entry = readMap()[feedId];
  if (!entry?.articleId) return null;
  if (Date.now() - entry.at > MAX_AGE_MS) return null;
  return entry.articleId;
}
