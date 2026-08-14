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

export default function CitationPanel({ items, activeIndex, onSelect, itemRefs }: CitationPanelProps) {
  if (items.length === 0) {
    return (
      <div className="flex h-full w-full flex-col">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">引用来源</h2>
        </div>
        <div className="flex flex-1 items-center justify-center px-4 text-sm text-slate-400">
          发送问题后将显示检索到的引用片段
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-800">引用来源</h2>
        <p className="mt-1 text-xs text-slate-500">点击回答中的 [n] 查看对应片段</p>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
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
              className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                active
                  ? "border-amber-400 bg-amber-50 shadow-sm ring-2 ring-amber-200"
                  : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
              }`}
            >
              <div className="flex items-start gap-2">
                <span
                  className={`mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full text-xs font-semibold ${
                    active ? "bg-amber-500 text-white" : "bg-slate-200 text-slate-700"
                  }`}
                >
                  {item.index}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{item.title || "无标题"}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {item.feed_name}
                    {item.published_at ? ` · ${formatTime(item.published_at)}` : ""}
                  </p>
                  <p className={`mt-2 text-xs leading-5 ${active ? "text-slate-700" : "text-slate-600"}`}>
                    {item.excerpt}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
