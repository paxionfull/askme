import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type {
  DigestTree,
  DigestTreeArticle,
  DigestTreeEvent,
  DigestTreePartition,
  DigestTreeSection,
} from "../api";
import {
  writeArticleDragData,
  writeArticleGroupDragData,
  type ArticleRef,
} from "./SummaryMarkdown";
import { useLocale } from "../i18n/LocaleContext";
import { formatMessage } from "../i18n/messages";

export type { DigestTree, DigestTreeArticle, DigestTreeEvent, DigestTreePartition, DigestTreeSection };

function articleDedupeKey(article: DigestTreeArticle): string {
  const url = article.url?.trim();
  if (url) return `u:${url}`;
  return `id:${article.feed_id}:${article.article_id}`;
}

function dedupeArticles(articles: DigestTreeArticle[]): DigestTreeArticle[] {
  const seen = new Set<string>();
  const out: DigestTreeArticle[] = [];
  for (const article of articles) {
    const key = articleDedupeKey(article);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(article);
  }
  return out;
}

function normalizeTitleKey(title: string | undefined, fallback: string): string {
  return (title || fallback).trim().replace(/\s+/g, " ").toLowerCase();
}

function groupArticlesByTitle(
  articles: DigestTreeArticle[],
): Array<{ title: string; articles: DigestTreeArticle[] }> {
  const unique = dedupeArticles(articles);
  const map = new Map<string, DigestTreeArticle[]>();
  const order: string[] = [];
  for (const article of unique) {
    const key = normalizeTitleKey(article.title, article.article_id);
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(article);
  }
  return order.map((key) => {
    const group = map.get(key)!;
    return {
      title: (group[0].title || group[0].article_id).trim() || group[0].article_id,
      articles: group,
    };
  });
}

function sectionArticleCount(section: DigestTreeSection): number {
  return dedupeArticles(section.events.flatMap((event) => event.articles)).length;
}

