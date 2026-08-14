export interface SseStatus {
  phase?: string;
  message?: string;
  article_count?: number;
  job_id?: string;
  slug?: string;
  entry_url?: string;
}

export interface SseCitationItem {
  index: number;
  id: string;
  title: string;
  feed_name: string;
  published_at: string;
  url: string;
  feed_id: string;
  article_id: string;
  chunk_index: number;
  char_start: number;
  excerpt: string;
  text?: string;
  score?: number;
}

export interface StreamCallbacks {
  onToken: (content: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
  onStatus?: (status: SseStatus) => void;
  onThinking?: (content: string) => void;
  onCitations?: (items: SseCitationItem[]) => void;
  onPromptPreview?: (system: string) => void;
  onResult?: (data: Record<string, unknown>) => void;
  onAnalysis?: (data: Record<string, unknown>) => void;
  onCancelled?: (detail: string, jobId?: string) => void;
  signal?: AbortSignal;
}

export async function streamPost(
  path: string,
  body: unknown,
  onToken: (content: string) => void,
  onDone: () => void,
  onError: (message: string) => void,
  onStatus?: (status: SseStatus) => void,
  onThinking?: (content: string) => void,
  onCitations?: (items: SseCitationItem[]) => void,
  onPromptPreview?: (system: string) => void,
  onResult?: (data: Record<string, unknown>) => void,
  onAnalysis?: (data: Record<string, unknown>) => void,
  onCancelled?: (detail: string, jobId?: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const detail = data.detail;
    onError(typeof detail === "string" ? detail : "请求失败");
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    onError("无法读取响应流");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        if (!part.trim()) continue;

        let event = "message";
        let data = "";

        for (const line of part.split("\n")) {
          if (line.startsWith("event:")) {
            event = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            data = line.slice(5).trim();
          }
        }

        if (!data) continue;

        const parsed = JSON.parse(data) as {
          content?: string;
          detail?: string;
          phase?: string;
          message?: string;
          article_count?: number;
          job_id?: string;
          items?: SseCitationItem[];
          system?: string;
          chunk_count?: number;
          history_turns?: number;
        };

        if (event === "status" && onStatus) {
          onStatus(parsed);
        } else if (event === "citations" && onCitations && parsed.items) {
          onCitations(parsed.items);
        } else if (event === "prompt_preview" && onPromptPreview && parsed.system) {
          onPromptPreview(parsed.system);
        } else if (event === "thinking" && parsed.content && onThinking) {
          onThinking(parsed.content);
        } else if (event === "token" && parsed.content) {
          onToken(parsed.content);
        } else if (event === "done") {
          finished = true;
          onDone();
        } else if (event === "cancelled") {
          finished = true;
          if (onCancelled) {
            onCancelled(parsed.detail ?? "已取消", parsed.job_id as string | undefined);
          } else {
            onDone();
          }
        } else if (event === "error") {
          finished = true;
          onError(parsed.detail ?? "LLM 请求失败");
        } else if (event === "result" && onResult) {
          onResult(parsed as Record<string, unknown>);
        } else if (event === "analysis" && onAnalysis) {
          onAnalysis(parsed as Record<string, unknown>);
        }
      }
    }

    if (!finished) {
      onDone();
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      if (onCancelled) {
        onCancelled("已取消");
      } else {
        onDone();
      }
      return;
    }
    onError(err instanceof Error ? err.message : "流式读取失败");
  }
}
