import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FEEDS_NEED_RELOAD_KEY,
  deleteFeed,
  fetchArticles,
  fetchFeedSchedulerConfig,
  fetchFeeds,
  renameFeed,
  saveFeedGroups,
  type Article,
  type Feed,
  type FeedGroup,
  type ScheduleTime,
} from "../api";
import ArticleList from "../components/ArticleList";
import AddSourceModal from "../components/AddSourceModal";
import GroupScheduleModal from "../components/GroupScheduleModal";
import FeedGroupModal from "../components/FeedGroupModal";
import ConfirmModal from "../components/ConfirmModal";
import FeedSidebar from "../components/FeedSidebar";
import { consumeLastOnboardedFeedId, useOnboarding } from "../contexts/OnboardingContext";
import { UNGROUPED_GROUP_ID, buildSections } from "../utils/feedLayout";
import { formatScheduleSummary, SCHEDULES_UPDATED_EVENT } from "../utils/feedScheduler";
import { resolveDefaultFeedId, setStoredSelectedFeedId } from "../utils/selectedFeed";
import { deleteFeedMessage, deleteFeedSuccessMessage, isPlatformFeed } from "../utils/platformFeed";
import { hydrateFeedsState, writeFeedsCache } from "../utils/feedsCache";
import { useDigest } from "../contexts/DigestContext";
import { useFeedRefresh } from "../contexts/FeedRefreshContext";
import { isEmbeddingConfigured, useSettings, formatDaysLabel } from "../hooks/useSettings";
import { useIndexBuildConfirm } from "../hooks/useIndexBuildConfirm";
import DaysRangeSelect from "../components/DaysRangeSelect";

const INITIAL_FEEDS_CACHE = hydrateFeedsState();
const SCOPE_GROUP_IDS_KEY = "askme.sources.scopedGroupIds";

function readScopedGroupIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SCOPE_GROUP_IDS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((id) => String(id)).filter(Boolean));
  } catch {
    return new Set();
  }
}

