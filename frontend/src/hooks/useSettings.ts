import { useCallback, useEffect, useState } from "react";
import { clearLlmSettings, fetchLlmSettings, saveLlmSettings } from "../api";

export type DefaultDays = 1 | 3;

export function normalizeDefaultDays(value: unknown): DefaultDays {
  return value === 3 ? 3 : 1;
}

export function formatDaysLabel(days: DefaultDays): string {
  return days === 1 ? "今天" : "近 3 天";
}

export interface AppSettings {
  defaultDays: DefaultDays;
  llmModel: string;
  embeddingModel: string;
  llmApiKey: string;
  llmApiBase: string;
  llmMaxTokens: number;
  thinkingStyle: string;
  embeddingApiKey: string;
  embeddingApiBase: string;
}

export interface LlmConfigPayload {
  model: string;
  embedding_model: string;
  api_key: string;
  api_base: string;
  max_tokens: number;
  thinking_style: string;
  embedding_api_key: string;
  embedding_api_base: string;
}

const STORAGE_KEY = "askme.settings";

export const DEFAULT_LLM_MODEL = "openai/gpt-4o-mini";
export const DEFAULT_EMBEDDING_MODEL = "";
export const DEFAULT_LLM_MAX_TOKENS = 32768;
export const MIN_LLM_MAX_TOKENS = 256;
export const MAX_LLM_MAX_TOKENS = 128000;

export function normalizeLlmMaxTokens(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return DEFAULT_LLM_MAX_TOKENS;
  }
  return Math.min(MAX_LLM_MAX_TOKENS, Math.max(MIN_LLM_MAX_TOKENS, Math.round(n)));
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultDays: 1,
  llmModel: "",
  embeddingModel: "",
  llmApiKey: "",
  llmApiBase: "",
  llmMaxTokens: DEFAULT_LLM_MAX_TOKENS,
  thinkingStyle: "",
  embeddingApiKey: "",
  embeddingApiBase: "",
};

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      defaultDays: normalizeDefaultDays(parsed.defaultDays),
      llmModel: parsed.llmModel ?? DEFAULT_SETTINGS.llmModel,
      embeddingModel: parsed.embeddingModel ?? DEFAULT_SETTINGS.embeddingModel,
      llmApiKey: parsed.llmApiKey ?? DEFAULT_SETTINGS.llmApiKey,
      llmApiBase: parsed.llmApiBase ?? DEFAULT_SETTINGS.llmApiBase,
      llmMaxTokens: normalizeLlmMaxTokens(
        parsed.llmMaxTokens ?? DEFAULT_SETTINGS.llmMaxTokens,
      ),
      thinkingStyle: parsed.thinkingStyle ?? DEFAULT_SETTINGS.thinkingStyle,
      embeddingApiKey: parsed.embeddingApiKey ?? DEFAULT_SETTINGS.embeddingApiKey,
      embeddingApiBase: parsed.embeddingApiBase ?? DEFAULT_SETTINGS.embeddingApiBase,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persistLocal(settings: AppSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  window.dispatchEvent(new Event("askme:settings-updated"));
}

function applyServerLlm(
  current: AppSettings,
  server: {
    model: string;
    embedding_model: string;
    api_key: string;
    api_base: string;
    max_tokens: number;
    thinking_style: string;
    embedding_api_key: string;
    embedding_api_base: string;
  },
): AppSettings {
  return {
    ...current,
    llmModel: server.model || current.llmModel,
    embeddingModel: server.embedding_model ?? current.embeddingModel,
    llmApiKey: server.api_key || current.llmApiKey,
    llmApiBase: server.api_base || current.llmApiBase,
    llmMaxTokens: normalizeLlmMaxTokens(server.max_tokens || current.llmMaxTokens),
    thinkingStyle: server.thinking_style ?? current.thinkingStyle,
    embeddingApiKey: server.embedding_api_key ?? current.embeddingApiKey,
    embeddingApiBase: server.embedding_api_base ?? current.embeddingApiBase,
  };
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
    max_tokens: normalizeLlmMaxTokens(current.llmMaxTokens),
    thinking_style: current.thinkingStyle ?? "",
    embedding_api_key: current.embeddingApiKey?.trim() ?? "",
    embedding_api_base: current.embeddingApiBase?.trim() ?? "",
  };
}

