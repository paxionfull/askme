import { useState } from "react";
import type { ScopedArticle } from "../contexts/ChatContext";
import { useLocale } from "../i18n/LocaleContext";
import { formatMessage } from "../i18n/messages";
import { IconChevron, IconClose } from "./icons/NavIcons";

interface ScopedArticlesBarProps {
  articles: ScopedArticle[];
  onRemove: (feedId: string, articleId: string) => void;
  onClear: () => void;
}

export default function ScopedArticlesBar({
  articles,
  onRemove,
  onClear,
}: ScopedArticlesBarProps) {
  const { t, locale } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const count = articles.length;
  if (count === 0) return null;

  const singleTitle = count === 1 ? articles[0].title || t("chatUnnamedArticle") : null;

  return (
    <div className="mx-auto mb-2 max-w-3xl">
      <div className="flex items-center gap-2 rounded-[var(--radius-panel)] border border-[color-mix(in_srgb,var(--accent)_30%,var(--rule))] bg-[var(--accent-soft)]/60 px-3 py-1.5">
        <span className="shrink-0 text-xs font-medium text-[var(--accent)]">
          {formatMessage(locale, "scopedBarLabel", { count })}
        </span>
        {singleTitle ? (
          <span className="min-w-0 flex-1 truncate text-xs text-[var(--accent)]" title={singleTitle}>
            {singleTitle}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="ui-btn ui-btn-ghost min-h-0 px-2 py-1 text-xs text-[var(--accent)]"
          >
            {expanded ? t("scopedBarCollapse") : t("scopedBarExpand")}
          </button>
        )}
        {count > 1 && (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="ui-icon-btn shrink-0 text-[var(--accent)]"
            aria-expanded={expanded}
            aria-label={expanded ? t("scopedBarCollapse") : t("scopedBarExpand")}
          >
            <IconChevron direction={expanded ? "up" : "down"} className="h-4 w-4" />
          </button>
        )}
        {count === 1 && (
          <button
            type="button"
            onClick={() => onRemove(articles[0].feed_id, articles[0].article_id)}
            className="ui-icon-btn shrink-0 text-[var(--accent)]"
            aria-label={t("scopedBarRemoveAria")}
          >
            <IconClose className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onClear}
          className="ui-btn ui-btn-ghost ml-auto shrink-0 min-h-0 px-2 py-1 text-xs"
        >
          {t("scopedBarClear")}
        </button>
      </div>
      {expanded && count > 1 && (
        <ul className="mt-1 max-h-32 overflow-y-auto rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)] text-xs">
          {articles.map((article) => (
            <li
              key={`${article.feed_id}:${article.article_id}`}
              className="flex items-center gap-2 border-b border-[var(--rule)] px-2.5 py-1.5 last:border-0"
            >
              <span className="min-w-0 flex-1 truncate text-[var(--ink)]" title={article.title}>
                {article.title || t("chatUnnamedArticle")}
              </span>
              <button
                type="button"
                onClick={() => onRemove(article.feed_id, article.article_id)}
                className="ui-icon-btn shrink-0 text-[var(--ink-muted)]"
                aria-label={t("scopedBarRemoveAria")}
              >
                <IconClose className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
