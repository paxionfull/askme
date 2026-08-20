import type { ReactNode } from "react";
import type { BriefInboxSelection } from "../../utils/digestInbox";
import { domainFromUrl } from "../../utils/digestInbox";
import SummaryMarkdown from "../SummaryMarkdown";
import type { ArticleRef } from "../SummaryMarkdown";
import { useLocale } from "../../i18n/LocaleContext";

type BriefSummaryPanelProps = {
  selection: BriefInboxSelection;
  displaySummary: string | null;
  articleRefs: ArticleRef[];
  onAddArticle?: (article: ArticleRef) => void;
  onAddArticles?: (articles: ArticleRef[]) => void;
  thinking?: string | null;
  generating?: boolean;
  emptyFallback?: ReactNode;
};

export default function BriefSummaryPanel({
  selection,
  displaySummary,
  articleRefs,
  onAddArticle,
  onAddArticles,
  thinking,
  generating,
  emptyFallback,
}: BriefSummaryPanelProps) {
  const { t } = useLocale();

  if (selection.kind === "article") {
    const { article, sectionName, eventTitle } = selection;
    const domain = domainFromUrl(article.url);
    return (
      <div className="brief-summary-article">
        <h3 className="brief-summary-article-title">
          {article.title?.trim() || article.article_id}
        </h3>
        {domain ? (
          <p className="brief-summary-meta-row">
            <span className="brief-summary-meta-label">{t("commonType")}</span>
            <span>{t("briefMetaArticle")}</span>
          </p>
        ) : null}
        {domain ? (
          <p className="brief-summary-meta-row">
            <span className="brief-summary-meta-label">{t("briefMetaDomain")}</span>
            <span>{domain}</span>
          </p>
        ) : null}
        {sectionName ? (
          <p className="brief-summary-meta-row">
            <span className="brief-summary-meta-label">{t("briefMetaSection")}</span>
            <span>{sectionName}</span>
          </p>
        ) : null}
        {eventTitle ? (
          <p className="brief-summary-meta-row">
            <span className="brief-summary-meta-label">{t("briefMetaTopic")}</span>
            <span>{eventTitle}</span>
          </p>
        ) : null}
        {article.url ? (
          <a
            href={article.url}
            target="_blank"
            rel="noreferrer"
            className="brief-summary-original ui-btn ui-btn-ghost mt-3"
          >
            {t("commonOriginal")}
          </a>
        ) : null}
        <p className="brief-summary-hint">{t("briefArticleAskHint")}</p>
      </div>
    );
  }

  if (displaySummary) {
    return (
      <div className="brief-summary-digest">
        {thinking && !generating ? (
          <details className="brief-summary-thinking">
            <summary>{t("briefThinking")}</summary>
            <p>{thinking}</p>
          </details>
        ) : null}
        <div className="summary-markdown-scroll">
          <SummaryMarkdown
            content={displaySummary}
            articleRefs={articleRefs}
            className="summary-markdown-readable"
            onAddArticle={onAddArticle}
            onAddArticles={onAddArticles}
          />
        </div>
        {generating ? (
          <span className="brief-summary-cursor" aria-hidden="true">
            ▍
          </span>
        ) : null}
      </div>
    );
  }

  return emptyFallback ?? <p className="brief-summary-empty">{t("briefSelectItem")}</p>;
}
