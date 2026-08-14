import type { MutableRefObject } from "react";

export interface CitationItem {
  index: number;
  id: string;
  title: string;
  feed_name: string;
  published_at: string;
  url: string;
  feed_id: string;
  article_id: string;
  chunk_index: number;
  char_start: number;
  excerpt: string;
  text?: string;
  score?: number;
}

interface CitationPanelProps {
  items: CitationItem[];
  activeIndex: number | null;
  onSelect: (index: number) => void;
  itemRefs?: MutableRefObject<Map<number, HTMLButtonElement>>;
  hideHeader?: boolean;
}

function formatTime(publishedAt: string) {
  if (!publishedAt) return "";
  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return publishedAt;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function CitationPanel({
  items,
  activeIndex,
  onSelect,
  itemRefs,
  hideHeader = false,
}: CitationPanelProps) {
  if (items.length === 0) {
    return (
      <div className="flex h-full w-full flex-col">
        {!hideHeader ? (
          <div className="border-b border-[var(--rule)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--ink)]">引用来源</h2>
          </div>
        ) : null}
        <div className="flex flex-1 items-center justify-center px-4 text-sm text-[var(--ink-muted)]">
          发送问题后将显示检索到的引用片段
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      {!hideHeader ? (
        <div className="border-b border-[var(--rule)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--ink)]">引用来源</h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">点击回答中的 [n] 查看对应片段</p>
        </div>
      ) : null}
      <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
        {items.map((item) => {
          const active = activeIndex === item.index;
          return (
            <button
              key={item.id}
              ref={(node) => {
                if (!itemRefs?.current) return;
                if (node) {
                  itemRefs.current.set(item.index, node);
                } else {
                  itemRefs.current.delete(item.index);
                }
              }}
              type="button"
              onClick={() => onSelect(item.index)}
              className={`w-full border-l-2 px-3 py-2.5 text-left transition ${
                active
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-transparent hover:bg-[var(--paper)]"
              }`}
            >
              <div className="flex items-start gap-2.5">
                <span
                  className={`mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded text-[11px] font-semibold tabular-nums ${
                    active
                      ? "bg-[var(--accent)] text-[var(--paper-raised)]"
                      : "bg-[var(--paper)] text-[var(--ink-muted)]"
                  }`}
                >
                  {item.index}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--ink)]">
                    {item.title || "无标题"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">
                    {item.feed_name}
                    {item.published_at ? ` · ${formatTime(item.published_at)}` : ""}
                  </p>
                  <p
                    className={`mt-1.5 text-xs leading-5 ${
                      active ? "text-[var(--ink)]" : "text-[var(--ink-muted)]"
                    }`}
                  >
                    {item.excerpt}
                  </p>
                  {item.url ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1.5 inline-block text-[11px] text-[var(--accent)] hover:underline"
                    >
                      打开原文
                    </a>
                  ) : null}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
