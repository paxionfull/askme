import { useEffect, useMemo, useState } from "react";
import {
  deleteCredential,
  fetchCredentials,
  fetchCursorApiKeyStatus,
  fetchLlmModels,
  saveCredential,
  saveCursorApiKey,
  verifyCredential,
  type AuthSlot,
  type CredentialItem,
} from "../api";
import FeedSchedulerSection from "../components/FeedSchedulerSection";
import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_LLM_MAX_TOKENS,
  MAX_LLM_MAX_TOKENS,
  MIN_LLM_MAX_TOKENS,
  filterEmbeddingModels,
  isLlmConfigured,
  normalizeLlmMaxTokens,
  useSettings,
  type DefaultDays,
  formatDaysLabel,
} from "../hooks/useSettings";
import { Link } from "react-router-dom";

interface LlmDraft {
  llmModel: string;
  embeddingModel: string;
  llmApiKey: string;
  llmApiBase: string;
  llmMaxTokens: number;
}

export default function SettingsPage() {
  const { settings, setSettings } = useSettings();

  const [draft, setDraft] = useState<LlmDraft>({
    llmModel: settings.llmModel,
    embeddingModel: settings.embeddingModel,
    llmApiKey: settings.llmApiKey,
    llmApiBase: settings.llmApiBase,
    llmMaxTokens: settings.llmMaxTokens,
  });
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [llmError, setLlmError] = useState("");
  const [llmSaved, setLlmSaved] = useState(false);
  const [credentials, setCredentials] = useState<CredentialItem[]>([]);
  const [authSlots, setAuthSlots] = useState<AuthSlot[]>([]);
  const [credSlot, setCredSlot] = useState("zhihu");
  const [credLabel, setCredLabel] = useState("");
  const [credCookie, setCredCookie] = useState("");
  const [credSaving, setCredSaving] = useState(false);
  const [credVerifyingId, setCredVerifyingId] = useState<string | null>(null);
  const [credMessage, setCredMessage] = useState("");
  const [credError, setCredError] = useState("");
  const [cursorApiKey, setCursorApiKey] = useState("");
  const [cursorConfigured, setCursorConfigured] = useState(false);
  const [cursorMasked, setCursorMasked] = useState("");
  const [cursorSaving, setCursorSaving] = useState(false);
  const [cursorMessage, setCursorMessage] = useState("");
  const [cursorError, setCursorError] = useState("");

  const selectedSlotMeta = useMemo(
    () => authSlots.find((slot) => slot.id === credSlot) ?? null,
    [authSlots, credSlot],
  );

  const embeddingModels = useMemo(() => filterEmbeddingModels(availableModels), [availableModels]);
  const configured = isLlmConfigured(settings);
  const draftDirty = useMemo(
    () =>
      draft.llmModel !== settings.llmModel ||
      draft.embeddingModel !== settings.embeddingModel ||
      draft.llmApiKey !== settings.llmApiKey ||
      draft.llmApiBase !== settings.llmApiBase ||
      draft.llmMaxTokens !== settings.llmMaxTokens,
    [draft, settings],
  );

  useEffect(() => {
    setDraft({
      llmModel: settings.llmModel,
      embeddingModel: settings.embeddingModel,
      llmApiKey: settings.llmApiKey,
      llmApiBase: settings.llmApiBase,
      llmMaxTokens: settings.llmMaxTokens,
    });
  }, [
    settings.llmModel,
    settings.embeddingModel,
    settings.llmApiKey,
    settings.llmApiBase,
    settings.llmMaxTokens,
  ]);

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

    const maxTokens = normalizeLlmMaxTokens(draft.llmMaxTokens);
    const modelsReady = availableModels.length > 0;
    const reusingSavedModels =
      !modelsReady &&
      draft.llmModel === settings.llmModel &&
      draft.embeddingModel === settings.embeddingModel &&
      Boolean(settings.llmModel.trim()) &&
      Boolean(settings.embeddingModel.trim());

    if (!modelsReady && !reusingSavedModels) {
      setLlmError("请先加载模型列表");
      return;
    }
    if (modelsReady) {
      if (!availableModels.includes(draft.llmModel)) {
        setLlmError("请从模型列表中选择有效的对话模型");
        return;
      }
      if (!embeddingModels.includes(draft.embeddingModel)) {
        setLlmError("请从 Embedding 模型列表中选择有效模型");
        return;
      }
    }

    setSettings({
      llmModel: draft.llmModel.trim(),
      embeddingModel: draft.embeddingModel.trim(),
      llmApiKey: draft.llmApiKey.trim(),
      llmApiBase: draft.llmApiBase.trim(),
      llmMaxTokens: maxTokens,
    });
    setDraft((current) => ({ ...current, llmMaxTokens: maxTokens }));
    setLlmSaved(true);
  }

  useEffect(() => {
    void (async () => {
      try {
        const [credStatus, cursorStatus] = await Promise.all([
          fetchCredentials(),
          fetchCursorApiKeyStatus(),
        ]);
        setCredentials(credStatus.credentials);
        setAuthSlots(credStatus.slots);
        if (credStatus.slots[0]?.id) {
          setCredSlot(credStatus.slots[0].id);
        }
        setCursorConfigured(cursorStatus.configured);
        setCursorMasked(cursorStatus.masked);
      } catch {
        // noop
      }
    })();
  }, []);

  async function reloadCredentials() {
    const data = await fetchCredentials();
    setCredentials(data.credentials);
    setAuthSlots(data.slots);
  }

  async function handleSaveCredential() {
    if (!credCookie.trim()) {
      setCredError("请先粘贴 Cookie");
      return;
    }
    setCredSaving(true);
    setCredError("");
    setCredMessage("");
    try {
      await saveCredential({
        slot: credSlot,
        cookie: credCookie.trim(),
        label: credLabel.trim() || selectedSlotMeta?.label || credSlot,
      });
      setCredCookie("");
      setCredLabel("");
      await reloadCredentials();
      setCredMessage("已保存授权凭证");
    } catch (err) {
      setCredError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setCredSaving(false);
    }
  }

  async function handleVerifyCredential(credId: string) {
    setCredVerifyingId(credId);
    setCredError("");
    setCredMessage("");
    try {
      const result = await verifyCredential(credId);
      setCredMessage(result.message || "校验成功");
    } catch (err) {
      setCredError(err instanceof Error ? err.message : "校验失败");
    } finally {
      setCredVerifyingId(null);
    }
  }

  async function handleDeleteCredential(credId: string) {
    setCredError("");
    setCredMessage("");
    try {
      await deleteCredential(credId);
      await reloadCredentials();
      setCredMessage("已删除凭证");
    } catch (err) {
      setCredError(err instanceof Error ? err.message : "删除失败");
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
    <div className="h-full overflow-y-auto bg-[var(--paper)]">
      <header className="border-b border-[var(--rule)] bg-[var(--paper-raised)] px-6 py-4">
        <h1 className="text-base font-semibold">设置</h1>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">Prompt 与 LLM 配置保存在浏览器本地</p>
      </header>

      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <FeedSchedulerSection />

        <section className="rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)] p-5">
          <h2 className="text-sm font-semibold">数据源授权（Cookie）</h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            按平台保存登录 Cookie。添加知乎等需登录的数据源时会自动使用对应授权；也可在此增删凭证。
          </p>

          {credentials.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {credentials.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[var(--rule)] px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-[var(--ink)]">
                      {item.label}
                      <span className="ml-2 text-xs font-normal text-[var(--ink-muted)]">
                        {item.slot_label || item.slot}
                      </span>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-[var(--ink-muted)]">{item.masked}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      disabled={credVerifyingId === item.id}
                      onClick={() => void handleVerifyCredential(item.id)}
                      className="text-xs text-[var(--ink-muted)] underline disabled:opacity-50"
                    >
                      {credVerifyingId === item.id ? "校验中…" : "测试"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteCredential(item.id)}
                      className="text-xs text-red-800 underline"
                    >
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-[var(--accent)]">尚未配置任何 Cookie 凭证</p>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-[var(--ink-muted)]">
              平台
              <select
                value={credSlot}
                onChange={(e) => setCredSlot(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--rule)] px-3 py-2 text-sm"
              >
                {(authSlots.length > 0 ? authSlots : [{ id: "zhihu", label: "知乎" }]).map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {slot.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-[var(--ink-muted)]">
              显示名称（可选）
              <input
                value={credLabel}
                onChange={(e) => setCredLabel(e.target.value)}
                placeholder={selectedSlotMeta?.label || "例如：知乎主号"}
                className="mt-1 w-full rounded-lg border border-[var(--rule)] px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {selectedSlotMeta?.login_url ? (
              <a
                href={selectedSlotMeta.login_url}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-[var(--rule)] px-3 py-1.5 text-sm hover:bg-[var(--paper)]"
              >
                打开登录页
              </a>
            ) : null}
          </div>

          <label className="mt-3 block text-xs font-medium text-[var(--ink-muted)]">Cookie</label>
          <textarea
            value={credCookie}
            onChange={(e) => setCredCookie(e.target.value)}
            rows={3}
            placeholder={selectedSlotMeta?.cookie_hint || "粘贴完整 Cookie"}
            className="mt-1 w-full rounded-lg border border-[var(--rule)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSaveCredential()}
              disabled={credSaving}
              className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-sm text-[var(--paper-raised)] hover:bg-[color-mix(in_srgb,var(--ink)_88%,white)] disabled:opacity-50"
            >
              {credSaving ? "保存中..." : "保存凭证"}
            </button>
          </div>

          {credError && <p className="mt-2 text-sm text-red-800">{credError}</p>}
          {credMessage && <p className="mt-2 text-sm text-[var(--success)]">{credMessage}</p>}
        </section>

        <section className="rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)] p-5">
          <h2 className="text-sm font-semibold">Cursor API Key（数据源接入）</h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            接入未知站点时，Askme 会通过 Cursor Agent 自动编写 discovery skill。请在{" "}
            <a
              href="https://cursor.com/settings"
              target="_blank"
              rel="noreferrer"
              className="text-[var(--ink)] underline"
            >
              Cursor 设置
            </a>{" "}
            创建 API Key 并粘贴保存。已知平台（知乎、金十等）无需配置。
          </p>
          <p className={`mt-2 text-xs ${cursorConfigured ? "text-[var(--success)]" : "text-[var(--accent)]"}`}>
            {cursorConfigured ? `已配置：${cursorMasked}` : "未配置"}
          </p>

          <label className="mt-4 block text-xs font-medium text-[var(--ink-muted)]">Cursor API Key</label>
          <input
            type="password"
            value={cursorApiKey}
            onChange={(e) => setCursorApiKey(e.target.value)}
            placeholder="cur_..."
            className="mt-1 w-full rounded-lg border border-[var(--rule)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />

          <div className="mt-3">
            <button
              type="button"
              onClick={() => void handleSaveCursorApiKey()}
              disabled={cursorSaving}
              className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-sm text-[var(--paper-raised)] hover:bg-[color-mix(in_srgb,var(--ink)_88%,white)] disabled:opacity-50"
            >
              {cursorSaving ? "保存中..." : "保存 API Key"}
            </button>
          </div>

          {cursorError && <p className="mt-2 text-sm text-red-800">{cursorError}</p>}
          {cursorMessage && <p className="mt-2 text-sm text-[var(--success)]">{cursorMessage}</p>}
        </section>

        <section className="rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)] p-5">
          <h2 className="text-sm font-semibold">LLM 配置</h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            状态：
            <span className={configured ? "text-[var(--success)]" : "text-[var(--accent)]"}>
              {configured ? "已配置" : "未配置"}
            </span>
            {configured ? (
              <>
                {` · 对话 ${settings.llmModel}`}
                {` · Embedding ${settings.embeddingModel || DEFAULT_EMBEDDING_MODEL}`}
                {` · 最大输出 ${settings.llmMaxTokens || DEFAULT_LLM_MAX_TOKENS}`}
              </>
            ) : null}
          </p>

          <label className="mt-4 block text-xs font-medium text-[var(--ink-muted)]">Base URL</label>
          <input
            type="url"
            value={draft.llmApiBase}
            onChange={(e) => {
              setDraft((current) => ({ ...current, llmApiBase: e.target.value }));
              setLlmSaved(false);
              invalidateModels();
            }}
            placeholder="https://api.openai.com/v1"
            className="mt-1 w-full rounded-lg border border-[var(--rule)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            留空则使用 OpenAI 默认地址，模型列表从 Base URL 的 /models 获取
          </p>

          <label className="mt-4 block text-xs font-medium text-[var(--ink-muted)]">API Key</label>
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
            className="mt-1 w-full rounded-lg border border-[var(--rule)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              disabled={modelsLoading || !draft.llmApiKey.trim()}
              onClick={() => void handleLoadModels()}
              className="rounded-md border border-[var(--rule)] px-3 py-1.5 text-sm hover:bg-[var(--paper)] disabled:opacity-50"
            >
              {modelsLoading ? "加载中..." : "加载模型列表"}
            </button>
            {availableModels.length > 0 && (
              <span className="text-xs text-[var(--ink-muted)]">共 {availableModels.length} 个模型</span>
            )}
          </div>

          <label className="mt-4 block text-xs font-medium text-[var(--ink-muted)]">对话 Model</label>
          <select
            value={draft.llmModel}
            disabled={availableModels.length === 0}
            onChange={(e) => {
              setDraft((current) => ({ ...current, llmModel: e.target.value }));
              setLlmSaved(false);
            }}
            className="mt-1 w-full rounded-lg border border-[var(--rule)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)] disabled:bg-[var(--paper)] disabled:text-[var(--ink-muted)]"
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

          <label className="mt-4 block text-xs font-medium text-[var(--ink-muted)]">Embedding Model</label>
          <select
            value={draft.embeddingModel}
            disabled={embeddingModels.length === 0}
            onChange={(e) => {
              setDraft((current) => ({ ...current, embeddingModel: e.target.value }));
              setLlmSaved(false);
            }}
            className="mt-1 w-full rounded-lg border border-[var(--rule)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)] disabled:bg-[var(--paper)] disabled:text-[var(--ink-muted)]"
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
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            用于 RAG 向量检索；默认优先展示名称含 embed 的模型，未配置时使用 {DEFAULT_EMBEDDING_MODEL}
          </p>

          <label className="mt-4 block text-xs font-medium text-[var(--ink-muted)]">最大输出 Tokens</label>
          <input
            type="number"
            min={MIN_LLM_MAX_TOKENS}
            max={MAX_LLM_MAX_TOKENS}
            step={256}
            value={draft.llmMaxTokens}
            onChange={(e) => {
              const raw = e.target.value;
              setDraft((current) => ({
                ...current,
                llmMaxTokens: raw === "" ? DEFAULT_LLM_MAX_TOKENS : Number(raw),
              }));
              setLlmSaved(false);
            }}
            onBlur={() => {
              setDraft((current) => ({
                ...current,
                llmMaxTokens: normalizeLlmMaxTokens(current.llmMaxTokens),
              }));
            }}
            className="mt-1 w-full rounded-lg border border-[var(--rule)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            控制概览与对话的单次最大生成长度，默认 {DEFAULT_LLM_MAX_TOKENS}（范围{" "}
            {MIN_LLM_MAX_TOKENS}–{MAX_LLM_MAX_TOKENS}）
          </p>

          {llmError && <p className="mt-3 text-sm text-red-800">{llmError}</p>}
          {llmSaved && !draftDirty && (
            <p className="mt-3 text-sm text-[var(--success)]">LLM 配置已保存</p>
          )}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={handleSaveLlm}
              disabled={!draftDirty}
              className="rounded-md bg-[var(--ink)] px-4 py-2 text-sm text-[var(--paper-raised)] hover:bg-[color-mix(in_srgb,var(--ink)_88%,white)] disabled:opacity-50"
            >
              保存
            </button>
          </div>
        </section>

        <section className="rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)] p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">默认时间范围</h2>
          </div>
          <div className="mt-3 flex gap-4 text-sm">
            {([1, 3] as DefaultDays[]).map((value) => (
              <label key={value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="defaultDays"
                  checked={settings.defaultDays === value}
                  onChange={() => setSettings({ defaultDays: value })}
                />
                {formatDaysLabel(value)}
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)] p-5">
          <h2 className="text-sm font-semibold">Skill</h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            概览、对话与数据源 Discovery Skill 统一在 Skill 页配置。
          </p>
          <Link
            to="/skills"
            className="ui-btn mt-3 inline-flex text-xs"
          >
            打开 Skill
          </Link>
        </section>
      </div>
    </div>
  );
}
