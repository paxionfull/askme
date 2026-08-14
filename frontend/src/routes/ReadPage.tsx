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
import { deleteFeedMessage, deleteFeedSuccessMessage, isPlatformFeed, clearUngroupedMessage, deleteGroupMessage } from "../utils/platformFeed";
import { formatMessage } from "../i18n/messages";
import { hydrateFeedsState, writeFeedsCache } from "../utils/feedsCache";
import { useDigest } from "../contexts/DigestContext";
import { useFeedRefresh } from "../contexts/FeedRefreshContext";
import { isEmbeddingConfigured, useSettings, formatDaysLabel } from "../hooks/useSettings";
import { useIndexBuildConfirm } from "../hooks/useIndexBuildConfirm";
import DaysRangeSelect from "../components/DaysRangeSelect";
import { useLocale } from "../i18n/LocaleContext";

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
  const { t, locale } = useLocale();
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
        .map((schedule) => formatScheduleSummary(locale, schedule));
      map[section.id] =
        labels.length > 0
          ? formatMessage(locale, "readScheduleIn", { labels: labels.join(locale === "zh" ? "、" : ", ") })
          : t("readScheduleOut");
    }
    return map;
  }, [locale, schedules, sections, t]);

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
      setError(err instanceof Error ? err.message : t("readErrLoadArticles"));
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
      setError(err instanceof Error ? err.message : t("readErrLoadFeeds"));
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
      setError(err instanceof Error ? err.message : t("readErrLoadArticles"));
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
        setInfo(formatMessage(locale, "readInfoOnboarded", { feedId }));
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
        setInfo(batch.message || formatMessage(locale, "readInfoOnboarded", { feedId }));
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
      setError(err instanceof Error ? err.message : t("readErrUpdateFeed"));
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
        formatMessage(locale, "readInfoGroupUpdated", {
          name: groupName,
          withBody,
          meta,
        }) +
          formatMessage(locale, "parenWrap", { value: formatDaysLabel(days) }) +
          (missing > 0 ? formatMessage(locale, "readInfoGroupUpdatedMissing", { missing }) : "") +
          formatMessage(locale, "readInfoGroupUpdatedStats", { cached, fetched }),
      );
      for (const feedId of feedIds) {
        articlesCache.current.delete(articleCacheKey(feedId, days));
      }
      if (selectedFeedId && feedIds.includes(selectedFeedId)) {
        void loadArticles(selectedFeedId, days, true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("readErrUpdateGroup"));
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
      setError(err instanceof Error ? err.message : t("readErrUpdateFeed"));
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
      setInfo(deleteFeedSuccessMessage(locale, result));
      await reloadSummaryGroups();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("readErrDelete"));
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
        setInfo(formatMessage(locale, "readInfoDeletedFeedsSkill", { count: feedIds.length }));
      } else {
        setInfo(formatMessage(locale, "readInfoDeletedFeeds", { count: feedIds.length }));
      }
    }
    await reloadSummaryGroups();
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
      setInfo(formatMessage(locale, "readInfoRenamedFeed", { from: feed.name, to: nextName }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("readErrRename"));
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
      setInfo(formatMessage(locale, "readInfoRenamedGroup", { name: trimmed }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("readErrRenameGroup"));
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
            ? t("readInfoDeletedGroup")
            : groupBulkRemoveSkill && removedSkill
              ? formatMessage(locale, "readInfoDeletedGroupWithSkill", { count: feedIds.length })
              : formatMessage(locale, "readInfoDeletedGroupKeepSkill", { count: feedIds.length });
        setInfo(skillHint);
      } else {
        setInfo(
          groupBulkRemoveSkill && removedSkill
            ? formatMessage(locale, "readInfoClearedUngroupedSkill", { count: feedIds.length })
            : formatMessage(locale, "readInfoClearedUngrouped", { count: feedIds.length }),
        );
      }

      setGroupBulkTarget(null);
      setGroupBulkRemoveSkill(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("readErrOperation"));
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
    setInfo(t("readInfoGroupsSaved"));
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
    await reloadSummaryGroups();
  }

  const combinedError = error || digestError;
  const embeddingConfigured = isEmbeddingConfigured(settings);
  const hasScopedSelection = scopedSections.length > 0;
  const updateAllSelected =
    hasScopedSelection && scopedSections.length === selectableGroupIds.length;

  const sourcesStatus = (() => {
    if (refreshBusy) return t("loading");
    if (loadingBodies) {
      return bodyProgress.total > 0
        ? `${t("fetchingBodies")} ${bodyProgress.current}/${bodyProgress.total}`
        : t("fetchingBodiesMessage");
    }
    if (loadingIndex) {
      return indexProgress.total > 0
        ? `${t("buildingIndex")} ${indexProgress.current}/${indexProgress.total}`
        : t("buildingIndexMessage");
    }
    if (feeds.length === 0) return t("sourcesNoFeeds");
    if (!hasScopedSelection) {
      return `${t("sourcesNoneSelected")} · ${formatDaysLabel(days)}`;
    }
    return `${t("sourcesScopeSelected")} ${scopedSections.length} ${t("sourcesGroups")} · ${scopedFeedIds.length} ${t("sourcesFeeds")} · ${formatDaysLabel(days)}`;
  })();

  const sourcesBusy = refreshBusy || loadingBodies;

  const indexScopeLabel = hasScopedSelection
    ? formatMessage(locale, "readScopeSelected", {
        groups: scopedSections.length,
        feeds: scopedFeedIds.length,
      })
    : t("readScopeDefault");

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
      <header className="border-b border-[var(--rule)] bg-[var(--paper-raised)] px-5 pb-3 pt-4">
        <h1 className="app-page-title text-[var(--ink)]">{t("sourcesTitle")}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2">
          <label className="inline-flex items-center gap-1.5 text-sm">
            <span className="text-xs text-[var(--ink-muted)]">{t("sourcesRange")}</span>
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
                ? t("sourcesNeedGroup")
                : undefined
            }
            onClick={() => void handleUpdateSourcesSelected()}
            className="ui-btn ui-btn-primary text-sm disabled:opacity-50"
          >
            {updateAllSelected ? t("sourcesUpdateAll") : t("sourcesUpdateSelected")}
          </button>
          {sourcesBusy ? (
            <button
              type="button"
              title={t("sourcesStopUpdateTitle")}
              onClick={stopUpdateSources}
              className="ui-btn text-sm"
            >
              {t("sourcesStopUpdate")}
            </button>
          ) : null}
          <button
            type="button"
            disabled={digestBusy || !hasScopedSelection || indexBuildBusy}
            title={
              !embeddingConfigured
                ? t("sourcesNeedEmbedding")
                : !hasScopedSelection
                  ? t("sourcesNeedGroup")
                  : indexReady
                    ? t("sourcesRebuildIndexTitle")
                    : t("sourcesBuildIndexTitle")
            }
            onClick={handleRequestIndexBuild}
            className="ui-btn text-sm disabled:opacity-50"
          >
            {loadingIndex ? t("sourcesBuildingIndex") : indexReady ? t("sourcesRebuildIndex") : t("sourcesBuildIndex")}
          </button>
        </div>
      </header>

      {combinedError && (
        <div
          className="whitespace-pre-wrap border-b border-[var(--rule)] bg-[var(--error-soft)] px-4 py-2.5 text-sm text-[var(--danger-text)]"
          role="alert"
        >
          {combinedError}
        </div>
      )}

      {info ? (
        <div
          className="border-b border-[var(--rule)] bg-[var(--accent-soft)] px-4 py-2.5 text-sm text-[var(--accent)]"
          role="status"
        >
          {info}
        </div>
      ) : null}

      <div className="app-sources-split flex min-h-0 flex-1">
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
      </div>

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
            if (skillCount > 0) {
              parts.push(formatMessage(locale, "readImportSkillUnit", { count: skillCount }));
            }
            if (platformCount > 0) {
              parts.push(formatMessage(locale, "readImportAccountUnit", { count: platformCount }));
            }
            const groupName =
              result.group_id === UNGROUPED_GROUP_ID
                ? t("addSourceUngrouped")
                : feedGroups.find((group) => group.id === result.group_id)?.name ?? t("readScopeDefault");
            let message = formatMessage(locale, "readImportSuccess", {
              parts: parts.join(locale === "zh" ? "、" : ", "),
              group: groupName,
            });
            if (result.needs_auth?.length) {
              message += formatMessage(locale, "readImportNeedAuth", {
                slots: result.needs_auth.join(locale === "zh" ? "、" : ", "),
              });
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
        title={t("deleteFeedTitle")}
        message={deleteTarget ? deleteFeedMessage(locale, deleteTarget) : ""}
        extraContent={
          deleteTarget && !isPlatformFeed(deleteTarget) ? (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--ink-muted)]">
              <input
                type="checkbox"
                checked={deleteRemoveSkill}
                onChange={(e) => setDeleteRemoveSkill(e.target.checked)}
                disabled={deletingFeed}
              />
              {t("deleteFeedRemoveSkill")}
            </label>
          ) : null
        }
        confirmLabel={t("deleteFeedConfirm")}
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
          groupBulkTarget?.kind === "clear-ungrouped" ? t("clearUngroupedTitle") : t("deleteGroupTitle")
        }
        message={
          !groupBulkTarget
            ? ""
            : groupBulkTarget.kind === "clear-ungrouped"
              ? clearUngroupedMessage(locale, groupBulkTarget.feedIds.length)
              : deleteGroupMessage(
                  locale,
                  groupBulkTarget.name,
                  groupBulkTarget.feedIds.length,
                )
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
                ? t("deleteGroupRemovePlatform")
                : formatMessage(locale, "deleteGroupRemoveSkills", {
                    count: groupBulkTarget.feedIds.length,
                  })}
            </label>
          ) : null
        }
        confirmLabel={
          groupBulkTarget?.kind === "clear-ungrouped" ? t("confirmClear") : t("deleteFeedConfirm")
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
