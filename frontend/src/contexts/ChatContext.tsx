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
  cancelChatJob,
  fetchCachedSummary,
  fetchChatJobStatus,
  fetchRagStatus,
  SCOPED_SUMMARIZE_DEFAULT_MESSAGE,
  streamChat,
  type ArticleScopeItem,
  type ChatJobStatus,
  type ChatMessagePayload,
  type CitationItem,
  type DigestTree,
} from "../api";
import { getLlmConfigPayload, useSettings } from "../hooks/useSettings";
import { useStoredFlag } from "../hooks/useStoredFlag";
import { useLocale } from "../i18n/LocaleContext";
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
const CHAT_BUCKETS_KEY = "askme.chat.buckets";

type ChatBucket = {
  messages: ChatUiMessage[];
  scopedArticles: ScopedArticle[];
  /** 发送时记录的后台任务 id；生成期间刷新页面后用它重新接上未完成的回复。 */
  pendingJobId?: string;
};

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

function isChatUiMessage(value: unknown): value is ChatUiMessage {
  if (!value || typeof value !== "object") return false;
  const item = value as ChatUiMessage;
  return (item.role === "user" || item.role === "assistant") && typeof item.content === "string";
}

function isScopedArticle(value: unknown): value is ScopedArticle {
  if (!value || typeof value !== "object") return false;
  const item = value as ScopedArticle;
  return (
    typeof item.feed_id === "string" &&
    typeof item.article_id === "string" &&
    typeof item.title === "string" &&
    typeof item.url === "string"
  );
}

function loadChatBuckets(): Record<string, ChatBucket> {
  try {
    // 优先 localStorage（与时间范围一致，刷新可恢复）；兼容旧 sessionStorage
    const raw =
      localStorage.getItem(CHAT_BUCKETS_KEY) ?? sessionStorage.getItem(CHAT_BUCKETS_KEY);
    if (!raw || raw === "undefined") return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, ChatBucket> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") continue;
      const bucket = value as {
        messages?: unknown;
        scopedArticles?: unknown;
        pendingJobId?: unknown;
      };
      const messages = Array.isArray(bucket.messages)
        ? bucket.messages.filter(isChatUiMessage)
        : [];
      const scopedArticles = Array.isArray(bucket.scopedArticles)
        ? bucket.scopedArticles.filter(isScopedArticle)
        : [];
      const pendingJobId =
        typeof bucket.pendingJobId === "string" && bucket.pendingJobId ? bucket.pendingJobId : undefined;
      result[key] = { messages, scopedArticles, pendingJobId };
    }
    return result;
  } catch {
    return {};
  }
}

function persistChatBuckets(buckets: Record<string, ChatBucket>) {
  try {
    localStorage.setItem(CHAT_BUCKETS_KEY, JSON.stringify(buckets));
  } catch {
    // ignore quota / private mode
  }
}

const PHASE_LABEL_KEYS: Record<string, "chatPhasePlanning" | "chatPhaseRetrieving" | "chatPhaseAnswering"> = {
  planning_queries: "chatPhasePlanning",
  retrieving: "chatPhaseRetrieving",
  answering: "chatPhaseAnswering",
};

