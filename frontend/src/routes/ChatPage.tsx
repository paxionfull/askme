import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchDigestSkills,
  fetchFeeds,
  saveFeedGroups,
  type DigestSkillDetail,
} from "../api";
import CitationMarkdown from "../components/CitationMarkdown";
import CitationSidebar from "../components/CitationSidebar";
import DaysRangeSelect from "../components/DaysRangeSelect";
import DigestGeneratingPanel from "../components/DigestGeneratingPanel";
import DigestTreeView from "../components/DigestTreeView";
import GettingStartedGuide, {
  GETTING_STARTED_INTRO,
  GETTING_STARTED_TITLE,
} from "../components/GettingStartedGuide";
import OverflowMenu, { type OverflowMenuItem } from "../components/OverflowMenu";
import RuleExplainModal from "../components/RuleExplainModal";
import ScopedArticlesBar from "../components/ScopedArticlesBar";
import SummaryMarkdown, {
  acceptsArticleDrag,
  readArticleDragPayload,
} from "../components/SummaryMarkdown";
import { useChat } from "../contexts/ChatContext";
import { useDigest } from "../contexts/DigestContext";
import { useResizableRatio } from "../hooks/useResizableRatio";
import { useIndexBuildConfirm } from "../hooks/useIndexBuildConfirm";
import { formatDaysLabel, isLlmConfigured, useSettings } from "../hooks/useSettings";
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

function getSubmitDisabledTitle(params: {
  input: string;
  scopedCount: number;
  effectiveRagReady: boolean;
  llmConfigured: boolean;
  loadingStatus: boolean;
  canSubmit: boolean;
}): string | undefined {
  const { input, scopedCount, effectiveRagReady, llmConfigured, loadingStatus, canSubmit } = params;
  if (canSubmit) return undefined;
  const trimmed = input.trim();
  if (trimmed) {
    if (!effectiveRagReady) {
      return loadingStatus ? "正在同步索引，稍候即可问答" : "问答需先建立索引";
    }
    if (!llmConfigured) return "请先在设置配置 API Key 和模型";
    return undefined;
  }
  if (scopedCount > 0 && !llmConfigured) return "生成摘要需先在设置配置 API Key 和模型";
  if (!effectiveRagReady && !loadingStatus) {
    return "问答需先建立索引；可先加入文章做摘要";
  }
  if (scopedCount > 0) return "空内容发送可生成摘要";
  return "输入问题，或先加入文章后空内容发送生成摘要";
}

