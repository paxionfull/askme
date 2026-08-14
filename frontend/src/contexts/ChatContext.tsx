import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import {
  fetchCachedSummary,
  fetchRagStatus,
  streamChat,
  type ChatMessagePayload,
  type CitationItem,
} from "../api";
import { getLlmConfigPayload, useSettings } from "../hooks/useSettings";
import { useStoredFlag } from "../hooks/useStoredFlag";
import { useDigest } from "./DigestContext";

export interface ChatUiMessage {
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  citations?: CitationItem[];
}

interface ChatContextValue {
  days: number;
  panelSummary: string;
  loadingSummary: boolean;
  ragReady: boolean;
  chunkCount: number;
  loadingStatus: boolean;
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
  chatSummary: string;
  sendMessage: (text: string) => Promise<void>;
  selectMessageCitations: (messageIndex: number) => void;
  enableDeepThinking: boolean;
  setEnableDeepThinking: (value: boolean) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

const PHASE_LABELS: Record<string, string> = {
  planning_queries: "正在分析问题…",
  retrieving: "正在检索…",
  answering: "正在回答…",
};

export function ChatProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const {
    summary: digestSummary,
    days,
    loadingIndex,
    indexReady,
    indexChunkCount,
    selectedGroupIds,
  } = useDigest();
  const [panelSummary, setPanelSummary] = useState("");
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [ragReady, setRagReady] = useState(false);
  const [chunkCount, setChunkCount] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const [citations, setCitations] = useState<CitationItem[]>([]);
  const [activeCitationIndex, setActiveCitationIndex] = useState<number | null>(null);
  const [promptPreview, setPromptPreview] = useState("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [enableDeepThinking, setEnableDeepThinking] = useStoredFlag("askme.chat.enableThinking");

  const chatSummary = panelSummary.trim();
  const canSend =
    ragReady && Boolean(settings.llmApiKey.trim() && settings.llmModel.trim()) && !sending;

  const loadRagStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const data = await fetchRagStatus(days);
      setRagReady(data.ready);
      setChunkCount(data.chunk_count);
    } catch {
      setRagReady(false);
      setChunkCount(0);
    } finally {
      setLoadingStatus(false);
    }
  }, [days]);

  const loadPanelSummary = useCallback(async () => {
    if (selectedGroupIds.length === 0) {
      setPanelSummary("");
      return;
    }
    setLoadingSummary(true);
    try {
      const data = await fetchCachedSummary(days, undefined, selectedGroupIds);
      setPanelSummary(data.summary ?? "");
    } catch {
      setPanelSummary("");
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
    if (digestSummary.trim()) {
      setPanelSummary(digestSummary);
    }
  }, [digestSummary]);

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

  const sendMessage = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || sending) return;

      if (!ragReady) {
        setError("请先在数据源页加载正文并建立索引后再提问");
        return;
      }

      const nextMessages: ChatUiMessage[] = [...messages, { role: "user", content }];
      const assistantIndex = nextMessages.length;
      setMessages([...nextMessages, { role: "assistant", content: "", thinking: "", citations: [] }]);
      setInput("");
      setSending(true);
      setError("");
      setStatusMessage("正在分析问题…");
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

      try {
        await streamChat(
          {
            messages: apiMessages,
            system_prompt: "",
            summary: chatSummary,
            days,
            stream: true,
            enable_thinking: enableDeepThinking,
            use_rag: true,
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
            if (items.length > 0) {
              setActiveCitationIndex(items[0].index);
            }
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
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "发送失败");
        setSending(false);
        setStatusMessage("");
      }
    },
    [chatSummary, days, enableDeepThinking, messages, ragReady, sending],
  );

  return (
    <ChatContext.Provider
      value={{
        days,
        panelSummary,
        loadingSummary,
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
        chatSummary,
        sendMessage,
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
