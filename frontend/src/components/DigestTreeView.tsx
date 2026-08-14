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

export type { DigestTree, DigestTreeArticle, DigestTreeEvent, DigestTreePartition, DigestTreeSection };

function sectionArticleCount(section: DigestTreeSection): number {
  return section.events.reduce((sum, event) => sum + event.articles.length, 0);
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
  return (
    <button
      type="button"
      title={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      className="ml-1.5 inline-flex shrink-0 items-center rounded border border-[color-mix(in_srgb,var(--accent)_30%,var(--rule))] bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)] opacity-0 transition-opacity hover:bg-[color-mix(in_srgb,var(--accent-soft)_80%,white)] group-hover/item:opacity-100"
    >
      加入对话
    </button>
  );
}

function ArticleRow({
  article,
}: {
  article: DigestTreeArticle;
  onAddArticle?: (article: ArticleRef) => void;
}) {
  const ref = toArticleRef(article);
  const title = article.title || article.article_id;
  return (
    <li className="group/item flex items-start gap-1 py-0.5 text-sm leading-6 text-[var(--ink)]">
      <span
        draggable
        title="拖到右侧对话区"
        className="min-w-0 flex-1 cursor-grab rounded px-0.5 hover:bg-[var(--accent-soft)] active:cursor-grabbing"
        onDragStart={(event) => writeArticleDragData(event.dataTransfer, ref)}
      >
        {article.url ? (
          <a
            href={article.url}
            target="_blank"
            rel="noreferrer"
            className="ui-link"
            onClick={(event) => event.stopPropagation()}
          >
            {title}
          </a>
        ) : (
          <span>{title}</span>
        )}
      </span>
    </li>
  );
}

function EventBlock({
  event,
  onAddArticles,
}: {
  event: DigestTreeEvent;
  onAddArticle?: (article: ArticleRef) => void;
  onAddArticles?: (articles: ArticleRef[]) => void;
}) {
  const refs = event.articles.map(toArticleRef);
  if (refs.length === 0) return null;

  if (refs.length === 1) {
    return <ArticleRow article={event.articles[0]} />;
  }

  const label = (event.title || "相关报道").trim() || "相关报道";
  return (
    <li className="py-0.5">
      <div className="group/item flex items-center gap-1 text-sm font-semibold text-[var(--ink)]">
        <span
          draggable
          title={`拖动添加 ${refs.length} 篇`}
          className="cursor-grab rounded px-0.5 hover:bg-[var(--accent-soft)] active:cursor-grabbing"
          onDragStart={(eventObj) =>
            writeArticleGroupDragData(eventObj.dataTransfer, { label, articles: refs })
          }
        >
          {label}
          <span className="ml-1 font-normal text-[var(--ink-muted)]">（{refs.length} 篇）</span>
        </span>
        {onAddArticles ? (
          <AddButton
            label={`将 ${refs.length} 篇文章加入对话`}
            onClick={() => onAddArticles(refs)}
          />
        ) : null}
      </div>
      <ul className="mt-0.5 space-y-0 border-l border-[var(--rule)] pl-3">
        {event.articles.map((article) => (
          <ArticleRow
            key={`${article.feed_id}:${article.article_id}`}
            article={article}
          />
        ))}
      </ul>
    </li>
  );
}

function SectionBlock({
  section,
  collapsed,
  onToggle,
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
  const count = sectionArticleCount(section);
  const isFocus = section.kind === "focus";
  const sectionRefs = section.events.flatMap((event) => event.articles.map(toArticleRef));

  return (
    <section
      ref={sectionRef}
      className={`mb-4 rounded-[var(--radius-panel)] transition-[background,padding] duration-150 ${
        isFocus ? "bg-[var(--focus-wash)] px-2 py-2" : ""
      }`}
    >
      <div className="group/item -mx-1 flex items-center gap-1 px-1 py-1">
        <button
          type="button"
          onClick={onToggle}
          className={`min-w-0 flex-1 text-left text-sm font-semibold tracking-tight ${
            isFocus ? "text-[var(--accent)]" : "text-[var(--ink)]"
          }`}
        >
          <span className="mr-1 inline-block w-3 text-xs text-[var(--ink-muted)]">
            {collapsed ? "▸" : "▾"}
          </span>
          {section.name}
          <span className="ml-1.5 text-xs font-normal text-[var(--ink-muted)]">{count}</span>
        </button>
        {count > 0 && onAddArticles ? (
          <AddButton
            label={`将本分类 ${count} 篇加入对话`}
            onClick={() => onAddArticles(sectionRefs)}
          />
        ) : null}
      </div>
      {!collapsed && (
        <ul className="mt-1 space-y-0.5">
          {section.events.length === 0 ? (
            <li className="py-1 text-xs text-[var(--ink-muted)]">暂无</li>
          ) : (
            section.events.map((event, index) => (
              <EventBlock
                key={`${section.id}-${index}-${event.title}`}
                event={event}
                onAddArticles={onAddArticles}
              />
            ))
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
  onAddArticles,
  className = "",
  scrollParentRef,
}: DigestTreeViewProps) {
  const partitions = useMemo(() => normalizePartitions(tree), [tree]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [activeKey, setActiveKey] = useState<string>("");
  const rootRef = useRef<HTMLDivElement>(null);
  const tocRef = useRef<HTMLElement>(null);
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
    const target = sectionElsRef.current.get(key);
    const tocEl = tocRef.current;
    const scroller =
      scrollParentRef?.current ?? findScrollParent(rootRef.current);
    if (!target) return;
    setActiveKey(key);
    lockActiveUntilRef.current = Date.now() + 700;
    if (!scroller || !tocEl) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const tocHeight = tocEl.offsetHeight;
    const delta =
      target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const nextTop = scroller.scrollTop + delta - tocHeight;
    scroller.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
  }

  if (partitions.length === 0) {
    return <p className="text-sm text-[var(--ink-muted)]">暂无结构化概览</p>;
  }

  return (
    <div ref={rootRef} className={className}>
      {hasTocNav ? (
        <nav
          ref={tocRef}
          aria-label="简报目录"
          className="sticky top-0 z-10 border-b border-[var(--rule)] bg-[color-mix(in_srgb,var(--paper)_88%,transparent)] backdrop-blur-[10px]"
        >
          <div className="mx-auto flex max-w-[42rem] items-stretch gap-0 overflow-x-auto px-5 pt-1.5 scrollbar-none sm:px-8 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {toc.map((item) => {
              const isActive = activeKey === item.key;
              const isFocus = item.kind === "focus";
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => scrollSectionToTop(item.key)}
                  className={`inline-flex shrink-0 items-baseline gap-1.5 border-0 border-b-2 bg-transparent px-3 pb-2.5 pt-1.5 text-[0.82rem] tracking-[0.01em] whitespace-nowrap transition-[color,border-color] duration-100 ${
                    isActive
                      ? isFocus
                        ? "border-[var(--accent)] font-semibold text-[var(--accent)]"
                        : "border-[var(--ink)] text-[var(--ink)]"
                      : isFocus
                        ? "border-transparent font-semibold text-[var(--accent)] hover:opacity-90"
                        : "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]"
                  }`}
                >
                  {item.label}
                  <span
                    className={`text-[0.7rem] font-medium tabular-nums ${
                      isActive ? "opacity-60" : "text-[color-mix(in_srgb,var(--ink-muted)_75%,transparent)]"
                    }`}
                  >
                    {item.count}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      ) : null}

      <div className="mx-auto min-w-0 max-w-[42rem] px-5 pt-4 pb-5 sm:px-8">
        {partitions.map((partition) => (
          <div key={partition.group_id || partition.group_name || "root"}>
            {partitions.length > 1 && partition.group_name ? (
              <h2 className="mb-2 text-sm font-semibold text-[var(--ink)]">
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
