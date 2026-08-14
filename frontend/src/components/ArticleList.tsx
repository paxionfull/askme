import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchStoredArticleBody,
  type Article,
  type StoredArticleBody,
} from "../api";
import { formatFeedSyncTime } from "../utils/formatSyncTime";

interface ArticleListProps {
  feedId: string | null;
  articles: Article[];
  loading: boolean;
  feedName: string;
  feedUrl?: string;
  syncTime?: number | null;
  onRefresh: () => void;
  refreshing: boolean;
}

const PREVIEW_COLLAPSED_KEY = "askme.articlePreview.collapsed";
const PREVIEW_HEIGHT_KEY = "askme.articlePreview.height";
const BODY_RETRY_AFTER_SETTINGS_KEY = "askme.article.retryAfterSettings";
const PREVIEW_MIN_HEIGHT = 160;
const PREVIEW_DEFAULT_HEIGHT = 300;
/** 选中文章后，列表区仅保留首行高度（约一条标题） */
const FOCUS_LIST_MAX_HEIGHT_PX = 88;

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

function resolveBodyError(body?: StoredArticleBody | null, fallback = "该文章暂无正文内容") {
  const status = body?.body_status ?? "";
  const detail = body?.body_detail?.trim() ?? "";
  if (status === "anti_bot") {
    return detail || "检测到反爬/机器人挑战，建议稍后重试或切换可稳定来源";
  }
  if (status === "auth_required") {
    return detail || "该页面需要登录或订阅权限，请先完成账号授权后重试";
  }
  if (status === "parse_failed") {
    return detail || "页面可访问，但暂未解析出正文内容";
  }
  if (status === "transient_error") {
    return detail || "站点暂时不可用，请稍后重试";
  }
  return detail || fallback;
}

function bodyHasContent(body?: StoredArticleBody | null): boolean {
  return Boolean(body?.content_html?.trim() || (body?.plain_text ?? "").trim());
}

function resolveTakeoverHint(
  status: string,
  feedId: string | null,
): { title: string; actionLabel?: string } | null {
  if (status === "auth_required") {
    if ((feedId || "").includes("zhihu")) {
      return { title: "该站点需要登录态 Cookie，建议先去设置页配置后重试。", actionLabel: "去设置页配置" };
    }
    return { title: "该站点需要登录或订阅权限，可先打开原文完成登录后再重试。", actionLabel: "去设置页" };
  }
  if (status === "anti_bot") {
    return { title: "检测到反爬挑战，建议先人工打开原文完成验证，再返回重试。", actionLabel: "打开原文" };
  }
  if (status === "parse_failed") {
    return { title: "页面可访问但解析失败，建议反馈该数据源以修复解析规则。" };
  }
  return null;
}

