import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchStoredArticleBody,
  type Article,
  type StoredArticleBody,
} from "../api";

interface ArticleListProps {
  feedId: string | null;
  articles: Article[];
  loading: boolean;
  feedName: string;
  onRefresh: () => void;
  refreshing: boolean;
}

function formatDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN");
}

function ExternalLinkIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M4.25 5.5a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 .75.75v8.5a.75.75 0 0 1-1.5 0V6.56l-7.22 7.22a.75.75 0 0 1-1.06-1.06L11.44 5.5H5a.75.75 0 0 1-.75-.75Z"
        clipRule="evenodd"
      />
      <path
        fillRule="evenodd"
        d="M6.5 3.25A2.25 2.25 0 0 0 4.25 5.5v8.5A2.25 2.25 0 0 0 6.5 16.25h8.5A2.25 2.25 0 0 0 17.25 14V11a.75.75 0 0 1 1.5 0v3a3.75 3.75 0 0 1-3.75 3.75h-8.5A3.75 3.75 0 0 1 2.75 14V5.5A3.75 3.75 0 0 1 6.5 1.75H10a.75.75 0 0 1 0 1.5H6.5Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export default function ArticleList({
  feedId,
  articles,
  loading,
  feedName,
  onRefresh,
  refreshing,
}: ArticleListProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [body, setBody] = useState<StoredArticleBody | null>(null);
  const [loadingBody, setLoadingBody] = useState(false);
  const [bodyError, setBodyError] = useState("");
  const bodyCache = useRef<Map<string, StoredArticleBody>>(new Map());

  useEffect(() => {
    setSelectedId(null);
    setBody(null);
    setBodyError("");
    setLoadingBody(false);
  }, [feedId]);

  const loadBody = useCallback(
    async (article: Article) => {
      if (!feedId) return;

      setSelectedId(article.id);
      setBodyError("");

      const key = `${feedId}:${article.id}`;
      const cached = bodyCache.current.get(key);
      if (cached) {
        setBody(cached);
        return;
      }

      setLoadingBody(true);
      setBody(null);
      try {
        const data = await fetchStoredArticleBody(feedId, article.id);
        bodyCache.current.set(key, data);
        setBody(data);
      } catch (err) {
        setBody(null);
        setBodyError(err instanceof Error ? err.message : "加载正文失败");
      } finally {
        setLoadingBody(false);
      }
    },
    [feedId],
  );

  const selectedArticle = articles.find((item) => item.id === selectedId) ?? null;

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{feedName || "请选择数据源"}</h2>
          <p className="text-xs text-slate-500">{articles.length} 篇文章</p>
        </div>
        <button
          type="button"
          disabled={!feedName || refreshing}
          onClick={onRefresh}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {refreshing ? "刷新中..." : "刷新"}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto border-b border-slate-200">
          {!feedName ? (
            <p className="px-4 py-8 text-sm text-slate-500">从左侧选择一个数据源</p>
          ) : loading ? (
            <p className="px-4 py-8 text-sm text-slate-500">加载文章中...</p>
          ) : articles.length === 0 ? (
            <p className="px-4 py-8 text-sm text-slate-500">暂无文章，可点击刷新尝试抓取</p>
          ) : (
            <ul>
              {articles.map((article) => {
                const active = selectedId === article.id;
                return (
                  <li
                    key={article.id}
                    className={`border-b border-slate-100 px-4 py-3 ${
                      active ? "bg-slate-50" : ""
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {article.url ? (
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noreferrer"
                          title="打开原文链接"
                          aria-label="打开原文链接"
                          className="mt-0.5 shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <ExternalLinkIcon />
                        </a>
                      ) : (
                        <span className="mt-0.5 inline-block w-6 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => void loadBody(article)}
                          className={`text-left text-sm font-medium leading-6 hover:text-slate-700 ${
                            active ? "text-slate-900" : "text-slate-800"
                          }`}
                        >
                          {article.title}
                        </button>
                        <p className="mt-1 text-xs text-slate-500">
                          {formatDate(article.published_at)}
                          {article.author ? ` · ${article.author}` : ""}
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex min-h-[40%] flex-1 flex-col bg-slate-50">
          <div className="border-b border-slate-200 bg-white px-4 py-2">
            <h3 className="text-xs font-semibold text-slate-600">正文预览</h3>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {!selectedArticle ? (
              <p className="text-sm text-slate-500">点击文章标题查看已加载的正文</p>
            ) : loadingBody ? (
              <p className="text-sm text-slate-500">正在加载正文...</p>
            ) : bodyError ? (
              <p className="text-sm text-red-600">{bodyError}</p>
            ) : body ? (
              <div className="rounded-xl bg-white p-4 shadow-sm">
                <h4 className="text-base font-semibold leading-7 text-slate-900">{body.title}</h4>
                <p className="mt-1 text-xs text-slate-500">
                  {body.feed_name} · {formatDate(body.published_at)}
                  {body.url ? (
                    <>
                      {" · "}
                      <a
                        href={body.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-slate-600 underline-offset-2 hover:underline"
                      >
                        原文
                      </a>
                    </>
                  ) : null}
                </p>
                {body.content_html ? (
                  <div
                    className="article-content mt-4 text-sm text-slate-800"
                    dangerouslySetInnerHTML={{ __html: body.content_html }}
                  />
                ) : (
                  <p className="mt-4 text-sm text-slate-500">暂无正文内容</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500">暂无正文内容</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
