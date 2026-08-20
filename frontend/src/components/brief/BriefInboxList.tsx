import type { BriefInboxRow, BriefInboxSelection } from "../../utils/digestInbox";
import { domainFromUrl, selectionId, selectionMatchesRow } from "../../utils/digestInbox";
import { useLocale } from "../../i18n/LocaleContext";
import { formatMessage } from "../../i18n/messages";

type BriefInboxListProps = {
  rows: BriefInboxRow[];
  selection: BriefInboxSelection;
  onSelect: (selection: BriefInboxSelection) => void;
  showDailyBrief: boolean;
};

export default function BriefInboxList({
  rows,
  selection,
  onSelect,
  showDailyBrief,
}: BriefInboxListProps) {
  const { t, locale } = useLocale();
  const count = rows.length + (showDailyBrief ? 1 : 0);
  const dailySelected = selection.kind === "brief";

  return (
    <div className="brief-inbox flex min-h-0 flex-1 flex-col">
      <div className="brief-inbox-head">
        <div className="brief-inbox-tabs" role="tablist" aria-label={t("briefInboxLabel")}>
          <span className="brief-inbox-tab is-active" role="tab" aria-selected="true">
            {t("briefInboxUpdates")}
          </span>
        </div>
        <span className="brief-inbox-count">{formatMessage(locale, "briefInboxCount", { count })}</span>
      </div>

      <ul className="brief-inbox-list" role="listbox" aria-label={t("briefInboxLabel")}>
        {showDailyBrief ? (
          <li role="presentation">
            <button
              type="button"
              role="option"
              aria-selected={dailySelected}
              className={`brief-inbox-row${dailySelected ? " is-selected" : ""}`}
              onClick={() => onSelect({ kind: "brief" })}
            >
              <span className="brief-inbox-row-icon" aria-hidden="true">
                ◆
              </span>
              <span className="brief-inbox-row-body">
                <span className="brief-inbox-row-title">{t("briefInboxDaily")}</span>
                <span className="brief-inbox-row-meta">{t("briefInboxDailyHint")}</span>
              </span>
            </button>
          </li>
        ) : null}

        {rows.map((row) => {
          const selected = selectionMatchesRow(selection, row);
          const domain = domainFromUrl(row.article.url) ?? row.article.feed_id;
          const snippet = row.eventTitle || row.sectionName;
          return (
            <li key={row.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={selected}
                className={`brief-inbox-row${selected ? " is-selected" : ""}${row.isHighlight ? " is-highlight" : ""}`}
                onClick={() =>
                  onSelect({
                    kind: "article",
                    article: row.article,
                    sectionName: row.sectionName,
                    eventTitle: row.eventTitle,
                  })
                }
              >
                <span className="brief-inbox-row-icon" aria-hidden="true">
                  {row.isHighlight ? "★" : "▫"}
                </span>
                <span className="brief-inbox-row-body">
                  <span className="brief-inbox-row-title">
                    {row.article.title?.trim() || row.article.article_id}
                  </span>
                  {snippet ? (
                    <span className="brief-inbox-row-snippet">{snippet}</span>
                  ) : null}
                  <span className="brief-inbox-row-meta">{domain}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {rows.length === 0 && !showDailyBrief ? (
        <p className="brief-inbox-empty">{t("briefInboxEmpty")}</p>
      ) : null}
    </div>
  );
}

export { selectionId };