export default function ArticleList({
  feedId,
  articles,
  loading,
  feedName,
  feedUrl,
  syncTime,
  onRefresh,
  refreshing,
}: ArticleListProps) {
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [body, setBody] = useState<StoredArticleBody | null>(null);
  const [loadingBody, setLoadingBody] = useState(false);
  const [bodyError, setBodyError] = useState("");
  const [bodyStatus, setBodyStatus] = useState<string>("");
  const [bodyDetail, setBodyDetail] = useState<string>("");
  const [previewCollapsed, setPreviewCollapsed] = useState(() => {
    try {
      return localStorage.getItem(PREVIEW_COLLAPSED_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [previewHeight, setPreviewHeight] = useState(() => {
    try {
      const raw = Number(localStorage.getItem(PREVIEW_HEIGHT_KEY));
      if (Number.isFinite(raw)) return Math.max(PREVIEW_MIN_HEIGHT, Math.round(raw));
    } catch {
      // ignore
    }
    return PREVIEW_DEFAULT_HEIGHT;
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const dragStateRef = useRef<{ moving: boolean; startY: number; startHeight: number }>({
    moving: false,
    startY: 0,
    startHeight: PREVIEW_DEFAULT_HEIGHT,
  });
  const bodyCache = useRef<Map<string, StoredArticleBody>>(new Map());
  const [loadedBodyIds, setLoadedBodyIds] = useState<Set<string>>(() => new Set());
  const retriedAfterSettingsRef = useRef(false);

  const focusPreview = !previewCollapsed && selectedId !== null;

  const scrollSelectedToVisibleTop = useCallback(() => {
    if (!selectedId) return;
    const container = listScrollRef.current;
    const item = itemRefs.current.get(selectedId);
    if (!container || !item) return;
    const delta = item.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTop += delta;
  }, [selectedId]);

  useEffect(() => {
    setSelectedId(null);
    setBody(null);
    setBodyError("");
    setBodyStatus("");
    setBodyDetail("");
    setLoadingBody(false);
    setLoadedBodyIds(new Set());
    setPreviewCollapsed(true);
    itemRefs.current.clear();
  }, [feedId]);

  useEffect(() => {
    try {
      localStorage.setItem(PREVIEW_COLLAPSED_KEY, previewCollapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [previewCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(PREVIEW_HEIGHT_KEY, String(previewHeight));
    } catch {
      // ignore
    }
  }, [previewHeight]);

  const markBodyLoaded = useCallback((articleId: string) => {
    setLoadedBodyIds((current) => {
      if (current.has(articleId)) return current;
      const next = new Set(current);
      next.add(articleId);
      return next;
    });
  }, []);

  const articleHasBody = useCallback(
    (article: Article) => article.has_body === true || loadedBodyIds.has(article.id),
    [loadedBodyIds],
  );

  const loadBody = useCallback(
    async (article: Article) => {
      if (!feedId) return;

      // 再次点击同一标题：收起预览
      if (selectedId === article.id && !previewCollapsed) {
        setSelectedId(null);
        setBody(null);
        setBodyError("");
        setBodyStatus("");
        setBodyDetail("");
        setLoadingBody(false);
        setPreviewCollapsed(true);
        return;
      }

      setSelectedId(article.id);
      setBodyError("");
      setBodyStatus("");
      setBodyDetail("");
      setPreviewCollapsed(false);

      const key = `${feedId}:${article.id}`;
      const cached = bodyCache.current.get(key);
      if (cached && bodyHasContent(cached)) {
        setBody(cached);
        markBodyLoaded(article.id);
        return;
      }

      setLoadingBody(true);
      setBody(null);
      try {
        let stored: StoredArticleBody | null = null;
        try {
          stored = await fetchStoredArticleBody(feedId, article.id, false);
        } catch (err) {
          const message = err instanceof Error ? err.message : "";
          if (!message.includes("正文未拉取")) {
            throw err;
          }
        }

        if (stored && bodyHasContent(stored)) {
          bodyCache.current.set(key, stored);
          setBody(stored);
          markBodyLoaded(article.id);
          return;
        }

        if (stored && stored.body_status && stored.body_status !== "ok") {
          setBodyError(resolveBodyError(stored));
          setBodyStatus(stored.body_status);
          setBodyDetail(stored.body_detail ?? "");
          return;
        }

        const fetched = await fetchStoredArticleBody(feedId, article.id, true);
        if (!bodyHasContent(fetched)) {
          setBodyError(resolveBodyError(fetched));
          setBodyStatus(fetched?.body_status ?? "");
          setBodyDetail(fetched?.body_detail ?? "");
          return;
        }
        bodyCache.current.set(key, fetched);
        setBody(fetched);
        markBodyLoaded(article.id);
      } catch (err) {
        setBody(null);
        setBodyStatus("");
        setBodyDetail("");
        const message = err instanceof Error ? err.message : "拉取正文失败";
        if (message.includes("正文未拉取") || message.includes("暂无可用正文") || message.includes("暂无正文")) {
          setBodyError("该文章暂无正文内容");
        } else {
          setBodyError(message);
        }
      } finally {
        setLoadingBody(false);
      }
    },
    [feedId, markBodyLoaded, previewCollapsed, selectedId],
  );

  const stopResize = useCallback(() => {
    dragStateRef.current.moving = false;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }, []);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!dragStateRef.current.moving || !containerRef.current) return;
      const delta = dragStateRef.current.startY - event.clientY;
      const rect = containerRef.current.getBoundingClientRect();
      const maxHeight = Math.max(PREVIEW_MIN_HEIGHT, rect.height - 180);
      const next = Math.max(
        PREVIEW_MIN_HEIGHT,
        Math.min(maxHeight, dragStateRef.current.startHeight + delta),
      );
      setPreviewHeight(Math.round(next));
    };
    const onUp = () => stopResize();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [stopResize]);

  const selectedArticle = articles.find((item) => item.id === selectedId) ?? null;
  const takeoverHint = resolveTakeoverHint(bodyStatus, feedId);

  useEffect(() => {
    if (!selectedId || previewCollapsed) return;
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollSelectedToVisibleTop();
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [previewCollapsed, scrollSelectedToVisibleTop, selectedId]);

  useEffect(() => {
    if (retriedAfterSettingsRef.current) return;
    if (!feedId || articles.length === 0) return;
    try {
      const raw = sessionStorage.getItem(BODY_RETRY_AFTER_SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { feed_id?: string; article_id?: string };
      if (!parsed.feed_id || !parsed.article_id) {
        sessionStorage.removeItem(BODY_RETRY_AFTER_SETTINGS_KEY);
        return;
      }
      if (parsed.feed_id !== feedId) return;
      const target = articles.find((item) => item.id === parsed.article_id);
      sessionStorage.removeItem(BODY_RETRY_AFTER_SETTINGS_KEY);
      if (!target) return;
      retriedAfterSettingsRef.current = true;
      void loadBody(target);
    } catch {
      sessionStorage.removeItem(BODY_RETRY_AFTER_SETTINGS_KEY);
    }
  }, [articles, feedId, loadBody]);

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">
            {feedName && feedUrl ? (
              <a
                href={feedUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={`打开数据源：${feedUrl}`}
                className="text-slate-900 underline-offset-2 hover:text-blue-700 hover:underline"
              >
                {feedName}
              </a>
            ) : (
              feedName || "请选择数据源"
            )}
          </h2>
          <p className="text-xs text-slate-500">
            {feedName
              ? `${articles.length} 篇文章 · ${formatFeedSyncTime(syncTime)}`
              : `${articles.length} 篇文章`}
          </p>
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

      <div ref={containerRef} className="flex min-h-0 flex-1 flex-col">
        <div
          ref={listScrollRef}
          className={`min-h-0 overflow-y-auto border-b border-slate-200 ${
            focusPreview ? "shrink-0" : "flex-1"
          }`}
          style={focusPreview ? { maxHeight: `${FOCUS_LIST_MAX_HEIGHT_PX}px` } : undefined}
        >
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
                const hasBody = articleHasBody(article);
                return (
                  <li
                    key={article.id}
                    ref={(element) => {
                      if (element) {
                        itemRefs.current.set(article.id, element);
                      } else {
                        itemRefs.current.delete(article.id);
                      }
                    }}
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
                          title={hasBody ? undefined : "正文尚未拉取，点击尝试加载"}
                          className={`text-left text-sm font-medium leading-6 hover:text-slate-700 ${
                            hasBody
                              ? active
                                ? "text-slate-900"
                                : "text-slate-800"
                              : "text-slate-400"
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

        {!previewCollapsed && !focusPreview && (
          <div
            className="h-1 shrink-0 cursor-row-resize bg-slate-200 transition-colors hover:bg-slate-400"
            onMouseDown={(event) => {
              event.preventDefault();
              dragStateRef.current = {
                moving: true,
                startY: event.clientY,
                startHeight: previewHeight,
              };
              document.body.style.userSelect = "none";
              document.body.style.cursor = "row-resize";
            }}
          />
        )}

        <div
          className={`flex flex-col bg-slate-50 ${
            previewCollapsed
              ? "h-10 shrink-0"
              : focusPreview
                ? "min-h-0 flex-1"
                : "shrink-0"
          }`}
          style={!previewCollapsed && !focusPreview ? { height: `${previewHeight}px` } : undefined}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
            <button
              type="button"
              onClick={() => setPreviewCollapsed((current) => !current)}
              className="text-xs font-semibold text-slate-600 hover:text-slate-800"
            >
              正文预览 {previewCollapsed ? "▸" : "▾"}
            </button>
            {!previewCollapsed && !focusPreview && (
              <span className="text-[11px] text-slate-400">拖动上方分隔线可调整高度</span>
            )}
            {focusPreview && articles.length > 1 ? (
              <span className="text-[11px] text-slate-400">
                选中项已滚至可见首位 · 列表区可滚动查看其余 {articles.length - 1} 篇
              </span>
            ) : null}
          </div>
          {!previewCollapsed && <div className="flex-1 overflow-y-auto p-4">
            {!selectedArticle ? (
              <p className="text-sm text-slate-500">点击文章标题查看已加载的正文</p>
            ) : loadingBody ? (
              <p className="text-sm text-slate-500">正在拉取正文...</p>
            ) : bodyError ? (
              <div className="space-y-3">
                <p className="text-sm text-red-600">{bodyError}</p>
                {bodyDetail ? <p className="text-xs text-slate-500">{bodyDetail}</p> : null}
                {takeoverHint ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs text-amber-800">{takeoverHint.title}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {takeoverHint.actionLabel === "去设置页配置" || takeoverHint.actionLabel === "去设置页" ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (feedId && selectedArticle?.id) {
                              sessionStorage.setItem(
                                BODY_RETRY_AFTER_SETTINGS_KEY,
                                JSON.stringify({
                                  feed_id: feedId,
                                  article_id: selectedArticle.id,
                                }),
                              );
                            }
                            navigate("/settings");
                          }}
                          className="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs text-amber-800 hover:bg-amber-100"
                        >
                          {takeoverHint.actionLabel}
                        </button>
                      ) : null}
                      {(takeoverHint.actionLabel === "打开原文" || bodyStatus === "auth_required") &&
                      selectedArticle?.url ? (
                        <a
                          href={selectedArticle.url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs text-amber-800 hover:bg-amber-100"
                        >
                          打开原文
                        </a>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
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
                ) : (body.plain_text ?? "").trim() ? (
                  <p className="article-content mt-4 whitespace-pre-wrap text-sm text-slate-800">
                    {body.plain_text}
                  </p>
                ) : (
                  <p className="mt-4 text-sm text-slate-500">暂无正文内容</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500">暂无正文内容</p>
            )}
          </div>}
        </div>
      </div>
    </section>
  );
}
