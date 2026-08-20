import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import CitationMarkdown from "../CitationMarkdown";
import CitationSidebar from "../CitationSidebar";
import OverflowMenu, { type OverflowMenuItem } from "../OverflowMenu";
import ScopedArticlesBar from "../ScopedArticlesBar";
import type { ChatUiMessage, ScopedArticle } from "../../contexts/ChatContext";
import type { CitationItem } from "../../api";
import { useLocale } from "../../i18n/LocaleContext";
import { formatMessage, type MessageKey } from "../../i18n/messages";
type BriefInsightPanelProps = {
  excerpt: string;
  messages: ChatUiMessage[];
  citations: CitationItem[];
  activeCitationIndex: number | null;
  citationOpen: boolean;
  onCitationOpenChange: (open: boolean) => void;
  onCitationSelect: (index: number | null) => void;
  emptyState: { kind: "generating" | "scoped" | "guide"; needIndex?: boolean } | null;
  digestReady?: boolean;
  scopedCount: number;
  effectiveRagReady: boolean;
  indexBuildLink: ReactNode;
  error: string;
  statusMessage: string;
  showPromptPreview: boolean;
  promptPreview: string;
  messagesScrollRef: React.RefObject<HTMLDivElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  onPaneClick: (event: React.MouseEvent) => void;
  dropActive: boolean;
  onDragOver: (event: React.DragEvent) => void;
  onDragLeave: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
  editingIndex: number | null;
  editingText: string;
  editTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onEditingTextChange: (value: string) => void;
  onCancelEdit: () => void;
  onSubmitEdit: () => void;
  onStartEdit: (index: number, content: string) => void;
  onFocusCitation: (citationIndex: number, messageIndex?: number) => void;
  onSelectMessageCitations: (messageIndex: number) => void;
  sending: boolean;
  scopedArticles: ScopedArticle[];
  onRemoveScoped: (feedId: string, articleId: string) => void;
  onClearScoped: () => void;
  composerHint: ReactNode;
  input: string;
  onInputChange: (value: string) => void;
  chatInputRef: React.RefObject<HTMLTextAreaElement | null>;
  onInputKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  inputPlaceholder: string;
  composerMenuItems: OverflowMenuItem[];
  canSubmit: boolean;
  submitDisabledTitle?: string;
  onSend: () => void;
  onStop: () => void;
  className?: string;
};

