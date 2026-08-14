import { useCallback, useEffect, useState } from "react";

export type DefaultDays = 1 | 3;

export function normalizeDefaultDays(value: unknown): DefaultDays {
  return value === 3 ? 3 : 1;
}

export function formatDaysLabel(days: DefaultDays): string {
  return days === 1 ? "今天" : "近 3 天";
}

export interface AppSettings {
  summaryPrompt: string;
  chatSystemPrompt: string;
  defaultDays: DefaultDays;
  llmModel: string;
  embeddingModel: string;
  llmApiKey: string;
  llmApiBase: string;
}

export interface LlmConfigPayload {
  model: string;
  embedding_model: string;
  api_key: string;
  api_base: string;
}

const STORAGE_KEY = "askme.settings";

export const DEFAULT_LLM_MODEL = "openai/gpt-4o-mini";
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

export const DEFAULT_SUMMARY_PROMPT = `你是 Askme 资讯编辑。用户消息中包含 XML 格式的 <文章集合>，每篇含来源、发布时间、标题和正文。

请根据这些文章生成中文 Markdown 日报概览，要求：
1. 开头用「## 今日要点」列出 3–5 条 bullet 总览
2. 正文按主题分组（## 主题名），每组注明来源（网站名 + 发布时间）和要点
3. 合并不同文章中的重复信息
4. 仅使用文中已有信息，不要臆测或编造
5. 全文控制在 800 字以内
6. 输出纯 Markdown，不要使用 XML`;

export const LEGACY_CHAT_PROMPT =
  "你是 Askme 助手，仅根据提供的文章回答。如果文章中没有相关信息，请明确说明。";

export const DEFAULT_CHAT_PROMPT = `你是 Askme 助手。用户会对照左侧日报概览提问；你还会收到检索到的原文片段。

请详细、有据地回答。具体引用与篇幅要求由系统在每次请求时追加，此处仅补充你的角色与语气：专业、清晰、中文 Markdown。`;

export const DEFAULT_SETTINGS: AppSettings = {
  summaryPrompt: DEFAULT_SUMMARY_PROMPT,
  chatSystemPrompt: DEFAULT_CHAT_PROMPT,
  defaultDays: 1,
  llmModel: "",
  embeddingModel: "",
  llmApiKey: "",
  llmApiBase: "",
};

function migrateSummaryPrompt(prompt: string | undefined): string {
  if (prompt === undefined) {
    return DEFAULT_SUMMARY_PROMPT;
  }
  if (prompt.includes("{articles}")) {
    return DEFAULT_SUMMARY_PROMPT;
  }
  return prompt;
}

function migrateChatPrompt(prompt: string | undefined): string {
  if (prompt === undefined) {
    return DEFAULT_CHAT_PROMPT;
  }
  if (prompt === LEGACY_CHAT_PROMPT) {
    return DEFAULT_CHAT_PROMPT;
  }
  return prompt;
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      summaryPrompt: migrateSummaryPrompt(parsed.summaryPrompt),
      chatSystemPrompt: migrateChatPrompt(parsed.chatSystemPrompt),
      defaultDays: normalizeDefaultDays(parsed.defaultDays),
      llmModel: parsed.llmModel ?? DEFAULT_SETTINGS.llmModel,
      embeddingModel: parsed.embeddingModel ?? DEFAULT_SETTINGS.embeddingModel,
      llmApiKey: parsed.llmApiKey ?? DEFAULT_SETTINGS.llmApiKey,
      llmApiBase: parsed.llmApiBase ?? DEFAULT_SETTINGS.llmApiBase,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function readStoredSettings(): AppSettings {
  return loadSettings();
}

export function getLlmConfigPayload(settings?: AppSettings): LlmConfigPayload {
  const current = settings ?? loadSettings();
  const embeddingModel = current.embeddingModel.trim();
  return {
    model: current.llmModel.trim(),
    embedding_model: embeddingModel,
    api_key: current.llmApiKey.trim(),
    api_base: current.llmApiBase.trim(),
  };
}

export function isLlmConfigured(settings: AppSettings): boolean {
  return settings.llmApiKey.trim().length > 0 && settings.llmModel.trim().length > 0;
}

export function filterEmbeddingModels(models: string[]): string[] {
  const filtered = models.filter((model) => /embed/i.test(model));
  return filtered.length > 0 ? filtered : models;
}

export function useSettings() {
  const [settings, setSettingsState] = useState<AppSettings>(loadSettings);

  const setSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettingsState((current) => {
      const normalizedPatch =
        patch.defaultDays !== undefined
          ? { ...patch, defaultDays: normalizeDefaultDays(patch.defaultDays) }
          : patch;
      const next = { ...current, ...normalizedPatch };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      window.dispatchEvent(new Event("askme:settings-updated"));
      return next;
    });
  }, []);

  const resetSummaryPrompt = useCallback(() => {
    setSettings({ summaryPrompt: DEFAULT_SUMMARY_PROMPT });
  }, [setSettings]);

  const resetChatPrompt = useCallback(() => {
    setSettings({ chatSystemPrompt: DEFAULT_CHAT_PROMPT });
  }, [setSettings]);

  useEffect(() => {
    const syncSettings = () => {
      setSettingsState(loadSettings());
    };
    window.addEventListener("storage", syncSettings);
    window.addEventListener("askme:settings-updated", syncSettings);
    return () => {
      window.removeEventListener("storage", syncSettings);
      window.removeEventListener("askme:settings-updated", syncSettings);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  return {
    settings,
    setSettings,
    resetSummaryPrompt,
    resetChatPrompt,
  };
}