export function isLlmConfigured(settings: AppSettings): boolean {
  return settings.llmApiKey.trim().length > 0 && settings.llmModel.trim().length > 0;
}

/** 建立向量索引所需：Embedding 模型 + 有效 API Key（专用或复用对话模型）。 */
export function isEmbeddingConfigured(settings: AppSettings): boolean {
  if (!settings.embeddingModel.trim()) return false;
  return (
    settings.embeddingApiKey.trim().length > 0 || settings.llmApiKey.trim().length > 0
  );
}

export function filterEmbeddingModels(models: string[]): string[] {
  const filtered = models.filter((model) => /embed/i.test(model));
  return filtered.length > 0 ? filtered : models;
}

export function useSettings() {
  const [settings, setSettingsState] = useState<AppSettings>(loadSettings);
  const [llmHydrated, setLlmHydrated] = useState(false);

  const setSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettingsState((current) => {
      let normalizedPatch = patch;
      if (patch.defaultDays !== undefined) {
        normalizedPatch = {
          ...normalizedPatch,
          defaultDays: normalizeDefaultDays(patch.defaultDays),
        };
      }
      if (patch.llmMaxTokens !== undefined) {
        normalizedPatch = {
          ...normalizedPatch,
          llmMaxTokens: normalizeLlmMaxTokens(patch.llmMaxTokens),
        };
      }
      const next = { ...current, ...normalizedPatch };
      persistLocal(next);
      return next;
    });
  }, []);

  const saveLlmToServer = useCallback(async (next: AppSettings) => {
    const saved = await saveLlmSettings({
      model: next.llmModel.trim(),
      embedding_model: next.embeddingModel.trim(),
      api_key: next.llmApiKey.trim(),
      api_base: next.llmApiBase.trim(),
      max_tokens: normalizeLlmMaxTokens(next.llmMaxTokens),
      thinking_style: next.thinkingStyle ?? "",
      embedding_api_key: next.embeddingApiKey?.trim() ?? "",
      embedding_api_base: next.embeddingApiBase?.trim() ?? "",
    });
    const merged = applyServerLlm(next, saved);
    persistLocal(merged);
    setSettingsState(merged);
    return merged;
  }, []);

  const clearLlmFromServer = useCallback(async () => {
    await clearLlmSettings();
    const cleared: AppSettings = {
      ...loadSettings(),
      llmModel: "",
      embeddingModel: "",
      llmApiKey: "",
      llmApiBase: "",
      llmMaxTokens: DEFAULT_LLM_MAX_TOKENS,
      thinkingStyle: "",
      embeddingApiKey: "",
      embeddingApiBase: "",
    };
    persistLocal(cleared);
    setSettingsState(cleared);
    return cleared;
  }, []);

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

  // 从服务端拉取 LLM 配置，保证 Cursor 内置浏览器与外部浏览器共用
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const local = loadSettings();
        const server = await fetchLlmSettings();
        if (cancelled) return;

        if (server.configured) {
          const merged = applyServerLlm(local, server);
          persistLocal(merged);
          setSettingsState(merged);
        } else if (server.persisted) {
          // 服务端已显式清空：同步本地
          const cleared: AppSettings = {
            ...local,
            llmModel: "",
            embeddingModel: "",
            llmApiKey: "",
            llmApiBase: "",
            llmMaxTokens: DEFAULT_LLM_MAX_TOKENS,
            thinkingStyle: "",
            embeddingApiKey: "",
            embeddingApiBase: "",
          };
          persistLocal(cleared);
          setSettingsState(cleared);
        } else if (isLlmConfigured(local)) {
          // 一次性迁移：本浏览器已有配置、服务端还没有
          await saveLlmSettings({
            model: local.llmModel.trim(),
            embedding_model: local.embeddingModel.trim(),
            api_key: local.llmApiKey.trim(),
            api_base: local.llmApiBase.trim(),
            max_tokens: normalizeLlmMaxTokens(local.llmMaxTokens),
            thinking_style: local.thinkingStyle ?? "",
            embedding_api_key: local.embeddingApiKey?.trim() ?? "",
            embedding_api_base: local.embeddingApiBase?.trim() ?? "",
          });
        }
      } catch {
        // 后端不可用时仍使用 localStorage
      } finally {
        if (!cancelled) setLlmHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    settings,
    setSettings,
    saveLlmToServer,
    clearLlmFromServer,
    llmHydrated,
  };
}