function writeScopedGroupIds(ids: Set<string>) {
  try {
    localStorage.setItem(SCOPE_GROUP_IDS_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore
  }
}

export default function ReadPage() {
  const { settings } = useSettings();
  const {
    days,
    setDays,
    loadingBodies,
    loadingIndex,
    loadError: digestError,
    indexReady,
    indexProgress,
    bodyProgress,
    digestBusy,
    loadBodies,
    clearErrors,
    reloadSummaryGroups,
    loadingBodiesGroupId,
    stopBodies,
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
    startRefreshSelected,
    startRefreshGroup,
    startRefreshFeed,
    stopRefresh,
  } = useFeedRefresh();
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [addSourceInitialUrls, setAddSourceInitialUrls] = useState("");
  const [addSourceGroupId, setAddSourceGroupId] = useState(UNGROUPED_GROUP_ID);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Feed | null>(null);
  const [deleteRemoveSkill, setDeleteRemoveSkill] = useState(false);
  const [deletingFeed, setDeletingFeed] = useState(false);
  const [groupBulkTarget, setGroupBulkTarget] = useState<
    | { kind: "delete-group"; id: string; name: string; feedIds: string[] }
    | { kind: "clear-ungrouped"; feedIds: string[] }
    | null
  >(null);
  const [groupBulkRemoveSkill, setGroupBulkRemoveSkill] = useState(false);
  const [deletingGroupBulk, setDeletingGroupBulk] = useState(false);
  const [scopedGroupIds, setScopedGroupIds] = useState<Set<string>>(() => readScopedGroupIds());
  const [schedules, setSchedules] = useState<ScheduleTime[]>([]);
  const [scheduleModalGroup, setScheduleModalGroup] = useState<{ id: string; name: string } | null>(
    null,
  );
  const { batch, authRetryUrls, clearAuthRetry } = useOnboarding();
  const { requestIndexBuild, IndexBuildConfirmModal, indexBuildBusy } = useIndexBuildConfirm();

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

  const reloadSchedules = useCallback(async () => {
    try {
      const config = await fetchFeedSchedulerConfig();
      setSchedules(config.schedules ?? []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void reloadSchedules();
    function onFocus() {
      void reloadSchedules();
    }
    function onSchedulesUpdated(event: Event) {
      const detail = (event as CustomEvent<{ schedules?: ScheduleTime[] }>).detail;
      if (detail?.schedules) {
        setSchedules(detail.schedules);
      } else {
        void reloadSchedules();
      }
    }
    window.addEventListener("focus", onFocus);
    window.addEventListener(SCHEDULES_UPDATED_EVENT, onSchedulesUpdated);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(SCHEDULES_UPDATED_EVENT, onSchedulesUpdated);
    };
  }, [reloadSchedules]);

  const sections = useMemo(
    () => buildSections(feeds, feedGroups, groupOrder),
    [feeds, feedGroups, groupOrder],
  );

  const selectableGroupIds = useMemo(
    () => sections.filter((section) => section.feeds.length > 0).map((section) => section.id),
    [sections],
  );

  // 分组变化时修剪无效勾选；首次无持久化时默认全选有源分组
  useEffect(() => {
    if (selectableGroupIds.length === 0) return;
    setScopedGroupIds((current) => {
      const next = new Set([...current].filter((id) => selectableGroupIds.includes(id)));
      const raw = localStorage.getItem(SCOPE_GROUP_IDS_KEY);
      if (next.size === 0 && raw == null) {
        for (const id of selectableGroupIds) next.add(id);
      }
      if (next.size === current.size && [...next].every((id) => current.has(id))) {
        return current;
      }
      writeScopedGroupIds(next);
      return next;
    });
  }, [selectableGroupIds]);

  const scopedSections = useMemo(
    () => sections.filter((section) => scopedGroupIds.has(section.id) && section.feeds.length > 0),
    [sections, scopedGroupIds],
  );

  const scopedFeedIds = useMemo(
    () => scopedSections.flatMap((section) => section.feeds.map((feed) => feed.id)),
    [scopedSections],
  );

  const scheduledGroupIds = useMemo(() => {
    const ids = new Set<string>();
    for (const schedule of schedules) {
      for (const gid of schedule.group_ids ?? []) {
        if (gid) ids.add(gid);
      }
    }
    return ids;
  }, [schedules]);

  const scheduleHintByGroupId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const section of sections) {
      if (section.isSystem) continue;
      const labels = schedules
        .filter((schedule) => (schedule.group_ids ?? []).includes(section.id))
        .map(formatScheduleSummary);
      map[section.id] =
        labels.length > 0
          ? `已加入定时：${labels.join("、")}`
          : "未加入任何定时（在设置 → 定时里为某条定时选择分组）";
    }
    return map;
  }, [schedules, sections]);

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

  function stopUpdateSources() {
    stopRefresh();
    stopBodies();
  }

  async function handleUpdateSourcesSelected() {
    if (scopedFeedIds.length === 0 || loadingBodies) return;
    setError("");
    setInfo("");
    try {
      const latest = await fetchFeeds();
      setFeeds(latest.feeds);
      setFeedGroups(latest.groups);
      setGroupOrder(latest.group_order ?? []);
      const names = scopedSections.map((section) => section.name);
      const label = names.join("、");
      const { cancelled } = await startRefreshSelected(scopedFeedIds, days, label);
      if (cancelled) return;
      clearErrors();
      await loadBodies({ feedIds: scopedFeedIds });
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新源信息失败");
    }
  }

  function handleToggleGroupScope(groupId: string, checked: boolean) {
    setScopedGroupIds((current) => {
      const next = new Set(current);
      if (checked) next.add(groupId);
      else next.delete(groupId);
      writeScopedGroupIds(next);
      return next;
    });
  }

  async function handleUpdateSourcesGroup(groupId: string, groupName: string, feedIds: string[]) {
    if (feedIds.length === 0 || loadingBodies) return;
    setError("");
    setInfo("");
    try {
      const { cancelled } = await startRefreshGroup(groupId, groupName, days);
      if (cancelled) return;
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
    if (!feedId || loadingBodies) return;
    setError("");
    setInfo("");
    try {
      const { cancelled } = await startRefreshFeed(
        feedId,
        feedName,
        days,
        entryUrl == null ? undefined : entryUrl,
      );
      if (cancelled) return;
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

  async function handleDeleteFeeds(
    feedIds: string[],
    removeSkill: boolean,
    options?: { silent?: boolean },
  ) {
    if (feedIds.length === 0) return { removedSkill: false };
    setError("");
    let removedSkill = false;
    for (const feedId of feedIds) {
      const result = await deleteFeed(feedId, removeSkill);
      articlesCache.current.delete(feedId);
      if (result.skill_removed) removedSkill = true;
    }
    const latest = await fetchFeeds();
    setFeeds(latest.feeds);
    setFeedGroups(latest.groups);
    setGroupOrder(latest.group_order ?? []);
    setSelectedFeedId((current) =>
      resolveDefaultFeedId(
        latest.feeds,
        latest.groups,
        latest.group_order ?? [],
        current && feedIds.includes(current) ? null : current,
      ),
    );
    if (!options?.silent) {
      if (removeSkill && removedSkill) {
        setInfo(`已删除 ${feedIds.length} 个源并删除本地 skill`);
      } else {
        setInfo(`已删除 ${feedIds.length} 个源`);
      }
    }
    return { removedSkill };
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

  async function handleRenameGroup(groupId: string, nextName: string) {
    const group = feedGroups.find((item) => item.id === groupId);
    if (!group) return;
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === group.name) return;
    setError("");
    try {
      const nextGroups = feedGroups.map((item) =>
        item.id === groupId ? { ...item, name: trimmed } : item,
      );
      const result = await saveFeedGroups(nextGroups, groupOrder);
      setFeedGroups(result.groups);
      setGroupOrder(result.group_order ?? []);
      await reloadSummaryGroups();
      setInfo(`已将分组重命名为「${trimmed}」`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "重命名分组失败");
    }
  }

  async function handleConfirmGroupBulk() {
    if (!groupBulkTarget) return;
    setDeletingGroupBulk(true);
    setError("");
    try {
      const feedIds = groupBulkTarget.feedIds;
      let removedSkill = false;
      if (feedIds.length > 0) {
        const result = await handleDeleteFeeds(feedIds, groupBulkRemoveSkill, { silent: true });
        removedSkill = result.removedSkill;
      }

      if (groupBulkTarget.kind === "delete-group") {
        const latest = await fetchFeeds();
        const currentGroups = latest.groups;
        const nextGroups = currentGroups.filter((group) => group.id !== groupBulkTarget.id);
        const nextOrder = (latest.group_order ?? groupOrder).filter(
          (id) => id !== groupBulkTarget.id,
        );
        const result = await saveFeedGroups(nextGroups, nextOrder);
        setFeedGroups(result.groups);
        setGroupOrder(result.group_order ?? []);
        setDefaultDigestSkill(result.default_digest_skill ?? defaultDigestSkill);
        const refreshed = await fetchFeeds();
        setFeeds(refreshed.feeds);
        setFeedGroups(refreshed.groups);
        setGroupOrder(refreshed.group_order ?? []);
        setScopedGroupIds((current) => {
          if (!current.has(groupBulkTarget.id)) return current;
          const next = new Set(current);
          next.delete(groupBulkTarget.id);
          writeScopedGroupIds(next);
          return next;
        });
        await reloadSummaryGroups();
        await reloadSchedules();
        const skillHint =
          feedIds.length === 0
            ? "已删除分组"
            : groupBulkRemoveSkill && removedSkill
              ? `已删除分组，并删除组内 ${feedIds.length} 个源及其本地 skill`
              : `已删除分组，并删除组内 ${feedIds.length} 个源（skill 已保留）`;
        setInfo(skillHint);
      } else {
        setInfo(
          groupBulkRemoveSkill && removedSkill
            ? `已清空未分组 ${feedIds.length} 个源并删除本地 skill`
            : `已清空未分组 ${feedIds.length} 个源`,
        );
      }

      setGroupBulkTarget(null);
      setGroupBulkRemoveSkill(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setDeletingGroupBulk(false);
    }
  }

  async function handleSaveGroups(groups: FeedGroup[]) {
    const removedCount = feedGroups.length - groups.length;
    const nextOrder = groupOrder.filter((id) => groups.some((group) => group.id === id));
    for (const group of groups) {
      if (!nextOrder.includes(group.id)) {
        nextOrder.push(group.id);
      }
    }
    const result = await saveFeedGroups(groups, nextOrder);
    setFeedGroups(result.groups);
    setGroupOrder(result.group_order ?? []);
    setDefaultDigestSkill(result.default_digest_skill ?? defaultDigestSkill);
    const latest = await fetchFeeds();
    setFeeds(latest.feeds);
    await reloadSummaryGroups();
    if (removedCount > 0) {
      await reloadSchedules();
    }
    setInfo("分组已保存");
  }

  async function handleLayoutChange(groups: FeedGroup[], nextGroupOrder: string[]) {
    const prevById = new Map(feedGroups.map((group) => [group.id, group]));
    const merged = groups.map((group) => {
      const prev = prevById.get(group.id);
      return {
        ...group,
        digest_skill_id: group.digest_skill_id ?? prev?.digest_skill_id ?? null,
        auto_refresh: group.auto_refresh ?? prev?.auto_refresh ?? true,
      };
    });
    const result = await saveFeedGroups(merged, nextGroupOrder);
    setFeedGroups(result.groups);
    setGroupOrder(result.group_order ?? []);
    const latest = await fetchFeeds();
    setFeeds(latest.feeds);
  }

  const combinedError = error || digestError;
  const embeddingConfigured = isEmbeddingConfigured(settings);
  const hasScopedSelection = scopedSections.length > 0;
  const updateAllSelected =
    hasScopedSelection && scopedSections.length === selectableGroupIds.length;

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
    if (feeds.length === 0) return "还没有数据源";
    if (!hasScopedSelection) {
      return `未勾选分组 · ${formatDaysLabel(days)}`;
    }
    return `已选 ${scopedSections.length} 组 · ${scopedFeedIds.length} 源 · ${formatDaysLabel(days)}`;
  })();

  const sourcesBusy = refreshBusy || loadingBodies;

  const indexScopeLabel = hasScopedSelection
    ? `已选 ${scopedSections.length} 组 · ${scopedFeedIds.length} 源`
    : "所选范围";

  const handleRequestIndexBuild = useCallback(() => {
    if (!hasScopedSelection) return;
    clearErrors();
    void requestIndexBuild({
      feedIds: scopedFeedIds,
      scopeLabel: indexScopeLabel,
    });
  }, [clearErrors, hasScopedSelection, indexScopeLabel, requestIndexBuild, scopedFeedIds]);

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
                : hasScopedSelection
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
            disabled={!hasScopedSelection || loadingBodies}
            title={
              !hasScopedSelection
                ? "请先在侧栏勾选至少一个分组"
                : undefined
            }
            onClick={() => void handleUpdateSourcesSelected()}
            className="ui-btn ui-btn-primary text-sm disabled:opacity-50"
          >
            {updateAllSelected ? "更新全部" : "更新所选"}
          </button>
          {sourcesBusy ? (
            <button
              type="button"
              title="停止更新（列表刷新与正文拉取）"
              onClick={stopUpdateSources}
              className="ui-btn text-sm"
            >
              停止更新
            </button>
          ) : null}
          <button
            type="button"
            disabled={digestBusy || !hasScopedSelection || indexBuildBusy}
            title={
              !embeddingConfigured
                ? "请先在设置配置 Embedding 模型与 API Key"
                : !hasScopedSelection
                  ? "请先在侧栏勾选至少一个分组"
                  : undefined
            }
            onClick={handleRequestIndexBuild}
            className="ui-btn text-sm disabled:opacity-50"
          >
            {loadingIndex ? "建立索引中…" : indexReady ? "重建索引" : "建立索引"}
          </button>
        </div>
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
            onRefreshAll={() => void handleUpdateSourcesSelected()}
            onRefreshGroup={(groupId, groupName, feedIds) =>
              void handleUpdateSourcesGroup(groupId, groupName, feedIds)
            }
            refreshingAll={refreshingAll}
            refreshing={Boolean(refreshingFeedId)}
            refreshingGroupId={refreshingGroupId}
            loadingBodies={loadingBodies}
            loadingBodiesGroupId={loadingBodiesGroupId}
            sourcesBusy={sourcesBusy}
            onAddSource={(groupId) => {
              setAddSourceGroupId(groupId || selectedFeed?.group_id || UNGROUPED_GROUP_ID);
              setAddSourceOpen(true);
            }}
            onManageGroups={() => setGroupModalOpen(true)}
            onRenameGroup={(groupId, name) => handleRenameGroup(groupId, name)}
            onOpenSchedule={(groupId) => {
              const section = sections.find((item) => item.id === groupId);
              if (!section || section.isSystem) return;
              setScheduleModalGroup({ id: section.id, name: section.name });
            }}
            onDeleteGroup={(group) => {
              setGroupBulkRemoveSkill(false);
              setGroupBulkTarget({
                kind: "delete-group",
                id: group.id,
                name: group.name,
                feedIds: group.feedIds,
              });
            }}
            onClearUngrouped={(feedIds) => {
              if (feedIds.length === 0) return;
              setGroupBulkRemoveSkill(false);
              setGroupBulkTarget({ kind: "clear-ungrouped", feedIds });
            }}
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
            scopedGroupIds={scopedGroupIds}
            onToggleGroupScope={handleToggleGroupScope}
            scheduledGroupIds={scheduledGroupIds}
            scheduleHintByGroupId={scheduleHintByGroupId}
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
          setAddSourceGroupId(UNGROUPED_GROUP_ID);
        }}
        groups={feedGroups}
        defaultGroupId={addSourceGroupId}
        initialUrls={addSourceInitialUrls}
        onImported={(result) => {
          pendingForceReload.current = true;
          void loadFeeds().then(() => {
            const skillCount = result.imported.length;
            const platformCount = result.imported_platform_accounts?.length ?? 0;
            const parts: string[] = [];
            if (skillCount > 0) parts.push(`${skillCount} 个 skill`);
            if (platformCount > 0) parts.push(`${platformCount} 个平台账号`);
            const groupName =
              result.group_id === UNGROUPED_GROUP_ID
                ? "未分组"
                : feedGroups.find((group) => group.id === result.group_id)?.name ?? "所选分组";
            let message = `已导入 ${parts.join("、")}到「${groupName}」`;
            if (result.needs_auth?.length) {
              message += `；请补授权：${result.needs_auth.join("、")}`;
            }
            setInfo(message);
          });
        }}
      />
      <FeedGroupModal
        open={groupModalOpen}
        feeds={feeds}
        groups={feedGroups}
        onClose={() => setGroupModalOpen(false)}
        onSave={handleSaveGroups}
        onDeleteFeeds={async (feedIds, removeSkill) => {
          await handleDeleteFeeds(feedIds, removeSkill);
        }}
      />
      <IndexBuildConfirmModal />
      <GroupScheduleModal
        open={Boolean(scheduleModalGroup)}
        groupId={scheduleModalGroup?.id ?? null}
        groupName={scheduleModalGroup?.name ?? ""}
        onClose={() => setScheduleModalGroup(null)}
        onSaved={setSchedules}
      />
      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="删除数据源"
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
        confirmLabel="确认删除"
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
      <ConfirmModal
        open={Boolean(groupBulkTarget)}
        title={
          groupBulkTarget?.kind === "clear-ungrouped" ? "清空未分组" : "删除分组"
        }
        message={
          !groupBulkTarget
            ? ""
            : groupBulkTarget.kind === "clear-ungrouped"
              ? `清空「未分组」下的 ${groupBulkTarget.feedIds.length} 个数据源？\n\n默认保留本地 discovery skill，之后可通过相同链接重新接入。`
              : groupBulkTarget.feedIds.length === 0
                ? `确定删除分组「${groupBulkTarget.name}」？\n\n该分组下没有数据源。`
                : `确定删除分组「${groupBulkTarget.name}」？\n\n将同时删除组内 ${groupBulkTarget.feedIds.length} 个数据源（不会移到「未分组」）。默认保留本地 discovery skill，之后可通过相同链接重新接入。`
        }
        extraContent={
          groupBulkTarget && groupBulkTarget.feedIds.length > 0 ? (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--ink-muted)]">
              <input
                type="checkbox"
                checked={groupBulkRemoveSkill}
                onChange={(e) => setGroupBulkRemoveSkill(e.target.checked)}
                disabled={deletingGroupBulk}
              />
              {groupBulkTarget.feedIds.every((id) =>
                isPlatformFeed(feeds.find((feed) => feed.id === id)),
              )
                ? "同时移除平台账号登记（不删除共享平台 skill）"
                : `同时删除这 ${groupBulkTarget.feedIds.length} 个源的本地 skill 目录（不可恢复）`}
            </label>
          ) : null
        }
        confirmLabel={
          groupBulkTarget?.kind === "clear-ungrouped" ? "确认清空" : "确认删除"
        }
        danger
        loading={deletingGroupBulk}
        onCancel={() => {
          if (!deletingGroupBulk) {
            setGroupBulkTarget(null);
            setGroupBulkRemoveSkill(false);
          }
        }}
        onConfirm={() => {
          void handleConfirmGroupBulk();
        }}
      />
    </div>
  );
}
