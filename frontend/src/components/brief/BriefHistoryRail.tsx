import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBriefHistory, type BriefHistoryItem } from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import {
  BRIEF_HISTORY_PAGE_SIZE,
  briefHistoryDetailLine,
  formatBriefListDateParts,
  historyItemKey,
} from "../../utils/briefHistory";

type BriefHistoryRailProps = {
  selectedKey: string | null;
  onSelect: (item: BriefHistoryItem) => void;
  refreshToken?: number;
  className?: string;
};

export default function BriefHistoryRail({
  selectedKey,
  onSelect,
  refreshToken = 0,
  className = "",
}: BriefHistoryRailProps) {
  const { t, locale } = useLocale();
  const [items, setItems] = useState<BriefHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLLIElement | null>(null);
  const loadingMoreRef = useRef(false);

  const hasMore = items.length < total;

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    setOffset(0);
    try {
      const data = await fetchBriefHistory(BRIEF_HISTORY_PAGE_SIZE, 0);
      setItems(data.items);
      setTotal(data.total);
      setOffset(data.items.length);
    } catch (err) {
      setItems([]);
      setTotal(0);
      setOffset(0);
      setError(err instanceof Error ? err.message : t("briefHistoryLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || loading) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const data = await fetchBriefHistory(BRIEF_HISTORY_PAGE_SIZE, offset);
      setItems((prev) => {
        const seen = new Set(prev.map(historyItemKey));
        const next = data.items.filter((item) => !seen.has(historyItemKey(item)));
        return next.length ? [...prev, ...next] : prev;
      });
      setTotal(data.total);
      setOffset((value) => value + data.items.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("briefHistoryLoadFailed"));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMore, loading, offset, t]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial, refreshToken]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || loading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMore();
        }
      },
      { root: node.closest(".brief-history-list"), rootMargin: "80px", threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, loadMore, items.length]);

  const sourcesWord = t("briefHistoryColSources").toLowerCase();

  return (
    <aside className={`brief-history-rail ${className}`.trim()} aria-label={t("briefHistoryTitle")}>
      <div className="brief-history-head">
        <h2 className="brief-history-title">{t("briefHistoryTitle")}</h2>
      </div>

      <div className="brief-history-cols" aria-hidden="true">
        <span className="brief-history-cols-date">{t("briefHistoryColDate")}</span>
        <span className="brief-history-cols-articles">{t("briefHistoryColArticles")}</span>
        <span className="brief-history-cols-sources">{t("briefHistoryColSources")}</span>
      </div>

      {loading ? (
        <p className="brief-history-status" aria-busy="true">
          {t("loading")}
        </p>
      ) : error && items.length === 0 ? (
        <p className="brief-history-status brief-history-status-error" role="alert">
          {error}
        </p>
      ) : items.length === 0 ? (
        <p className="brief-history-status">{t("briefHistoryEmpty")}</p>
      ) : (
        <ul className="brief-history-list" role="listbox" aria-label={t("briefHistoryTitle")}>
          {items.map((item) => {
            const key = historyItemKey(item);
            const selected = selectedKey === key;
            const date = formatBriefListDateParts(item.updated_at, locale);
            return (
              <li key={key} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`brief-history-row${selected ? " is-selected" : ""}`}
                  onClick={() => onSelect(item)}
                >
                  <span className="brief-history-dot" aria-hidden="true" />
                  <span className="brief-history-row-date">
                    {date.day}
                    <br />
                    {date.year}
                  </span>
                  <span className="brief-history-row-title">{item.title}</span>
                  <span className="brief-history-row-count">{item.article_count}</span>
                  <span className="brief-history-row-detail">
                    {briefHistoryDetailLine(item, locale, sourcesWord)}
                  </span>
                </button>
              </li>
            );
          })}
          {hasMore ? (
            <li ref={sentinelRef} className="brief-history-sentinel" aria-hidden="true">
              {loadingMore ? t("loading") : null}
            </li>
          ) : null}
        </ul>
      )}
    </aside>
  );
}
