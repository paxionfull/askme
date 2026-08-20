import type { Locale } from "../i18n/locale";
import type { BriefHistoryItem } from "../api";

export function briefTitleFromSummary(summary: string, fallback: string): string {
  for (const line of summary.split("\n")) {
    let text = line.trim();
    if (!text) continue;
    while (text.startsWith("#")) {
      text = text.replace(/^#+\s*/, "").trim();
    }
    if (text) {
      return text.length > 100 ? `${text.slice(0, 97)}…` : text;
    }
  }
  return fallback;
}

export function briefExcerptFromSummary(summary: string, maxLen = 480): string {
  const trimmed = summary.trim();
  if (!trimmed) return "";
  const withoutHeadings = trimmed.replace(/^#+\s.*$/gm, "").trim();
  const firstBlock = withoutHeadings.split(/\n{2,}/)[0]?.trim() || withoutHeadings;
  if (firstBlock.length <= maxLen) return firstBlock;
  return `${firstBlock.slice(0, maxLen - 1).trim()}…`;
}

export function historyItemKey(item: Pick<BriefHistoryItem, "cache_key">): string {
  return item.cache_key;
}

export function historyScopeMatches(
  item: BriefHistoryItem,
  days: number,
  groupIds: string[],
): boolean {
  if (item.days !== days) return false;
  const a = [...(item.group_ids ?? [])].sort().join(",");
  const b = [...groupIds].sort().join(",");
  return a === b;
}

/** Batch size for scroll-loading the history rail (not paged UI). */
export const BRIEF_HISTORY_PAGE_SIZE = 30;

function dateLocale(locale: Locale): string {
  return locale === "zh" ? "zh-CN" : "en-US";
}

/** Stable display ref like #1287 for list + stage meta. */
export function briefRefId(cacheKey: string): string {
  let hash = 0;
  for (let i = 0; i < cacheKey.length; i += 1) {
    hash = (hash * 31 + cacheKey.charCodeAt(i)) >>> 0;
  }
  return `#${(hash % 9000) + 1000}`;
}

export function formatBriefListDate(ts: number, locale: Locale = "en"): string {
  const date = new Date(ts * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(dateLocale(locale), {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Design splits the list date onto two lines: "May 18" over "2025". */
export function formatBriefListDateParts(
  ts: number,
  locale: Locale = "en",
): { day: string; year: string } {
  const date = new Date(ts * 1000);
  if (Number.isNaN(date.getTime())) return { day: "", year: "" };
  return {
    day: date.toLocaleDateString(dateLocale(locale), { month: "short", day: "numeric" }),
    year: String(date.getFullYear()),
  };
}

export function formatBriefListTime(ts: number, locale: Locale = "en"): string {
  const date = new Date(ts * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(dateLocale(locale), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Page tokens shaped like the design's "‹ 1 2 3 … 19 ›" control. */
export function briefHistoryPageTokens(
  page: number,
  pageCount: number,
): Array<number | "gap"> {
  const wanted = new Set<number>([1, 2, 3, pageCount, page, page + 1, page + 2]);
  const pages = [...wanted].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);
  const tokens: Array<number | "gap"> = [];
  let previous = 0;
  for (const value of pages) {
    if (previous && value - previous > 1) tokens.push("gap");
    tokens.push(value);
    previous = value;
  }
  return tokens;
}

export function briefHistoryDetailLine(
  item: Pick<BriefHistoryItem, "source_count" | "updated_at" | "cache_key">,
  locale: Locale,
  sourcesLabel: string,
): string {
  const time = formatBriefListTime(item.updated_at, locale);
  const id = briefRefId(item.cache_key);
  const sourcePart = `${item.source_count} ${sourcesLabel}`;
  return [sourcePart, time, id].filter(Boolean).join(" · ");
}
