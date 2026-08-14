import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  deleteCredential,
  fetchCredentials,
  fetchCursorApiKeyStatus,
  fetchLlmModels,
  saveCursorApiKey,
  verifyCredential,
  type AuthPrecheckItem,
  type AuthSlot,
  type CredentialItem,
} from "../api";
import AuthHandoffPanel from "../components/AuthHandoffPanel";
import FeedSchedulerSection from "../components/FeedSchedulerSection";
import SkillsPanel from "./SkillsPage";
import { isRefreshAuthError } from "../contexts/FeedRefreshContext";
import {
  filterEmbeddingModels,
  isLlmConfigured,
  normalizeLlmMaxTokens,
  useSettings,
  type DefaultDays,
  formatDaysLabel,
} from "../hooks/useSettings";
import { THINKING_STYLES } from "../constants/llmProviders";
import { WEIXIN_SOURCE_ENABLED } from "../utils/featureFlags";

interface LlmDraft {
  llmModel: string;
  embeddingModel: string;
  llmApiKey: string;
  llmApiBase: string;
  llmMaxTokens: number;
  thinkingStyle: string;
  embeddingApiKey: string;
  embeddingApiBase: string;
}

type SettingsTab = "sync" | "auth" | "model" | "skill" | "more";

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "sync", label: "同步与定时" },
  { id: "auth", label: "授权" },
  { id: "model", label: "模型" },
  { id: "skill", label: "Skill" },
  { id: "more", label: "其他" },
];

function parseSettingsTab(value: string | null): SettingsTab | null {
  if (!value) return null;
  return SETTINGS_TABS.some((tab) => tab.id === value) ? (value as SettingsTab) : null;
}

