import { useCallback, useEffect, useRef, useState } from "react";
import { FEEDS_NEED_RELOAD_KEY, deleteFeed, fetchArticles, fetchFeeds, renameFeed, saveFeedGroups, type Article, type Feed, type FeedGroup } from "../api";
import ArticleList from "../components/ArticleList";
import AddSourceModal from "../components/AddSourceModal";
import FeedGroupModal from "../components/FeedGroupModal";
import ConfirmModal from "../components/ConfirmModal";
import FeedSidebar from "../components/FeedSidebar";
import { consumeLastOnboardedFeedId, useOnboarding } from "../contexts/OnboardingContext";
import { UNGROUPED_GROUP_ID } from "../utils/feedLayout";
import { resolveDefaultFeedId, setStoredSelectedFeedId } from "../utils/selectedFeed";
import { deleteFeedMessage, deleteFeedSuccessMessage, isPlatformFeed } from "../utils/platformFeed";
import { hydrateFeedsState, writeFeedsCache } from "../utils/feedsCache";
import { useDigest } from "../contexts/DigestContext";
import { useFeedRefresh } from "../contexts/FeedRefreshContext";
import { isLlmConfigured, useSettings, formatDaysLabel } from "../hooks/useSettings";
import DaysRangeSelect from "../components/DaysRangeSelect";

const INITIAL_FEEDS_CACHE = hydrateFeedsState();

