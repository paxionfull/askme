import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchCachedSummary,
  fetchDigestSkills,
  fetchFeeds,
  saveFeedGroups,
  type BriefHistoryItem,
  type CachedSummaryResponse,
  type DigestSkillDetail,
} from "../api";
import ConfirmModal from "../components/ConfirmModal";
import DaysRangeSelect from "../components/DaysRangeSelect";
import DigestGeneratingPanel from "../components/DigestGeneratingPanel";
import BriefHistoryRail from "../components/brief/BriefHistoryRail";
import BriefInsightPanel from "../components/brief/BriefInsightPanel";
import DigestTreeView from "../components/DigestTreeView";
import GettingStartedGuide, { useGettingStartedCopy } from "../components/GettingStartedGuide";
import { type OverflowMenuItem } from "../components/OverflowMenu";
import RuleExplainModal from "../components/RuleExplainModal";
import SummaryMarkdown, {
  acceptsArticleDrag,
  readArticleDragPayload,
} from "../components/SummaryMarkdown";
import { useChat } from "../contexts/ChatContext";
import { useDigest } from "../contexts/DigestContext";
import { useIndexBuildConfirm } from "../hooks/useIndexBuildConfirm";
import { formatDaysLabel, isLlmConfigured, useSettings } from "../hooks/useSettings";
import { useLocale } from "../i18n/LocaleContext";
import { formatMessage, type MessageKey } from "../i18n/messages";
import { UNGROUPED_GROUP_ID } from "../utils/feedLayout";
import {
  buildDigestExportFilename,
  buildDigestMarkdownFromText,
  buildDigestMarkdownFromTree,
  downloadMarkdownFile,
  formatDigestDayRange,
} from "../utils/digestMarkdown";
import {
  briefExcerptFromSummary,
  historyItemKey,
  historyScopeMatches,
} from "../utils/briefHistory";

/** 焦点在可输入控件 / 菜单 / 弹层时，不抢占 Enter 发送。 */
function isComposerShortcutBlocked(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest("textarea, input, select, [contenteditable='true']")) return true;
  if (target.closest('[role="dialog"], [role="menu"], [role="listbox"], [role="combobox"]')) {
    return true;
  }
  return false;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'a, button, input, textarea, select, summary, label, [role="button"], [role="menuitem"], [contenteditable="true"]',
    ),
  );
}

const CHAT_MESSAGES_SCROLL_KEY = "askme.chat.messagesScroll";

type SavedMessagesScroll = {
  scopeKey: string;
  top: number;
  stick: boolean;
};

function messagesScrollScopeKey(days: number): string {
  return String(days);
}