export default function SettingsPage() {
  const { settings, setSettings, saveLlmToServer } = useSettings();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    () => parseSettingsTab(searchParams.get("tab")) ?? "model",
  );
  const [draft, setDraft] = useState<LlmDraft>({
    llmModel: settings.llmModel,
    embeddingModel: settings.embeddingModel,
    llmApiKey: settings.llmApiKey,
    llmApiBase: settings.llmApiBase,
    llmMaxTokens: settings.llmMaxTokens,
    thinkingStyle: settings.thinkingStyle,
    embeddingApiKey: settings.embeddingApiKey,
    embeddingApiBase: settings.embeddingApiBase,
  });
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [llmError, setLlmError] = useState("");
  const [llmSaved, setLlmSaved] = useState(false);
  // editing=false → 只读显示已保存值；editing=true → 可编辑
  const [editing, setEditing] = useState(() => !isLlmConfigured(settings));
  // embedding 独立编辑态
  const [embedModels, setEmbedModels] = useState<string[]>([]);
  const [embedModelsLoading, setEmbedModelsLoading] = useState(false);
  const [embedError, setEmbedError] = useState("");
  const [embedSaved, setEmbedSaved] = useState(false);
  const [editingEmbed, setEditingEmbed] = useState(() => !settings.embeddingModel.trim());
  const [credentials, setCredentials] = useState<CredentialItem[]>([]);
  const [authSlots, setAuthSlots] = useState<AuthSlot[]>([]);
  const [credVerifyingId, setCredVerifyingId] = useState<string | null>(null);
  const [credMessage, setCredMessage] = useState("");
  const [credError, setCredError] = useState("");
  const [reauthItem, setReauthItem] = useState<AuthPrecheckItem | null>(null);
  const [reauthCookie, setReauthCookie] = useState("");
  const [reauthKey, setReauthKey] = useState(0);
  const [cursorApiKey, setCursorApiKey] = useState("");
  const [cursorConfigured, setCursorConfigured] = useState(false);
  const [cursorMasked, setCursorMasked] = useState("");
  const [cursorSaving, setCursorSaving] = useState(false);
  const [cursorMessage, setCursorMessage] = useState("");
  const [cursorError, setCursorError] = useState("");

  const visibleCredentials = useMemo(
    () =>
      WEIXIN_SOURCE_ENABLED
        ? credentials
        : credentials.filter((item) => item.slot !== "weixin"),
    [credentials],
  );

  useEffect(() => {
    const fromUrl = parseSettingsTab(searchParams.get("tab"));
    if (fromUrl) setActiveTab(fromUrl);
  }, [searchParams]);

  function switchTab(tab: SettingsTab) {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setSearchParams(next, { replace: true });
  }

  const configured = isLlmConfigured(settings);

  useEffect(() => {
    setDraft({
      llmModel: settings.llmModel,
      embeddingModel: settings.embeddingModel,
      llmApiKey: settings.llmApiKey,
      llmApiBase: settings.llmApiBase,
      llmMaxTokens: settings.llmMaxTokens,
      thinkingStyle: settings.thinkingStyle,
      embeddingApiKey: settings.embeddingApiKey,
      embeddingApiBase: settings.embeddingApiBase,
    });
  }, [
    settings.llmModel,
    settings.embeddingModel,
    settings.llmApiKey,
    settings.llmApiBase,
    settings.llmMaxTokens,
    settings.thinkingStyle,
    settings.embeddingApiKey,
    settings.embeddingApiBase,
  ]);

  function invalidateModels() {
    setAvailableModels([]);
    setDraft((current) => ({ ...current, llmModel: "" }));
  }

  function invalidateEmbedModels() {
    setEmbedModels([]);
    setDraft((current) => ({ ...current, embeddingModel: "" }));
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

      setDraft((current) => ({
        ...current,
        llmModel: preferredChat && models.includes(preferredChat) ? preferredChat : "",
      }));
    } catch (err) {
      setAvailableModels([]);
      setLlmError(err instanceof Error ? err.message : "加载模型列表失败");
    } finally {
      setModelsLoading(false);
    }
  }

  async function handleLoadEmbedModels() {
    const key = draft.embeddingApiKey.trim() || draft.llmApiKey.trim();
    if (!key) {
      setEmbedError("请先填写 API Key");
      return;
    }
    const base = draft.embeddingApiBase.trim() || draft.llmApiBase.trim();
    setEmbedModelsLoading(true);
    setEmbedError("");
    setEmbedSaved(false);
    try {
      const { models } = await fetchLlmModels(base, key);
      const embedCandidates = filterEmbeddingModels(models);
      setEmbedModels(embedCandidates);
      const preferred = draft.embeddingModel || settings.embeddingModel;
      setDraft((current) => ({
        ...current,
        embeddingModel:
          preferred && embedCandidates.includes(preferred)
            ? preferred
            : embedCandidates[0] ?? "",
      }));
    } catch (err) {
      setEmbedModels([]);
      setEmbedError(err instanceof Error ? err.message : "加载模型列表失败");
    } finally {
      setEmbedModelsLoading(false);
    }
  }

  async function handleSaveLlm() {
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

    const maxTokens = normalizeLlmMaxTokens(draft.llmMaxTokens);
    const modelsReady = availableModels.length > 0;
    const reusingSavedModel =
      !modelsReady && draft.llmModel === settings.llmModel && Boolean(settings.llmModel.trim());

    if (!modelsReady && !reusingSavedModel) {
      setLlmError("请先加载模型列表");
      return;
    }
    if (modelsReady && !availableModels.includes(draft.llmModel)) {
      setLlmError("请从模型列表中选择有效的对话模型");
      return;
    }

    try {
      await saveLlmToServer({
        ...settings,
        llmModel: draft.llmModel.trim(),
        embeddingModel: draft.embeddingModel.trim(),
        llmApiKey: draft.llmApiKey.trim(),
        llmApiBase: draft.llmApiBase.trim(),
        llmMaxTokens: maxTokens,
        thinkingStyle: draft.thinkingStyle,
        embeddingApiKey: draft.embeddingApiKey.trim(),
        embeddingApiBase: draft.embeddingApiBase.trim(),
      });
      setDraft((current) => ({ ...current, llmMaxTokens: maxTokens }));
      setLlmSaved(true);
      setEditing(false);
    } catch (err) {
      setLlmError(err instanceof Error ? err.message : "保存失败");
    }
  }

  async function handleSaveEmbed() {
    setEmbedError("");
    setEmbedSaved(false);
    if (!draft.embeddingModel.trim()) {
      setEmbedError("请选择 Embedding 模型");
      return;
    }
    try {
      await saveLlmToServer({
        ...settings,
        embeddingModel: draft.embeddingModel.trim(),
        embeddingApiKey: draft.embeddingApiKey.trim(),
        embeddingApiBase: draft.embeddingApiBase.trim(),
      });
      setEmbedSaved(true);
      setEditingEmbed(false);
    } catch (err) {
      setEmbedError(err instanceof Error ? err.message : "保存失败");
    }
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

  function buildReauthItem(cred: CredentialItem): AuthPrecheckItem {
    const slotMeta = authSlots.find((slot) => slot.id === cred.slot);
    return {
      entry_url: slotMeta?.login_url || "",
      requires_auth: true,
      slot: cred.slot,
      slot_label: cred.slot_label || slotMeta?.label || cred.label || cred.slot,
      login_url: slotMeta?.login_url || "",
      cookie_hint: slotMeta?.cookie_hint,
      configured: false,
      can_proceed: false,
    };
  }

  function openReauthForCredential(cred: CredentialItem, reason?: string) {
    setReauthItem(buildReauthItem(cred));
    setReauthCookie("");
    setReauthKey((value) => value + 1);
    if (reason) {
      setCredError(reason);
    } else {
      setCredError("");
    }
    setCredMessage("");
  }

  function closeReauthPanel() {
    setReauthItem(null);
    setReauthCookie("");
  }

  async function handleVerifyCredential(credId: string) {
    setCredVerifyingId(credId);
    setCredError("");
    setCredMessage("");
    const cred = credentials.find((item) => item.id === credId) ?? null;
    try {
      const result = await verifyCredential(credId);
      setCredMessage(result.message || "校验成功");
      setReauthItem(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "校验失败";
      setCredError(message);
      if (cred && isRefreshAuthError(message)) {
        openReauthForCredential(cred, message);
      }
    } finally {
      setCredVerifyingId(null);
    }
  }

  async function handleReauthSaved() {
    setReauthCookie("");
    setReauthItem(null);
    await reloadCredentials();
    setCredMessage("已重新授权并保存凭证");
    setCredError("");
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
        <h1 className="text-lg font-semibold">设置</h1>
        <p className="mt-1 text-[clamp(0.92rem,0.15vw+0.86rem,1rem)] text-[var(--ink-muted)]">
          Prompt 与 LLM 配置保存在浏览器本地
        </p>
      </header>

      <div className="app-content-medium space-y-6 p-6">
        <nav
          aria-label="设置分区"
          className="flex flex-wrap gap-1 rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)] p-1"
        >
          {SETTINGS_TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => switchTab(tab.id)}
                className={`rounded-[var(--radius-control)] px-3.5 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-[var(--ink)] text-[var(--paper-raised)]"
                    : "text-[var(--ink-muted)] hover:bg-[var(--paper)] hover:text-[var(--ink)]"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {activeTab === "sync" ? (
          <>
            <FeedSchedulerSection />
            <section className="rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)] p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">默认时间范围</h2>
              </div>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                用于库与对话页的默认查询窗口，可随时在页面内临时切换。
              </p>
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
          </>
        ) : null}

        {activeTab === "auth" ? (
          <>
        <section className="rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)] p-5">
          <h2 className="text-base font-semibold">数据源授权（Cookie）</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            已保存的平台登录态如下。可用「测试」检查是否仍有效；失效时点「重新授权」打开登录窗口。
            新源接入时也会引导授权。
          </p>

          {visibleCredentials.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {visibleCredentials.map((item) => (
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
                      onClick={() => openReauthForCredential(item)}
                      className="text-xs text-[var(--accent)] underline"
                    >
                      重新授权
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
            <p className="mt-3 text-xs text-[var(--accent)]">
              尚未配置任何 Cookie 凭证。添加需登录的数据源时会引导授权。
            </p>
          )}

          {reauthItem ? (
            <div className="mt-4">
              <AuthHandoffPanel
                key={`${reauthItem.slot}-${reauthKey}`}
                item={reauthItem}
                cookieDraft={reauthCookie}
                onCookieChange={setReauthCookie}
                onSaved={() => void handleReauthSaved()}
                onCancel={closeReauthPanel}
                autoStart
                title={`请重新授权：${reauthItem.slot_label || reauthItem.slot}`}
              />
            </div>
          ) : null}

          {credError && <p className="mt-3 text-sm text-red-800">{credError}</p>}
          {credMessage && <p className="mt-3 text-sm text-[var(--success)]">{credMessage}</p>}
        </section>

        <section className="rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)] p-5">
          <h2 className="text-base font-semibold">Cursor API Key（数据源接入）</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
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
          </>
        ) : null}

        {activeTab === "model" ? (
        <>
        {/* ── 对话模型卡片 ── */}
        <section className="rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)] p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">对话模型</h2>
            <span className={`text-xs font-medium ${configured ? "text-[var(--success)]" : "text-[var(--accent)]"}`}>
              {configured ? "已配置" : "未配置"}
            </span>
          </div>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            用于对话与概览生成。配置保存在本机服务端，Cursor 内置浏览器与 Chrome/Safari 等共用。
          </p>

          {(() => {
            const ro = !editing;
            const fieldCls = `mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none ${
              ro
                ? "border-[var(--rule)] bg-[var(--paper)] text-[var(--ink-muted)] cursor-default"
                : "border-[var(--rule)] bg-white focus:border-[var(--accent)]"
            }`;
            const selectCls = fieldCls;
            return (
              <>
                <label className="mt-4 block text-xs font-medium text-[var(--ink-muted)]">Base URL</label>
                <input type="url" readOnly={ro} value={draft.llmApiBase}
                  onChange={(e) => { setDraft((c) => ({ ...c, llmApiBase: e.target.value })); setLlmSaved(false); invalidateModels(); }}
                  placeholder="https://api.openai.com/v1" className={fieldCls} />
                {!ro && <p className="mt-1 text-xs text-[var(--ink-muted)]">留空则使用 OpenAI 默认地址，模型列表从 /models 获取</p>}

                <label className="mt-4 block text-xs font-medium text-[var(--ink-muted)]">API Key</label>
                <input type="password" readOnly={ro} value={draft.llmApiKey}
                  onChange={(e) => { setDraft((c) => ({ ...c, llmApiKey: e.target.value })); setLlmSaved(false); invalidateModels(); }}
                  placeholder="sk-..." autoComplete="off" className={fieldCls} />

                {!ro && (
                  <div className="mt-4 flex items-center gap-2">
                    <button type="button" disabled={modelsLoading || !draft.llmApiKey.trim()}
                      onClick={() => void handleLoadModels()}
                      className="rounded-md border border-[var(--rule)] px-3 py-1.5 text-sm hover:bg-[var(--paper)] disabled:opacity-50">
                      {modelsLoading ? "加载中..." : "加载模型列表"}
                    </button>
                    {availableModels.length > 0 && <span className="text-xs text-[var(--ink-muted)]">共 {availableModels.length} 个</span>}
                  </div>
                )}

                <label className="mt-4 block text-xs font-medium text-[var(--ink-muted)]">对话 Model</label>
                <select disabled={ro || availableModels.length === 0} value={draft.llmModel}
                  onChange={(e) => { setDraft((c) => ({ ...c, llmModel: e.target.value })); setLlmSaved(false); }}
                  className={selectCls}>
                  {draft.llmModel && !availableModels.includes(draft.llmModel) && <option value={draft.llmModel}>{draft.llmModel}</option>}
                  {availableModels.length === 0 && !draft.llmModel && <option value="">请先加载模型列表</option>}
                  {availableModels.length > 0 && !draft.llmModel && <option value="">请选择对话模型</option>}
                  {availableModels.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>

                <label className="mt-4 block text-xs font-medium text-[var(--ink-muted)]">深度思考参数风格</label>
                <select disabled={ro} value={draft.thinkingStyle}
                  onChange={(e) => { setDraft((c) => ({ ...c, thinkingStyle: e.target.value })); setLlmSaved(false); }}
                  className={selectCls}>
                  {THINKING_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                {!ro && <p className="mt-1 text-xs text-[var(--ink-muted)]">控制开启深度思考时向模型传递的参数格式，选「自动推断」时根据模型名判断</p>}

                <label className="mt-4 block text-xs font-medium text-[var(--ink-muted)]">最大输出 Tokens</label>
                <input type="text" inputMode="numeric" readOnly={ro} value={draft.llmMaxTokens}
                  onChange={(e) => { setDraft((c) => ({ ...c, llmMaxTokens: e.target.value === "" ? 32768 : Number(e.target.value) })); setLlmSaved(false); }}
                  placeholder="32768" className={fieldCls} />
                {!ro && <p className="mt-1 text-xs text-[var(--ink-muted)]">控制概览与对话的单次最大生成长度，默认 32768</p>}
              </>
            );
          })()}

          {llmError && <p className="mt-3 text-sm text-red-800">{llmError}</p>}
          {llmSaved && !editing && <p className="mt-3 text-sm text-[var(--success)]">对话模型配置已保存</p>}

          <div className="mt-5 flex justify-end gap-2">
            {editing ? (
              <>
                <button type="button"
                  onClick={() => { setEditing(false); setLlmError(""); setAvailableModels([]);
                    setDraft((c) => ({ ...c, llmModel: settings.llmModel, llmApiKey: settings.llmApiKey, llmApiBase: settings.llmApiBase, llmMaxTokens: settings.llmMaxTokens, thinkingStyle: settings.thinkingStyle })); }}
                  className="rounded-md border border-[var(--rule)] px-4 py-2 text-sm hover:bg-[var(--paper)]">取消</button>
                <button type="button" onClick={() => void handleSaveLlm()}
                  className="rounded-md bg-[var(--ink)] px-4 py-2 text-sm text-[var(--paper-raised)] hover:bg-[color-mix(in_srgb,var(--ink)_88%,white)]">保存</button>
              </>
            ) : (
              <button type="button" onClick={() => { setEditing(true); setLlmSaved(false); setLlmError(""); }}
                className="rounded-md border border-[var(--rule)] px-4 py-2 text-sm hover:bg-[var(--paper)]">修改</button>
            )}
          </div>
        </section>

        {/* ── Embedding 模型卡片 ── */}
        <section className="rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)] p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Embedding 模型</h2>
            <span className={`text-xs font-medium ${settings.embeddingModel ? "text-[var(--success)]" : "text-[var(--ink-muted)]"}`}>
              {settings.embeddingModel || "未配置"}
            </span>
          </div>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            用于 RAG 向量检索。可使用与对话模型不同的厂商；留空 Key / Base URL 则复用对话模型的配置。
          </p>

          {(() => {
            const ro = !editingEmbed;
            const fieldCls = `mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none ${
              ro
                ? "border-[var(--rule)] bg-[var(--paper)] text-[var(--ink-muted)] cursor-default"
                : "border-[var(--rule)] bg-white focus:border-[var(--accent)]"
            }`;
            const selectCls = fieldCls;
            return (
              <>
                <label className="mt-4 block text-xs font-medium text-[var(--ink-muted)]">Base URL（可选）</label>
                <input type="url" readOnly={ro} value={draft.embeddingApiBase}
                  onChange={(e) => { setDraft((c) => ({ ...c, embeddingApiBase: e.target.value })); setEmbedSaved(false); invalidateEmbedModels(); }}
                  placeholder="留空则使用对话模型的 Base URL" className={fieldCls} />

                <label className="mt-4 block text-xs font-medium text-[var(--ink-muted)]">API Key（可选）</label>
                <input type="password" readOnly={ro} value={draft.embeddingApiKey}
                  onChange={(e) => { setDraft((c) => ({ ...c, embeddingApiKey: e.target.value })); setEmbedSaved(false); invalidateEmbedModels(); }}
                  placeholder="留空则使用对话模型的 API Key" autoComplete="off" className={fieldCls} />
                {!ro && <p className="mt-1 text-xs text-[var(--ink-muted)]">不同厂商时才需要单独填写</p>}

                {!ro && (
                  <div className="mt-4 flex items-center gap-2">
                    <button type="button"
                      disabled={embedModelsLoading || (!draft.embeddingApiKey.trim() && !draft.llmApiKey.trim())}
                      onClick={() => void handleLoadEmbedModels()}
                      className="rounded-md border border-[var(--rule)] px-3 py-1.5 text-sm hover:bg-[var(--paper)] disabled:opacity-50">
                      {embedModelsLoading ? "加载中..." : "加载模型列表"}
                    </button>
                    {embedModels.length > 0 && <span className="text-xs text-[var(--ink-muted)]">共 {embedModels.length} 个</span>}
                  </div>
                )}

                <label className="mt-4 block text-xs font-medium text-[var(--ink-muted)]">Embedding Model</label>
                <select disabled={ro || (embedModels.length === 0 && !draft.embeddingModel)} value={draft.embeddingModel}
                  onChange={(e) => { setDraft((c) => ({ ...c, embeddingModel: e.target.value })); setEmbedSaved(false); }}
                  className={selectCls}>
                  {draft.embeddingModel && !embedModels.includes(draft.embeddingModel) && <option value={draft.embeddingModel}>{draft.embeddingModel}</option>}
                  {embedModels.length === 0 && !draft.embeddingModel && <option value="">请先加载模型列表</option>}
                  {embedModels.length > 0 && !draft.embeddingModel && <option value="">请选择 Embedding 模型</option>}
                  {embedModels.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                {!ro && <p className="mt-1 text-xs text-[var(--ink-muted)]">默认优先展示名称含 embed 的模型</p>}
              </>
            );
          })()}

          {embedError && <p className="mt-3 text-sm text-red-800">{embedError}</p>}
          {embedSaved && !editingEmbed && <p className="mt-3 text-sm text-[var(--success)]">Embedding 配置已保存</p>}

          <div className="mt-5 flex justify-end gap-2">
            {editingEmbed ? (
              <>
                <button type="button"
                  onClick={() => { setEditingEmbed(false); setEmbedError(""); setEmbedModels([]);
                    setDraft((c) => ({ ...c, embeddingModel: settings.embeddingModel, embeddingApiKey: settings.embeddingApiKey, embeddingApiBase: settings.embeddingApiBase })); }}
                  className="rounded-md border border-[var(--rule)] px-4 py-2 text-sm hover:bg-[var(--paper)]">取消</button>
                <button type="button" onClick={() => void handleSaveEmbed()}
                  className="rounded-md bg-[var(--ink)] px-4 py-2 text-sm text-[var(--paper-raised)] hover:bg-[color-mix(in_srgb,var(--ink)_88%,white)]">保存</button>
              </>
            ) : (
              <button type="button" onClick={() => { setEditingEmbed(true); setEmbedSaved(false); setEmbedError(""); }}
                className="rounded-md border border-[var(--rule)] px-4 py-2 text-sm hover:bg-[var(--paper)]">修改</button>
            )}
          </div>
        </section>
        </>) : null}

        {activeTab === "skill" ? (
          <section className="rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)] p-5">
            <SkillsPanel embedded />
          </section>
        ) : null}

        {activeTab === "more" ? (
          <section className="rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)] p-5">
            <h2 className="text-base font-semibold">其他</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              预留扩展项。当前常用配置已归入「同步与定时 / 授权 / 模型 / Skill」。
            </p>
          </section>
        ) : null}
      </div>
    </div>
  );
}
