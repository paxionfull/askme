import { useEffect, useRef } from "react";
import CitationMarkdown from "../components/CitationMarkdown";
import CitationPanel from "../components/CitationPanel";
import MarkdownContent from "../components/MarkdownContent";
import { useChat } from "../contexts/ChatContext";
import { useDigest } from "../contexts/DigestContext";
import { isLlmConfigured, useSettings } from "../hooks/useSettings";

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
    selectedGroupIds,
    toggleSummaryGroup,
    selectAllSummaryGroups,
    enableDeepThinking: summarizeDeepThinking,
    setEnableDeepThinking: setSummarizeDeepThinking,
  } = useDigest();
  const {
    loadingSummary,
    chatSummary,
    ragReady,
    chunkCount,
    loadingStatus,
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
    sendMessage,
    selectMessageCitations,
    enableDeepThinking,
    setEnableDeepThinking,
  } = useChat();

  const bottomRef = useRef<HTMLDivElement>(null);
  const displaySummary = generating ? summary : chatSummary;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending, statusMessage]);

  return (
    <div className="flex h-full bg-slate-50">
      <aside className="flex w-[38%] min-w-[280px] max-w-[480px] shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">摘要</h2>
          <p className="mt-1 text-xs text-slate-500">近 {days} 天 · 对照摘要提问</p>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loadingSummary && !generating && !displaySummary ? (
            <p className="text-sm text-slate-400">加载摘要...</p>
          ) : displaySummary || thinking ? (
            <div>
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
              {displaySummary ? <MarkdownContent content={displaySummary} /> : null}
              {generating && (
                <span className="mt-1 inline-block animate-pulse text-slate-400">▍</span>
              )}
            </div>
          ) : (
            <p className="text-sm leading-7 text-slate-500">
              暂无摘要。请先在「数据源」页加载正文，再点击上方「生成摘要」。
            </p>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div>
            <h1 className="text-base font-semibold">对话</h1>
            <p className="text-xs text-slate-500">
              {loadingStatus
                ? "检查索引状态..."
                : ragReady
                  ? `RAG 索引：近 ${days} 天 · ${chunkCount} 个片段`
                  : "尚未建立索引，请先在数据源页加载正文并建立索引"}
            </p>
            {!displaySummary && !loadingSummary && !generating && (
              <p className="mt-1 text-xs text-amber-600">左侧暂无摘要，回答质量可能下降</p>
            )}
            {!bodiesReady && !loadingStatus && !ragReady && (
              <p className="mt-1 text-xs text-amber-600">正文尚未加载</p>
            )}
            {summaryError && (
              <p className="mt-1 text-xs text-red-600">{summaryError}</p>
            )}
            {generating && summarizeStatus && (
              <p className="mt-1 text-xs text-slate-500">{summarizeStatus}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {summaryGroupOptions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
                <button
                  type="button"
                  onClick={selectAllSummaryGroups}
                  className="text-xs text-slate-500 hover:text-slate-700"
                >
                  {selectedGroupIds.length === summaryGroupOptions.length ? "全不选" : "全选"}
                </button>
                {summaryGroupOptions.map((group) => (
                  <label
                    key={group.id}
                    className={`flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-xs ${
                      selectedGroupIds.includes(group.id)
                        ? "bg-slate-900 text-white"
                        : "bg-white text-slate-600"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={selectedGroupIds.includes(group.id)}
                      onChange={() => toggleSummaryGroup(group.id)}
                    />
                    {group.name}
                    <span className="opacity-70">({group.feedCount})</span>
                  </label>
                ))}
              </div>
            )}
            <button
              type="button"
              aria-pressed={summarizeDeepThinking}
              disabled={digestBusy}
              onClick={() => setSummarizeDeepThinking(!summarizeDeepThinking)}
              title="开启后生成摘要前先推理，需模型/API 支持"
              className={`rounded-md border px-3 py-1.5 text-sm disabled:opacity-50 ${
                summarizeDeepThinking
                  ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                  : "border-slate-300 hover:bg-slate-50"
              }`}
            >
              摘要深度思考
            </button>
            <button
              type="button"
              disabled={digestBusy || !bodiesReady || !isLlmConfigured(settings) || selectedGroupIds.length === 0}
              onClick={() => void startSummarize()}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              {generating ? "生成中..." : "生成摘要"}
            </button>
            <button
              type="button"
              aria-pressed={enableDeepThinking}
              onClick={() => setEnableDeepThinking(!enableDeepThinking)}
              title="开启后回答前会先推理，需模型/API 支持"
              className={`rounded-md border px-3 py-1.5 text-sm ${
                enableDeepThinking
                  ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                  : "border-slate-300 hover:bg-slate-50"
              }`}
            >
              对话深度思考
            </button>
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
              查看本次 System Prompt（含摘要与检索片段）
            </summary>
            <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-slate-700">
              {promptPreview}
            </pre>
          </details>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4">
              <p className="text-sm text-slate-500">基于近 {days} 天文章与摘要提问</p>
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
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
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
                              onClick={() => selectMessageCitations(index)}
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
                              selectMessageCitations(index);
                              setActiveCitationIndex(citationIndex);
                            }}
                          />
                        ) : sending && index === messages.length - 1 ? (
                          <span className="text-sm text-slate-400">...</span>
                        ) : null}
                      </>
                    ) : (
                      message.content
                    )}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 bg-white px-4 py-3">
          <form
            className="mx-auto flex max-w-3xl gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void sendMessage(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={ragReady ? "输入问题，Enter 发送" : "请先在数据源页加载正文并建立索引"}
              disabled={!canSend}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!canSend || !input.trim()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {sending ? "发送中..." : "发送"}
            </button>
          </form>
          <p className="mx-auto mt-2 max-w-3xl text-xs text-slate-400">
            Prompt 组装见 backend/chat_service.py → build_answer_messages；发送后可展开上方预览核对
          </p>
        </div>
      </div>

      <div className="hidden w-[320px] shrink-0 lg:block xl:w-[360px]">
        <CitationPanel
          items={citations}
          activeIndex={activeCitationIndex}
          onSelect={setActiveCitationIndex}
        />
      </div>
    </div>
  );
}