function loadSavedMessagesScroll(scopeKey: string): SavedMessagesScroll | null {
  try {
    const raw = sessionStorage.getItem(CHAT_MESSAGES_SCROLL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedMessagesScroll>;
    if (parsed.scopeKey !== scopeKey || typeof parsed.top !== "number") return null;
    return { scopeKey, top: parsed.top, stick: Boolean(parsed.stick) };
  } catch {
    return null;
  }
}

function persistMessagesScroll(scopeKey: string, top: number, stick: boolean) {
  try {
    sessionStorage.setItem(
      CHAT_MESSAGES_SCROLL_KEY,
      JSON.stringify({ scopeKey, top, stick } satisfies SavedMessagesScroll),
    );
  } catch {
    // ignore quota / private mode
  }
}

function getSubmitDisabledTitle(params: {
  input: string;
  scopedCount: number;
  effectiveRagReady: boolean;
  llmConfigured: boolean;
  loadingStatus: boolean;
  canSubmit: boolean;
  t: (key: MessageKey) => string;
}): string | undefined {
  const { input, scopedCount, effectiveRagReady, llmConfigured, loadingStatus, canSubmit, t } =
    params;
  if (canSubmit) return undefined;
  const trimmed = input.trim();
  if (trimmed) {
    if (!effectiveRagReady) {
      return loadingStatus ? t("chatSubmitSyncing") : t("chatSubmitNeedIndex");
    }
    if (!llmConfigured) return t("chatSubmitNeedLlm");
    return undefined;
  }
  if (scopedCount > 0 && !llmConfigured) return t("chatSubmitSummaryNeedLlm");
  if (!effectiveRagReady && !loadingStatus) {
    return t("chatSubmitNeedIndexOrSummary");
  }
  if (scopedCount > 0) return t("chatSubmitEmptySummary");
  return t("chatEmptyHint");
}

export default function ChatPage() {
  const { t, locale } = useLocale();
  const gettingStarted = useGettingStartedCopy();
  const { settings } = useSettings();
  const {
    days,
    setDays,
    summary,
    thinking,
    generating,
    summaryPhase,
    statusMessage: summarizeStatus,
    summaryError,
    digestBusy,
    loadingIndex,
    startSummarize,
    stopSummarize,
    summaryGroupOptions,
    selectedGroupId,
    selectedGroupIds,
    setSelectedSummaryGroup,
    reloadSummaryGroups,
  } = useDigest();
  const {
    loadingSummary,
    chatSummary,
    digestTree,
    articleRefs,
    scopedArticles,
    addScopedArticle,
    addScopedArticles,
    removeScopedArticle,
    clearScopedArticles,
    loadingStatus,
    statusRevalidating,
    effectiveRagReady,
    messages,
    citations,
    activeCitationIndex,
    setActiveCitationIndex,
    promptPreview,
    input,
    setInput,
    sending,
    statusMessage,
    error,
    canSend,
    canSendScopedSummary,
    sendMessage,
    stopGeneration,
    clearMessages,
    selectMessageCitations,
  } = useChat();

  const { requestIndexBuild, IndexBuildConfirmModal, IndexBuildLink, indexBuildBusy } =
    useIndexBuildConfirm();

  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  /** 仅当用户已在底部附近时才跟滚；刷新后先恢复保存的滚动位置。 */
  const stickToBottomRef = useRef(false);
  const pendingScrollRestoreRef = useRef<SavedMessagesScroll | null>(
    loadSavedMessagesScroll(messagesScrollScopeKey(days)),
  );
  const suppressScrollPersistRef = useRef(false);
  const scrollScopeKeyRef = useRef(messagesScrollScopeKey(days));
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const overviewScrollRef = useRef<HTMLDivElement>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const [exportDone, setExportDone] = useState(false);
  const [regenConfirmOpen, setRegenConfirmOpen] = useState(false);
  const [selectedHistoryKey, setSelectedHistoryKey] = useState<string | null>(null);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<BriefHistoryItem | null>(null);
  const [historySnapshot, setHistorySnapshot] = useState<CachedSummaryResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);
  const [mobileBriefTab, setMobileBriefTab] = useState<"history" | "stage" | "ask">("stage");
  const exportResetTimerRef = useRef<number | null>(null);
  const viewingLiveScope =
    !selectedHistoryItem || historyScopeMatches(selectedHistoryItem, days, selectedGroupIds);
  const displaySummary = viewingLiveScope
    ? generating
      ? summary
      : chatSummary
    : historySnapshot?.summary ?? "";
  const displayTree = viewingLiveScope
    ? generating
      ? null
      : digestTree
    : historySnapshot?.digest_tree ?? null;
  const stageArticleRefs = viewingLiveScope
    ? articleRefs
    : (historySnapshot?.article_refs ?? []).map((article) => ({
        feed_id: article.feed_id,
        article_id: article.article_id,
        title: article.title ?? "",
        url: article.url ?? "",
      }));
  const showTree = Boolean(!generating && displayTree);
  const hasOverview = Boolean(displaySummary || displayTree || generating);

  const formatDateLabel = (when: Date) => {
    if (locale === "zh") {
      const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
      return {
        date: `${when.getMonth() + 1} 月 ${when.getDate()} 日`,
        weekday: `星期${weekdays[when.getDay()]}`,
      };
    }
    return {
      date: when.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
      weekday: when.toLocaleDateString("en-US", { weekday: "long" }),
    };
  };
  const todayLabel = formatDateLabel(new Date());
  const stageDateLabel = (() => {
    if (!viewingLiveScope) {
      const ts = historySnapshot?.updated_at ?? selectedHistoryItem?.updated_at;
      if (ts) return formatDateLabel(new Date(ts * 1000));
    }
    return todayLabel;
  })();
  const [citationOpen, setCitationOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [digestSkills, setDigestSkills] = useState<DigestSkillDetail[]>([]);
  const [savingRule, setSavingRule] = useState(false);
  const [composerNudge, setComposerNudge] = useState(false);
  const [ruleExplainOpen, setRuleExplainOpen] = useState(false);
  const llmConfigured = isLlmConfigured(settings);
  const selectedGroup = summaryGroupOptions.find((group) => group.id === selectedGroupId) ?? null;
  const isUngrouped = selectedGroupId === UNGROUPED_GROUP_ID;
  const hasRuleBound = Boolean(selectedGroup?.digestSkillId) && !isUngrouped;
  const indexScopeLabel = selectedGroup?.name?.trim() || t("chatCurrentSection");
  const indexFeedIds = useMemo(
    () => selectedGroup?.feedIds ?? [],
    [selectedGroup?.feedIds],
  );
  const openIndexBuild = useCallback(() => {
    void requestIndexBuild({
      feedIds: indexFeedIds,
      scopeLabel: indexScopeLabel,
    });
  }, [indexFeedIds, indexScopeLabel, requestIndexBuild]);
  const canSubmit = (canSend && Boolean(input.trim())) || canSendScopedSummary;
  const submitDisabledTitle = getSubmitDisabledTitle({
    input,
    scopedCount: scopedArticles.length,
    effectiveRagReady,
    llmConfigured,
    loadingStatus,
    canSubmit,
    t,
  });
  const composerHint = (() => {
    if (sending) return null;
    const trimmed = input.trim();
    if (trimmed) {
      if (!effectiveRagReady) {
        if (loadingStatus) return t("chatSyncingReady");
        return (
          <>
            {t("chatNeedIndexPrefix")}{" "}
            <IndexBuildLink onClick={openIndexBuild} disabled={indexBuildBusy} />
            {t("chatNeedIndexSuffix")}
          </>
        );
      }
      if (!llmConfigured) {
        return (
          <>
            {t("chatConfigureLlmPrefix")}{" "}
            <Link to="/settings" className="text-[var(--accent)] hover:underline">
              {t("settingsTitle")}
            </Link>{" "}
            {t("chatConfigureLlmSuffix")}
          </>
        );
      }
      return null;
    }
    if (scopedArticles.length > 0 && !llmConfigured) {
      return (
        <>
          {t("chatSummaryNeedLlmPrefix")}{" "}
          <Link to="/settings" className="text-[var(--accent)] hover:underline">
            {t("settingsTitle")}
          </Link>{" "}
          {t("chatSummaryNeedLlmSuffix")}
        </>
      );
    }
    if (composerNudge && !canSubmit) {
      if (!effectiveRagReady && !loadingStatus) {
        return (
          <>
            {t("chatNeedIndexPrefix")}{" "}
            <IndexBuildLink onClick={openIndexBuild} disabled={indexBuildBusy} />
            {t("chatNeedIndexOrSummary")}
          </>
        );
      }
      return t("chatEmptyHint");
    }
    return null;
  })();
  const inputPlaceholder = (() => {
    if (scopedArticles.length > 0) {
      return input.trim()
        ? formatMessage(locale, "chatScopedEnterSend", { count: scopedArticles.length })
        : formatMessage(locale, "chatScopedEnterSummary", { count: scopedArticles.length });
    }
    if (loadingStatus && !effectiveRagReady) return t("askSyncing");
    if (!effectiveRagReady) return t("askNeedIndexHint");
    if (!llmConfigured) return t("askNeedLlm");
    return t("askPlaceholder");
  })();

  const boundRuleName =
    digestSkills.find((skill) => skill.id === selectedGroup?.digestSkillId)?.name ||
    selectedGroup?.digestSkillId ||
    "";

  const handleExportMarkdown = useCallback(() => {
    const groupName = selectedGroup?.name?.trim() || t("chatDefaultBrief");
    const dayRange = formatDigestDayRange(days);
    const meta = {
      groupName,
      rangeLabel: formatDaysLabel(days),
      dayRange,
      ruleName: boundRuleName || t("chatUnbound"),
    };
    let md = "";
    if (displayTree && !generating) {
      md = buildDigestMarkdownFromTree(displayTree, meta, locale);
    } else if (displaySummary.trim()) {
      md = buildDigestMarkdownFromText(displaySummary, meta, locale);
    } else {
      return;
    }
    downloadMarkdownFile(buildDigestExportFilename(groupName, dayRange, locale), md);
    setExportDone(true);
    if (exportResetTimerRef.current != null) {
      window.clearTimeout(exportResetTimerRef.current);
    }
    exportResetTimerRef.current = window.setTimeout(() => {
      setExportDone(false);
      exportResetTimerRef.current = null;
    }, 1600);
  }, [
    boundRuleName,
    days,
    displayTree,
    displaySummary,
    generating,
    locale,
    selectedGroup?.name,
    t,
  ]);

  useEffect(() => {
    return () => {
      if (exportResetTimerRef.current != null) {
        window.clearTimeout(exportResetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    // 从源页切回时刷新板块列表（DigestProvider 常驻，不会自动重载）
    void reloadSummaryGroups();
  }, [reloadSummaryGroups]);

  useEffect(() => {
    void fetchDigestSkills()
      .then((data) => setDigestSkills(data.skills))
      .catch(() => setDigestSkills([]));
  }, []);

  const bindRuleToSelectedGroup = useCallback(
    async (skillId: string) => {
      if (!selectedGroupId || selectedGroupId === UNGROUPED_GROUP_ID) return;
      setSavingRule(true);
      try {
        const feedsData = await fetchFeeds();
        const groups = feedsData.groups.map((group) =>
          group.id === selectedGroupId
            ? { ...group, digest_skill_id: skillId || null }
            : group,
        );
        await saveFeedGroups(groups, feedsData.group_order);
        await reloadSummaryGroups();
      } catch {
        // 错误由后续生成门禁提示
      } finally {
        setSavingRule(false);
      }
    },
    [reloadSummaryGroups, selectedGroupId],
  );

  const statusLine = (() => {
    if (!hasRuleBound && !loadingSummary && !generating) {
      return t("briefNeedRuleStatus");
    }
    if (scopedArticles.length > 0) {
      return `${t("briefScopedArticles")} ${scopedArticles.length} ${t("briefArticlesUnit")}`;
    }
    if (loadingIndex) {
      return t("briefBuildingIndexStatus");
    }
    if (loadingStatus && !effectiveRagReady) {
      return t("briefSyncingIndexStatus");
    }
    if (effectiveRagReady) {
      if (statusRevalidating) return t("briefSyncingStatus");
      return null;
    }
    return t("briefNoIndexStatus");
  })();

  const emptyState = (() => {
    if (messages.length > 0) return null;
    if (generating) return { kind: "generating" as const };
    if (scopedArticles.length > 0) return { kind: "scoped" as const };
    return {
      kind: "guide" as const,
      needIndex: !effectiveRagReady,
    };
  })();

  const handleSelectHistory = useCallback(
    async (item: BriefHistoryItem) => {
      setSelectedHistoryKey(historyItemKey(item));
      setSelectedHistoryItem(item);
      setMobileBriefTab("stage");
      if (historyScopeMatches(item, days, selectedGroupIds)) {
        setHistorySnapshot(null);
        return;
      }
      setHistoryLoading(true);
      try {
        const data = await fetchCachedSummary(item.days, item.feed_ids, item.group_ids, {
          allowHistory: true,
        });
        setHistorySnapshot(data);
      } catch {
        setHistorySnapshot(null);
      } finally {
        setHistoryLoading(false);
      }
    },
    [days, selectedGroupIds],
  );

  useEffect(() => {
    if (!generating && hasOverview && viewingLiveScope) {
      setHistoryRefreshToken((value) => value + 1);
    }
  }, [generating, hasOverview, viewingLiveScope]);

  useEffect(() => {
    setSelectedHistoryKey(null);
    setSelectedHistoryItem(null);
    setHistorySnapshot(null);
  }, [days, selectedGroupIds]);

  const stageExcerpt = useMemo(
    () => briefExcerptFromSummary(displaySummary),
    [displaySummary],
  );

  const stageSourceCount = useMemo(() => {
    if (selectedHistoryItem && !viewingLiveScope) return selectedHistoryItem.source_count;
    const feeds = new Set(stageArticleRefs.map((article) => article.feed_id).filter(Boolean));
    return feeds.size;
  }, [selectedHistoryItem, stageArticleRefs, viewingLiveScope]);

  const stageArticleCount = useMemo(() => {
    if (selectedHistoryItem && !viewingLiveScope) return selectedHistoryItem.article_count;
    if (historySnapshot?.article_count) return historySnapshot.article_count;
    return stageArticleRefs.length;
  }, [historySnapshot?.article_count, selectedHistoryItem, stageArticleRefs.length, viewingLiveScope]);

  const focusChatInput = useCallback(() => {
    const el = chatInputRef.current;
    if (!el || el.disabled) return;
    el.focus({ preventScroll: true });
  }, []);

  const handleSend = useCallback(() => {
    if (sending) return;
    if (canSubmit) {
      setComposerNudge(false);
      stickToBottomRef.current = true;
      pendingScrollRestoreRef.current = null;
      persistMessagesScroll(scrollScopeKeyRef.current, Number.MAX_SAFE_INTEGER, true);
      void sendMessage(input);
      return;
    }
    setComposerNudge(true);
  }, [canSubmit, input, sendMessage, sending]);

  useEffect(() => {
    if (canSubmit) setComposerNudge(false);
  }, [canSubmit]);

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
      event.preventDefault();
      handleSend();
    },
    [handleSend],
  );

  // Enter 发送；/ 聚焦提问；G 生成；Shift+R 重新生成；? 帮助
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented) return;

      if (event.key === "Enter" && !event.shiftKey) {
        if (isComposerShortcutBlocked(event.target)) return;
        if (sending) return;
        event.preventDefault();
        focusChatInput();
        handleSend();
        return;
      }

      if (isComposerShortcutBlocked(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "/" && !event.shiftKey) {
        event.preventDefault();
        focusChatInput();
        return;
      }
      if (event.key === "?" || (event.shiftKey && event.key === "/")) {
        event.preventDefault();
        window.dispatchEvent(new Event("askme:open-help"));
        return;
      }
      if (event.key === "g" || event.key === "G") {
        if (generating || digestBusy || !selectedGroupId || !hasRuleBound || !llmConfigured) return;
        event.preventDefault();
        if (hasOverview) setRegenConfirmOpen(true);
        else void startSummarize();
        return;
      }
      if (event.shiftKey && (event.key === "R" || event.key === "r")) {
        if (!hasOverview || generating || digestBusy || !hasRuleBound || !llmConfigured) return;
        event.preventDefault();
        setRegenConfirmOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    focusChatInput,
    handleSend,
    sending,
    generating,
    digestBusy,
    selectedGroupId,
    hasRuleBound,
    llmConfigured,
    hasOverview,
    startSummarize,
  ]);

  const handleArticleDragOver = useCallback((event: React.DragEvent) => {
    if (!acceptsArticleDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  }, []);

  const handleArticleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setDropActive(false);
      const payload = readArticleDragPayload(event.dataTransfer);
      if (payload.group) {
        addScopedArticles(
          payload.group.articles.map((article) => ({
            feed_id: article.feed_id,
            article_id: article.article_id,
            title: article.title || t("chatUnnamedArticle"),
            url: article.url || "",
          })),
        );
      } else if (payload.single) {
        addScopedArticle({
          feed_id: payload.single.feed_id,
          article_id: payload.single.article_id,
          title: payload.single.title || t("chatUnnamedArticle"),
          url: payload.single.url || "",
        });
      } else {
        return;
      }
      // drop 后浏览器常把焦点留给拖放目标，延后一帧再抢回输入框
      window.requestAnimationFrame(() => focusChatInput());
    },
    [addScopedArticle, addScopedArticles, focusChatInput],
  );

  const handleArticleDragLeave = useCallback((event: React.DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDropActive(false);
    }
  }, []);

  /** 点击右侧对话区非交互位置后把焦点收回输入框（保留划词；有选区则不抢焦）。 */
  const handleChatPaneClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 0) return;
      if (isInteractiveTarget(event.target)) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      focusChatInput();
    },
    [focusChatInput],
  );

  const focusCitation = useCallback(
    (citationIndex: number, messageIndex?: number) => {
      if (messageIndex !== undefined) {
        selectMessageCitations(messageIndex);
      }
      setActiveCitationIndex(citationIndex);
      setCitationOpen(true);
    },
    [selectMessageCitations, setActiveCitationIndex],
  );

  useEffect(() => {
    const nextKey = messagesScrollScopeKey(days);
    if (scrollScopeKeyRef.current === nextKey) return;
    scrollScopeKeyRef.current = nextKey;
    pendingScrollRestoreRef.current = loadSavedMessagesScroll(nextKey);
    stickToBottomRef.current = Boolean(pendingScrollRestoreRef.current?.stick);
  }, [days]);

  useEffect(() => {
    const scroller = messagesScrollRef.current;
    if (!scroller) return;

    const onScroll = () => {
      if (suppressScrollPersistRef.current) return;
      pendingScrollRestoreRef.current = null;
      const distanceFromBottom =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      const stick = distanceFromBottom < 80;
      stickToBottomRef.current = stick;
      persistMessagesScroll(scrollScopeKeyRef.current, scroller.scrollTop, stick);
    };

    const flush = () => {
      persistMessagesScroll(
        scrollScopeKeyRef.current,
        scroller.scrollTop,
        stickToBottomRef.current,
      );
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
    };
  }, []);

  useLayoutEffect(() => {
    const scroller = messagesScrollRef.current;
    if (!scroller) return;

    const pending = pendingScrollRestoreRef.current;
    if (pending) {
      stickToBottomRef.current = pending.stick;
      suppressScrollPersistRef.current = true;
      if (pending.stick) {
        scroller.scrollTop = scroller.scrollHeight;
        pendingScrollRestoreRef.current = null;
      } else {
        const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        scroller.scrollTop = Math.min(pending.top, maxTop);
        // 内容尚未撑开到原先高度时继续等下一轮消息/渲染再恢复
        if (pending.top <= maxTop + 1) {
          pendingScrollRestoreRef.current = null;
        }
      }
      requestAnimationFrame(() => {
        suppressScrollPersistRef.current = false;
      });
      return;
    }

    if (!stickToBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, sending, statusMessage]);

  useEffect(() => {
    if (sending) {
      setCitationOpen(false);
    }
  }, [sending]);

  useEffect(() => {
    if (messages.length === 0) {
      setCitationOpen(false);
    }
  }, [messages.length]);

  useEffect(() => {
    if (editingIndex != null) {
      editTextareaRef.current?.focus();
    }
  }, [editingIndex]);

  useEffect(() => {
    if (editingIndex != null && editingIndex >= messages.length) {
      setEditingIndex(null);
      setEditingText("");
    }
  }, [editingIndex, messages.length]);

  useEffect(() => {
    const el = chatInputRef.current;
    if (!el) return;
    if (!input) {
      el.style.height = "auto";
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [input]);

  const startInlineEdit = useCallback((index: number, content: string) => {
    setEditingIndex(index);
    setEditingText(content);
  }, []);

  const cancelInlineEdit = useCallback(() => {
    setEditingIndex(null);
    setEditingText("");
  }, []);

  const submitInlineEdit = useCallback(() => {
    if (editingIndex == null || !editingText.trim()) return;
    const index = editingIndex;
    const text = editingText;
    setEditingIndex(null);
    setEditingText("");
    stickToBottomRef.current = true;
    pendingScrollRestoreRef.current = null;
    persistMessagesScroll(scrollScopeKeyRef.current, Number.MAX_SAFE_INTEGER, true);
    void sendMessage(text, { replaceFromIndex: index });
  }, [editingIndex, editingText, sendMessage]);

  const composerMenuItems: OverflowMenuItem[] = [];
  composerMenuItems.push({
    label: t("shortcutsMenu"),
    hint: t("shortcutsHint"),
    onClick: () => window.alert(t("shortcutsHint")),
  });
  if (promptPreview) {
    composerMenuItems.push({
      label: showPromptPreview ? t("askHidePrompt") : t("askShowPrompt"),
      onClick: () => setShowPromptPreview((open) => !open),
    });
  }
  if (messages.length > 0) {
    composerMenuItems.push({
      label: t("askClearChat"),
      danger: true,
      onClick: () => {
        cancelInlineEdit();
        setCitationOpen(false);
        stickToBottomRef.current = false;
        pendingScrollRestoreRef.current = null;
        persistMessagesScroll(scrollScopeKeyRef.current, 0, false);
        clearMessages();
      },
    });
  }

  return (
    <div className="flex h-full flex-col bg-[var(--surface)]">
      <h1 className="sr-only">{t("briefLabel")}</h1>

      <div className="app-brief-mobile-tabs" role="tablist" aria-label={t("briefLabel")}>
        <button
          type="button"
          role="tab"
          className={mobileBriefTab === "history" ? "is-active" : ""}
          aria-selected={mobileBriefTab === "history"}
          onClick={() => setMobileBriefTab("history")}
        >
          {t("briefHistoryTab")}
        </button>
        <button
          type="button"
          role="tab"
          className={mobileBriefTab === "stage" ? "is-active" : ""}
          aria-selected={mobileBriefTab === "stage"}
          onClick={() => setMobileBriefTab("stage")}
        >
          {t("briefStageTab")}
        </button>
        <button
          type="button"
          role="tab"
          className={mobileBriefTab === "ask" ? "is-active" : ""}
          aria-selected={mobileBriefTab === "ask"}
          onClick={() => setMobileBriefTab("ask")}
        >
          {t("briefAskTab")}
        </button>
      </div>

      <div className="app-brief-stage">
        <BriefHistoryRail
          className={mobileBriefTab === "history" ? "" : "is-mobile-hidden"}
          selectedKey={selectedHistoryKey}
          onSelect={(item) => void handleSelectHistory(item)}
          refreshToken={historyRefreshToken}
        />

        <section
          className={`brief-stage-pane${mobileBriefTab === "stage" ? "" : " is-mobile-hidden"}`}
          aria-label={t("briefLabel")}
        >
          <header className="brief-stage-header">
            <h2 className="brief-stage-title">
              {stageDateLabel.date}
              <span className="brief-home-weekday"> · {stageDateLabel.weekday}</span>
            </h2>
            {(stageArticleCount > 0 || stageSourceCount > 0 || summaryError) && (
              <div className="brief-stage-meta">
                {stageArticleCount > 0 ? (
                  <span className="brief-stage-meta-chip">
                    {stageArticleCount} {t("briefArticlesUnit")}
                  </span>
                ) : null}
                {stageSourceCount > 0 ? (
                  <span className="brief-stage-meta-chip">
                    {stageSourceCount} {t("briefHistoryColSources").toLowerCase()}
                  </span>
                ) : null}
                {summaryError ? (
                  <span className="brief-stage-meta-chip text-[var(--danger-text)]" role="alert">
                    {summaryError}
                  </span>
                ) : null}
              </div>
            )}
            <div className="brief-home-bar mt-2">
              <div className="brief-toolbar" role="group" aria-label={t("briefScope")}>
                <div className="brief-toolbar-fields">
                  <label className="brief-toolbar-field">
                    <span>{t("briefGroup")}</span>
                    <select
                      value={selectedGroupId ?? ""}
                      onChange={(e) => setSelectedSummaryGroup(e.target.value)}
                      disabled={summaryGroupOptions.length === 0 || digestBusy}
                      className="ui-select min-w-0 truncate disabled:opacity-50"
                      aria-label={t("briefSelectGroup")}
                    >
                      {summaryGroupOptions.length === 0 ? (
                        <option value="">{t("briefNoGroups")}</option>
                      ) : (
                        summaryGroupOptions.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                  <label className="brief-toolbar-field">
                    <span>{t("briefRange")}</span>
                    <DaysRangeSelect
                      value={days}
                      onChange={setDays}
                      disabled={digestBusy}
                      size="sm"
                      className="shrink-0"
                    />
                  </label>
                  {selectedGroupId && !isUngrouped ? (
                    <label className={`brief-toolbar-field ${hasRuleBound ? "" : "is-unset"}`}>
                      <span>{t("briefRule")}</span>
                      <select
                        value={selectedGroup?.digestSkillId ?? ""}
                        onChange={(e) => void bindRuleToSelectedGroup(e.target.value)}
                        disabled={digestBusy || savingRule || digestSkills.length === 0}
                        className="ui-select min-w-0 truncate disabled:opacity-50"
                        aria-label={t("briefSelectRule")}
                        title={hasRuleBound ? boundRuleName : t("briefRuleRequiredTitle")}
                      >
                        <option value="">{t("briefUnset")}</option>
                        {digestSkills.map((skill) => (
                          <option key={skill.id} value={skill.id}>
                            {skill.name || skill.id}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>

                <div className="brief-toolbar-actions">
                  {generating || !hasOverview ? (
                    <button
                      type="button"
                      disabled={
                        generating
                          ? false
                          : digestBusy ||
                            !isLlmConfigured(settings) ||
                            !selectedGroupId ||
                            !hasRuleBound
                      }
                      onClick={() => {
                        if (generating) {
                          void stopSummarize();
                          return;
                        }
                        void startSummarize();
                      }}
                      className={generating ? "ui-btn" : "ui-btn ui-btn-primary"}
                      title={
                        generating
                          ? t("briefStopTitle")
                          : !hasRuleBound
                            ? t("briefNeedRuleTitle")
                            : t("briefGenerateTitle")
                      }
                    >
                      {generating ? t("briefStopGenerate") : t("briefGenerate")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={
                        digestBusy || !isLlmConfigured(settings) || !selectedGroupId || !hasRuleBound
                      }
                      onClick={() => setRegenConfirmOpen(true)}
                      className="ui-btn"
                      title={t("briefRegenTitle")}
                    >
                      {t("briefRegenerate")}
                    </button>
                  )}
                  {hasOverview && !generating ? (
                    <button
                      type="button"
                      onClick={handleExportMarkdown}
                      title={exportDone ? t("briefExportedTitle") : t("briefExportTitle")}
                      className="brief-export-btn ui-btn ui-btn-ghost"
                    >
                      {exportDone ? t("briefExported") : t("briefExportMd")}
                    </button>
                  ) : null}
                </div>

                {hasOverview && !generating ? (
                  <span className="brief-toolbar-status is-ok">{t("briefReady")}</span>
                ) : statusLine ? (
                  <span
                    className={`brief-toolbar-status ${
                      statusLine === t("briefNoIndexStatus") ||
                      statusLine === t("briefNeedRuleStatus")
                        ? ""
                        : "is-warn"
                    }`}
                  >
                    {statusLine}
                  </span>
                ) : null}
              </div>
            </div>
            {!hasOverview && !loadingSummary && !historyLoading ? (
              <p className="brief-home-hint">{t("briefHint")}</p>
            ) : null}
          </header>

          <div ref={overviewScrollRef} className="brief-stage-body">
            {generating ? (
              <DigestGeneratingPanel
                phase={summaryPhase}
                message={summarizeStatus}
                hasPreview={Boolean(displaySummary || displayTree || thinking)}
              />
            ) : null}
            {(loadingSummary || historyLoading) &&
            !generating &&
            !displaySummary &&
            !displayTree ? (
              <div className="flex flex-col gap-3" aria-busy="true" aria-label={t("briefLoading")}>
                <div className="h-4 w-2/3 max-w-sm animate-pulse rounded bg-[color-mix(in_srgb,var(--border)_60%,white)]" />
                <div className="h-4 w-full max-w-xl animate-pulse rounded bg-[color-mix(in_srgb,var(--border)_50%,white)]" />
                <div className="h-4 w-5/6 max-w-lg animate-pulse rounded bg-[color-mix(in_srgb,var(--border)_50%,white)]" />
                <p className="mt-2 text-sm text-[var(--ink-muted)]">{t("briefLoading")}</p>
              </div>
            ) : displaySummary || displayTree || thinking ? (
              showTree && displayTree ? (
                <>
                  {thinking && !generating ? (
                    <details className="mb-3 border-l border-[var(--border)] pl-2">
                      <summary className="cursor-pointer text-[11px] text-[var(--ink-muted)]">
                        {t("briefThinking")}
                      </summary>
                      <p className="mt-1.5 max-h-32 overflow-y-auto whitespace-pre-wrap text-[11px] leading-5 text-[var(--ink-muted)]">
                        {thinking}
                      </p>
                    </details>
                  ) : null}
                  <DigestTreeView
                    tree={displayTree}
                    scrollParentRef={overviewScrollRef}
                    onAddArticle={addScopedArticle}
                    onAddArticles={addScopedArticles}
                  />
                </>
              ) : (
                <div className="min-w-0">
                  {thinking && !generating ? (
                    <details className="mb-3 border-l border-[var(--border)] pl-2">
                      <summary className="cursor-pointer text-[11px] text-[var(--ink-muted)]">
                        {t("briefThinking")}
                      </summary>
                      <p className="mt-1.5 max-h-32 overflow-y-auto whitespace-pre-wrap text-[11px] leading-5 text-[var(--ink-muted)]">
                        {thinking}
                      </p>
                    </details>
                  ) : null}
                  {displaySummary ? (
                    <div className="summary-markdown-scroll">
                      <SummaryMarkdown
                        content={displaySummary}
                        articleRefs={stageArticleRefs}
                        className="summary-markdown-readable"
                        onAddArticle={addScopedArticle}
                        onAddArticles={addScopedArticles}
                      />
                    </div>
                  ) : null}
                  {generating && displaySummary ? (
                    <span className="mt-1 inline-block animate-pulse text-[var(--ink-muted)]">▍</span>
                  ) : null}
                </div>
              )
            ) : !generating ? (
              <div className="mx-auto max-w-[32rem] py-12 text-center">
                <h3 className="text-lg font-medium text-[var(--ink)]">{gettingStarted.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
                  {gettingStarted.intro}
                </p>
                <GettingStartedGuide onExplainRule={() => setRuleExplainOpen(true)} />
              </div>
            ) : null}
          </div>

          {stageSourceCount > 0 && hasOverview && !generating ? (
            <div className="brief-stage-footer">
              <div className="brief-stage-footer-box">
                <span className="brief-stage-footer-note">
                  {formatMessage(locale, "briefSourcesFooter", { count: stageSourceCount })}
                </span>
              </div>
            </div>
          ) : null}
        </section>

        <BriefInsightPanel
          className={mobileBriefTab === "ask" ? "" : "is-mobile-hidden"}
          excerpt={stageExcerpt}
          messages={messages}
          citations={citations}
          activeCitationIndex={activeCitationIndex}
          citationOpen={citationOpen}
          onCitationOpenChange={setCitationOpen}
          onCitationSelect={setActiveCitationIndex}
          emptyState={emptyState}
          scopedCount={scopedArticles.length}
          effectiveRagReady={effectiveRagReady}
          indexBuildLink={
            <IndexBuildLink onClick={openIndexBuild} disabled={indexBuildBusy} />
          }
          error={error}
          statusMessage={statusMessage}
          showPromptPreview={showPromptPreview}
          promptPreview={promptPreview}
          messagesScrollRef={messagesScrollRef}
          bottomRef={bottomRef}
          onPaneClick={handleChatPaneClick}
          dropActive={dropActive}
          onDragOver={handleArticleDragOver}
          onDragLeave={handleArticleDragLeave}
          onDrop={handleArticleDrop}
          editingIndex={editingIndex}
          editingText={editingText}
          editTextareaRef={editTextareaRef}
          onEditingTextChange={setEditingText}
          onCancelEdit={cancelInlineEdit}
          onSubmitEdit={submitInlineEdit}
          onStartEdit={startInlineEdit}
          onFocusCitation={focusCitation}
          onSelectMessageCitations={selectMessageCitations}
          sending={sending}
          scopedArticles={scopedArticles}
          onRemoveScoped={removeScopedArticle}
          onClearScoped={clearScopedArticles}
          composerHint={composerHint}
          input={input}
          onInputChange={setInput}
          chatInputRef={chatInputRef}
          onInputKeyDown={handleInputKeyDown}
          inputPlaceholder={inputPlaceholder}
          composerMenuItems={composerMenuItems}
          canSubmit={canSubmit}
          submitDisabledTitle={submitDisabledTitle}
          onSend={handleSend}
          onStop={stopGeneration}
        />
      </div>

      <IndexBuildConfirmModal />
      <ConfirmModal
        open={regenConfirmOpen}
        title={t("briefRegenConfirmTitle")}
        message={t("briefRegenConfirmMessage")}
        confirmLabel={t("briefRegenerate")}
        onConfirm={() => {
          setRegenConfirmOpen(false);
          void startSummarize();
        }}
        onCancel={() => setRegenConfirmOpen(false)}
      />
      <RuleExplainModal
        open={ruleExplainOpen}
        onClose={() => setRuleExplainOpen(false)}
        skills={digestSkills}
      />
    </div>
  );
}
