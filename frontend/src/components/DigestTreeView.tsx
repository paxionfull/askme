import { useMemo, useState } from "react";
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
  onAddArticle,
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
      {onAddArticle ? (
        <AddButton label="加入对话" onClick={() => onAddArticle(ref)} />
      ) : null}
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
  const refs = event.articles.map(toArticleRef);
  if (refs.length === 0) return null;

  if (refs.length === 1) {
    return <ArticleRow article={event.articles[0]} onAddArticle={onAddArticle} />;
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
            onAddArticle={onAddArticle}
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
  onAddArticle,
  onAddArticles,
}: {
  section: DigestTreeSection;
  collapsed: boolean;
  onToggle: () => void;
  onAddArticle?: (article: ArticleRef) => void;
  onAddArticles?: (articles: ArticleRef[]) => void;
}) {
  const count = sectionArticleCount(section);
  const isFocus = section.kind === "focus";
  const sectionRefs = section.events.flatMap((event) => event.articles.map(toArticleRef));

  return (
    <section
      className={`mb-4 rounded-[var(--radius-panel)] transition-[background,padding] duration-150 ${
        isFocus ? "bg-[var(--focus-wash)] px-2 py-2" : ""
      }`}
    >
      <div
        className={`group/item sticky top-0 z-[1] -mx-1 flex items-center gap-1 px-1 py-1 backdrop-blur-sm ${
          isFocus ? "bg-[var(--focus-wash)]/95" : "bg-[var(--paper-raised)]/95"
        }`}
      >
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
                onAddArticle={onAddArticle}
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

interface DigestTreeViewProps {
  tree: DigestTree;
  onAddArticle?: (article: ArticleRef) => void;
  onAddArticles?: (articles: ArticleRef[]) => void;
  className?: string;
}

export default function DigestTreeView({
  tree,
  onAddArticle,
  onAddArticles,
  className = "",
}: DigestTreeViewProps) {
  const partitions = useMemo(() => normalizePartitions(tree), [tree]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toc = useMemo(() => {
    const items: Array<{ key: string; label: string; count: number; kind: string }> = [];
    for (const partition of partitions) {
      const prefix = partition.group_name ? `${partition.group_name} · ` : "";
      for (const section of partition.sections || []) {
        items.push({
          key: `${partition.group_id}::${section.id}`,
          label: `${prefix}${section.name}`,
          count: sectionArticleCount(section),
          kind: section.kind,
        });
      }
    }
    return items;
  }, [partitions]);

  if (partitions.length === 0) {
    return <p className="text-sm text-[var(--ink-muted)]">暂无结构化概览</p>;
  }

  return (
    <div className={className}>
      {toc.length > 1 && (
        <nav className="mb-3 flex flex-wrap gap-1.5 border-b border-[var(--rule)] pb-3">
          {toc.map((item) => (
            <a
              key={item.key}
              href={`#digest-${item.key}`}
              className={`rounded px-1.5 py-0.5 text-[11px] ${
                item.kind === "focus"
                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "bg-[var(--paper)] text-[var(--ink-muted)] hover:bg-[color-mix(in_srgb,var(--paper)_70%,white)]"
              }`}
            >
              {item.label}
              {item.count > 0 ? ` ${item.count}` : ""}
            </a>
          ))}
        </nav>
      )}

      {partitions.map((partition) => (
        <div key={partition.group_id || partition.group_name || "root"}>
          {partitions.length > 1 && partition.group_name ? (
            <h2 className="mb-2 text-sm font-semibold text-[var(--ink)]">{partition.group_name}</h2>
          ) : null}
          {(partition.sections || []).map((section) => {
            const key = `${partition.group_id}::${section.id}`;
            const isCollapsed =
              collapsed[key] ?? (sectionArticleCount(section) === 0 && section.kind !== "focus");
            return (
              <div key={key} id={`digest-${key}`}>
                <SectionBlock
                  section={section}
                  collapsed={isCollapsed}
                  onToggle={() =>
                    setCollapsed((current) => ({
                      ...current,
                      [key]: !isCollapsed,
                    }))
                  }
                  onAddArticle={onAddArticle}
                  onAddArticles={onAddArticles}
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