function toArticleRef(article: DigestTreeArticle): ArticleRef {
  return {
    feed_id: article.feed_id,
    article_id: article.article_id,
    title: article.title,
    url: article.url,
  };
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  const { t } = useLocale();
  return (
    <button
      type="button"
      title={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      className="digest-add-btn ui-chip-btn ml-1.5 shrink-0 border border-transparent bg-transparent font-medium text-[var(--accent)] opacity-0 pointer-events-none transition-opacity group-hover/item:opacity-100 group-hover/item:pointer-events-auto group-focus-within/item:opacity-100 group-focus-within/item:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--rule))] hover:bg-[var(--accent-soft)] focus-visible:border-[color-mix(in_srgb,var(--accent)_35%,var(--rule))] focus-visible:bg-[var(--accent-soft)] [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto"
    >
      {t("digestAddToChat")}
    </button>
  );
}

function ArticleRow({
  article,
  onAddArticle,
}: {
  article: DigestTreeArticle;
  onAddArticle?: (article: ArticleRef) => void;
}) {
  const { t } = useLocale();
  const ref = toArticleRef(article);
  const title = article.title || article.article_id;
  return (
    <li className="group/item flex items-start gap-1 py-0.5 text-[0.875rem] font-normal leading-[1.45] text-[var(--ink)]">
      <span
        draggable
        title={t("digestDragHint")}
        className="min-w-0 flex-1 cursor-grab rounded-[var(--radius-control)] px-1 py-0.5 transition-colors hover:bg-[var(--accent-soft)] active:cursor-grabbing"
        onDragStart={(event) => writeArticleDragData(event.dataTransfer, ref)}
      >
        {article.url ? (
          <a
            href={article.url}
            target="_blank"
            rel="noreferrer"
            className="digest-article-title"
            onClick={(event) => event.stopPropagation()}
          >
            {title}
          </a>
        ) : (
          <span className="digest-article-title">{title}</span>
        )}
      </span>
      {onAddArticle ? (
        <AddButton label={t("digestAddToChat")} onClick={() => onAddArticle(ref)} />
      ) : null}
    </li>
  );
}

function TitleClusterRow({
  title,
  articles,
  onAddArticle,
  onAddArticles,
}: {
  title: string;
  articles: DigestTreeArticle[];
  onAddArticle?: (article: ArticleRef) => void;
  onAddArticles?: (articles: ArticleRef[]) => void;
}) {
  const { locale } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const refs = articles.map(toArticleRef);

  if (articles.length === 1) {
    return <ArticleRow article={articles[0]} onAddArticle={onAddArticle} />;
  }

  return (
    <li className="py-0.5">
      <div className="group/item flex items-start gap-1 text-[0.875rem] leading-[1.45] text-[var(--ink)]">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <span
              draggable
              title={formatMessage(locale, "digestDragAddCount", { count: refs.length })}
              className="digest-event-title cursor-grab rounded-[var(--radius-control)] px-1 py-0.5 hover:bg-[var(--accent-soft)] active:cursor-grabbing"
              onDragStart={(event) =>
                writeArticleGroupDragData(event.dataTransfer, { label: title, articles: refs })
              }
            >
              {title}
            </span>
            <button
              type="button"
              className="digest-meta-count text-[var(--accent)] hover:underline"
              aria-expanded={expanded}
              onClick={() => setExpanded((open) => !open)}
            >
              {formatMessage(locale, "digestSourcesCount", { count: articles.length })}
            </button>
          </div>
          {expanded ? (
            <ul className="mt-1 space-y-0.5 border-l border-[var(--rule)] pl-2.5">
              {articles.map((article, index) => (
                <li key={`${article.feed_id}:${article.article_id}:${article.url || ""}`}>
                  {article.url ? (
                    <a
                      href={article.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[0.75rem] text-[var(--ink-muted)] hover:text-[var(--ink)] hover:underline"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {formatMessage(locale, "digestSourceN", { n: index + 1 })}
                    </a>
                  ) : (
                    <span className="text-[0.75rem] text-[var(--ink-muted)]">
                      {formatMessage(locale, "digestSourceN", { n: index + 1 })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {onAddArticles ? (
          <AddButton
            label={formatMessage(locale, "digestAddArticlesToChat", { count: refs.length })}
            onClick={() => onAddArticles(refs)}
          />
        ) : null}
      </div>
    </li>
  );
}

function EventBlock({
  event,
  onAddArticle,
  onAddArticles,
}: {
  event: DigestTreeEvent;
  onAddArticle?: (article: ArticleRef) => void;
  onAddArticles?: (articles: ArticleRef[]) => void;
}) {
  const { t, locale } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const clusters = groupArticlesByTitle(event.articles);
  const refs = clusters.flatMap((cluster) => cluster.articles.map(toArticleRef));
  if (refs.length === 0) return null;

  if (clusters.length === 1 && clusters[0].articles.length === 1) {
    return <ArticleRow article={clusters[0].articles[0]} onAddArticle={onAddArticle} />;
  }

  if (clusters.length === 1) {
    return (
      <TitleClusterRow
        title={clusters[0].title}
        articles={clusters[0].articles}
        onAddArticle={onAddArticle}
        onAddArticles={onAddArticles}
      />
    );
  }

  const fallbackLabel = t("digestRelatedReport");
  const label = (event.title || fallbackLabel).trim() || fallbackLabel;
  return (
    <li className="py-0.5">
      <div className="group/item flex items-baseline gap-1.5">
        <span
          draggable
          title={formatMessage(locale, "digestDragAddCount", { count: refs.length })}
          className="digest-event-title min-w-0 cursor-grab rounded-[var(--radius-control)] px-1 py-0.5 hover:bg-[var(--accent-soft)] active:cursor-grabbing"
          onDragStart={(eventObj) =>
            writeArticleGroupDragData(eventObj.dataTransfer, { label, articles: refs })
          }
        >
          {label}
        </span>
        <button
          type="button"
          className="digest-meta-count shrink-0 text-[var(--accent)] hover:underline"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          {formatMessage(locale, "digestArticlesCount", { count: refs.length })}
        </button>
        {onAddArticles ? (
          <AddButton
            label={formatMessage(locale, "digestAddArticlesToChat", { count: refs.length })}
            onClick={() => onAddArticles(refs)}
          />
        ) : null}
      </div>
      {expanded ? (
        <ul className="mt-1 space-y-0 border-l border-[var(--rule)] pl-2.5">
          {clusters.map((cluster) => (
            <TitleClusterRow
              key={normalizeTitleKey(cluster.title, cluster.articles[0]?.article_id || "x")}
              title={cluster.title}
              articles={cluster.articles}
              onAddArticle={onAddArticle}
              onAddArticles={onAddArticles}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function SectionBlock({
  section,
  collapsed,
  onToggle,
  onAddArticle,
  onAddArticles,
  sectionRef,
}: {
  section: DigestTreeSection;
  collapsed: boolean;
  onToggle: () => void;
  onAddArticle?: (article: ArticleRef) => void;
  onAddArticles?: (articles: ArticleRef[]) => void;
  sectionRef?: (node: HTMLElement | null) => void;
}) {
  const { t, locale } = useLocale();
  const multiEvents: DigestTreeEvent[] = [];
  const singleArticles: DigestTreeArticle[] = [];
  for (const event of section.events) {
    const unique = dedupeArticles(event.articles);
    if (unique.length > 1) {
      multiEvents.push({ ...event, articles: unique });
    } else if (unique.length === 1) {
      singleArticles.push(unique[0]);
    }
  }
  const titleClusters = groupArticlesByTitle(singleArticles);
  const uniqueArticles = dedupeArticles([
    ...singleArticles,
    ...multiEvents.flatMap((event) => event.articles),
  ]);
  const count = uniqueArticles.length;
  const isFocus = section.kind === "focus";
  const isEmpty = count === 0;
  const sectionRefs = uniqueArticles.map(toArticleRef);
  const hasBody = multiEvents.length > 0 || titleClusters.length > 0;

  return (
    <section
      ref={sectionRef}
      className={`digest-section transition-[background,border-color,box-shadow] duration-150 ${
        isFocus ? "is-focus" : ""
      } ${isEmpty ? "is-empty" : ""}`}
    >
      <div className="digest-section-head group/item">
        <button type="button" onClick={onToggle} className="digest-section-title min-w-0 flex-1 text-left">
          <span
            className={`mr-1.5 inline-block w-3 text-[0.8125rem] font-semibold ${
              isFocus ? "text-[var(--accent)]" : "text-[var(--ink-muted)]"
            }`}
            aria-hidden="true"
          >
            {collapsed ? "▸" : "▾"}
          </span>
          {section.name}
          <span className="digest-meta-count">{count}</span>
        </button>
        {count > 0 && onAddArticles ? (
          <AddButton
            label={formatMessage(locale, "digestAddCategoryToChat", { count })}
            onClick={() => onAddArticles(sectionRefs)}
          />
        ) : null}
      </div>
      {!collapsed && (
        <ul className="digest-section-body space-y-0">
          {!hasBody ? (
            <li className="py-1 text-[0.8125rem] text-[var(--ink-muted)]">{t("digestNoItems")}</li>
          ) : (
            <>
              {multiEvents.map((event, index) => (
                <EventBlock
                  key={`${section.id}-multi-${index}-${event.title}`}
                  event={event}
                  onAddArticle={onAddArticle}
                  onAddArticles={onAddArticles}
                />
              ))}
              {titleClusters.map((cluster) => (
                <TitleClusterRow
                  key={`${section.id}-${normalizeTitleKey(cluster.title, cluster.articles[0]?.article_id || "x")}`}
                  title={cluster.title}
                  articles={cluster.articles}
                  onAddArticle={onAddArticle}
                  onAddArticles={onAddArticles}
                />
              ))}
            </>
          )}
        </ul>
      )}
    </section>
  );
}

function normalizePartitions(tree: DigestTree): DigestTreePartition[] {
  if (Array.isArray(tree.partitions) && tree.partitions.length > 0) {
    return tree.partitions;
  }
  if (Array.isArray(tree.sections)) {
    return [{ group_id: "", group_name: "", sections: tree.sections }];
  }
  return [];
}

function findScrollParent(node: HTMLElement | null): HTMLElement | null {
  let el = node?.parentElement ?? null;
  while (el) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

/** Scroll a tab horizontally inside its tablist without moving the brief vertical scroller. */
function scrollTabHorizontally(tab: HTMLElement, tablist: HTMLElement) {
  const listRect = tablist.getBoundingClientRect();
  const tabRect = tab.getBoundingClientRect();
  const pad = 12;
  if (tabRect.left < listRect.left + pad) {
    tablist.scrollBy({ left: tabRect.left - listRect.left - pad, behavior: "smooth" });
  } else if (tabRect.right > listRect.right - pad) {
    tablist.scrollBy({ left: tabRect.right - listRect.right + pad, behavior: "smooth" });
  }
}

interface DigestTreeViewProps {
  tree: DigestTree;
  onAddArticle?: (article: ArticleRef) => void;
  onAddArticles?: (articles: ArticleRef[]) => void;
  className?: string;
  /** 简报区滚动容器；不传则自动向上查找 */
  scrollParentRef?: RefObject<HTMLElement | null>;
}

export default function DigestTreeView({
  tree,
  onAddArticle,
  onAddArticles,
  className = "",
  scrollParentRef,
}: DigestTreeViewProps) {
  const { t } = useLocale();
  const partitions = useMemo(() => normalizePartitions(tree), [tree]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [activeKey, setActiveKey] = useState<string>("");
  const rootRef = useRef<HTMLDivElement>(null);
  const tocRef = useRef<HTMLElement>(null);
  const tablistRef = useRef<HTMLDivElement>(null);
  const sectionElsRef = useRef<Map<string, HTMLElement>>(new Map());
  const lockActiveUntilRef = useRef(0);

  const toc = useMemo(() => {
    const items: Array<{ key: string; label: string; count: number; kind: string }> = [];
    for (const partition of partitions) {
      for (const section of partition.sections || []) {
        items.push({
          key: `${partition.group_id}::${section.id}`,
          label: section.name,
          count: sectionArticleCount(section),
          kind: section.kind,
        });
      }
    }
    return items;
  }, [partitions]);

  const hasTocNav = toc.length > 1;

  useEffect(() => {
    if (!hasTocNav) return;
    if (!activeKey && toc[0]) setActiveKey(toc[0].key);
  }, [hasTocNav, toc, activeKey]);

  useEffect(() => {
    if (!hasTocNav || !activeKey) return;
    const tablist = tablistRef.current;
    if (!tablist) return;
    const activeTab = tablist.querySelector<HTMLElement>(`[role="tab"][aria-selected="true"]`);
    if (activeTab) scrollTabHorizontally(activeTab, tablist);
  }, [hasTocNav, activeKey]);

  useEffect(() => {
    if (!hasTocNav) return;
    const scroller =
      scrollParentRef?.current ?? findScrollParent(rootRef.current);
    const tocEl = tocRef.current;
    if (!scroller || !tocEl) return;

    const onScroll = () => {
      if (Date.now() < lockActiveUntilRef.current) return;
      const offset = tocEl.offsetHeight + 4;
      const scrollerTop = scroller.getBoundingClientRect().top;
      let current = toc[0]?.key ?? "";
      for (const item of toc) {
        const el = sectionElsRef.current.get(item.key);
        if (!el) continue;
        const top = el.getBoundingClientRect().top - scrollerTop;
        if (top - offset <= 2) current = item.key;
      }
      if (current) setActiveKey(current);
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [hasTocNav, toc, scrollParentRef]);

  function scrollSectionToTop(key: string) {
    // Ensure the target category is expanded so jump lands on readable content.
    setCollapsed((current) => ({ ...current, [key]: false }));
    setActiveKey(key);
    lockActiveUntilRef.current = Date.now() + 900;

    const run = () => {
      const target = sectionElsRef.current.get(key);
      const tocEl = tocRef.current;
      const scroller =
        scrollParentRef?.current ?? findScrollParent(rootRef.current);
      if (!target) return;
      if (!scroller || !tocEl) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      const tocHeight = tocEl.offsetHeight;
      const delta =
        target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const nextTop = scroller.scrollTop + delta - tocHeight;
      scroller.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
    };

    // Wait one frame so expand layout settles before measuring.
    requestAnimationFrame(() => requestAnimationFrame(run));
  }

  if (partitions.length === 0) {
    return <p className="text-sm text-[var(--ink-muted)]">{t("digestNoOverview")}</p>;
  }

  return (
    <div ref={rootRef} className={className}>
      {hasTocNav ? (
        <nav
          ref={tocRef}
          aria-label={t("digestTocLabel")}
          className="sticky top-0 z-10 border-b border-[var(--rule)] bg-[color-mix(in_srgb,var(--paper)_88%,transparent)] backdrop-blur-[10px]"
        >
          <div className="mx-auto flex max-w-[42rem] items-center gap-2 px-5 pt-1.5 sm:px-8">
            <div
              ref={tablistRef}
              role="tablist"
              aria-label={t("digestTocLabel")}
              className="flex min-w-0 flex-1 items-stretch gap-0 overflow-x-auto scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {toc.map((item) => {
                const isActive = activeKey === item.key;
                const isFocus = item.kind === "focus";
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => scrollSectionToTop(item.key)}
                    className={`digest-toc-tab inline-flex shrink-0 items-baseline gap-1.5 border-0 border-b-2 bg-transparent px-3 pb-2.5 pt-1.5 text-[0.8125rem] tracking-[0.01em] whitespace-nowrap transition-[color,border-color,background] duration-100 ${
                      isFocus ? "is-focus-tab" : ""
                    } ${
                      isActive
                        ? isFocus
                          ? "border-[var(--accent)] font-semibold text-[var(--accent)]"
                          : "border-[var(--ink)] font-semibold text-[var(--ink)]"
                        : isFocus
                          ? "border-transparent hover:bg-[var(--accent-soft)]"
                          : "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]"
                    }`}
                  >
                    {item.label}
                    <span
                      className={`digest-meta-count ${
                        isFocus
                          ? isActive
                            ? "text-[var(--accent)] opacity-90"
                            : "text-[var(--accent)] opacity-70"
                          : isActive
                            ? "opacity-70"
                            : "opacity-80"
                      }`}
                    >
                      {item.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </nav>
      ) : null}

      <div className="mx-auto min-w-0 max-w-[42rem] space-y-0 px-5 pt-5 pb-6 sm:px-8">
        {partitions.map((partition) => (
          <div key={partition.group_id || partition.group_name || "root"}>
            {partitions.length > 1 && partition.group_name ? (
              <h2 className="mb-3 px-0.5 text-[0.9375rem] font-semibold tracking-[-0.01em] text-[var(--ink)]">
                {partition.group_name}
              </h2>
            ) : null}
            {(partition.sections || []).map((section) => {
              const key = `${partition.group_id}::${section.id}`;
              const isCollapsed =
                collapsed[key] ??
                (sectionArticleCount(section) === 0 && section.kind !== "focus");
              return (
                <SectionBlock
                  key={key}
                  section={section}
                  collapsed={isCollapsed}
                  sectionRef={(node) => {
                    if (node) sectionElsRef.current.set(key, node);
                    else sectionElsRef.current.delete(key);
                  }}
                  onToggle={() =>
                    setCollapsed((current) => ({
                      ...current,
                      [key]: !isCollapsed,
                    }))
                  }
                  onAddArticle={onAddArticle}
                  onAddArticles={onAddArticles}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