function shanghaiDateKey(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

function chatScopeKey(days: number, date = shanghaiDateKey()): string {
  return `${date}:${days}`;
}

function readBucket(buckets: Record<string, ChatBucket>, key: string): ChatBucket {
  return buckets[key] ?? { messages: [], scopedArticles: [] };
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const { t } = useLocale();
  const {
    days,
    generating: digestGenerating,
    loadingIndex,
    indexReady,
    indexChunkCount,
    selectedGroupIds,
  } = useDigest();
  const initialRagCache = loadRagStatusCache(days);
  const initialScopeKeyRef = useRef(chatScopeKey(days));
  const chatBucketsRef = useRef<Record<string, ChatBucket>>(loadChatBuckets());
  const initialBucketRef = useRef(readBucket(chatBucketsRef.current, initialScopeKeyRef.current));
  const [panelSummary, setPanelSummary] = useState("");
  const [digestTree, setDigestTree] = useState<DigestTree | null>(null);
  const [articleRefs, setArticleRefs] = useState<ScopedArticle[]>([]);
  const [scopedArticles, setScopedArticles] = useState<ScopedArticle[]>(
    () => initialBucketRef.current.scopedArticles,
  );
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [ragReady, setRagReady] = useState(initialRagCache?.ready ?? false);
  const [chunkCount, setChunkCount] = useState(initialRagCache?.chunk_count ?? 0);
  const [loadingStatus, setLoadingStatus] = useState(!initialRagCache);
  const [statusRevalidating, setStatusRevalidating] = useState(false);
  const [messages, setMessages] = useState<ChatUiMessage[]>(
    () => initialBucketRef.current.messages,
  );
  const [citations, setCitations] = useState<CitationItem[]>(() => {
    const lastAssistant = [...initialBucketRef.current.messages]
      .reverse()
      .find((item) => item.role === "assistant");
    return lastAssistant?.citations ?? [];
  });
  const [activeCitationIndex, setActiveCitationIndex] = useState<number | null>(null);
  const [promptPreview, setPromptPreview] = useState("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [enableDeepThinking, setEnableDeepThinking] = useStoredFlag("askme.chat.enableThinking");
  const abortRef = useRef<AbortController | null>(null);
  const prevDigestGeneratingRef = useRef(digestGenerating);
  const messagesRef = useRef(messages);
  const scopedArticlesRef = useRef(scopedArticles);
  const chatScopeRef = useRef<{ key: string; days: number; date: string } | null>({
    key: initialScopeKeyRef.current,
    days,
    date: shanghaiDateKey(),
  });
  const persistTimerRef = useRef<number | null>(null);
  const pendingJobIdRef = useRef<string | undefined>(initialBucketRef.current.pendingJobId);
  const reattachGenerationRef = useRef(0);
  const reattachTimerRef = useRef<number | null>(null);
  messagesRef.current = messages;
  scopedArticlesRef.current = scopedArticles;

  const persistCurrentChat = useCallback(
    (next?: { messages?: ChatUiMessage[]; scopedArticles?: ScopedArticle[] }) => {
      const key = chatScopeRef.current?.key;
      if (!key) return;
      const bucket: ChatBucket = {
        messages: next?.messages ?? messagesRef.current,
        scopedArticles: next?.scopedArticles ?? scopedArticlesRef.current,
        pendingJobId: pendingJobIdRef.current,
      };
      chatBucketsRef.current[key] = bucket;
      persistChatBuckets(chatBucketsRef.current);
    },
    [],
  );

  const schedulePersistCurrentChat = useCallback(() => {
    if (persistTimerRef.current != null) return;
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      persistCurrentChat();
    }, 200);
  }, [persistCurrentChat]);

  /** 生成完成 / 出错 / 取消后统一收尾：清掉待恢复任务标记并落盘最终内容。 */
  const finalizeReattach = useCallback(
    (finalMessages: ChatUiMessage[], options?: { error?: string }) => {
      messagesRef.current = finalMessages;
      setMessages(finalMessages);
      setSending(false);
      setStatusMessage("");
      pendingJobIdRef.current = undefined;
      if (options?.error) setError(options.error);
      persistCurrentChat({ messages: finalMessages });
    },
    [persistCurrentChat],
  );

  /** 页面刷新后，若上次生成仍挂着未完成的后台任务，重新接上并继续展示其产出。 */
  const reattachChatJob = useCallback(
    (jobId: string) => {
      const generation = ++reattachGenerationRef.current;
      const assistantIndex = messagesRef.current.length - 1;
      if (assistantIndex < 0 || messagesRef.current[assistantIndex]?.role !== "assistant") {
        pendingJobIdRef.current = undefined;
        persistCurrentChat();
        return;
      }

      setSending(true);
      setStatusMessage(t("chatResumingGeneration"));
      setError("");

      const applyStatus = (data: ChatJobStatus) => {
        if (reattachGenerationRef.current !== generation) return;
        const updated = [...messagesRef.current];
        const prev = updated[assistantIndex];
        updated[assistantIndex] = {
          role: "assistant",
          content: data.content || "",
          thinking: data.thinking || "",
          citations: data.citations ?? prev?.citations ?? [],
        };
        messagesRef.current = updated;
        setMessages(updated);
        if (data.citations) setCitations(data.citations);
      };

      const poll = async () => {
        if (reattachGenerationRef.current !== generation) return;
        let data: ChatJobStatus | null = null;
        try {
          data = await fetchChatJobStatus();
        } catch {
          reattachTimerRef.current = window.setTimeout(poll, 800);
          return;
        }
        if (reattachGenerationRef.current !== generation) return;
        if (!data.job_id || data.job_id !== jobId) {
          finalizeReattach(messagesRef.current, { error: t("chatResultLost") });
          return;
        }
        applyStatus(data);
        if (data.status === "running") {
          reattachTimerRef.current = window.setTimeout(poll, 300);
          return;
        }
        if (data.status === "error") {
          finalizeReattach(messagesRef.current, { error: data.error || t("chatFailed") });
          return;
        }
        if (data.status === "cancelled") {
          const current = messagesRef.current;
          const last = current[current.length - 1];
          if (last?.role === "assistant" && !last.content.trim() && !last.thinking?.trim()) {
            finalizeReattach(current.slice(0, -1));
            return;
          }
        }
        finalizeReattach(messagesRef.current);
      };

      void poll();
    },
    [finalizeReattach, persistCurrentChat, t],
  );

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

  const addScopedArticle = useCallback(
    (article: ScopedArticle) => {
      if (!article.feed_id || !article.article_id) return;
      if (article.title.includes("尚未建立索引")) return;
      const next = [article];
      scopedArticlesRef.current = next;
      setScopedArticles(next);
      persistCurrentChat({ scopedArticles: next });
    },
    [persistCurrentChat],
  );

  const addScopedArticles = useCallback(
    (articles: ScopedArticle[]) => {
      if (articles.length === 0) return;
      const next: ScopedArticle[] = [];
      for (const article of articles) {
        if (!article.feed_id || !article.article_id) continue;
        if (article.title.includes("尚未建立索引")) continue;
        if (
          next.some((item) => item.feed_id === article.feed_id && item.article_id === article.article_id)
        ) {
          continue;
        }
        next.push(article);
      }
      if (next.length === 0) return;
      scopedArticlesRef.current = next;
      setScopedArticles(next);
      persistCurrentChat({ scopedArticles: next });
    },
    [persistCurrentChat],
  );

  const removeScopedArticle = useCallback(
    (feedId: string, articleId: string) => {
      const next = scopedArticlesRef.current.filter(
        (item) => !(item.feed_id === feedId && item.article_id === articleId),
      );
      scopedArticlesRef.current = next;
      setScopedArticles(next);
      persistCurrentChat({ scopedArticles: next });
    },
    [persistCurrentChat],
  );

  const clearScopedArticles = useCallback(() => {
    scopedArticlesRef.current = [];
    setScopedArticles([]);
    persistCurrentChat({ scopedArticles: [] });
  }, [persistCurrentChat]);

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
    if (pendingJobIdRef.current) {
      void cancelChatJob().catch(() => {});
    }
  }, []);

  const applyChatBucket = useCallback(
    (bucket: ChatBucket) => {
      abortRef.current?.abort();
      abortRef.current = null;
      reattachGenerationRef.current += 1;
      if (reattachTimerRef.current != null) {
        window.clearTimeout(reattachTimerRef.current);
        reattachTimerRef.current = null;
      }
      setSending(false);
      setStatusMessage("");
      setError("");
      setPromptPreview("");
      setActiveCitationIndex(null);
      messagesRef.current = bucket.messages;
      scopedArticlesRef.current = bucket.scopedArticles;
      pendingJobIdRef.current = bucket.pendingJobId;
      setMessages(bucket.messages);
      setScopedArticles(bucket.scopedArticles);
      const lastAssistant = [...bucket.messages]
        .reverse()
        .find((item) => item.role === "assistant");
      setCitations(lastAssistant?.citations ?? []);
      persistCurrentChat({
        messages: bucket.messages,
        scopedArticles: bucket.scopedArticles,
      });
      if (bucket.pendingJobId) {
        reattachChatJob(bucket.pendingJobId);
      }
    },
    [persistCurrentChat, reattachChatJob],
  );

  const switchChatScope = useCallback(
    (nextDays: number, nextDate: string) => {
      const nextKey = chatScopeKey(nextDays, nextDate);
      const prev = chatScopeRef.current;
      if (prev?.key === nextKey) return false;

      if (prev) {
        persistCurrentChat();
      }

      const restored = readBucket(chatBucketsRef.current, nextKey);
      chatScopeRef.current = { key: nextKey, days: nextDays, date: nextDate };
      applyChatBucket(restored);
      return true;
    },
    [applyChatBucket, persistCurrentChat],
  );

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
    messagesRef.current = [];
    persistCurrentChat({ messages: [], scopedArticles: scopedArticlesRef.current });
  }, [persistCurrentChat]);

  useEffect(() => {
    switchChatScope(days, shanghaiDateKey());
  }, [days, switchChatScope]);

  // 首次挂载：若刷新前正巧在生成中，恢复该任务的产出（switchChatScope 因 scope 未变不会触发）
  useEffect(() => {
    if (initialBucketRef.current.pendingJobId) {
      reattachChatJob(initialBucketRef.current.pendingJobId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 刷新 / 切后台时强制落盘（生成中 useEffect 来不及写也会保住）
  useEffect(() => {
    const flush = () => {
      if (persistTimerRef.current != null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      persistCurrentChat();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [persistCurrentChat]);

  useEffect(() => {
    const syncCalendarDay = () => {
      const date = shanghaiDateKey();
      const prev = chatScopeRef.current;
      if (!prev || prev.date === date) return;
      const switched = switchChatScope(prev.days, date);
      if (switched) {
        void loadPanelSummary();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") syncCalendarDay();
    };
    window.addEventListener("focus", syncCalendarDay);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", syncCalendarDay);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [switchChatScope, loadPanelSummary]);

  const sendMessage = useCallback(
    async (text: string, options?: { replaceFromIndex?: number }) => {
      const trimmed = text.trim();
      const isScopedSummary = !trimmed && scopedArticles.length > 0;
      const content = isScopedSummary ? SCOPED_SUMMARIZE_DEFAULT_MESSAGE : trimmed;
      if (!content) return;

      if (sending && options?.replaceFromIndex == null) return;

      if (!isScopedSummary && !effectiveRagReady) {
        setError(t("chatNeedIndexFirst"));
        return;
      }

      if (isScopedSummary && !llmConfigured) {
        setError(t("chatNeedLlmConfig"));
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
      const seededMessages: ChatUiMessage[] = [
        ...nextMessages,
        { role: "assistant", content: "", thinking: "", citations: [] },
      ];
      messagesRef.current = seededMessages;
      pendingJobIdRef.current = undefined;
      setMessages(seededMessages);
      persistCurrentChat({ messages: seededMessages });
      setInput("");
      setSending(true);
      setError("");
      setStatusMessage(isScopedSummary ? t("chatGeneratingSummary") : t("chatPhasePlanning"));
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

      const commitAssistant = (options?: { flushUi?: boolean; persistNow?: boolean }) => {
        const updated = [...messagesRef.current];
        updated[assistantIndex] = {
          role: "assistant",
          content: assistantContent,
          thinking: assistantThinking,
          citations: assistantCitations,
        };
        // 先写 ref，刷新时 pagehide 能读到最新内容
        messagesRef.current = updated;
        if (options?.flushUi) {
          flushSync(() => setMessages(updated));
        } else {
          setMessages(updated);
        }
        if (options?.persistNow) {
          persistCurrentChat({ messages: updated });
        } else {
          schedulePersistCurrentChat();
        }
      };

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
            commitAssistant({ flushUi: true });
          },
          () => {
            // 走到这里说明后端确实发了 done：生成已真正结束，可以放心清掉 pendingJobId。
            setSending(false);
            setStatusMessage("");
            pendingJobIdRef.current = undefined;
            persistCurrentChat({ messages: messagesRef.current });
          },
          (message) => {
            setError(message);
            setSending(false);
            setStatusMessage("");
            pendingJobIdRef.current = undefined;
            persistCurrentChat({ messages: messagesRef.current });
          },
          (status) => {
            const phaseKey = status.phase ? PHASE_LABEL_KEYS[status.phase] : undefined;
            const label = status.message || (phaseKey ? t(phaseKey) : "");
            if (label) setStatusMessage(label);
            if (status.job_id && status.job_id !== pendingJobIdRef.current) {
              pendingJobIdRef.current = status.job_id;
              persistCurrentChat();
            }
          },
          (chunk) => {
            assistantThinking += chunk;
            commitAssistant({ flushUi: true });
          },
          (items) => {
            assistantCitations = items;
            setCitations(items);
            commitAssistant({ persistNow: true });
          },
          (preview) => {
            setPromptPreview(preview);
          },
          controller.signal,
          {
            // 连接中断（页面刷新/卸载、网络抖动，或我们自己调用 stopGeneration 主动断开）：
            // 后台任务与本次连接生命周期无关，很可能仍在运行，不能像 onDone 那样直接清空
            // pendingJobId——否则刷新后就再也接不上这次生成了。标签页还活着就立刻续上继续显示；
            // 真的被刷新掉的话，pendingJobId 已经落盘，下次挂载时会自动重新接上。
            onCancelled: () => {
              if (pendingJobIdRef.current) {
                reattachChatJob(pendingJobIdRef.current);
                return;
              }
              setSending(false);
              setStatusMessage("");
              const current = messagesRef.current;
              const last = current[current.length - 1];
              if (last?.role === "assistant" && !last.content.trim() && !last.thinking?.trim()) {
                const trimmedMessages = current.slice(0, -1);
                messagesRef.current = trimmedMessages;
                setMessages(trimmedMessages);
                persistCurrentChat({ messages: trimmedMessages });
                return;
              }
              persistCurrentChat({ messages: messagesRef.current });
            },
          },
        );
      } catch (err) {
        const isAbort = err instanceof DOMException && err.name === "AbortError";
        if (!isAbort) {
          setError(err instanceof Error ? err.message : t("chatSendFailed"));
        }
        setSending(false);
        setStatusMessage("");
        // 注意：这里不清空 pendingJobIdRef——极早期（连响应头都没收到）就断连时才会走到这里，
        // 此时若已经拿到过 job_id，后台任务可能已经起来了，清空会导致刷新后接不上。
      } finally {
        if (persistTimerRef.current != null) {
          window.clearTimeout(persistTimerRef.current);
          persistTimerRef.current = null;
        }
        persistCurrentChat();
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [
      chatSummary,
      days,
      effectiveRagReady,
      enableDeepThinking,
      llmConfigured,
      messages,
      persistCurrentChat,
      reattachChatJob,
      schedulePersistCurrentChat,
      scopedArticles,
      sending,
      t,
    ],
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
