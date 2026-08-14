import { useCallback, useEffect, useRef, useState } from "react";
import CitationMarkdown from "../components/CitationMarkdown";
import CitationSidebar from "../components/CitationSidebar";
import DaysRangeSelect from "../components/DaysRangeSelect";
import DigestGeneratingPanel from "../components/DigestGeneratingPanel";
import DigestTreeView from "../components/DigestTreeView";
import OverflowMenu, { type OverflowMenuItem } from "../components/OverflowMenu";
import ScopedArticlesBar from "../components/ScopedArticlesBar";
import SummaryMarkdown, {
  acceptsArticleDrag,
  readArticleDragPayload,
} from "../components/SummaryMarkdown";
import { useChat } from "../contexts/ChatContext";
import { useDigest } from "../contexts/DigestContext";
import { useResizablePane } from "../hooks/useResizablePane";
import { formatDaysLabel, isLlmConfigured, useSettings } from "../hooks/useSettings";

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
    startSummarize,
    summaryGroupOptions,
    selectedGroupId,
    setSelectedSummaryGroup,
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
    effectiveChunkCount,
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

  const bottomRef = useRef<HTMLDivElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const displaySummary = generating ? summary : chatSummary;
  const showTree = Boolean(!generating && digestTree);
  const hasOverview = Boolean(displaySummary || digestTree || generating);
  const { containerRef, width: summaryWidth, startDrag } = useResizablePane({
    storageKey: "askme.chat.summaryPaneWidth",
    defaultWidth: 360,
    minWidth: 240,
    maxWidth: 640,
  });
  const [citationOpen, setCitationOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const canSubmit = (canSend && Boolean(input.trim())) || canSendScopedSummary;
  const inputEnabled = effectiveRagReady || scopedArticles.length > 0 || loadingStatus;

  const statusLine = (() => {
    const parts = [formatDaysLabel(days)];
    if (loadingStatus && !effectiveRagReady) {
      parts.push("同步索引中");
    } else if (effectiveRagReady) {
      if (scopedArticles.length > 0) {
        parts.push(`限定 ${scopedArticles.length} 篇`);
      } else {
        parts.push(`${effectiveChunkCount} 片段`);
        if (statusRevalidating) parts.push("同步中");
      }
    } else {
      parts.push("未建索引");
    }
    if (hasOverview) {
      parts.push("概览就绪");
    } else if (!loadingSummary && !generating) {
      parts.push("无概览");
    }
    return parts.join(" · ");
  })();

  const focusChatInput = useCallback(() => {
    const el = chatInputRef.current;
    if (!el || el.disabled) return;
    el.focus({ preventScroll: true });
  }, []);

  const handleSend = useCallback(() => {
    if (!canSubmit || sending) return;
    void sendMessage(input);
  }, [canSubmit, input, sendMessage, sending]);

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
      if (!canSubmit || sending) return;
      event.preventDefault();
      focusChatInput();
      handleSend();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canSubmit, focusChatInput, handleSend, sending]);

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

  const composerMenuItems: OverflowMenuItem[] = [
    {
      label: enableDeepThinking ? "深度思考：开" : "深度思考：关",
      hint: "开启后回答前会先推理，需模型支持",
      disabled: !inputEnabled,
      onClick: () => setEnableDeepThinking(!enableDeepThinking),
    },
  ];
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
    <div ref={containerRef} className="flex h-full bg-[var(--paper)]">
      <aside
        style={{ width: summaryWidth }}
        className="flex min-w-0 shrink-0 flex-col border-r border-[var(--rule)] bg-[var(--paper-raised)]"
      >
        <div className="border-b border-[var(--rule)] px-3 py-2.5">
          <div className="flex items-center gap-2">
            <select
              value={selectedGroupId ?? ""}
              onChange={(e) => setSelectedSummaryGroup(e.target.value)}
              disabled={summaryGroupOptions.length === 0 || digestBusy}
              className="ui-select min-w-0 flex-1 truncate py-1.5 text-xs disabled:opacity-50"
              aria-label="选择分组"
              title={
                summaryGroupOptions.find((g) => g.id === selectedGroupId)?.name || "选择分组"
              }
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
            <DaysRangeSelect
              value={days}
              onChange={setDays}
              disabled={digestBusy}
              size="sm"
              className="shrink-0"
            />
            <button
              type="button"
              disabled={digestBusy || !isLlmConfigured(settings) || !selectedGroupId}
              onClick={() => void startSummarize()}
              className="ui-btn ui-btn-primary shrink-0 px-2.5 py-1.5 text-xs disabled:opacity-50"
              title="按当前分组与时间范围生成结构化概览目录"
            >
              {generating ? "生成中…" : "生成概览"}
            </button>
          </div>
          {summaryError ? <p className="mt-2 text-xs text-red-700">{summaryError}</p> : null}
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {generating ? (
            <DigestGeneratingPanel
              phase={summaryPhase}
              message={summarizeStatus}
              hasPreview={Boolean(displaySummary || digestTree || thinking)}
            />
          ) : null}
          {loadingSummary && !generating && !displaySummary && !digestTree ? (
            <p className="px-1 text-sm text-[var(--ink-muted)]">加载目录…</p>
          ) : displaySummary || digestTree || thinking ? (
            <div className="min-w-0">
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
              {showTree && digestTree ? (
                <DigestTreeView
                  tree={digestTree}
                  onAddArticle={addScopedArticle}
                  onAddArticles={addScopedArticles}
                />
              ) : displaySummary ? (
                <div className="summary-markdown-scroll">
                  <SummaryMarkdown
                    content={displaySummary}
                    articleRefs={articleRefs}
                    className="summary-markdown-nowrap"
                    onAddArticle={addScopedArticle}
                    onAddArticles={addScopedArticles}
                  />
                </div>
              ) : null}
              {generating && displaySummary ? (
                <span className="mt-1 inline-block animate-pulse text-[var(--ink-muted)]">▍</span>
              ) : null}
            </div>
          ) : !generating ? (
            <p className="px-1 text-sm leading-6 text-[var(--ink-muted)]">
              选择分组与时间后点「生成概览」，或从已有目录拖标题到右侧对话。
            </p>
          ) : null}
        </div>
      </aside>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整目录栏宽度"
        onMouseDown={startDrag}
        className="group relative z-10 w-1 shrink-0 cursor-col-resize bg-[var(--rule)] transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_30%,var(--rule))]"
      >
        <div className="absolute inset-y-0 -left-1 -right-1" />
      </div>

      <div
        className={`relative flex min-w-0 flex-1 flex-col transition-colors ${
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
              松开以加入对话
            </p>
          </div>
        ) : null}

        <header className="border-b border-[var(--rule)] bg-[var(--paper-raised)] px-5 py-3">
          <h1 className="text-base font-semibold tracking-tight text-[var(--ink)]">对话</h1>
          <p className="mt-0.5 truncate text-xs text-[var(--ink-muted)]">{statusLine}</p>
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
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <p className="text-base font-medium tracking-tight text-[var(--ink)]">开始对话</p>
              <ol className="mt-4 max-w-sm space-y-2 text-left text-sm leading-6 text-[var(--ink-muted)]">
                <li>
                  <span className="mr-2 tabular-nums text-[var(--ink)]">1.</span>
                  左侧选分组与时间，点「生成概览」
                </li>
                <li>
                  <span className="mr-2 tabular-nums text-[var(--ink)]">2.</span>
                  拖章节/文章到此处，或直接提问
                </li>
                <li>
                  <span className="mr-2 tabular-nums text-[var(--ink)]">3.</span>
                  Enter 发送 · Shift+Enter 换行 · 点 [n] 看引用
                </li>
              </ol>
            </div>
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
              placeholder={
                scopedArticles.length > 0
                  ? input.trim()
                    ? `已加入 ${scopedArticles.length} 篇 · Enter 发送`
                    : `已加入 ${scopedArticles.length} 篇 · Enter 生成摘要`
                  : inputEnabled
                    ? "输入问题…"
                    : loadingStatus
                      ? "正在同步索引…"
                      : "输入问题（需先建索引，或从左侧加入文章）"
              }
              disabled={sending}
              className="ui-textarea min-h-[2.5rem] max-h-36 min-w-0 flex-1 resize-none py-2 text-sm leading-6 disabled:opacity-50"
            />
            <div className="flex shrink-0 items-center gap-1.5 pb-0.5">
              {enableDeepThinking ? (
                <span className="hidden text-[10px] text-[var(--accent)] sm:inline">深度思考</span>
              ) : null}
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
                  disabled={!canSubmit}
                  title={
                    canSubmit
                      ? undefined
                      : inputEnabled
                        ? "输入问题后发送"
                        : "请先建立索引，或从左侧加入文章"
                  }
                  className="ui-btn ui-btn-primary shrink-0 disabled:opacity-50"
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
      </div>
    </div>
  );
}
