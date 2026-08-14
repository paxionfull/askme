import { useCallback, useEffect, useRef, useState } from "react";
import CitationMarkdown from "../components/CitationMarkdown";
import CitationSidebar from "../components/CitationSidebar";
import ScopedArticlesBar from "../components/ScopedArticlesBar";
import SummaryMarkdown, {
  acceptsArticleDrag,
  readArticleDragPayload,
} from "../components/SummaryMarkdown";
import { useChat } from "../contexts/ChatContext";
import { useDigest } from "../contexts/DigestContext";
import { useResizablePane } from "../hooks/useResizablePane";
import { formatDaysLabel, isLlmConfigured, useSettings } from "../hooks/useSettings";

const SUGGESTIONS = [
  "今天有哪些重要文章？",
  "帮我按主题分类总结一下",
  "有没有值得深入阅读的文章？",
];

export default function ChatPage() {
  const { settings } = useSettings();
  const {
    days,
    bodiesReady,
    summary,
    thinking,
    generating,
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
    articleRefs,
    scopedArticles,
    addScopedArticle,
    addScopedArticles,
    removeScopedArticle,
    clearScopedArticles,
    ragReady,
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
  const chatInputRef = useRef<HTMLInputElement>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const displaySummary = generating ? summary : chatSummary;
  const { containerRef, width: summaryWidth, startDrag } = useResizablePane({
    storageKey: "askme.chat.summaryPaneWidth",
    defaultWidth: 360,
    minWidth: 240,
    maxWidth: 640,
  });
  const [citationOpen, setCitationOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const canSubmit = (canSend && Boolean(input.trim())) || canSendScopedSummary;

  const handleSend = useCallback(() => {
    if (!canSubmit || sending) return;
    void sendMessage(input);
  }, [canSubmit, input, sendMessage, sending]);

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
      event.preventDefault();
      handleSend();
    },
    [handleSend],
  );

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
      chatInputRef.current?.focus();
    },
    [addScopedArticle, addScopedArticles],
  );

  const handleArticleDragLeave = useCallback((event: React.DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDropActive(false);
    }
  }, []);

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

  const startInlineEdit = useCallback(
    (index: number, content: string) => {
      setEditingIndex(index);
      setEditingText(content);
    },
    [],
  );

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

  return (
    <div ref={containerRef} className="flex h-full bg-slate-50">
      <aside
        style={{ width: summaryWidth }}
        className="flex min-w-0 shrink-0 flex-col border-r border-slate-200 bg-white"
      >
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">概览</h2>
          <p className="mt-1 text-xs text-slate-500">{formatDaysLabel(days)} · 标题索引 · 点击「加入对话」或拖标题到右侧</p>
          <div className="mt-3 flex items-center gap-2">
            <select
              value={selectedGroupId ?? ""}
              onChange={(e) => setSelectedSummaryGroup(e.target.value)}
              disabled={summaryGroupOptions.length === 0 || digestBusy}
              className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 disabled:opacity-50"
              aria-label="选择分组"
            >
              {summaryGroupOptions.length === 0 ? (
                <option value="">暂无可用分组</option>
              ) : (
                summaryGroupOptions.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}（{group.feedCount}）
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              disabled={
                digestBusy ||
                !bodiesReady ||
                !isLlmConfigured(settings) ||
                !selectedGroupId
              }
              onClick={() => void startSummarize()}
              className="shrink-0 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
            >
              {generating ? "生成中..." : "生成概览"}
            </button>
          </div>
          {summaryError && (
            <p className="mt-2 text-xs text-red-600">{summaryError}</p>
          )}
          {generating && summarizeStatus && (
            <p className="mt-2 text-xs text-slate-500">{summarizeStatus}</p>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loadingSummary && !generating && !displaySummary ? (
            <p className="text-sm text-slate-400">加载概览...</p>
          ) : displaySummary || thinking ? (
            <div className="min-w-0">
              {thinking && (
                <details open={generating && !summary} className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <summary className="cursor-pointer text-xs font-medium text-slate-500">
                    思考过程{generating && !summary ? "（生成中）" : ""}
                  </summary>
                  <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-6 text-slate-500">
                    {thinking}
                  </p>
                </details>
              )}
              {displaySummary ? (
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
              {generating && (
                <span className="mt-1 inline-block animate-pulse text-slate-400">▍</span>
              )}
            </div>
          ) : (
            <p className="text-sm leading-7 text-slate-500">
              暂无概览。请先在「数据源」页拉取正文，再选择分组并生成概览。
            </p>
          )}
        </div>
      </aside>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整概览栏宽度"
        onMouseDown={startDrag}
        className="group relative z-10 w-1 shrink-0 cursor-col-resize bg-slate-200 transition-colors hover:bg-slate-400"
      >
        <div className="absolute inset-y-0 -left-1 -right-1" />
      </div>

      <div
        className={`relative flex min-w-0 flex-1 flex-col transition-colors ${
          dropActive ? "bg-indigo-50/40" : ""
        }`}
        onDragOver={handleArticleDragOver}
        onDragLeave={handleArticleDragLeave}
        onDrop={handleArticleDrop}
      >
        {dropActive && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-indigo-300 bg-indigo-50/50">
            <p className="rounded-lg bg-white/90 px-4 py-2 text-sm text-indigo-700 shadow-sm">
              松开以添加文章到对话
            </p>
          </div>
        )}
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div>
            <h1 className="text-base font-semibold">对话</h1>
            <p className="text-xs text-slate-500">
              {loadingStatus && !effectiveRagReady
                ? "正在同步索引状态…"
                : effectiveRagReady
                  ? scopedArticles.length > 0
                    ? `RAG 限定 ${scopedArticles.length} 篇文章 · ${formatDaysLabel(days)}`
                    : `RAG 索引：${formatDaysLabel(days)} · ${effectiveChunkCount} 个片段${statusRevalidating ? " · 同步中" : ""}`
                  : "尚未建立索引，请先在数据源页拉取正文并建立索引"}
            </p>
            {!displaySummary && !loadingSummary && !generating && (
              <p className="mt-1 text-xs text-amber-600">左侧暂无概览，回答质量可能下降</p>
            )}
            {!bodiesReady && !loadingStatus && !ragReady && (
              <p className="mt-1 text-xs text-amber-600">正文尚未加载</p>
            )}
          </div>
        </header>

        {error && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
        )}

        {statusMessage && (
          <div className="border-b border-slate-200 bg-slate-100 px-4 py-2 text-sm text-slate-600">
            {statusMessage}
          </div>
        )}

        {promptPreview && (
          <details className="border-b border-slate-200 bg-slate-50 px-4 py-2">
            <summary className="cursor-pointer text-xs font-medium text-slate-600">
              查看本次 Prompt（system + 本轮用户上下文）
            </summary>
            <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-slate-700">
              {promptPreview}
            </pre>
          </details>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4">
              <p className="text-sm text-slate-500">
                点击概览中的「加入对话」，或拖入章节标题、文章链接；Enter 发送可提问或生成摘要
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => void sendMessage(item)}
                    disabled={!canSend}
                    className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-3">
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={`group flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`chat-bubble max-w-[92%] rounded-2xl px-4 py-2 ${
                      message.role === "user"
                        ? "bg-slate-900 text-sm leading-7 text-white whitespace-pre-wrap"
                        : "bg-white text-slate-800 shadow-sm"
                    }`}
                  >
                    {message.role === "assistant" ? (
                      <>
                        {message.citations && message.citations.length > 0 && (
                          <p className="mb-2 text-xs text-slate-500">
                            引用 {message.citations.length} 个片段 ·{" "}
                            <button
                              type="button"
                              className="text-amber-700 hover:underline"
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
                              在右侧查看
                            </button>
                          </p>
                        )}
                        {message.thinking ? (
                          <details className="mb-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                            <summary className="cursor-pointer font-medium">思考过程</summary>
                            <pre className="mt-2 whitespace-pre-wrap">{message.thinking}</pre>
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
                          <span className="text-sm text-slate-400">...</span>
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
                          className="w-full resize-y rounded-lg border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm leading-6 text-white outline-none focus:border-slate-400"
                        />
                        <div className="mt-2 flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={cancelInlineEdit}
                            className="rounded px-2 py-1 text-xs text-slate-400 hover:text-white"
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            disabled={!editingText.trim()}
                            onClick={submitInlineEdit}
                            className="rounded bg-white px-2 py-1 text-xs text-slate-900 hover:bg-slate-100 disabled:opacity-50"
                          >
                            发送
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {message.content}
                        {message.scoped_articles && message.scoped_articles.length > 0 && (
                          <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                            {message.scoped_articles.map((article) => (
                              <span
                                key={`${article.feed_id}:${article.article_id}`}
                                className="inline-flex max-w-full items-center rounded-full border border-slate-500/40 bg-slate-800/70 px-2 py-0.5 text-[11px] text-slate-100"
                                title={article.title}
                              >
                                {article.title || "未命名文章"}
                              </span>
                            ))}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => startInlineEdit(index, message.content)}
                          className="mt-1 block text-xs text-slate-400 opacity-0 transition-opacity group-hover:opacity-100 hover:text-white"
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

        <div className="border-t border-slate-200 bg-white px-4 py-3">
          <ScopedArticlesBar
            articles={scopedArticles}
            onRemove={removeScopedArticle}
            onClear={clearScopedArticles}
          />
          <form
            className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-lg"
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
          >
            <input
              ref={chatInputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={
                effectiveRagReady || scopedArticles.length > 0
                  ? scopedArticles.length > 0
                    ? input.trim()
                      ? `已添加 ${scopedArticles.length} 篇文章，Enter 发送`
                      : `已添加 ${scopedArticles.length} 篇，Enter 或点发送生成原文摘要`
                    : "输入问题，Enter 发送；也可从左侧概览加入文章"
                  : loadingStatus
                    ? "正在同步索引状态…"
                    : "请先在数据源页拉取正文并建立索引"
              }
              disabled={sending || (!effectiveRagReady && scopedArticles.length === 0 && !loadingStatus)}
              className="min-w-[12rem] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 disabled:opacity-50"
            />
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                aria-pressed={enableDeepThinking}
                disabled={!effectiveRagReady && scopedArticles.length === 0}
                onClick={() => setEnableDeepThinking(!enableDeepThinking)}
                title="开启后回答前会先推理，需模型/API 支持"
                className={`shrink-0 rounded-lg border px-3 py-2 text-sm disabled:opacity-50 ${
                  enableDeepThinking
                    ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                    : "border-slate-300 text-slate-600 hover:bg-slate-50"
                }`}
              >
                深度思考
              </button>
              {sending ? (
                <button
                  type="button"
                  onClick={stopGeneration}
                  className="shrink-0 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700 hover:bg-red-100"
                >
                  停止
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  发送
                </button>
              )}
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    cancelInlineEdit();
                    setCitationOpen(false);
                    clearMessages();
                  }}
                  className="shrink-0 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
                >
                  清空对话
                </button>
              )}
            </div>
          </form>
          <p className="mx-auto mt-2 max-w-3xl text-xs text-slate-400">
            Prompt 组装：system 仅角色/规则；概览与检索片段在本轮 user（见 chat_service.build_answer_messages）
          </p>
        </div>
      </div>

      <CitationSidebar
        items={citations}
        activeIndex={activeCitationIndex}
        open={citationOpen}
        onOpenChange={setCitationOpen}
        onSelect={setActiveCitationIndex}
      />
    </div>
  );
}
