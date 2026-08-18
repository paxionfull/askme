import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchDigestSkills,
  fetchFeeds,
  saveFeedGroups,
  type DigestSkillDetail,
} from "../api";
import CitationMarkdown from "../components/CitationMarkdown";
import CitationSidebar from "../components/CitationSidebar";
import ConfirmModal from "../components/ConfirmModal";
import DaysRangeSelect from "../components/DaysRangeSelect";
import DigestGeneratingPanel from "../components/DigestGeneratingPanel";
import DigestTreeView from "../components/DigestTreeView";
import GettingStartedGuide, { useGettingStartedCopy } from "../components/GettingStartedGuide";
import OverflowMenu, { type OverflowMenuItem } from "../components/OverflowMenu";
import RuleExplainModal from "../components/RuleExplainModal";
import ScopedArticlesBar from "../components/ScopedArticlesBar";
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
    enableDeepThinking,
    setEnableDeepThinking,
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
  const [askDrawerOpen, setAskDrawerOpen] = useState(false);
  const exportResetTimerRef = useRef<number | null>(null);
  const displaySummary = generating ? summary : chatSummary;
  const showTree = Boolean(!generating && digestTree);
  const hasOverview = Boolean(displaySummary || digestTree || generating);

  const todayLabel = (() => {
    const now = new Date();
    if (locale === "zh") {
      const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
      return {
        date: `${now.getMonth() + 1} 月 ${now.getDate()} 日`,
        weekday: `星期${weekdays[now.getDay()]}`,
      };
    }
    return {
      date: now.toLocaleDateString("en-US", { month: "long", day: "numeric" }),
      weekday: now.toLocaleDateString("en-US", { weekday: "long" }),
    };
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
    if (digestTree && !generating) {
      md = buildDigestMarkdownFromTree(digestTree, meta, locale);
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
    digestTree,
    displaySummary,
    generating,
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

  useEffect(() => {
    if (messages.length > 0) setAskDrawerOpen(true);
  }, [messages.length]);

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
    <div className="flex h-full flex-col bg-[var(--paper)]">
      <header className="app-page-header">
        <div className="brief-home-bar">
          <h1 className="app-page-title brief-home-date min-w-0 text-[var(--ink)]">
            {todayLabel.date}
            <span className="brief-home-weekday"> · {todayLabel.weekday}</span>
          </h1>
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
                  disabled={digestBusy || !isLlmConfigured(settings) || !selectedGroupId || !hasRuleBound}
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
                  statusLine === t("briefNoIndexStatus") || statusLine === t("briefNeedRuleStatus")
                    ? ""
                    : "is-warn"
                }`}
              >
                {statusLine}
              </span>
            ) : null}
          </div>
        </div>

        {!hasOverview && !loadingSummary ? (
          <p className="brief-home-hint">{t("briefHint")}</p>
        ) : null}
        {summaryError ? (
          <p className="brief-home-hint text-[var(--danger-text)]" role="alert">
            {summaryError}
          </p>
        ) : null}
      </header>

      <section
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--paper)]"
        aria-label={t("briefLabel")}
      >
          <div ref={overviewScrollRef} className="flex-1 overflow-y-auto">
            {generating ? (
              <div className="px-5 pt-5 sm:px-8">
                <DigestGeneratingPanel
                  phase={summaryPhase}
                  message={summarizeStatus}
                  hasPreview={Boolean(displaySummary || digestTree || thinking)}
                />
              </div>
            ) : null}
            {loadingSummary && !generating && !displaySummary && !digestTree ? (
              <div
                className="flex flex-col gap-3 px-5 pt-5 sm:px-8"
                aria-busy="true"
                aria-label={t("briefLoading")}
              >
                <div className="h-4 w-2/3 max-w-sm animate-pulse rounded bg-[color-mix(in_srgb,var(--rule)_60%,white)]" />
                <div className="h-4 w-full max-w-xl animate-pulse rounded bg-[color-mix(in_srgb,var(--rule)_50%,white)]" />
                <div className="h-4 w-5/6 max-w-lg animate-pulse rounded bg-[color-mix(in_srgb,var(--rule)_50%,white)]" />
                <p className="mt-2 text-sm text-[var(--ink-muted)]">{t("briefLoading")}</p>
              </div>
            ) : displaySummary || digestTree || thinking ? (
              showTree && digestTree ? (
                <>
                  {thinking && !generating ? (
                    <details className="mx-auto max-w-[42rem] border-l border-[var(--rule)] px-5 pt-4 pl-[calc(1.25rem+1px)] sm:px-8 sm:pl-[calc(2rem+1px)]">
                      <summary className="cursor-pointer text-[11px] text-[var(--ink-muted)]">
                        {t("briefThinking")}
                      </summary>
                      <p className="mt-1.5 max-h-32 overflow-y-auto whitespace-pre-wrap text-[11px] leading-5 text-[var(--ink-muted)]">
                        {thinking}
                      </p>
                    </details>
                  ) : null}
                  <DigestTreeView
                    tree={digestTree}
                    scrollParentRef={overviewScrollRef}
                    onAddArticle={addScopedArticle}
                    onAddArticles={addScopedArticles}
                  />
                </>
              ) : (
                <div className="mx-auto min-w-0 max-w-[42rem] px-5 py-5 sm:px-8">
                  {thinking && !generating ? (
                    <details className="mb-3 border-l border-[var(--rule)] pl-2">
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
                        articleRefs={articleRefs}
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
              <div className="mx-auto max-w-[32rem] px-5 py-12 text-center sm:px-8">
                <h3 className="text-lg font-medium text-[var(--ink)]">{gettingStarted.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
                  {gettingStarted.intro}
                </p>
                <GettingStartedGuide onExplainRule={() => setRuleExplainOpen(true)} />
              </div>
            ) : null}
          </div>
      </section>

        <div
          className={`app-ask-stack ${
            dropActive ? "bg-[color-mix(in_srgb,var(--accent-soft)_40%,transparent)]" : ""
          }`}
          onDragOver={handleArticleDragOver}
          onDragLeave={handleArticleDragLeave}
          onDrop={handleArticleDrop}
          onClick={handleChatPaneClick}
        >
        {dropActive ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-[color-mix(in_srgb,var(--accent)_40%,var(--rule))] bg-[color-mix(in_srgb,var(--accent-soft)_50%,transparent)]">
            <p className="rounded-[var(--radius-control)] bg-[var(--paper-raised)]/90 px-4 py-2 text-sm text-[var(--accent)]">
              {t("askDropHere")}
            </p>
          </div>
        ) : null}

        {askDrawerOpen ? (
        <section
          id="ask-drawer"
          className="app-ask-drawer"
          aria-label={t("briefAsk")}
        >
        <div className="app-ask-drawer-head">
          <h2 className="app-ask-drawer-title">{t("briefAsk")}</h2>
          <button
            type="button"
            className="brief-export-btn ui-btn ui-btn-ghost"
            onClick={() => setAskDrawerOpen(false)}
          >
            {t("close")}
          </button>
        </div>

        {error ? (
          <div
            className="border-b border-[var(--rule)] bg-[var(--error-soft)] px-5 py-2 text-sm text-[var(--danger-text)]"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        {statusMessage ? (
          <div className="border-b border-[var(--rule)] bg-[var(--paper)] px-5 py-2 text-sm text-[var(--ink-muted)]">
            {statusMessage}
          </div>
        ) : null}

        {showPromptPreview && promptPreview ? (
          <details open className="border-b border-[var(--rule)] bg-[var(--paper)] px-5 py-2">
            <summary className="cursor-pointer text-xs text-[var(--ink-muted)]">{t("askPromptPreview")}</summary>
            <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-[var(--ink)]">
              {promptPreview}
            </pre>
          </details>
        ) : null}

        <div ref={messagesScrollRef} className="app-ask-drawer-body">
          {messages.length === 0 ? (
            emptyState?.kind === "generating" ? (
              <div className="flex h-full items-start justify-center pt-8">
                <p className="text-sm text-[var(--ink-muted)]">{t("askGeneratingHint")}</p>
              </div>
            ) : emptyState?.kind === "scoped" ? (
              <div className="mx-auto max-w-[40rem]">
                <p className="text-sm font-medium tracking-tight text-[var(--ink)]">
                  {formatMessage(locale, "chatArticlesAdded", { count: scopedArticles.length })}
                </p>
                <ul className="mt-3 list-none space-y-2 text-xs leading-5 text-[var(--ink-muted)]">
                  <li>
                    <span className="font-medium text-[var(--ink)]">{t("chatSummaryLabel")}</span>
                    {t("chatSummaryEmptyEnter")}
                  </li>
                  <li>
                    <span className="font-medium text-[var(--ink)]">{t("briefAsk")}</span>
                    {!effectiveRagReady ? (
                      <>
                        {" — "}
                        {t("chatNeedIndexPrefix")}{" "}
                        <IndexBuildLink
                          onClick={openIndexBuild}
                          disabled={indexBuildBusy}
                        />
                        {t("chatAskThenEnter")}
                      </>
                    ) : (
                      t("chatAskScopedEnter")
                    )}
                  </li>
                  <li className="pt-0.5 text-[11px] text-[var(--ink-muted)]/80">
                    {t("chatDragHint")}
                  </li>
                </ul>
              </div>
            ) : (
              <div className="mx-auto max-w-[40rem]">
                <p className="text-sm font-medium tracking-tight text-[var(--ink)]">{t("chatHowToUse")}</p>
                <ul className="mt-3 list-none space-y-2 text-xs leading-5 text-[var(--ink-muted)]">
                  <li>
                    <span className="font-medium text-[var(--ink)]">{t("chatSummaryLabel")}</span>
                    {t("chatSummaryGuide")}
                  </li>
                  <li>
                    <span className="font-medium text-[var(--ink)]">{t("briefAsk")}</span>
                    {emptyState?.needIndex ? (
                      <>
                        {" — "}
                        {t("chatNeedIndexPrefix")}{" "}
                        <IndexBuildLink
                          onClick={openIndexBuild}
                          disabled={indexBuildBusy}
                        />
                        {t("chatAskThenEnter")}
                      </>
                    ) : (
                      t("chatAskEnterFull")
                    )}
                  </li>
                </ul>
              </div>
            )
          ) : (
            <div className="mx-auto flex max-w-[40rem] flex-col gap-4">
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={`group flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[92%] px-1 py-0.5 ${
                      message.role === "user"
                        ? "rounded-[var(--radius-panel)] bg-[var(--ink)] px-4 py-2.5 text-sm leading-7 text-[var(--paper-raised)] whitespace-pre-wrap"
                        : "text-[var(--ink)]"
                    }`}
                  >
                    {message.role === "assistant" ? (
                      <>
                        {message.citations && message.citations.length > 0 ? (
                          <p className="mb-2 text-[11px] text-[var(--ink-muted)]">
                            {formatMessage(locale, "chatCitations", {
                              count: message.citations.length,
                            })}
                            <button
                              type="button"
                              className="text-[var(--accent)] hover:underline"
                              onClick={() => {
                                const first = message.citations?.[0]?.index;
                                if (first != null) {
                                  focusCitation(first, index);
                                } else {
                                  selectMessageCitations(index);
                                  setCitationOpen(true);
                                }
                              }}
                            >
                              {t("chatOpenCitations")}
                            </button>
                          </p>
                        ) : null}
                        {message.thinking ? (
                          <details className="mb-2 border-l border-[var(--rule)] pl-2 text-[11px] text-[var(--ink-muted)]">
                            <summary className="cursor-pointer">{t("briefThinking")}</summary>
                            <pre className="mt-1.5 whitespace-pre-wrap">{message.thinking}</pre>
                          </details>
                        ) : null}
                        {message.content ? (
                          <CitationMarkdown
                            content={message.content}
                            onCitationClick={(citationIndex) => {
                              focusCitation(citationIndex, index);
                            }}
                          />
                        ) : sending && index === messages.length - 1 ? (
                          <span className="text-sm text-[var(--ink-muted)]">…</span>
                        ) : null}
                      </>
                    ) : editingIndex === index ? (
                      <div className="min-w-[200px]">
                        <textarea
                          ref={editTextareaRef}
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              submitInlineEdit();
                            } else if (e.key === "Escape") {
                              cancelInlineEdit();
                            }
                          }}
                          rows={3}
                          className="w-full resize-y rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--paper-raised)_30%,var(--ink))] bg-[color-mix(in_srgb,var(--ink)_92%,white)] px-2 py-1.5 text-sm leading-6 text-[var(--paper-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color-mix(in_srgb,var(--accent)_55%,transparent)]"
                        />
                        <div className="mt-2 flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={cancelInlineEdit}
                            className="rounded px-2 py-1 text-xs text-[var(--ink-muted)] hover:text-[var(--paper-raised)]"
                          >
                            {t("cancel")}
                          </button>
                          <button
                            type="button"
                            disabled={!editingText.trim()}
                            onClick={submitInlineEdit}
                            className="rounded bg-[var(--paper-raised)] px-2 py-1 text-xs text-[var(--ink)] disabled:opacity-50"
                          >
                            {t("commonSend")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {message.content}
                        {message.scoped_articles && message.scoped_articles.length > 0 ? (
                          <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                            {message.scoped_articles.map((article) => (
                              <span
                                key={`${article.feed_id}:${article.article_id}`}
                                className="inline-flex max-w-full items-center rounded px-2 py-0.5 text-[11px] text-[color-mix(in_srgb,var(--paper-raised)_80%,transparent)]"
                                title={article.title}
                              >
                                {article.title || t("chatUnnamedArticle")}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => startInlineEdit(index, message.content)}
                          className="mt-1 block text-xs text-[var(--ink-muted)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--paper-raised)] focus-visible:opacity-100"
                        >
                          {t("chatResend")}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
        </section>
        ) : null}

        {!askDrawerOpen && error ? (
          <div
            className="border-t border-[var(--rule)] bg-[var(--error-soft)] px-5 py-2 text-sm text-[var(--danger-text)]"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        <div className="app-ask-dock">
          {messages.length > 0 && !askDrawerOpen ? (
            <div className="mx-auto mb-2 flex max-w-[40rem] justify-end">
              <button
                type="button"
                className="brief-export-btn ui-btn ui-btn-ghost"
                aria-expanded={false}
                aria-controls="ask-drawer"
                onClick={() => setAskDrawerOpen(true)}
              >
                {t("askShowConversation")}
              </button>
            </div>
          ) : null}
          <ScopedArticlesBar
            articles={scopedArticles}
            onRemove={removeScopedArticle}
            onClear={clearScopedArticles}
          />
          {composerHint ? (
            <p className="mx-auto mb-2 max-w-[40rem] text-xs leading-5 text-[var(--ink-muted)]">
              {composerHint}
            </p>
          ) : null}
          <form
            className="mx-auto flex max-w-[40rem] items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
          >
            <textarea
              ref={chatInputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                const el = e.target;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
              }}
              onKeyDown={handleInputKeyDown}
              rows={1}
              placeholder={inputPlaceholder}
              disabled={sending}
              className="ui-textarea min-h-[2.5rem] max-h-36 min-w-0 flex-1 resize-none py-2 text-sm leading-6 disabled:opacity-50"
            />
            <div className="flex shrink-0 items-center gap-1.5 pb-0.5">
              <button
                type="button"
                onClick={() => setEnableDeepThinking(!enableDeepThinking)}
                title={`${enableDeepThinking ? t("chatDeepThinkOn") : t("chatDeepThinkOff")} · ${t("chatThinkHint")}`}
                aria-pressed={enableDeepThinking}
                aria-label={t("chatThinkHint")}
                className={`ui-btn px-2.5 text-xs ${
                  enableDeepThinking
                    ? "ui-btn-accent"
                    : "ui-btn-ghost"
                }`}
              >
                {t("chatThink")}
              </button>
              {composerMenuItems.length > 0 ? (
                <OverflowMenu
                  items={composerMenuItems}
                  label={t("chatComposerMenu")}
                  placement="top"
                />
              ) : null}
              {sending ? (
                <button
                  type="button"
                  onClick={stopGeneration}
                  className="ui-btn ui-btn-danger shrink-0"
                >
                  {t("stop")}
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={sending}
                  title={submitDisabledTitle}
                  className={`ui-btn ui-btn-primary shrink-0 ${!canSubmit ? "opacity-50" : ""}`}
                >
                  {t("commonSend")}
                </button>
              )}
            </div>
          </form>
        </div>

        <CitationSidebar
          items={citations}
          activeIndex={activeCitationIndex}
          open={citationOpen}
          onOpenChange={setCitationOpen}
          onSelect={setActiveCitationIndex}
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