export default function BriefInsightPanel({
  excerpt,
  messages,
  citations,
  activeCitationIndex,
  citationOpen,
  onCitationOpenChange,
  onCitationSelect,
  emptyState,
  digestReady = false,
  scopedCount,
  effectiveRagReady,
  indexBuildLink,
  error,
  statusMessage,
  showPromptPreview,
  promptPreview,
  messagesScrollRef,
  bottomRef,
  onPaneClick,
  dropActive,
  onDragOver,
  onDragLeave,
  onDrop,
  editingIndex,
  editingText,
  editTextareaRef,
  onEditingTextChange,
  onCancelEdit,
  onSubmitEdit,
  onStartEdit,
  onFocusCitation,
  onSelectMessageCitations,
  sending,
  scopedArticles,
  onRemoveScoped,
  onClearScoped,
  composerHint,
  input,
  onInputChange,
  chatInputRef,
  onInputKeyDown,
  inputPlaceholder,
  composerMenuItems,
  canSubmit,
  submitDisabledTitle,
  onSend,
  onStop,
  className = "",
}: BriefInsightPanelProps) {
  const { t, locale } = useLocale();

  const label = (key: MessageKey) => (
    <span className="font-medium text-[var(--ink)]">{t(key)}</span>
  );

  return (
    <aside
      className={`brief-insight-pane relative ${className}`.trim()}
      aria-label={t("briefAsk")}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onPaneClick}
    >
      {dropActive ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-[color-mix(in_srgb,var(--accent)_40%,var(--border))] bg-[color-mix(in_srgb,var(--accent-soft)_50%,transparent)]">
          <p className="rounded-[var(--radius-control)] bg-[var(--surface-raised)]/90 px-4 py-2 text-sm text-[var(--accent)]">
            {t("askDropHere")}
          </p>
        </div>
      ) : null}

      <section className="brief-insight-summary" aria-label={t("briefSummarizedBy")}>
        <p className="brief-insight-summary-label">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M7.6 1.1c.5 3.3 1.9 4.7 5.2 5.2-3.3.5-4.7 1.9-5.2 5.2-.5-3.3-1.9-4.7-5.2-5.2 3.3-.5 4.7-1.9 5.2-5.2Z"
              fill="currentColor"
            />
            <path
              d="M12.4 10.3c.2 1.4.8 2 2.2 2.2-1.4.2-2 .8-2.2 2.2-.2-1.4-.8-2-2.2-2.2 1.4-.2 2-.8 2.2-2.2Z"
              fill="currentColor"
            />
          </svg>
          {t("briefSummarizedBy")}
        </p>
        {excerpt.trim() ? (
          <div className="brief-insight-summary-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noreferrer">
                    {children}
                  </a>
                ),
                h1: ({ children }) => <p>{children}</p>,
                h2: ({ children }) => <p>{children}</p>,
                h3: ({ children }) => <p>{children}</p>,
                h4: ({ children }) => <p>{children}</p>,
                ul: ({ children }) => <ul>{children}</ul>,
                ol: ({ children }) => <ol>{children}</ol>,
                li: ({ children }) => <li>{children}</li>,
                p: ({ children }) => <p>{children}</p>,
              }}
            >
              {excerpt}
            </ReactMarkdown>
          </div>
        ) : (
          <p className="brief-insight-summary-body is-empty">{t("briefSummaryEmpty")}</p>
        )}
      </section>

      <div className="brief-insight-ask">
        {error ? (
          <div
            className="border-b border-[var(--border)] bg-[var(--error-soft)] px-3 py-2 text-sm text-[var(--danger-text)]"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        {statusMessage ? (
          <div className="border-b border-[var(--border)] px-3 py-2 text-sm text-[var(--ink-muted)]">
            {statusMessage}
          </div>
        ) : null}

        {showPromptPreview && promptPreview ? (
          <details open className="border-b border-[var(--border)] px-3 py-2">
            <summary className="cursor-pointer text-xs text-[var(--ink-muted)]">
              {t("askPromptPreview")}
            </summary>
            <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-[var(--ink)]">
              {promptPreview}
            </pre>
          </details>
        ) : null}

        <div ref={messagesScrollRef} className="brief-insight-ask-body">
          {messages.length === 0 ? (
            emptyState?.kind === "generating" ? (
              <p className="text-sm text-[var(--ink-muted)]">{t("askGeneratingHint")}</p>
            ) : emptyState?.kind === "scoped" ? (
              <div>
                <p className="text-sm font-medium text-[var(--ink)]">
                  {formatMessage(locale, "chatArticlesAdded", { count: scopedCount })}
                </p>
                <ul className="mt-3 list-none space-y-2 text-xs leading-5 text-[var(--ink-muted)]">
                  <li>
                    {label("chatSummaryLabel")}
                    {t("chatSummaryEmptyEnter")}
                  </li>
                  <li>
                    {label("briefAsk")}
                    {!effectiveRagReady ? (
                      <>
                        {" — "}
                        {t("chatNeedIndexPrefix")} {indexBuildLink}
                        {t("chatAskThenEnter")}
                      </>
                    ) : (
                      t("chatAskScopedEnter")
                    )}
                  </li>
                </ul>
              </div>
            ) : digestReady ? (
              <p className="text-sm leading-6 text-[var(--ink-muted)]">
                {t("briefAskReadyHint")}
                {emptyState?.needIndex ? (
                  <>
                    {" "}
                    {indexBuildLink}
                    {t("chatAskThenEnter")}
                  </>
                ) : null}
              </p>
            ) : (
              <div>
                <p className="text-sm font-medium text-[var(--ink)]">{t("chatHowToUse")}</p>
                <ul className="mt-3 list-none space-y-2 text-xs leading-5 text-[var(--ink-muted)]">
                  <li>
                    {label("chatSummaryLabel")}
                    {t("chatSummaryGuide")}
                  </li>
                  <li>
                    {label("briefAsk")}
                    {emptyState?.needIndex ? (
                      <>
                        {" — "}
                        {t("chatNeedIndexPrefix")} {indexBuildLink}
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
            <div>
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={`brief-chat-row${message.role === "user" ? " is-user" : " is-assistant"}`}
                >
                  {message.role === "assistant" ? (
                    <div className="brief-chat-head">
                      <img src="/logo.svg" alt="" width={22} height={22} className="brief-chat-avatar" />
                      <span className="brief-chat-author">{t("appName")}</span>
                    </div>
                  ) : null}
                  <div
                    className={`brief-chat-bubble${
                      message.role === "user" ? " is-user" : " is-assistant"
                    }`}
                  >
                    {message.role === "assistant" ? (
                      <>
                        {message.citations && message.citations.length > 0 ? (
                          <p className="mb-2 text-[11px] text-[var(--ink-muted)]">
                            {formatMessage(locale, "chatCitations", {
                              count: message.citations.length,
                            })}{" "}
                            <button
                              type="button"
                              className="text-[var(--accent)] hover:underline"
                              onClick={() => {
                                const first = message.citations?.[0]?.index;
                                if (first != null) {
                                  onFocusCitation(first, index);
                                } else {
                                  onSelectMessageCitations(index);
                                  onCitationOpenChange(true);
                                }
                              }}
                            >
                              {t("chatOpenCitations")}
                            </button>
                          </p>
                        ) : null}
                        {message.content ? (
                          <CitationMarkdown
                            content={message.content}
                            onCitationClick={(citationIndex) => onFocusCitation(citationIndex, index)}
                          />
                        ) : sending && index === messages.length - 1 ? (
                          <span className="text-[var(--ink-muted)]">…</span>
                        ) : null}
                      </>
                    ) : editingIndex === index ? (
                      <div className="min-w-[180px]">
                        <textarea
                          ref={editTextareaRef}
                          value={editingText}
                          onChange={(e) => onEditingTextChange(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              onSubmitEdit();
                            } else if (e.key === "Escape") {
                              onCancelEdit();
                            }
                          }}
                          rows={3}
                          className="ui-textarea w-full text-sm"
                        />
                        <div className="mt-2 flex justify-end gap-2">
                          <button type="button" onClick={onCancelEdit} className="ui-btn ui-btn-ghost text-xs">
                            {t("cancel")}
                          </button>
                          <button
                            type="button"
                            disabled={!editingText.trim()}
                            onClick={onSubmitEdit}
                            className="ui-btn ui-btn-primary text-xs"
                          >
                            {t("commonSend")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {message.content}
                        <button
                          type="button"
                          onClick={() => onStartEdit(index, message.content)}
                          className="mt-1 block text-xs text-[var(--ink-muted)] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
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

        <div className="brief-insight-composer">
          <ScopedArticlesBar
            articles={scopedArticles}
            onRemove={onRemoveScoped}
            onClear={onClearScoped}
          />
          {composerHint ? (
            <p className="mb-2 text-xs leading-5 text-[var(--ink-muted)]">{composerHint}</p>
          ) : null}
          <form
            className="brief-insight-composer-form"
            onSubmit={(e) => {
              e.preventDefault();
              onSend();
            }}
          >
            <OverflowMenu
              items={composerMenuItems}
              label={t("chatComposerMenu")}
              placement="top"
              disabled={composerMenuItems.length === 0}
            />
            <textarea
              ref={chatInputRef}
              value={input}
              onChange={(e) => {
                onInputChange(e.target.value);
                const el = e.target;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
              }}
              onKeyDown={onInputKeyDown}
              rows={1}
              placeholder={inputPlaceholder}
              disabled={sending}
              className="ui-textarea text-sm leading-6 disabled:opacity-50"
            />
            {sending ? (
              <button type="button" onClick={onStop} className="ui-btn ui-btn-danger brief-insight-send">
                {t("stop")}
              </button>
            ) : (
              <button
                type="submit"
                disabled={sending}
                title={submitDisabledTitle}
                className={`ui-btn ui-btn-primary brief-insight-send ${!canSubmit ? "opacity-50" : ""}`}
                aria-label={t("commonSend")}
              >
                <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M17.4 2.6 2.9 7.9c-.6.2-.6 1 0 1.2l5.2 1.8 1.8 5.2c.2.6 1 .6 1.2 0l5.3-14.5c.2-.5-.3-1-.8-.8l-.2.1Z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M17.4 2.6 8.1 10.9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
          </form>
        </div>
      </div>

      <CitationSidebar
        items={citations}
        activeIndex={activeCitationIndex}
        open={citationOpen}
        onOpenChange={onCitationOpenChange}
        onSelect={onCitationSelect}
      />
    </aside>
  );
}
