import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchStoredArticleBody,
  type Article,
  type StoredArticleBody,
} from "../api";
import OverflowMenu from "./OverflowMenu";
import { formatFeedSyncTime, formatRelativePublished } from "../utils/formatSyncTime";
import { getFeedLastReadArticleId, markFeedArticleRead } from "../utils/lastRead";

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

const BODY_RETRY_AFTER_SETTINGS_KEY = "askme.article.retryAfterSettings";

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
      return {
        title: "该站点需要登录 Cookie，请到设置页「数据源授权」配置或更新后重试。",
        actionLabel: "去设置页配置",
      };
    }
    return {
      title: "该站点需要登录或订阅权限，可到设置页添加 Cookie 授权，或先打开原文登录后再重试。",
      actionLabel: "去设置页",
    };
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
  const bodyCache = useRef<Map<string, StoredArticleBody>>(new Map());
  const [loadedBodyIds, setLoadedBodyIds] = useState<Set<string>>(() => new Set());
  const retriedAfterSettingsRef = useRef(false);
  const [lastReadId, setLastReadId] = useState<string | null>(() =>
    getFeedLastReadArticleId(feedId),
  );

  const reading = selectedId !== null;
  const selectedArticle = articles.find((item) => item.id === selectedId) ?? null;
  const takeoverHint = resolveTakeoverHint(bodyStatus, feedId);

  const markAsJustRead = useCallback(
    (articleId: string) => {
      if (!feedId || !articleId) return;
      markFeedArticleRead(feedId, articleId);
      setLastReadId(articleId);
    },
    [feedId],
  );

  const backToQueue = useCallback(() => {
    setSelectedId(null);
    setBody(null);
    setBodyError("");
    setBodyStatus("");
    setBodyDetail("");
    setLoadingBody(false);
  }, []);

  useEffect(() => {
    backToQueue();
    setLoadedBodyIds(new Set());
    setLastReadId(getFeedLastReadArticleId(feedId));
  }, [feedId, backToQueue]);

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

      if (selectedId === article.id) {
        backToQueue();
        return;
      }

      setSelectedId(article.id);
      setBodyError("");
      setBodyStatus("");
      setBodyDetail("");
      markAsJustRead(article.id);

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
        if (
          message.includes("正文未拉取") ||
          message.includes("暂无可用正文") ||
          message.includes("暂无正文")
        ) {
          setBodyError("该文章暂无正文内容");
        } else {
          setBodyError(message);
        }
      } finally {
        setLoadingBody(false);
      }
    },
    [feedId, markBodyLoaded, selectedId, backToQueue, markAsJustRead],
  );

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
    <section className="flex h-full min-w-0 flex-1 flex-col bg-[var(--paper)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--rule)] bg-[var(--paper-raised)] px-5 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold tracking-tight text-[var(--ink)]">
            {feedName && feedUrl ? (
              <a
                href={feedUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={`打开数据源：${feedUrl}`}
                className="text-[var(--ink)] underline-offset-2 hover:text-[var(--accent)] hover:underline"
              >
                {feedName}
              </a>
            ) : (
              feedName || "请选择数据源"
            )}
          </h2>
          <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
            {feedName
              ? `${articles.length} 篇 · ${formatFeedSyncTime(syncTime)}`
              : `${articles.length} 篇文章`}
          </p>
        </div>
        {feedName ? (
          <OverflowMenu
            label="源操作"
            disabled={refreshing}
            items={[
              {
                label: refreshing ? "更新中…" : "更新源信息",
                hint: "刷新该源文章列表并拉取正文",
                disabled: refreshing,
                onClick: onRefresh,
              },
            ]}
          />
        ) : null}
      </div>

      {reading ? (
        <div className="flex min-h-0 flex-1 flex-col bg-[var(--paper-raised)]">
          <div className="flex shrink-0 items-center gap-3 border-b border-[var(--rule)] px-5 py-2.5">
            <button
              type="button"
              onClick={backToQueue}
              className="shrink-0 text-xs text-[var(--ink-muted)] hover:text-[var(--accent)]"
            >
              ← {articles.length} 篇
            </button>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--ink)]">
              {selectedArticle?.title ?? "阅读中"}
            </span>
            {selectedArticle?.url ? (
              <a
                href={selectedArticle.url}
                target="_blank"
                rel="noreferrer"
                onClick={() => markAsJustRead(selectedArticle.id)}
                className="shrink-0 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]"
              >
                原文
              </a>
            ) : null}
          </div>

          <div className="flex-1 overflow-y-auto px-6 pb-10 pt-6">
            {!selectedArticle ? (
              <p className="text-sm text-[var(--ink-muted)]">文章不存在</p>
            ) : loadingBody ? (
              <p className="text-sm text-[var(--ink-muted)]">正在拉取正文…</p>
            ) : bodyError ? (
              <div className="mx-auto max-w-[40rem] space-y-3">
                <p className="text-sm text-red-700">{bodyError}</p>
                {bodyDetail ? <p className="text-xs text-[var(--ink-muted)]">{bodyDetail}</p> : null}
                {takeoverHint ? (
                  <div className="border-l-2 border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-2.5">
                    <p className="text-xs text-[var(--accent)]">{takeoverHint.title}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {takeoverHint.actionLabel === "去设置页配置" ||
                      takeoverHint.actionLabel === "去设置页" ? (
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
                          className="ui-btn ui-btn-accent text-xs"
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
                          onClick={() => markAsJustRead(selectedArticle.id)}
                          className="ui-btn text-xs"
                        >
                          打开原文
                        </a>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : body ? (
              <article className="mx-auto max-w-[40rem]">
                <h4 className="text-[1.35rem] font-semibold leading-snug tracking-tight text-[var(--ink)]">
                  {body.title}
                </h4>
                <p className="mt-2 text-xs text-[var(--ink-muted)]">
                  {body.feed_name} · {formatRelativePublished(body.published_at)}
                  {body.url ? (
                    <>
                      {" · "}
                      <a
                        href={body.url}
                        target="_blank"
                        rel="noreferrer"
                        className="ui-link"
                        onClick={() => {
                          if (selectedArticle) markAsJustRead(selectedArticle.id);
                        }}
                      >
                        原文
                      </a>
                    </>
                  ) : null}
                </p>
                {body.content_html ? (
                  <div
                    className="article-content mt-7"
                    dangerouslySetInnerHTML={{ __html: body.content_html }}
                  />
                ) : (body.plain_text ?? "").trim() ? (
                  <p className="article-content mt-7 whitespace-pre-wrap">{body.plain_text}</p>
                ) : (
                  <p className="mt-4 text-sm text-[var(--ink-muted)]">暂无正文内容</p>
                )}
              </article>
            ) : (
              <p className="text-sm text-[var(--ink-muted)]">暂无正文内容</p>
            )}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!feedName ? (
            <p className="px-5 py-10 text-sm text-[var(--ink-muted)]">从左侧选择一个数据源</p>
          ) : loading ? (
            <p className="px-5 py-10 text-sm text-[var(--ink-muted)]">加载文章中…</p>
          ) : articles.length === 0 ? (
            <p className="px-5 py-10 text-sm text-[var(--ink-muted)]">暂无文章，可从菜单刷新抓取</p>
          ) : (
            <ul className="py-1">
              {articles.map((article) => {
                const hasBody = articleHasBody(article);
                const justRead = lastReadId === article.id;
                return (
                  <li key={article.id} className="group relative">
                    <div className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-[color-mix(in_srgb,var(--paper-raised)_75%,transparent)]">
                      <span
                        className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${
                          hasBody
                            ? "bg-[var(--accent)]"
                            : "bg-[color-mix(in_srgb,var(--ink-muted)_40%,transparent)]"
                        }`}
                        title={hasBody ? "已有正文" : "正文未拉取"}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => void loadBody(article)}
                          title={hasBody ? undefined : "正文尚未拉取，点击尝试加载"}
                          className={`w-full text-left text-[15px] font-medium leading-[1.45] tracking-tight ${
                            hasBody ? "text-[var(--ink)]" : "text-[var(--ink-muted)]"
                          } hover:text-[var(--ink)]`}
                        >
                          {article.title}
                        </button>
                        <p className="mt-1 text-[11px] leading-none text-[var(--ink-muted)]">
                          {formatRelativePublished(article.published_at)}
                          {article.author ? ` · ${article.author}` : ""}
                        </p>
                      </div>
                      {justRead ? (
                        <span className="mt-1 shrink-0 text-[10px] font-medium tracking-wide text-[var(--accent)]">
                          刚看过
                        </span>
                      ) : null}
                      {article.url ? (
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noreferrer"
                          title="打开原文"
                          aria-label="打开原文"
                          onClick={() => markAsJustRead(article.id)}
                          className="mt-0.5 shrink-0 rounded p-1 text-[var(--ink-muted)] opacity-0 transition-opacity hover:bg-[var(--paper-raised)] hover:text-[var(--ink)] group-hover:opacity-100 focus:opacity-100"
                        >
                          <ExternalLinkIcon />
                        </a>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