export default function ReadPage() {
  const { settings } = useSettings();
  const {
    days,
    setDays,
    loadingBodies,
    loadingIndex,
    loadError: digestError,
    metaCount,
    indexReady,
    indexChunkCount,
    indexProgress,
    bodyProgress,
    digestBusy,
    loadBodies,
    buildIndex,
    clearErrors,
    reloadSummaryGroups,
    loadingBodiesGroupId,
  } = useDigest();

  const [feeds, setFeeds] = useState<Feed[]>(() => INITIAL_FEEDS_CACHE?.feeds ?? []);
  const [feedGroups, setFeedGroups] = useState<FeedGroup[]>(() => INITIAL_FEEDS_CACHE?.groups ?? []);
  const [groupOrder, setGroupOrder] = useState<string[]>(() => INITIAL_FEEDS_CACHE?.groupOrder ?? []);
  const [defaultDigestSkill, setDefaultDigestSkill] = useState(
    () => INITIAL_FEEDS_CACHE?.defaultDigestSkill ?? "general-digest",
  );
  const [selectedFeedId, setSelectedFeedId] = useState<string | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);

  const [feedsLoading, setFeedsLoading] = useState(() => !INITIAL_FEEDS_CACHE);
  const [articlesLoading, setArticlesLoading] = useState(false);
  const {
    refreshingAll,
    refreshingGroupId,
    refreshingFeedId,
    refreshBusy,
    startRefreshAll,
    startRefreshGroup,
    startRefreshFeed,
  } = useFeedRefresh();
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [addSourceInitialUrls, setAddSourceInitialUrls] = useState("");
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Feed | null>(null);
  const [deleteRemoveSkill, setDeleteRemoveSkill] = useState(false);
  const [deletingFeed, setDeletingFeed] = useState(false);
  const { batch, authRetryUrls, clearAuthRetry } = useOnboarding();

  useEffect(() => {
    if (authRetryUrls.length === 0) return;
    setAddSourceInitialUrls(authRetryUrls.join("\n"));
    setAddSourceOpen(true);
    clearAuthRetry();
  }, [authRetryUrls, clearAuthRetry]);

  const articlesCache = useRef<Map<string, Article[]>>(new Map());

  const articleCacheKey = useCallback((feedId: string, rangeDays: number) => `${feedId}:${rangeDays}`, []);
  const pendingForceReload = useRef(sessionStorage.getItem(FEEDS_NEED_RELOAD_KEY) === "1");
  const prefetchingAll = useRef(false);
  const selectedFeedIdRef = useRef<string | null>(selectedFeedId);
  const prevLoadingBodiesRef = useRef(false);

  useEffect(() => {
    selectedFeedIdRef.current = selectedFeedId;
  }, [selectedFeedId]);

  useEffect(() => {
    if (selectedFeedId) {
      setStoredSelectedFeedId(selectedFeedId);
    }
  }, [selectedFeedId]);

  const selectedFeed = feeds.find((feed) => feed.id === selectedFeedId) ?? null;

  const prefetchAllArticles = useCallback(async (feedList: Feed[], rangeDays: number) => {
    if (feedList.length === 0) return;

    prefetchingAll.current = true;
    articlesCache.current.clear();
    setArticlesLoading(true);
    setError("");
    try {
      await Promise.all(
        feedList.map(async (feed) => {
          const data = await fetchArticles(feed.id, undefined, false, true, rangeDays);
          articlesCache.current.set(articleCacheKey(feed.id, rangeDays), data);
        }),
      );
      if (selectedFeedIdRef.current) {
        setArticles(articlesCache.current.get(articleCacheKey(selectedFeedIdRef.current, rangeDays)) ?? []);
      }
    } catch (err) {
      setArticles([]);
      setError(err instanceof Error ? err.message : "加载文章失败");
    } finally {
      prefetchingAll.current = false;
      setArticlesLoading(false);
    }
  }, [articleCacheKey]);

  const loadFeeds = useCallback(async () => {
    if (!INITIAL_FEEDS_CACHE) {
      setFeedsLoading(true);
    }
    setError("");
    setInfo("");
    try {
      const data = await fetchFeeds();
      setFeeds(data.feeds);
      setFeedGroups(data.groups);
      setGroupOrder(data.group_order ?? []);
      setDefaultDigestSkill(data.default_digest_skill ?? "general-digest");
      writeFeedsCache({
        feeds: data.feeds,
        groups: data.groups,
        groupOrder: data.group_order ?? [],
        defaultDigestSkill: data.default_digest_skill ?? "general-digest",
      });
      setSelectedFeedId((current) =>
        resolveDefaultFeedId(
          data.feeds,
          data.groups,
          data.group_order ?? [],
          current,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载数据源失败");
    } finally {
      setFeedsLoading(false);
    }
  }, []);

  const loadArticles = useCallback(async (feedId: string, rangeDays: number, force = false) => {
    const cacheKey = articleCacheKey(feedId, rangeDays);
    const cachedWhilePrefetching = prefetchingAll.current
      ? articlesCache.current.get(cacheKey)
      : undefined;
    if (prefetchingAll.current) {
      if (cachedWhilePrefetching) {
        setArticles(cachedWhilePrefetching);
        return;
      }
    }

    const needsReload = sessionStorage.getItem(FEEDS_NEED_RELOAD_KEY) === "1";
    const reallyForce = force || needsReload;

    if (!prefetchingAll.current && !reallyForce && articlesCache.current.has(cacheKey)) {
      setArticles(articlesCache.current.get(cacheKey)!);
      return;
    }

    setArticlesLoading(true);
    setError("");
    try {
      const data = await fetchArticles(feedId, undefined, false, true, rangeDays);
      if (selectedFeedIdRef.current !== feedId) {
        articlesCache.current.set(cacheKey, data);
        return;
      }
      articlesCache.current.set(cacheKey, data);
      setArticles(data);
    } catch (err) {
      if (selectedFeedIdRef.current !== feedId) {
        return;
      }
      setArticles([]);
      setError(err instanceof Error ? err.message : "加载文章失败");
    } finally {
      if (selectedFeedIdRef.current === feedId) {
        setArticlesLoading(false);
      }
    }
  }, [articleCacheKey]);

  useEffect(() => {
    void loadFeeds().then(() => {
      const feedId = consumeLastOnboardedFeedId();
      if (feedId) {
        setSelectedFeedId(feedId);
        setInfo(`Agent 已接入 ${feedId}`);
      }
    });
  }, [loadFeeds]);

  // 接入过程中每完成一个、或整批结束时刷新侧边栏，避免 skill 已写入但列表仍是旧的
  useEffect(() => {
    if (!batch) return;
    if (batch.status === "running" && batch.completed === 0 && batch.failed === 0) {
      return;
    }

    void loadFeeds().then(() => {
      const feedId = consumeLastOnboardedFeedId();
      if (feedId) {
        setSelectedFeedId(feedId);
        setInfo(batch.message || `已接入 ${feedId}`);
      } else if (batch.status !== "running") {
        setInfo(batch.message);
      }
    });
  }, [batch?.batch_id, batch?.completed, batch?.failed, batch?.status, batch?.message, loadFeeds]);

  useEffect(() => {
    if (feeds.length === 0) return;

    const needsReload =
      pendingForceReload.current || sessionStorage.getItem(FEEDS_NEED_RELOAD_KEY) === "1";
    if (!needsReload) return;

    prefetchingAll.current = true;
    pendingForceReload.current = false;
    sessionStorage.removeItem(FEEDS_NEED_RELOAD_KEY);
    void prefetchAllArticles(feeds, days);
  }, [feeds, days, prefetchAllArticles]);

  useEffect(() => {
    if (selectedFeedId) {
      const cacheKey = articleCacheKey(selectedFeedId, days);
      const cached = articlesCache.current.get(cacheKey);
      if (cached) {
        setArticles(cached);
      } else {
        setArticles([]);
      }
      void loadArticles(selectedFeedId, days);
    } else {
      setArticles([]);
    }
  }, [selectedFeedId, days, loadArticles, articleCacheKey]);

  // 批量拉取正文结束后刷新列表，更新 has_body 与标题颜色
  useEffect(() => {
    const wasLoading = prevLoadingBodiesRef.current;
    prevLoadingBodiesRef.current = loadingBodies;
    if (wasLoading && !loadingBodies && selectedFeedId) {
      void loadArticles(selectedFeedId, days, true);
    }
  }, [loadingBodies, selectedFeedId, days, loadArticles]);

  const feedRefreshBusy = refreshBusy;
  const prevRefreshBusyRef = useRef(refreshBusy);

  useEffect(() => {
    const wasBusy = prevRefreshBusyRef.current;
    prevRefreshBusyRef.current = refreshBusy;
    if (wasBusy && !refreshBusy) {
      void loadFeeds();
      if (selectedFeedIdRef.current) {
        articlesCache.current.delete(articleCacheKey(selectedFeedIdRef.current, days));
        void loadArticles(selectedFeedIdRef.current, days, true);
      }
    }
  }, [refreshBusy, loadFeeds, loadArticles, days, articleCacheKey]);

  async function handleUpdateSourcesAll() {
    if (feeds.length === 0 || feedRefreshBusy || loadingBodies) return;
    setError("");
    setInfo("");
    try {
      const latest = await fetchFeeds();
      setFeeds(latest.feeds);
      setFeedGroups(latest.groups);
      setGroupOrder(latest.group_order ?? []);
      await startRefreshAll(days);
      clearErrors();
      await loadBodies();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新源信息失败");
    }
  }

  async function handleUpdateSourcesGroup(groupId: string, groupName: string, feedIds: string[]) {
    if (feedIds.length === 0 || feedRefreshBusy || loadingBodies) return;
    setError("");
    setInfo("");
    try {
      await startRefreshGroup(groupId, groupName, days);
      clearErrors();
      const result = await loadBodies({
        feedIds,
        groupId,
        groupName,
      });
      if (!result) return;
      const withBody = result.article_count ?? 0;
      const meta = result.meta_count ?? withBody;
      const cached = result.cached_count ?? 0;
      const fetched = result.fetched_count ?? 0;
      const missing = meta > withBody ? meta - withBody : 0;
      setInfo(
        `分组「${groupName}」已更新：列表已刷新 · ${withBody}/${meta} 篇含正文` +
          `（${formatDaysLabel(days)}）` +
          `${missing > 0 ? ` · ${missing} 篇无正文` : ""}` +
          ` · 缓存 ${cached} · 新拉 ${fetched}`,
      );
      for (const feedId of feedIds) {
        articlesCache.current.delete(articleCacheKey(feedId, days));
      }
      if (selectedFeedId && feedIds.includes(selectedFeedId)) {
        void loadArticles(selectedFeedId, days, true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新分组失败");
    }
  }

  async function handleUpdateSourcesFeed(
    feedId: string,
    feedName?: string,
    entryUrl?: string | null,
  ) {
    if (!feedId || feedRefreshBusy || loadingBodies) return;
    setError("");
    setInfo("");
    try {
      await startRefreshFeed(
        feedId,
        feedName,
        days,
        entryUrl == null ? undefined : entryUrl,
      );
      clearErrors();
      await loadBodies({ feedIds: [feedId] });
      articlesCache.current.delete(articleCacheKey(feedId, days));
      if (selectedFeedId === feedId) {
        void loadArticles(feedId, days, true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新源信息失败");
    }
  }

  async function handleDeleteFeed(feedId: string) {
    setDeletingFeed(true);
    setError("");
    try {
      const result = await deleteFeed(feedId, deleteRemoveSkill);
      articlesCache.current.delete(feedId);
      const latest = await fetchFeeds();
      setFeeds(latest.feeds);
      setFeedGroups(latest.groups);
      setGroupOrder(latest.group_order ?? []);
      setSelectedFeedId((current) =>
        resolveDefaultFeedId(
          latest.feeds,
          latest.groups,
          latest.group_order ?? [],
          current === feedId ? null : current,
        ),
      );
      setDeleteTarget(null);
      setDeleteRemoveSkill(false);
      setInfo(deleteFeedSuccessMessage(result));
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeletingFeed(false);
    }
  }

  async function handleRenameFeed(feedId: string, nextName: string) {
    const feed = feeds.find((item) => item.id === feedId);
    if (!feed) return;
    if (!nextName.trim() || nextName === feed.name) return;
    setError("");
    try {
      await renameFeed(feedId, nextName);
      const latest = await fetchFeeds();
      setFeeds(latest.feeds);
      setFeedGroups(latest.groups);
      setGroupOrder(latest.group_order ?? []);
      setInfo(`已将「${feed.name}」重命名为「${nextName}」`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "重命名失败");
    }
  }

  async function handleSaveGroups(groups: FeedGroup[], nextDefaultDigestSkill: string) {
    const nextOrder = groupOrder.filter((id) => groups.some((group) => group.id === id));
    for (const group of groups) {
      if (!nextOrder.includes(group.id)) {
        nextOrder.push(group.id);
      }
    }
    const result = await saveFeedGroups(groups, nextOrder, nextDefaultDigestSkill);
    setFeedGroups(result.groups);
    setGroupOrder(result.group_order ?? []);
    setDefaultDigestSkill(result.default_digest_skill ?? nextDefaultDigestSkill);
    const latest = await fetchFeeds();
    setFeeds(latest.feeds);
    await reloadSummaryGroups();
    setInfo("分组已保存");
  }

  async function handleLayoutChange(groups: FeedGroup[], nextGroupOrder: string[]) {
    const skillById = new Map(feedGroups.map((group) => [group.id, group.digest_skill_id ?? null]));
    const merged = groups.map((group) => ({
      ...group,
      digest_skill_id: group.digest_skill_id ?? skillById.get(group.id) ?? null,
    }));
    const result = await saveFeedGroups(merged, nextGroupOrder);
    setFeedGroups(result.groups);
    setGroupOrder(result.group_order ?? []);
    const latest = await fetchFeeds();
    setFeeds(latest.feeds);
  }

  const combinedError = error || digestError;
  const llmConfigured = isLlmConfigured(settings);
  const hasList = metaCount > 0 || feeds.length > 0;

  const sourcesStatus = (() => {
    if (refreshBusy) return "正在更新文章列表…";
    if (loadingBodies) {
      return bodyProgress.total > 0
        ? `正在拉取正文 ${bodyProgress.current}/${bodyProgress.total}`
        : "正在拉取正文…";
    }
    if (loadingIndex) {
      return indexProgress.total > 0
        ? `建立索引中 ${indexProgress.current}/${indexProgress.total}`
        : "正在建立索引…";
    }
    const parts: string[] = [];
    if (feeds.length > 0) parts.push(`${feeds.length} 个源`);
    parts.push(formatDaysLabel(days));
    if (metaCount > 0) parts.push(`${metaCount} 篇列表`);
    else if (feeds.length > 0) parts.push("暂无文章");
    if (indexReady) parts.push(`索引 ${indexChunkCount} 片段`);
    return parts.join(" · ") || "还没有数据源";
  })();

  const sourcesBusy = refreshBusy || loadingBodies;

  return (
    <div className="flex h-full flex-col bg-[var(--paper)]">
      <header className="border-b border-[var(--rule)] bg-[var(--paper-raised)] px-4 py-3">
        <h1 className="text-[1.35rem] font-semibold tracking-tight text-[var(--ink)]">源</h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2">
          <label className="inline-flex items-center gap-1.5 text-sm">
            <span className="text-xs text-[var(--ink-muted)]">范围</span>
            <DaysRangeSelect value={days} onChange={setDays} disabled={digestBusy} size="sm" />
          </label>
          <span className="text-[var(--ink-muted)]">·</span>
          <span
            className={`text-sm ${
              sourcesBusy || loadingIndex
                ? "text-[var(--accent)]"
                : hasList
                  ? "text-[var(--success)]"
                  : "text-[var(--ink-muted)]"
            }`}
          >
            {sourcesStatus}
          </span>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={sourcesBusy || feeds.length === 0}
            title={
              feeds.length === 0
                ? "请先添加数据源"
                : "刷新各源文章列表，并拉取正文。\n生成简报与摘要会用到更新后的内容；建立索引仍需另点。"
            }
            onClick={() => void handleUpdateSourcesAll()}
            className="ui-btn ui-btn-primary text-sm disabled:opacity-50"
          >
            {sourcesBusy ? "更新中…" : "更新源信息"}
          </button>
          <button
            type="button"
            disabled={digestBusy || !llmConfigured}
            title={
              !llmConfigured
                ? "请先在设置配置模型"
                : "为已有正文建立检索索引，仅自由提问时需要。\n生成简报或对选定文章做摘要不需要索引，可跳过以节省 token。"
            }
            onClick={() => {
              clearErrors();
              void buildIndex();
            }}
            className="ui-btn text-sm disabled:opacity-50"
          >
            {loadingIndex ? "建立索引中…" : indexReady ? "重建索引" : "建立索引"}
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--ink-muted)]">
          更新源信息 = 刷新列表并拉取正文；建立索引仅在提问时需要。
        </p>
      </header>

      {combinedError && (
        <div className="whitespace-pre-wrap border-b border-[var(--rule)] bg-[var(--error-soft)] px-4 py-2.5 text-sm text-red-800">
          {combinedError}
        </div>
      )}

      {info && (
        <div className="border-b border-[var(--rule)] bg-[var(--accent-soft)] px-4 py-2.5 text-sm text-[var(--accent)]">
          {info}
        </div>
      )}

      <main className="flex min-h-0 flex-1">
        <FeedSidebar
          feeds={feeds}
          groups={feedGroups}
          groupOrder={groupOrder}
          selectedId={selectedFeedId}
          loading={feedsLoading}
          onSelect={setSelectedFeedId}
          onRefreshAll={() => void handleUpdateSourcesAll()}
          onRefreshGroup={(groupId, groupName, feedIds) =>
            void handleUpdateSourcesGroup(groupId, groupName, feedIds)
          }
          refreshingAll={refreshingAll}
          refreshing={Boolean(refreshingFeedId)}
          refreshingGroupId={refreshingGroupId}
          loadingBodies={loadingBodies}
          loadingBodiesGroupId={loadingBodiesGroupId}
          sourcesBusy={sourcesBusy}
          onAddSource={() => setAddSourceOpen(true)}
          onManageGroups={() => setGroupModalOpen(true)}
          onDeleteFeed={(feedId) => {
            const feed = feeds.find((item) => item.id === feedId) ?? null;
            if (feed) {
              setDeleteTarget(feed);
              setDeleteRemoveSkill(false);
            }
          }}
          onRenameFeed={(feedId, name) => handleRenameFeed(feedId, name)}
          onLayoutChange={handleLayoutChange}
          days={days}
        />
        <ArticleList
          key={selectedFeedId ?? "none"}
          feedId={selectedFeedId}
          articles={articles}
          loading={articlesLoading}
          feedName={selectedFeed?.name ?? ""}
          feedUrl={selectedFeed?.entry_url}
          syncTime={selectedFeed?.sync_time}
          onRefresh={() => {
            if (!selectedFeedId) return;
            void handleUpdateSourcesFeed(
              selectedFeedId,
              selectedFeed?.name,
              selectedFeed?.entry_url,
            );
          }}
          refreshing={sourcesBusy}
        />
      </main>

      <AddSourceModal
        open={addSourceOpen}
        onClose={() => {
          setAddSourceOpen(false);
          setAddSourceInitialUrls("");
        }}
        groups={feedGroups}
        defaultGroupId={selectedFeed?.group_id ?? UNGROUPED_GROUP_ID}
        initialUrls={addSourceInitialUrls}
      />
      <FeedGroupModal
        open={groupModalOpen}
        feeds={feeds}
        groups={feedGroups}
        defaultDigestSkill={defaultDigestSkill}
        onClose={() => setGroupModalOpen(false)}
        onSave={handleSaveGroups}
      />
      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="移除数据源"
        message={deleteTarget ? deleteFeedMessage(deleteTarget) : ""}
        extraContent={
          deleteTarget && !isPlatformFeed(deleteTarget) ? (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--ink-muted)]">
              <input
                type="checkbox"
                checked={deleteRemoveSkill}
                onChange={(e) => setDeleteRemoveSkill(e.target.checked)}
                disabled={deletingFeed}
              />
              同时删除本地 skill 目录（不可恢复）
            </label>
          ) : null
        }
        confirmLabel="确认移除"
        danger
        loading={deletingFeed}
        onCancel={() => {
          if (!deletingFeed) {
            setDeleteTarget(null);
            setDeleteRemoveSkill(false);
          }
        }}
        onConfirm={() => {
          if (deleteTarget) void handleDeleteFeed(deleteTarget.id);
        }}
      />
    </div>
  );
}
