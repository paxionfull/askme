import { useState } from "react";
import type { ScopedArticle } from "../contexts/ChatContext";

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
  const [expanded, setExpanded] = useState(false);
  const count = articles.length;
  if (count === 0) return null;

  const singleTitle = count === 1 ? articles[0].title || "未命名文章" : null;

  return (
    <div className="mx-auto mb-2 max-w-3xl">
      <div className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-1.5">
        <span className="shrink-0 text-xs font-medium text-indigo-800">引用限定 · {count} 篇</span>
        {singleTitle ? (
          <span className="min-w-0 flex-1 truncate text-xs text-indigo-700" title={singleTitle}>
            {singleTitle}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="text-xs text-indigo-600 hover:text-indigo-800"
          >
            {expanded ? "收起列表" : "查看列表"}
          </button>
        )}
        {count > 1 && (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="shrink-0 text-xs text-indigo-500 hover:text-indigo-700"
            aria-expanded={expanded}
          >
            {expanded ? "▴" : "▾"}
          </button>
        )}
        {count === 1 && (
          <button
            type="button"
            onClick={() => onRemove(articles[0].feed_id, articles[0].article_id)}
            className="shrink-0 text-xs text-indigo-500 hover:text-indigo-800"
            aria-label="移除限定文章"
          >
            ×
          </button>
        )}
        <button
          type="button"
          onClick={onClear}
          className="ml-auto shrink-0 text-xs text-slate-500 hover:text-slate-700"
        >
          清除
        </button>
      </div>
      {expanded && count > 1 && (
        <ul className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-slate-200 bg-white text-xs shadow-sm">
          {articles.map((article) => (
            <li
              key={`${article.feed_id}:${article.article_id}`}
              className="flex items-center gap-2 border-b border-slate-100 px-2.5 py-1.5 last:border-0"
            >
              <span className="min-w-0 flex-1 truncate text-slate-700" title={article.title}>
                {article.title || "未命名文章"}
              </span>
              <button
                type="button"
                onClick={() => onRemove(article.feed_id, article.article_id)}
                className="shrink-0 text-slate-400 hover:text-slate-700"
                aria-label="移除限定文章"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
