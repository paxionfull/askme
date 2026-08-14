import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import {
  fetchCachedSummary,
  fetchRagStatus,
  SCOPED_SUMMARIZE_DEFAULT_MESSAGE,
  streamChat,
  type ArticleScopeItem,
  type ChatMessagePayload,
  type CitationItem,
  type DigestTree,
} from "../api";
import { getLlmConfigPayload, useSettings } from "../hooks/useSettings";
import { useStoredFlag } from "../hooks/useStoredFlag";
import { useDigest } from "./DigestContext";

export interface ChatUiMessage {
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  citations?: CitationItem[];
  scoped_articles?: ScopedArticle[];
}

export interface ScopedArticle {
  feed_id: string;
  article_id: string;
  title: string;
  url: string;
}

interface ChatContextValue {
  days: number;
  panelSummary: string;
  digestTree: DigestTree | null;
  articleRefs: ScopedArticle[];
  scopedArticles: ScopedArticle[];
  addScopedArticle: (article: ScopedArticle) => void;
  addScopedArticles: (articles: ScopedArticle[]) => void;
  removeScopedArticle: (feedId: string, articleId: string) => void;
  clearScopedArticles: () => void;
  loadingSummary: boolean;
  ragReady: boolean;
  chunkCount: number;
  loadingStatus: boolean;
  statusRevalidating: boolean;
  effectiveRagReady: boolean;
  effectiveChunkCount: number;
  messages: ChatUiMessage[];
  citations: CitationItem[];
  activeCitationIndex: number | null;
  setActiveCitationIndex: (index: number | null) => void;
  promptPreview: string;
  input: string;
  setInput: (value: string) => void;
  sending: boolean;
  statusMessage: string;
  error: string;
  canSend: boolean;
  canSendScopedSummary: boolean;
  chatSummary: string;
  sendMessage: (text: string, options?: { replaceFromIndex?: number }) => Promise<void>;
  stopGeneration: () => void;
  clearMessages: () => void;
  selectMessageCitations: (messageIndex: number) => void;
  enableDeepThinking: boolean;
  setEnableDeepThinking: (value: boolean) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

const RAG_STATUS_CACHE_KEY = "askme.ragStatus";

function loadRagStatusCache(days: number): { ready: boolean; chunk_count: number } | null {
  try {
    const raw = sessionStorage.getItem(RAG_STATUS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { days?: number; ready?: boolean; chunk_count?: number };
    if (parsed.days !== days) return null;
    return {
      ready: Boolean(parsed.ready),
      chunk_count: Number(parsed.chunk_count) || 0,
    };
  } catch {
    return null;
  }
}

function saveRagStatusCache(days: number, ready: boolean, chunk_count: number) {
  sessionStorage.setItem(
    RAG_STATUS_CACHE_KEY,
    JSON.stringify({ days, ready, chunk_count, ts: Date.now() }),
  );
}

const PHASE_LABELS: Record<string, string> = {
  planning_queries: "正在分析问题…",
  retrieving: "正在检索…",
  answering: "正在回答…",
};

export function ChatProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const {
    days,
    generating: digestGenerating,
    loadingIndex,
    indexReady,
    indexChunkCount,
    selectedGroupIds,
  } = useDigest();
  const initialRagCache = loadRagStatusCache(days);
  const [panelSummary, setPanelSummary] = useState("");
  const [digestTree, setDigestTree] = useState<DigestTree | null>(null);
  const [articleRefs, setArticleRefs] = useState<ScopedArticle[]>([]);
  const [scopedArticles, setScopedArticles] = useState<ScopedArticle[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [ragReady, setRagReady] = useState(initialRagCache?.ready ?? false);
  const [chunkCount, setChunkCount] = useState(initialRagCache?.chunk_count ?? 0);
  const [loadingStatus, setLoadingStatus] = useState(!initialRagCache);
  const [statusRevalidating, setStatusRevalidating] = useState(false);
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const [citations, setCitations] = useState<CitationItem[]>([]);
  const [activeCitationIndex, setActiveCitationIndex] = useState<number | null>(null);
  const [promptPreview, setPromptPreview] = useState("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [enableDeepThinking, setEnableDeepThinking] = useStoredFlag("askme.chat.enableThinking");
  const abortRef = useRef<AbortController | null>(null);
  const prevDigestGeneratingRef = useRef(digestGenerating);

  const chatSummary = panelSummary.trim();
  const llmConfigured = Boolean(settings.llmApiKey.trim() && settings.llmModel.trim());
  const effectiveRagReady = ragReady || indexReady;
  const effectiveChunkCount = ragReady ? chunkCount : indexReady ? indexChunkCount : chunkCount;
  const canSend = effectiveRagReady && llmConfigured && !sending;
  const canSendScopedSummary = llmConfigured && scopedArticles.length > 0 && !sending;

  const loadRagStatus = useCallback(async () => {
    const cached = loadRagStatusCache(days);
    if (cached) {
      setRagReady(cached.ready);
      setChunkCount(cached.chunk_count);
      setLoadingStatus(false);
      setStatusRevalidating(true);
    } else {
      setLoadingStatus(true);
    }
    try {
      const data = await fetchRagStatus(days);
      setRagReady(data.ready);
      setChunkCount(data.chunk_count);
      saveRagStatusCache(days, data.ready, data.chunk_count);
    } catch {
      if (!cached) {
        setRagReady(false);
        setChunkCount(0);
      }
    } finally {
      setLoadingStatus(false);
      setStatusRevalidating(false);
    }
  }, [days]);

  const addScopedArticle = useCallback((article: ScopedArticle) => {
    if (!article.feed_id || !article.article_id) return;
    if (article.title.includes("尚未建立索引")) return;
    setScopedArticles((current) => {
      if (current.some((item) => item.feed_id === article.feed_id && item.article_id === article.article_id)) {
        return current;
      }
      return [...current, article];
    });
  }, []);

  const addScopedArticles = useCallback((articles: ScopedArticle[]) => {
    if (articles.length === 0) return;
    setScopedArticles((current) => {
      const next = [...current];
      for (const article of articles) {
        if (!article.feed_id || !article.article_id) continue;
        if (article.title.includes("尚未建立索引")) continue;
        if (next.some((item) => item.feed_id === article.feed_id && item.article_id === article.article_id)) {
          continue;
        }
        next.push(article);
      }
      return next;
    });
  }, []);

  const removeScopedArticle = useCallback((feedId: string, articleId: string) => {
    setScopedArticles((current) =>
      current.filter((item) => !(item.feed_id === feedId && item.article_id === articleId)),
    );
  }, []);

  const clearScopedArticles = useCallback(() => {
    setScopedArticles([]);
  }, []);

  const loadPanelSummary = useCallback(async () => {
    if (selectedGroupIds.length === 0) {
      setPanelSummary("");
      setDigestTree(null);
      setArticleRefs([]);
      return;
    }
    setLoadingSummary(true);
    try {
      const data = await fetchCachedSummary(days, undefined, selectedGroupIds);
      setPanelSummary(data.summary ?? "");
      setDigestTree(data.digest_tree ?? null);
      setArticleRefs(
        (data.article_refs ?? []).map((item) => ({
          feed_id: item.feed_id,
          article_id: item.article_id,
          title: item.title ?? "",
          url: item.url ?? "",
        })),
      );
    } catch {
      setPanelSummary("");
      setDigestTree(null);
      setArticleRefs([]);
    } finally {
      setLoadingSummary(false);
    }
  }, [days, selectedGroupIds]);

  useEffect(() => {
    void loadRagStatus();
  }, [loadRagStatus]);

  useEffect(() => {
    void loadPanelSummary();
  }, [loadPanelSummary]);

  useEffect(() => {
    const wasGenerating = prevDigestGeneratingRef.current;
    prevDigestGeneratingRef.current = digestGenerating;
    if (wasGenerating && !digestGenerating) {
      void loadPanelSummary();
    }
  }, [digestGenerating, loadPanelSummary]);

  useEffect(() => {
    if (!loadingIndex) {
      void loadRagStatus();
    }
  }, [loadingIndex, indexReady, indexChunkCount, loadRagStatus]);

  const selectMessageCitations = useCallback((messageIndex: number) => {
    setMessages((current) => {
      const items = current[messageIndex]?.citations ?? [];
      setCitations(items);
      return current;
    });
  }, []);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    setStatusMessage("");
  }, []);

  const clearMessages = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setCitations([]);
    setActiveCitationIndex(null);
    setPromptPreview("");
    setError("");
    setStatusMessage("");
    setSending(false);
  }, []);

  const sendMessage = useCallback(
    async (text: string, options?: { replaceFromIndex?: number }) => {
      const trimmed = text.trim();
      const isScopedSummary = !trimmed && scopedArticles.length > 0;
      const content = isScopedSummary ? SCOPED_SUMMARIZE_DEFAULT_MESSAGE : trimmed;
      if (!content) return;

      if (sending && options?.replaceFromIndex == null) return;

      if (!isScopedSummary && !effectiveRagReady) {
        setError("请先在数据源页拉取正文并建立索引后再提问");
        return;
      }

      if (isScopedSummary && !llmConfigured) {
        setError("请先在设置页配置 API Key 和模型");
        return;
      }

      if (sending && options?.replaceFromIndex != null) {
        abortRef.current?.abort();
        abortRef.current = null;
        setSending(false);
        setStatusMessage("");
      }

      const scopedSnapshot =
        scopedArticles.length > 0
          ? scopedArticles.map((item) => ({
              feed_id: item.feed_id,
              article_id: item.article_id,
              title: item.title,
              url: item.url,
            }))
          : [];

      const baseMessages =
        options?.replaceFromIndex != null
          ? messages.slice(0, options.replaceFromIndex)
          : messages;
      const nextMessages: ChatUiMessage[] = [
        ...baseMessages,
        { role: "user", content, scoped_articles: scopedSnapshot },
      ];
      const assistantIndex = nextMessages.length;
      setMessages([...nextMessages, { role: "assistant", content: "", thinking: "", citations: [] }]);
      setInput("");
      setSending(true);
      setError("");
      setStatusMessage(isScopedSummary ? "正在生成摘要…" : "正在分析问题…");
      setPromptPreview("");
      setCitations([]);
      setActiveCitationIndex(null);

      const apiMessages: ChatMessagePayload[] = nextMessages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      let assistantContent = "";
      let assistantThinking = "";
      let assistantCitations: CitationItem[] = [];
      const controller = new AbortController();
      abortRef.current = controller;

      const articleScope: ArticleScopeItem[] | undefined =
        scopedArticles.length > 0
          ? scopedArticles.map((item) => ({
              feed_id: item.feed_id,
              article_id: item.article_id,
              title: item.title,
              url: item.url,
            }))
          : undefined;

      try {
        await streamChat(
          {
            messages: apiMessages,
            system_prompt: "",
            summary: chatSummary,
            days,
            article_scope: articleScope,
            summarize_scope: isScopedSummary,
            stream: true,
            enable_thinking: enableDeepThinking,
            use_rag: !isScopedSummary,
            llm_config: getLlmConfigPayload(),
          },
          (token) => {
            assistantContent += token;
            flushSync(() => {
              setMessages((current) => {
                const updated = [...current];
                updated[assistantIndex] = {
                  role: "assistant",
                  content: assistantContent,
                  thinking: assistantThinking,
                  citations: assistantCitations,
                };
                return updated;
              });
            });
          },
          () => {
            setSending(false);
            setStatusMessage("");
            if (controller.signal.aborted) {
              setMessages((current) => {
                const last = current[current.length - 1];
                if (
                  last?.role === "assistant" &&
                  !last.content.trim() &&
                  !last.thinking?.trim()
                ) {
                  return current.slice(0, -1);
                }
                return current;
              });
            }
          },
          (message) => {
            setError(message);
            setSending(false);
            setStatusMessage("");
          },
          (status) => {
            const label = status.message || (status.phase ? PHASE_LABELS[status.phase] : "");
            if (label) setStatusMessage(label);
          },
          (chunk) => {
            assistantThinking += chunk;
            flushSync(() => {
              setMessages((current) => {
                const updated = [...current];
                updated[assistantIndex] = {
                  role: "assistant",
                  content: assistantContent,
                  thinking: assistantThinking,
                  citations: assistantCitations,
                };
                return updated;
              });
            });
          },
          (items) => {
            assistantCitations = items;
            setCitations(items);
            setMessages((current) => {
              const updated = [...current];
              updated[assistantIndex] = {
                role: "assistant",
                content: assistantContent,
                thinking: assistantThinking,
                citations: items,
              };
              return updated;
            });
          },
          (preview) => {
            setPromptPreview(preview);
          },
          controller.signal,
        );
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof Error ? err.message : "发送失败");
        }
        setSending(false);
        setStatusMessage("");
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [chatSummary, days, effectiveRagReady, enableDeepThinking, llmConfigured, messages, scopedArticles, sending],
  );

  return (
    <ChatContext.Provider
      value={{
        days,
        panelSummary,
        digestTree,
        articleRefs,
        scopedArticles,
        addScopedArticle,
        addScopedArticles,
        removeScopedArticle,
        clearScopedArticles,
        loadingSummary,
        ragReady,
        chunkCount,
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
        chatSummary,
        sendMessage,
        stopGeneration,
        clearMessages,
        selectMessageCitations,
        enableDeepThinking,
        setEnableDeepThinking,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used within ChatProvider");
  }
  return context;
}