export default function ChatPage() {
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
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const overviewScrollRef = useRef<HTMLDivElement>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const [exportDone, setExportDone] = useState(false);
  const exportResetTimerRef = useRef<number | null>(null);
  const displaySummary = generating ? summary : chatSummary;
  const showTree = Boolean(!generating && digestTree);
  const hasOverview = Boolean(displaySummary || digestTree || generating);

  const {
    containerRef,
    askPercent,
    briefPercent,
    dragging,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    resetRatio,
    nudgeRatio,
  } = useResizableRatio({
    storageKey: "askme.brief.askPaneRatio",
    defaultRatio: 0.32,
    minRatio: 0.22,
    maxRatio: 0.55,
  });
  const todayLabel = (() => {
    const now = new Date();
    const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
    return {
      date: `${now.getMonth() + 1} 月 ${now.getDate()} 日`,
      weekday: `星期${weekdays[now.getDay()]}`,
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
  const indexScopeLabel = selectedGroup?.name?.trim() || "当前板块";
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
  });
  const composerHint = (() => {
    if (sending) return null;
    const trimmed = input.trim();
    if (trimmed) {
      if (!effectiveRagReady) {
        if (loadingStatus) return <>正在同步索引，稍候即可问答</>;
        return (
          <>
            问答需先{" "}
            <IndexBuildLink onClick={openIndexBuild} disabled={indexBuildBusy} />
          </>
        );
      }
      if (!llmConfigured) {
        return (
          <>
            请先在{" "}
            <Link to="/settings" className="text-[var(--accent)] hover:underline">
              设置
            </Link>{" "}
            配置 API Key 和模型
          </>
        );
      }
      return null;
    }
    if (scopedArticles.length > 0 && !llmConfigured) {
      return (
        <>
          生成摘要需先在{" "}
          <Link to="/settings" className="text-[var(--accent)] hover:underline">
            设置
          </Link>{" "}
          配置 API Key 和模型
        </>
      );
    }
    if (composerNudge && !canSubmit) {
      if (!effectiveRagReady && !loadingStatus) {
        return (
          <>
            问答需先{" "}
            <IndexBuildLink onClick={openIndexBuild} disabled={indexBuildBusy} />
            ；可先加入文章做摘要
          </>
        );
      }
      return "输入问题，或先加入文章后空内容发送生成摘要";
    }
    return null;
  })();
  const inputPlaceholder = (() => {
    if (scopedArticles.length > 0) {
      return input.trim()
        ? `已加入 ${scopedArticles.length} 篇 · Enter 发送`
        : `已加入 ${scopedArticles.length} 篇 · Enter 生成摘要`;
    }
    if (loadingStatus && !effectiveRagReady) return "正在同步索引…";
    if (!effectiveRagReady) return "问答需建索引；可先加入文章做摘要";
    if (!llmConfigured) return "请先在设置配置模型后再提问";
    return "输入问题，Enter 发送";
  })();

  const boundRuleName =
    digestSkills.find((skill) => skill.id === selectedGroup?.digestSkillId)?.name ||
    selectedGroup?.digestSkillId ||
    "";

  const handleExportMarkdown = useCallback(() => {
    const groupName = selectedGroup?.name?.trim() || "简报";
    const dayRange = formatDigestDayRange(days);
    const meta = {
      groupName,
      rangeLabel: formatDaysLabel(days),
      dayRange,
      ruleName: boundRuleName || "未绑定",
    };
    let md = "";
    if (digestTree && !generating) {
      md = buildDigestMarkdownFromTree(digestTree, meta);
    } else if (displaySummary.trim()) {
      md = buildDigestMarkdownFromText(displaySummary, meta);
    } else {
      return;
    }
    downloadMarkdownFile(buildDigestExportFilename(groupName, dayRange), md);
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
  ]);

  useEffect(() => {
    return () => {
      if (exportResetTimerRef.current != null) {
        window.clearTimeout(exportResetTimerRef.current);
      }
    };
  }, []);

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
      return "需设置整理规则";
    }
    if (scopedArticles.length > 0) {
      return `限定 ${scopedArticles.length} 篇`;
    }
    if (loadingIndex) {
      return "建立索引中";
    }
    if (loadingStatus && !effectiveRagReady) {
      return "同步索引中";
    }
    if (effectiveRagReady) {
      if (statusRevalidating) return "同步中";
      return null;
    }
    return "未建索引";
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

  const focusChatInput = useCallback(() => {
    const el = chatInputRef.current;
    if (!el || el.disabled) return;
    el.focus({ preventScroll: true });
  }, []);

  const handleSend = useCallback(() => {
    if (sending) return;
    if (canSubmit) {
      setComposerNudge(false);
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

  // 点到对话区空白/消息后焦点常离开输入框；此时 Enter 仍应发送（不抢输入框/菜单内的 Enter）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.defaultPrevented) {
        return;
      }
      if (isComposerShortcutBlocked(event.target)) return;
      if (sending) return;
      event.preventDefault();
      focusChatInput();
      handleSend();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusChatInput, handleSend, sending]);

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
            title: article.title || "未命名文章",
            url: article.url || "",
          })),
        );
      } else if (payload.single) {
        addScopedArticle({
          feed_id: payload.single.feed_id,
          article_id: payload.single.article_id,
          title: payload.single.title || "未命名文章",
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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
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
    void sendMessage(text, { replaceFromIndex: index });
  }, [editingIndex, editingText, sendMessage]);

  const composerMenuItems: OverflowMenuItem[] = [];
  if (promptPreview) {
    composerMenuItems.push({
      label: showPromptPreview ? "隐藏 Prompt" : "查看 Prompt",
      onClick: () => setShowPromptPreview((open) => !open),
    });
  }
  if (messages.length > 0) {
    composerMenuItems.push({
      label: "清空对话",
      danger: true,
      onClick: () => {
        cancelInlineEdit();
        setCitationOpen(false);
        clearMessages();
      },
    });
  }

  return (
    <div className="flex h-full flex-col bg-[var(--paper)]">
      <header className="shrink-0 border-b border-[var(--rule)] bg-[var(--paper-raised)] px-5 pb-3 pt-4">
        <p className="text-[1.35rem] font-semibold tracking-tight text-[var(--ink)]">
          <span className="mb-0.5 block text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-[var(--accent)]">
            简报
          </span>
          {todayLabel.date}
          <span className="ml-1.5 text-[0.95rem] font-medium text-[var(--ink-muted)]">
            · {todayLabel.weekday}
          </span>
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-[var(--rule)] bg-[var(--paper)] px-3 py-2.5">
          <label className="inline-flex min-w-0 items-center gap-1.5 text-sm">
            <span className="shrink-0 text-xs text-[var(--ink-muted)]">板块</span>
            <select
              value={selectedGroupId ?? ""}
              onChange={(e) => setSelectedSummaryGroup(e.target.value)}
              disabled={summaryGroupOptions.length === 0 || digestBusy}
              className="ui-select min-w-0 max-w-[10rem] truncate py-1.5 text-sm disabled:opacity-50"
              aria-label="选择分组"
            >
              {summaryGroupOptions.length === 0 ? (
                <option value="">暂无分组</option>
              ) : (
                summaryGroupOptions.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="inline-flex items-center gap-1.5 text-sm">
            <span className="shrink-0 text-xs text-[var(--ink-muted)]">范围</span>
            <DaysRangeSelect
              value={days}
              onChange={setDays}
              disabled={digestBusy}
              size="sm"
              className="shrink-0"
            />
          </label>
          {selectedGroupId && !isUngrouped ? (
            <label className="inline-flex min-w-0 items-center gap-1.5 text-sm">
              <span className="shrink-0 text-xs text-[var(--ink-muted)]">整理规则</span>
              <select
                value={selectedGroup?.digestSkillId ?? ""}
                onChange={(e) => void bindRuleToSelectedGroup(e.target.value)}
                disabled={digestBusy || savingRule || digestSkills.length === 0}
                className={`ui-select min-w-0 max-w-[11rem] truncate py-1.5 text-sm disabled:opacity-50 ${
                  hasRuleBound
                    ? ""
                    : "border-[color-mix(in_srgb,var(--accent)_40%,var(--rule))] text-[var(--accent)]"
                }`}
                aria-label="选择整理规则"
                title={hasRuleBound ? boundRuleName : "未设置整理规则时无法生成简报"}
              >
                <option value="">未设置</option>
                {digestSkills.map((skill) => (
                  <option key={skill.id} value={skill.id}>
                    {skill.name || skill.id}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
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
            onClick={() => void (generating ? stopSummarize() : startSummarize())}
            className={`group/gen relative min-w-[5.5rem] shrink-0 rounded-[var(--radius-control)] px-3 py-1.5 text-sm disabled:opacity-50 ${
              generating
                ? "ui-btn"
                : hasOverview
                  ? "border border-[var(--rule)] bg-[var(--paper-raised)] text-[var(--ink-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  : "ui-btn ui-btn-primary"
            }`}
            title={
              generating
                ? "停止当前简报生成，保留上一版"
                : !hasRuleBound
                  ? "请先为当前板块设置整理规则"
                  : hasOverview
                    ? "重新生成简报"
                    : "按当前板块绑定的整理规则生成简报"
            }
          >
            {generating ? (
              "停止生成"
            ) : hasOverview ? (
              <>
                <span className="group-hover/gen:hidden group-focus-visible/gen:hidden">已生成</span>
                <span className="hidden group-hover/gen:inline group-focus-visible/gen:inline">
                  重新生成
                </span>
              </>
            ) : (
              "生成简报"
            )}
          </button>
          {statusLine ? (
            <>
              <span className="text-[var(--ink-muted)]">·</span>
              <span
                className={`text-sm ${
                  statusLine === "未建索引" || statusLine === "需设置整理规则"
                    ? "text-[var(--ink-muted)]"
                    : "text-[var(--accent)]"
                }`}
              >
                {statusLine}
              </span>
            </>
          ) : null}
        </div>
        {!hasOverview && !loadingSummary ? (
          <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]">
            添加源并更新列表后，须为每个板块手动设置整理规则，才能生成简报。
          </p>
        ) : null}
        {summaryError ? <p className="mt-2 text-xs text-red-700">{summaryError}</p> : null}
      </header>

      <div
        ref={containerRef}
        className={`flex min-h-0 flex-1 ${dragging ? "cursor-col-resize select-none" : ""}`}
      >
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden border-r border-[var(--rule)] bg-[var(--paper)]">
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
              <p className="px-5 pt-5 text-sm text-[var(--ink-muted)] sm:px-8">加载简报…</p>
            ) : displaySummary || digestTree || thinking ? (
              showTree && digestTree ? (
                <>
                  {thinking && !generating ? (
                    <details className="mx-auto max-w-[42rem] border-l-2 border-[var(--rule)] px-5 pt-4 pl-[calc(1.25rem+2px)] sm:px-8 sm:pl-[calc(2rem+2px)]">
                      <summary className="cursor-pointer text-[11px] text-[var(--ink-muted)]">
                        思考过程
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
                    exportAction={{
                      done: exportDone,
                      onClick: handleExportMarkdown,
                    }}
                  />
                </>
              ) : (
                <div className="relative">
                  <div className="relative z-[4] h-0">
                    <button
                      type="button"
                      title={exportDone ? "已导出 Markdown" : "下载当前简报为 Markdown"}
                      onClick={handleExportMarkdown}
                      className={`absolute left-[0.85rem] top-[0.55rem] whitespace-nowrap rounded-[var(--radius-control)] border px-2.5 py-1 text-[0.8rem] transition-colors ${
                        exportDone
                          ? "border-[color-mix(in_srgb,var(--success)_40%,var(--rule))] bg-[var(--success-soft)] text-[var(--success)]"
                          : "border-[var(--rule)] bg-[var(--paper-raised)] text-[var(--ink-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                      }`}
                    >
                      {exportDone ? "已导出" : "导出为 Markdown"}
                    </button>
                  </div>
                <div className="mx-auto min-w-0 max-w-[42rem] px-5 py-5 sm:px-8">
                  {thinking && !generating ? (
                    <details className="mb-3 border-l-2 border-[var(--rule)] pl-2">
                      <summary className="cursor-pointer text-[11px] text-[var(--ink-muted)]">
                        思考过程
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
                </div>
              )
            ) : !generating ? (
              <div className="mx-auto max-w-[32rem] px-5 py-12 text-center sm:px-8">
                <h3 className="text-lg font-medium text-[var(--ink)]">{GETTING_STARTED_TITLE}</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
                  {GETTING_STARTED_INTRO}
                </p>
                <GettingStartedGuide onExplainRule={() => setRuleExplainOpen(true)} />
              </div>
            ) : null}
          </div>
        </section>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调节简报与提问区宽度"
          aria-valuemin={22}
          aria-valuemax={55}
          aria-valuenow={askPercent}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onDoubleClick={resetRatio}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 0.05 : 0.02;
            if (e.key === "ArrowLeft") {
              nudgeRatio(step);
              e.preventDefault();
            } else if (e.key === "ArrowRight") {
              nudgeRatio(-step);
              e.preventDefault();
            } else if (e.key === "Home") {
              resetRatio();
              e.preventDefault();
            }
          }}
          className="group relative z-10 w-1.5 shrink-0 cursor-col-resize bg-transparent"
        >
          <div
            className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-[width,background] ${
              dragging
                ? "w-0.5 bg-[var(--accent)]"
                : "bg-[var(--rule)] group-hover:w-0.5 group-hover:bg-[var(--accent)] group-focus-visible:w-0.5 group-focus-visible:bg-[var(--accent)]"
            }`}
          />
          <div className="absolute inset-y-0 -left-1 -right-1" />
          {dragging ? (
            <span className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-[var(--ink)] px-2 py-0.5 text-[11px] text-[var(--paper-raised)]">
              简报 {briefPercent}% · 提问 {askPercent}%
            </span>
          ) : null}
        </div>

        <aside
          style={{ width: `${askPercent}%`, minWidth: 240, maxWidth: "55%" }}
          className={`relative flex min-w-0 shrink-0 flex-col border-l border-[var(--rule)] bg-[var(--paper-raised)] ${
            dropActive ? "bg-[color-mix(in_srgb,var(--accent-soft)_40%,transparent)]" : ""
          } ${dragging ? "transition-none" : ""}`}
          onDragOver={handleArticleDragOver}
          onDragLeave={handleArticleDragLeave}
          onDrop={handleArticleDrop}
          onClick={handleChatPaneClick}
        >
        {dropActive ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-[color-mix(in_srgb,var(--accent)_40%,var(--rule))] bg-[color-mix(in_srgb,var(--accent-soft)_50%,transparent)]">
            <p className="rounded-[var(--radius-control)] bg-[var(--paper-raised)]/90 px-4 py-2 text-sm text-[var(--accent)]">
              松开以加入提问
            </p>
          </div>
        ) : null}

        <header className="border-b border-[var(--rule)] px-4 py-3">
          <h2 className="text-sm font-semibold tracking-tight text-[var(--ink)]">提问</h2>
        </header>

        {error ? (
          <div className="border-b border-[var(--rule)] bg-[var(--error-soft)] px-5 py-2 text-sm text-red-800">
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
            <summary className="cursor-pointer text-xs text-[var(--ink-muted)]">本次 Prompt</summary>
            <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-[var(--ink)]">
              {promptPreview}
            </pre>
          </details>
        ) : null}

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {messages.length === 0 ? (
            emptyState?.kind === "generating" ? (
              <div className="flex h-full items-start justify-center pt-8">
                <p className="text-sm text-[var(--ink-muted)]">简报生成中，完成后可拖标题到此处</p>
              </div>
            ) : emptyState?.kind === "scoped" ? (
              <div className="mx-auto max-w-[40rem]">
                <p className="text-sm font-medium tracking-tight text-[var(--ink)]">
                  已加入 {scopedArticles.length} 篇
                </p>
                <ul className="mt-3 list-none space-y-2 text-xs leading-5 text-[var(--ink-muted)]">
                  <li>
                    <span className="font-medium text-[var(--ink)]">摘要</span>
                    {" — 空内容回车"}
                  </li>
                  <li>
                    <span className="font-medium text-[var(--ink)]">问答</span>
                    {!effectiveRagReady ? (
                      <>
                        {" — 需先 "}
                        <IndexBuildLink
                          onClick={openIndexBuild}
                          disabled={indexBuildBusy}
                        />
                        {"，再输入问题回车"}
                      </>
                    ) : (
                      " — 输入问题回车，限定已加入的文章"
                    )}
                  </li>
                  <li className="pt-0.5 text-[11px] text-[var(--ink-muted)]/80">
                    可继续「加入对话」或拖标题到这里
                  </li>
                </ul>
              </div>
            ) : (
              <div className="mx-auto max-w-[40rem]">
                <p className="text-sm font-medium tracking-tight text-[var(--ink)]">可以这样用</p>
                <ul className="mt-3 list-none space-y-2 text-xs leading-5 text-[var(--ink-muted)]">
                  <li>
                    <span className="font-medium text-[var(--ink)]">摘要</span>
                    {" — 先「加入对话」或拖标题限定范围，空内容回车"}
                  </li>
                  <li>
                    <span className="font-medium text-[var(--ink)]">问答</span>
                    {emptyState?.needIndex ? (
                      <>
                        {" — 需先 "}
                        <IndexBuildLink
                          onClick={openIndexBuild}
                          disabled={indexBuildBusy}
                        />
                        {"，再输入问题回车"}
                      </>
                    ) : (
                      " — 输入问题回车（不选文章则检索整份简报）"
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
                            引用 {message.citations.length} 个片段 ·{" "}
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
                              打开引用
                            </button>
                          </p>
                        ) : null}
                        {message.thinking ? (
                          <details className="mb-2 border-l-2 border-[var(--rule)] pl-2 text-[11px] text-[var(--ink-muted)]">
                            <summary className="cursor-pointer">思考过程</summary>
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
                          className="w-full resize-y rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--paper-raised)_30%,var(--ink))] bg-[color-mix(in_srgb,var(--ink)_92%,white)] px-2 py-1.5 text-sm leading-6 text-[var(--paper-raised)] outline-none"
                        />
                        <div className="mt-2 flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={cancelInlineEdit}
                            className="rounded px-2 py-1 text-xs text-[var(--ink-muted)] hover:text-[var(--paper-raised)]"
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            disabled={!editingText.trim()}
                            onClick={submitInlineEdit}
                            className="rounded bg-[var(--paper-raised)] px-2 py-1 text-xs text-[var(--ink)] disabled:opacity-50"
                          >
                            发送
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
                                {article.title || "未命名文章"}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => startInlineEdit(index, message.content)}
                          className="mt-1 block text-xs text-[var(--ink-muted)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--paper-raised)]"
                        >
                          重新编辑
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

        <div className="border-t border-[var(--rule)] bg-[var(--paper-raised)] px-5 py-3">
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
                title={enableDeepThinking ? "关闭深度思考" : "开启深度思考"}
                className={`rounded px-2 py-1 text-xs transition-colors ${
                  enableDeepThinking
                    ? "bg-[var(--accent-subtle,color-mix(in_srgb,var(--accent)_12%,transparent))] text-[var(--accent)]"
                    : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
                }`}
              >
                思考
              </button>
              {composerMenuItems.length > 0 ? (
                <OverflowMenu
                  items={composerMenuItems}
                  label="对话选项"
                  placement="top"
                />
              ) : null}
              {sending ? (
                <button
                  type="button"
                  onClick={stopGeneration}
                  className="ui-btn ui-btn-danger shrink-0"
                >
                  停止
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={sending}
                  title={submitDisabledTitle}
                  className={`ui-btn ui-btn-primary shrink-0 ${!canSubmit ? "opacity-50" : ""}`}
                >
                  发送
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
        </aside>
      </div>
      <IndexBuildConfirmModal />
      <RuleExplainModal
        open={ruleExplainOpen}
        onClose={() => setRuleExplainOpen(false)}
        skills={digestSkills}
      />
    </div>
  );
}
