import { useEffect, useMemo, useState } from "react";
import {
  fetchCursorApiKeyStatus,
  fetchLlmModels,
  fetchZhihuCookieStatus,
  saveCursorApiKey,
  saveZhihuCookie,
  verifyZhihuCookie,
} from "../api";
import FeedSchedulerSection from "../components/FeedSchedulerSection";
import {
  DEFAULT_EMBEDDING_MODEL,
  filterEmbeddingModels,
  isLlmConfigured,
  useSettings,
  type DefaultDays,
} from "../hooks/useSettings";
import { Link } from "react-router-dom";

interface LlmDraft {
  llmModel: string;
  embeddingModel: string;
  llmApiKey: string;
  llmApiBase: string;
}

export default function SettingsPage() {
  const { settings, setSettings } = useSettings();

  const [draft, setDraft] = useState<LlmDraft>({
    llmModel: settings.llmModel,
    embeddingModel: settings.embeddingModel,
    llmApiKey: settings.llmApiKey,
    llmApiBase: settings.llmApiBase,
  });
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [llmError, setLlmError] = useState("");
  const [llmSaved, setLlmSaved] = useState(false);
  const [zhihuCookie, setZhihuCookie] = useState("");
  const [zhihuConfigured, setZhihuConfigured] = useState(false);
  const [zhihuMasked, setZhihuMasked] = useState("");
  const [zhihuSaving, setZhihuSaving] = useState(false);
  const [zhihuVerifying, setZhihuVerifying] = useState(false);
  const [zhihuMessage, setZhihuMessage] = useState("");
  const [zhihuError, setZhihuError] = useState("");
  const [cursorApiKey, setCursorApiKey] = useState("");
  const [cursorConfigured, setCursorConfigured] = useState(false);
  const [cursorMasked, setCursorMasked] = useState("");
  const [cursorSaving, setCursorSaving] = useState(false);
  const [cursorMessage, setCursorMessage] = useState("");
  const [cursorError, setCursorError] = useState("");

  const embeddingModels = useMemo(() => filterEmbeddingModels(availableModels), [availableModels]);
  const configured = isLlmConfigured(settings);
  const draftDirty = useMemo(
    () =>
      draft.llmModel !== settings.llmModel ||
      draft.embeddingModel !== settings.embeddingModel ||
      draft.llmApiKey !== settings.llmApiKey ||
      draft.llmApiBase !== settings.llmApiBase,
    [draft, settings],
  );

  useEffect(() => {
    setDraft({
      llmModel: settings.llmModel,
      embeddingModel: settings.embeddingModel,
      llmApiKey: settings.llmApiKey,
      llmApiBase: settings.llmApiBase,
    });
  }, [settings.llmModel, settings.embeddingModel, settings.llmApiKey, settings.llmApiBase]);

  function invalidateModels() {
    setAvailableModels([]);
    setDraft((current) => ({ ...current, llmModel: "", embeddingModel: "" }));
  }

  async function handleLoadModels() {
    if (!draft.llmApiKey.trim()) {
      setLlmError("请先填写 API Key");
      return;
    }

    setModelsLoading(true);
    setLlmError("");
    setLlmSaved(false);
    try {
      const { models } = await fetchLlmModels(draft.llmApiBase, draft.llmApiKey);
      setAvailableModels(models);

      const preferredChat = draft.llmModel || settings.llmModel;
      const preferredEmbed = draft.embeddingModel || settings.embeddingModel;
      const embedCandidates = filterEmbeddingModels(models);

      setDraft((current) => ({
        ...current,
        llmModel: preferredChat && models.includes(preferredChat) ? preferredChat : "",
        embeddingModel:
          preferredEmbed && embedCandidates.includes(preferredEmbed)
            ? preferredEmbed
            : embedCandidates.includes(DEFAULT_EMBEDDING_MODEL)
              ? DEFAULT_EMBEDDING_MODEL
              : embedCandidates[0] ?? "",
      }));
    } catch (err) {
      setAvailableModels([]);
      setLlmError(err instanceof Error ? err.message : "加载模型列表失败");
    } finally {
      setModelsLoading(false);
    }
  }

  function handleSaveLlm() {
    setLlmError("");
    setLlmSaved(false);

    if (!draft.llmApiKey.trim()) {
      setLlmError("请填写 API Key");
      return;
    }
    if (!draft.llmModel.trim()) {
      setLlmError("请选择对话模型");
      return;
    }
    if (!draft.embeddingModel.trim()) {
      setLlmError("请选择 Embedding 模型");
      return;
    }
    if (availableModels.length === 0) {
      setLlmError("请先加载模型列表");
      return;
    }
    if (!availableModels.includes(draft.llmModel)) {
      setLlmError("请从模型列表中选择有效的对话模型");
      return;
    }
    if (!embeddingModels.includes(draft.embeddingModel)) {
      setLlmError("请从 Embedding 模型列表中选择有效模型");
      return;
    }

    setSettings({
      llmModel: draft.llmModel.trim(),
      embeddingModel: draft.embeddingModel.trim(),
      llmApiKey: draft.llmApiKey.trim(),
      llmApiBase: draft.llmApiBase.trim(),
    });
    setLlmSaved(true);
  }

  useEffect(() => {
    void (async () => {
      try {
        const [zhihuStatus, cursorStatus] = await Promise.all([
          fetchZhihuCookieStatus(),
          fetchCursorApiKeyStatus(),
        ]);
        setZhihuConfigured(zhihuStatus.configured);
        setZhihuMasked(zhihuStatus.masked);
        setCursorConfigured(cursorStatus.configured);
        setCursorMasked(cursorStatus.masked);
      } catch {
        // noop
      }
    })();
  }, []);

  async function handleSaveZhihuCookie() {
    if (!zhihuCookie.trim()) {
      setZhihuError("请先粘贴知乎 Cookie");
      return;
    }
    setZhihuSaving(true);
    setZhihuError("");
    setZhihuMessage("");
    try {
      const result = await saveZhihuCookie(zhihuCookie.trim());
      setZhihuConfigured(result.configured);
      setZhihuMasked(result.masked);
      setZhihuCookie("");
      setZhihuMessage("已保存知乎 Cookie");
    } catch (err) {
      setZhihuError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setZhihuSaving(false);
    }
  }

  async function handleVerifyZhihuCookie() {
    setZhihuVerifying(true);
    setZhihuError("");
    setZhihuMessage("");
    try {
      const result = await verifyZhihuCookie();
      setZhihuMessage(result.message || "知乎 Cookie 校验成功");
    } catch (err) {
      setZhihuError(err instanceof Error ? err.message : "校验失败");
    } finally {
      setZhihuVerifying(false);
    }
  }

  async function handleSaveCursorApiKey() {
    if (!cursorApiKey.trim()) {
      setCursorError("请先填写 Cursor API Key");
      return;
    }
    setCursorSaving(true);
    setCursorError("");
    setCursorMessage("");
    try {
      const result = await saveCursorApiKey(cursorApiKey.trim());
      setCursorConfigured(result.configured);
      setCursorMasked(result.masked);
      setCursorApiKey("");
      setCursorMessage("已保存 Cursor API Key");
    } catch (err) {
      setCursorError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setCursorSaving(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-base font-semibold">设置</h1>
        <p className="mt-1 text-sm text-slate-500">Prompt 与 LLM 配置保存在浏览器本地</p>
      </header>

      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <FeedSchedulerSection />

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold">知乎登录（数据源授权）</h2>
          <p className="mt-1 text-xs text-slate-500">
            1) 点击下方按钮登录知乎；2) 在浏览器开发者工具复制请求头 Cookie；3) 粘贴并保存。
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <a
              href="https://www.zhihu.com/signin"
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              打开知乎登录页
            </a>
            <span className={`text-xs ${zhihuConfigured ? "text-green-700" : "text-amber-700"}`}>
              {zhihuConfigured ? `已配置：${zhihuMasked}` : "未配置"}
            </span>
          </div>

          <label className="mt-4 block text-xs font-medium text-slate-600">知乎 Cookie</label>
          <textarea
            value={zhihuCookie}
            onChange={(e) => setZhihuCookie(e.target.value)}
            rows={3}
            placeholder="粘贴完整 Cookie（至少包含 d_c0）"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSaveZhihuCookie()}
              disabled={zhihuSaving}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {zhihuSaving ? "保存中..." : "保存 Cookie"}
            </button>
            <button
              type="button"
              onClick={() => void handleVerifyZhihuCookie()}
              disabled={zhihuVerifying || !zhihuConfigured}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              {zhihuVerifying ? "校验中..." : "测试连接"}
            </button>
          </div>

          {zhihuError && <p className="mt-2 text-sm text-red-600">{zhihuError}</p>}
          {zhihuMessage && <p className="mt-2 text-sm text-green-700">{zhihuMessage}</p>}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold">Cursor API Key（数据源接入）</h2>
          <p className="mt-1 text-xs text-slate-500">
            接入未知站点时，Askme 会通过 Cursor Agent 自动编写 discovery skill。请在{" "}
            <a
              href="https://cursor.com/settings"
              target="_blank"
              rel="noreferrer"
              className="text-slate-700 underline"
            >
              Cursor 设置
            </a>{" "}
            创建 API Key 并粘贴保存。已知平台（知乎、金十等）无需配置。
          </p>
          <p className={`mt-2 text-xs ${cursorConfigured ? "text-green-700" : "text-amber-700"}`}>
            {cursorConfigured ? `已配置：${cursorMasked}` : "未配置"}
          </p>

          <label className="mt-4 block text-xs font-medium text-slate-600">Cursor API Key</label>
          <input
            type="password"
            value={cursorApiKey}
            onChange={(e) => setCursorApiKey(e.target.value)}
            placeholder="cur_..."
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />

          <div className="mt-3">
            <button
              type="button"
              onClick={() => void handleSaveCursorApiKey()}
              disabled={cursorSaving}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {cursorSaving ? "保存中..." : "保存 API Key"}
            </button>
          </div>

          {cursorError && <p className="mt-2 text-sm text-red-600">{cursorError}</p>}
          {cursorMessage && <p className="mt-2 text-sm text-green-700">{cursorMessage}</p>}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold">LLM 配置</h2>
          <p className="mt-1 text-xs text-slate-500">
            状态：
            <span className={configured ? "text-green-700" : "text-amber-700"}>
              {configured ? "已配置" : "未配置"}
            </span>
            {configured ? (
              <>
                {` · 对话 ${settings.llmModel}`}
                {` · Embedding ${settings.embeddingModel || DEFAULT_EMBEDDING_MODEL}`}
              </>
            ) : null}
          </p>

          <label className="mt-4 block text-xs font-medium text-slate-600">Base URL</label>
          <input
            type="url"
            value={draft.llmApiBase}
            onChange={(e) => {
              setDraft((current) => ({ ...current, llmApiBase: e.target.value }));
              setLlmSaved(false);
              invalidateModels();
            }}
            placeholder="https://api.openai.com/v1"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          <p className="mt-1 text-xs text-slate-400">
            留空则使用 OpenAI 默认地址，模型列表从 Base URL 的 /models 获取
          </p>

          <label className="mt-4 block text-xs font-medium text-slate-600">API Key</label>
          <input
            type="password"
            value={draft.llmApiKey}
            onChange={(e) => {
              setDraft((current) => ({ ...current, llmApiKey: e.target.value }));
              setLlmSaved(false);
              invalidateModels();
            }}
            placeholder="sk-..."
            autoComplete="off"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              disabled={modelsLoading || !draft.llmApiKey.trim()}
              onClick={() => void handleLoadModels()}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              {modelsLoading ? "加载中..." : "加载模型列表"}
            </button>
            {availableModels.length > 0 && (
              <span className="text-xs text-slate-500">共 {availableModels.length} 个模型</span>
            )}
          </div>

          <label className="mt-4 block text-xs font-medium text-slate-600">对话 Model</label>
          <select
            value={draft.llmModel}
            disabled={availableModels.length === 0}
            onChange={(e) => {
              setDraft((current) => ({ ...current, llmModel: e.target.value }));
              setLlmSaved(false);
            }}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 disabled:bg-slate-50 disabled:text-slate-400"
          >
            <option value="">
              {availableModels.length === 0 ? "请先加载模型列表" : "请选择对话模型"}
            </option>
            {availableModels.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>

          <label className="mt-4 block text-xs font-medium text-slate-600">Embedding Model</label>
          <select
            value={draft.embeddingModel}
            disabled={embeddingModels.length === 0}
            onChange={(e) => {
              setDraft((current) => ({ ...current, embeddingModel: e.target.value }));
              setLlmSaved(false);
            }}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 disabled:bg-slate-50 disabled:text-slate-400"
          >
            <option value="">
              {availableModels.length === 0 ? "请先加载模型列表" : "请选择 Embedding 模型"}
            </option>
            {embeddingModels.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-400">
            用于 RAG 向量检索；默认优先展示名称含 embed 的模型，未配置时使用 {DEFAULT_EMBEDDING_MODEL}
          </p>

          {llmError && <p className="mt-3 text-sm text-red-600">{llmError}</p>}
          {llmSaved && !draftDirty && (
            <p className="mt-3 text-sm text-green-700">LLM 配置已保存</p>
          )}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={handleSaveLlm}
              disabled={!draftDirty}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
            >
              保存
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">默认时间范围</h2>
          </div>
          <div className="mt-3 flex gap-4 text-sm">
            {([1, 3, 7] as DefaultDays[]).map((value) => (
              <label key={value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="defaultDays"
                  checked={settings.defaultDays === value}
                  onChange={() => setSettings({ defaultDays: value })}
                />
                近 {value} 天
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold">Skill 与 Prompt</h2>
          <p className="mt-1 text-xs text-slate-500">
            摘要 skill、对话 system prompt、数据源 discovery skill 等统一在 Skill 管理页配置。
          </p>
          <Link
            to="/skills"
            className="mt-3 inline-block rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            打开 Skill 管理
          </Link>
        </section>
      </div>
    </div>
  );
}
