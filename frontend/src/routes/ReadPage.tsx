import { useCallback, useEffect, useRef, useState } from "react";
import { FEEDS_NEED_RELOAD_KEY, deleteFeed, fetchArticles, fetchFeeds, refreshAllFeeds, refreshFeed, saveFeedGroups, waitForRefreshAllComplete, type Article, type Feed, type FeedGroup } from "../api";
import ArticleList from "../components/ArticleList";
import AddSourceModal from "../components/AddSourceModal";
import FeedGroupModal from "../components/FeedGroupModal";
import ConfirmModal from "../components/ConfirmModal";
import FeedSidebar from "../components/FeedSidebar";
import { consumeLastOnboardedFeedId, useOnboarding } from "../contexts/OnboardingContext";
import { useDigest } from "../contexts/DigestContext";
import { isLlmConfigured, useSettings, type DefaultDays } from "../hooks/useSettings";

export default function ReadPage() {
  const { settings } = useSettings();
  const {
    days,
    setDays,
    loadingBodies,
    loadingIndex,
    loadError: digestError,
    truncated,
    metaCount,
    bodyCount,
    cachedCount,
    fetchedCount,
    bodiesReady,
    indexReady,
    indexChunkCount,
    digestBusy,
    loadBodies,
    buildIndex,
    clearErrors,
    reloadSummaryGroups,
  } = useDigest();

  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [feedGroups, setFeedGroups] = useState<FeedGroup[]>([]);
  const [groupOrder, setGroupOrder] = useState<string[]>([]);
  const [defaultDigestSkill, setDefaultDigestSkill] = useState("general-digest");
  const [selectedFeedId, setSelectedFeedId] = useState<string | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);

  const [feedsLoading, setFeedsLoading] = useState(true);
  const [articlesLoading, setArticlesLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Feed | null>(null);
  const [deletingFeed, setDeletingFeed] = useState(false);
  const { job: onboardJob } = useOnboarding();

  const articlesCache = useRef<Map<string, Article[]>>(new Map());
  const pendingForceReload = useRef(sessionStorage.getItem(FEEDS_NEED_RELOAD_KEY) === "1");
  const prefetchingAll = useRef(false);
  const selectedFeedIdRef = useRef<string | null>(selectedFeedId);

  useEffect(() => {
    selectedFeedIdRef.current = selectedFeedId;
  }, [selectedFeedId]);

  const selectedFeed = feeds.find((feed) => feed.id === selectedFeedId) ?? null;

  const prefetchAllArticles = useCallback(async (feedList: Feed[]) => {
    if (feedList.length === 0) return;

    prefetchingAll.current = true;
    articlesCache.current.clear();
    setArticlesLoading(true);
    setError("");
    try {
      await Promise.all(
        feedList.map(async (feed) => {
          const data = await fetchArticles(feed.id, 20, false, true);
          articlesCache.current.set(feed.id, data);
        }),
      );
      if (selectedFeedIdRef.current) {
        setArticles(articlesCache.current.get(selectedFeedIdRef.current) ?? []);
      }
    } catch (err) {
      setArticles([]);
      setError(err instanceof Error ? err.message : "加载文章失败");
    } finally {
      prefetchingAll.current = false;
      setArticlesLoading(false);
    }
  }, []);

  const loadFeeds = useCallback(async () => {
    setFeedsLoading(true);
    setError("");
    setInfo("");
    try {
      const data = await fetchFeeds();
      setFeeds(data.feeds);
      setFeedGroups(data.groups);
      setGroupOrder(data.group_order ?? []);
      setDefaultDigestSkill(data.default_digest_skill ?? "general-digest");
      setSelectedFeedId((current) => {
        if (current && data.feeds.some((feed) => feed.id === current)) {
          return current;
        }
        return data.feeds[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载数据源失败");
    } finally {
      setFeedsLoading(false);
    }
  }, []);

  const loadArticles = useCallback(async (feedId: string, force = false) => {
    const cachedWhilePrefetching = prefetchingAll.current
      ? articlesCache.current.get(feedId)
      : undefined;
    if (prefetchingAll.current) {
      if (cachedWhilePrefetching) {
        setArticles(cachedWhilePrefetching);
        return;
      }
    }

    const needsReload = sessionStorage.getItem(FEEDS_NEED_RELOAD_KEY) === "1";
    const reallyForce = force || needsReload;

    if (!prefetchingAll.current && !reallyForce && articlesCache.current.has(feedId)) {
      setArticles(articlesCache.current.get(feedId)!);
      return;
    }

    setArticlesLoading(true);
    setError("");
    try {
      const data = await fetchArticles(feedId, 20, false, true);
      if (selectedFeedIdRef.current !== feedId) {
        articlesCache.current.set(feedId, data);
        return;
      }
      articlesCache.current.set(feedId, data);
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
  }, []);

  useEffect(() => {
    void loadFeeds().then(() => {
      const feedId = consumeLastOnboardedFeedId();
      if (feedId) {
        setSelectedFeedId(feedId);
        setInfo(`Agent 已接入 ${feedId}`);
      }
    });
  }, [loadFeeds]);

  useEffect(() => {
    if (!onboardJob?.result) return;
    const feedId = onboardJob.result.feed_id;
    setInfo(`Agent 已接入 ${feedId} · ${onboardJob.result.skill_dir}`);
    void loadFeeds().then(() => setSelectedFeedId(feedId));
  }, [onboardJob?.result, loadFeeds]);

  useEffect(() => {
    if (feeds.length === 0) return;

    const needsReload =
      pendingForceReload.current || sessionStorage.getItem(FEEDS_NEED_RELOAD_KEY) === "1";
    if (!needsReload) return;

    prefetchingAll.current = true;
    pendingForceReload.current = false;
    sessionStorage.removeItem(FEEDS_NEED_RELOAD_KEY);
    void prefetchAllArticles(feeds);
  }, [feeds, prefetchAllArticles]);

  useEffect(() => {
    if (selectedFeedId) {
      const cached = articlesCache.current.get(selectedFeedId);
      if (cached) {
        setArticles(cached);
      } else {
        setArticles([]);
      }
      void loadArticles(selectedFeedId);
    } else {
      setArticles([]);
    }
  }, [selectedFeedId, loadArticles]);

  async function handleRefresh() {
    if (!selectedFeedId) return;

    setRefreshing(true);
    setError("");
    setInfo("正在从官网拉取最新文章...");
    try {
      const result = await refreshFeed(selectedFeedId);
      articlesCache.current.delete(selectedFeedId);
      await loadArticles(selectedFeedId, true);
      await loadFeeds();
      setInfo(result.message);
    } catch (err) {
      setInfo("");
      setError(err instanceof Error ? err.message : "刷新失败");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleRefreshAll() {
    if (feeds.length === 0) return;

    setRefreshingAll(true);
    setError("");
    setInfo("正在启动更新全部数据源…");
    try {
      const start = await refreshAllFeeds();
      setInfo(start.message);

      const status = await waitForRefreshAllComplete((progress) => {
        const item = progress.refresh_progress;
        if (item && item.total > 0) {
          setInfo(`正在更新 ${item.current}/${item.total}：${item.feed_name || "…"}`);
        }
      });

      articlesCache.current.clear();
      const latest = await fetchFeeds();
      setFeeds(latest.feeds);
      setFeedGroups(latest.groups);
      setGroupOrder(latest.group_order ?? []);
      await prefetchAllArticles(latest.feeds);

      const message = status.last_refresh_message || start.message;
      if (status.last_error && (status.last_feed_count ?? 0) === 0) {
        setInfo("");
        setError(message);
      } else {
        setInfo(message);
      }
    } catch (err) {
      setInfo("");
      setError(err instanceof Error ? err.message : "更新全部失败");
    } finally {
      setRefreshingAll(false);
    }
  }

  async function handleDeleteFeed(feedId: string) {
    setDeletingFeed(true);
    setError("");
    try {
      await deleteFeed(feedId);
      articlesCache.current.delete(feedId);
      const latest = await fetchFeeds();
      setFeeds(latest.feeds);
      setFeedGroups(latest.groups);
      setGroupOrder(latest.group_order ?? []);
      setSelectedFeedId((current) => {
        if (current === feedId) {
          return latest.feeds[0]?.id ?? null;
        }
        return current;
      });
      setDeleteTarget(null);
      setInfo("已从列表移除数据源（skill 已保留）");
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeletingFeed(false);
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
    const result = await saveFeedGroups(groups, nextGroupOrder);
    setFeedGroups(result.groups);
    setGroupOrder(result.group_order ?? []);
    const latest = await fetchFeeds();
    setFeeds(latest.feeds);
  }

  const combinedError = error || digestError;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <div>
          <h1 className="text-base font-semibold">数据源</h1>
          <p className="text-xs text-slate-500">
            近 {days} 天
            {bodiesReady
              ? ` · ${bodyCount} 篇含正文${metaCount > bodyCount ? `（共 ${metaCount} 篇）` : ""}`
              : metaCount > 0
                ? ` · ${metaCount} 篇文章待加载正文`
                : ""}
            {bodiesReady && cachedCount + fetchedCount > 0
              ? ` · 缓存 ${cachedCount} · 新拉 ${fetchedCount}`
              : ""}
            {bodiesReady && truncated ? " · 部分内容将在生成时截断" : ""}
            {indexReady ? ` · 索引 ${indexChunkCount} 片段` : loadingIndex ? " · 正在建立索引..." : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            disabled={digestBusy}
            onChange={(e) => setDays(Number(e.target.value) as DefaultDays)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:opacity-50"
          >
            <option value={1}>近 1 天</option>
            <option value={3}>近 3 天</option>
            <option value={7}>近 7 天</option>
          </select>
          <button
            type="button"
            disabled={digestBusy}
            onClick={() => {
              clearErrors();
              void loadBodies();
            }}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            {loadingBodies ? "加载正文中..." : bodiesReady ? "重新加载正文" : "加载正文"}
          </button>
          <button
            type="button"
            disabled={digestBusy || !bodiesReady || !isLlmConfigured(settings)}
            onClick={() => {
              clearErrors();
              void buildIndex();
            }}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            {loadingIndex ? "建立索引中..." : indexReady ? "重新建立索引" : "建立索引"}
          </button>
        </div>
      </header>

      {combinedError && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {combinedError}
        </div>
      )}

      {info && !combinedError && (
        <div className="border-b border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700">
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
          onRefreshAll={() => void handleRefreshAll()}
          refreshingAll={refreshingAll}
          onAddSource={() => setAddSourceOpen(true)}
          onManageGroups={() => setGroupModalOpen(true)}
          onDeleteFeed={(feedId) => {
            const feed = feeds.find((item) => item.id === feedId) ?? null;
            if (feed) setDeleteTarget(feed);
          }}
          onLayoutChange={handleLayoutChange}
        />
        <ArticleList
          key={selectedFeedId ?? "none"}
          feedId={selectedFeedId}
          articles={articles}
          loading={articlesLoading}
          feedName={selectedFeed?.name ?? ""}
          onRefresh={handleRefresh}
          refreshing={refreshing || refreshingAll}
        />
      </main>

      <AddSourceModal open={addSourceOpen} onClose={() => setAddSourceOpen(false)} />
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
        message={
          deleteTarget
            ? `确定从列表移除「${deleteTarget.name}」？\n\nskill 文件会保留，之后可通过相同链接重新接入。`
            : ""
        }
        confirmLabel="确认移除"
        danger
        loading={deletingFeed}
        onCancel={() => {
          if (!deletingFeed) setDeleteTarget(null);
        }}
        onConfirm={() => {
          if (deleteTarget) void handleDeleteFeed(deleteTarget.id);
        }}
      />
    </div>
  );
}
