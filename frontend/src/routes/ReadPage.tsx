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
import { useDigest } from "../contexts/DigestContext";
import { useFeedRefresh } from "../contexts/FeedRefreshContext";
import { isLlmConfigured, useSettings, formatDaysLabel } from "../hooks/useSettings";
import DaysRangeSelect from "../components/DaysRangeSelect";
import OverflowMenu from "../components/OverflowMenu";

export default function ReadPage() {
  const { settings } = useSettings();
  const {
    days,
    setDays,
    loadingBodies,
    loadingIndex,
    loadError: digestError,
    metaCount,
    bodyCount,
    bodiesReady,
    indexReady,
    indexChunkCount,
    indexProgress,
    digestBusy,
    loadBodies,
    buildIndex,
    clearErrors,
    reloadSummaryGroups,
    loadingBodiesGroupId,
  } = useDigest();

  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [feedGroups, setFeedGroups] = useState<FeedGroup[]>([]);
  const [groupOrder, setGroupOrder] = useState<string[]>([]);
  const [defaultDigestSkill, setDefaultDigestSkill] = useState("general-digest");
  const [selectedFeedId, setSelectedFeedId] = useState<string | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);

  const [feedsLoading, setFeedsLoading] = useState(true);
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
    setFeedsLoading(true);
    setError("");
    setInfo("");
    try {
      const data = await fetchFeeds();
      setFeeds(data.feeds);
      setFeedGroups(data.groups);
      setGroupOrder(data.group_order ?? []);
      setDefaultDigestSkill(data.default_digest_skill ?? "general-digest");
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

  async function handleRefresh() {
    if (!selectedFeedId || feedRefreshBusy) return;
    setError("");
    setInfo("");
    try {
      await startRefreshFeed(selectedFeedId, selectedFeed?.name, days, selectedFeed?.entry_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "刷新失败");
    }
  }

  async function handleRefreshAll() {
    if (feeds.length === 0 || feedRefreshBusy) return;
    setError("");
    setInfo("");
    try {
      const latest = await fetchFeeds();
      setFeeds(latest.feeds);
      setFeedGroups(latest.groups);
      setGroupOrder(latest.group_order ?? []);
      await startRefreshAll(days);
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新全部失败");
    }
  }

  async function handleRefreshGroup(groupId: string, groupName: string, feedIds: string[]) {
    if (feedIds.length === 0 || feedRefreshBusy) return;
    setError("");
    setInfo("");
    try {
      await startRefreshGroup(groupId, groupName, days);
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新分组失败");
    }
  }

  async function handleLoadBodiesGroup(groupId: string, groupName: string, feedIds: string[]) {
    if (feedIds.length === 0 || loadingBodies || feedRefreshBusy) return;
    setError("");
    setInfo("");
    const result = await loadBodies({
      feedIds,
      groupId,
      groupName,
    });
    if (!result) {
      return;
    }
    const withBody = result.article_count ?? 0;
    const meta = result.meta_count ?? withBody;
    const cached = result.cached_count ?? 0;
    const fetched = result.fetched_count ?? 0;
    const missing = meta > withBody ? meta - withBody : 0;
    setInfo(
      `分组「${groupName}」正文拉取完成：${withBody}/${meta} 篇含正文` +
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

  const bodyStatusLabel = bodiesReady
    ? "正文已就绪"
    : loadingBodies
      ? "拉取正文中…"
      : metaCount > 0
        ? "待拉取正文"
        : "暂无文章";
  const indexStatusLabel = indexReady
    ? "索引已就绪"
    : loadingIndex
      ? `建立索引中 ${indexProgress.current}/${indexProgress.total || "…"}`
      : "未建索引";

  return (
    <div className="flex h-full flex-col bg-[var(--paper)]">
      <header className="border-b border-[var(--rule)] bg-[var(--paper-raised)] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-base font-semibold tracking-tight text-[var(--ink)]">库</h1>
            <p className="mt-0.5 truncate text-xs text-[var(--ink-muted)]">
              {formatDaysLabel(days)} · {bodyStatusLabel} · {indexStatusLabel}
              {bodiesReady && bodyCount > 0 ? ` · ${bodyCount} 篇正文` : ""}
              {indexReady ? ` · ${indexChunkCount} 片段` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <DaysRangeSelect value={days} onChange={setDays} disabled={digestBusy} />
            <OverflowMenu
              disabled={digestBusy && !loadingBodies && !loadingIndex}
              items={[
                {
                  label: loadingBodies
                    ? "拉取正文中…"
                    : bodiesReady
                      ? "重新拉取正文"
                      : "拉取正文",
                  hint: bodiesReady
                    ? `${bodyCount} 篇含正文${metaCount > bodyCount ? `（共 ${metaCount}）` : ""}`
                    : metaCount > 0
                      ? `${metaCount} 篇待拉取`
                      : "当前范围暂无文章",
                  disabled: digestBusy,
                  onClick: () => {
                    clearErrors();
                    void loadBodies();
                  },
                },
                {
                  label: loadingIndex
                    ? "建立索引中…"
                    : indexReady
                      ? "重新建立索引"
                      : "建立索引",
                  hint: indexReady
                    ? `已有 ${indexChunkCount} 个向量片段（近 3 天范围保留）`
                    : "无新正文时按 0 篇处理，保留近 3 天已有索引",
                  disabled: digestBusy || !isLlmConfigured(settings),
                  onClick: () => {
                    clearErrors();
                    void buildIndex();
                  },
                },
              ]}
            />
          </div>
        </div>
      </header>

      {combinedError && (
        <div className="whitespace-pre-wrap border-b border-[var(--rule)] bg-[var(--error-soft)] px-4 py-2 text-sm text-red-800">
          {combinedError}
        </div>
      )}

      {info && (
        <div className="border-b border-[var(--rule)] bg-[var(--accent-soft)] px-4 py-2 text-sm text-[var(--accent)]">
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
          onRefreshGroup={(groupId, groupName, feedIds) =>
            void handleRefreshGroup(groupId, groupName, feedIds)
          }
          onLoadGroupBodies={(groupId, groupName, feedIds) =>
            void handleLoadBodiesGroup(groupId, groupName, feedIds)
          }
          refreshingAll={refreshingAll}
          refreshing={Boolean(refreshingFeedId)}
          refreshingGroupId={refreshingGroupId}
          loadingBodies={loadingBodies}
          loadingBodiesGroupId={loadingBodiesGroupId}
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
          onRefresh={handleRefresh}
          refreshing={feedRefreshBusy}
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
