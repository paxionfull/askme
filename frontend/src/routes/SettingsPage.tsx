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
import ConfirmModal from "../components/ConfirmModal";
import FeedSchedulerSection from "../components/FeedSchedulerSection";
import SkillsPanel from "./SkillsPage";
import { isRefreshAuthError } from "../contexts/FeedRefreshContext";
import {
  DEFAULT_LLM_MAX_TOKENS,
  filterEmbeddingModels,
  isLlmConfigured,
  normalizeLlmMaxTokens,
  useSettings,
  type DefaultDays,
  formatDaysLabel,
} from "../hooks/useSettings";
import { THINKING_STYLES } from "../constants/llmProviders";

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

type SettingsTab = "model" | "skill" | "sync" | "auth";

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "skill", label: "Skills" },
  { id: "sync", label: "定时" },
  { id: "model", label: "API Key" },
  { id: "auth", label: "Cookie" },
];

function parseSettingsTab(value: string | null): SettingsTab | null {
  if (!value) return null;
  return SETTINGS_TABS.some((tab) => tab.id === value) ? (value as SettingsTab) : null;
}

const PENDING_AUTH_SLOT_KEY = "askme.settings.pendingAuthSlot";
const AUTH_AUTOSTART_DONE_KEY = "askme.settings.authAutoStartDone";

function readPendingAuthSlot(): string | null {
  try {
    const raw = (sessionStorage.getItem(PENDING_AUTH_SLOT_KEY) || "").trim().toLowerCase();
    return raw || null;
  } catch {
    return null;
  }
}

function writePendingAuthSlot(slot: string | null) {
  try {
    if (!slot) {
      sessionStorage.removeItem(PENDING_AUTH_SLOT_KEY);
      return;
    }
    sessionStorage.setItem(PENDING_AUTH_SLOT_KEY, slot);
  } catch {
    // ignore
  }
}

function readAuthAutoStartDone(): string | null {
  try {
    const raw = (sessionStorage.getItem(AUTH_AUTOSTART_DONE_KEY) || "").trim().toLowerCase();
    return raw || null;
  } catch {
    return null;
  }
}

function writeAuthAutoStartDone(slot: string | null) {
  try {
    if (!slot) {
      sessionStorage.removeItem(AUTH_AUTOSTART_DONE_KEY);
      return;
    }
    sessionStorage.setItem(AUTH_AUTOSTART_DONE_KEY, slot);
  } catch {
    // ignore
  }
}

function buildReauthItemForSlotFrom(
  authSlots: AuthSlot[],
  credentials: CredentialItem[],
  slotId: string,
): AuthPrecheckItem | null {
  const id = slotId.trim().toLowerCase();
  if (!id) return null;
  const slotMeta = authSlots.find((slot) => slot.id === id);
  const existing = credentials.find((item) => item.slot === id);
  // slot 元数据未加载完时仍给出可展示的占位，避免引导闪没
  return {
    entry_url: slotMeta?.login_url || "",
    requires_auth: true,
    slot: id,
    slot_label: existing?.slot_label || existing?.label || slotMeta?.label || id,
    login_url: slotMeta?.login_url || "",
    cookie_hint: slotMeta?.cookie_hint,
    configured: false,
    can_proceed: false,
  };
}

export default function SettingsPage() {
  const { settings, setSettings, saveLlmToServer, clearLlmFromServer } = useSettings();
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
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resettingLlm, setResettingLlm] = useState(false);
  const [resetEmbedConfirmOpen, setResetEmbedConfirmOpen] = useState(false);
  const [resettingEmbed, setResettingEmbed] = useState(false);
  const [credentials, setCredentials] = useState<CredentialItem[]>([]);
  const [authSlots, setAuthSlots] = useState<AuthSlot[]>([]);
  const [credVerifyingId, setCredVerifyingId] = useState<string | null>(null);
  const [credMessage, setCredMessage] = useState("");
  const [credError, setCredError] = useState("");
  const [reauthItem, setReauthItem] = useState<AuthPrecheckItem | null>(null);
  const [reauthCookie, setReauthCookie] = useState("");
  const [reauthKey, setReauthKey] = useState(0);
  /** 进行中的授权 slot：取消/保存前一直保留（含 sessionStorage），不随 tab 卸载 */
  const [pendingAuthSlot, setPendingAuthSlotState] = useState<string | null>(() => {
    const fromUrl = (searchParams.get("slot") || "").trim().toLowerCase();
    return fromUrl || readPendingAuthSlot();
  });
  /** 该 slot 是否已自动打开过登录窗（防止切 tab 回来再次弹窗） */
  const [autoStartDoneForSlot, setAutoStartDoneForSlot] = useState<string | null>(() =>
    readAuthAutoStartDone(),
  );
  const [cursorApiKey, setCursorApiKey] = useState("");
  const [cursorConfigured, setCursorConfigured] = useState(false);
  const [cursorMasked, setCursorMasked] = useState("");
  const [cursorSaving, setCursorSaving] = useState(false);
  const [cursorMessage, setCursorMessage] = useState("");
  const [cursorError, setCursorError] = useState("");
  const [editingCursor, setEditingCursor] = useState(false);

  const setPendingAuthSlot = (slot: string | null) => {
    const next = (slot || "").trim().toLowerCase() || null;
    setPendingAuthSlotState(next);
    writePendingAuthSlot(next);
    if (!next) {
      setAutoStartDoneForSlot(null);
      writeAuthAutoStartDone(null);
    }
  };

  const visibleCredentials = credentials;

  const activeHandoffItem = useMemo(() => {
    if (reauthItem) return reauthItem;
    if (!pendingAuthSlot) return null;
    return buildReauthItemForSlotFrom(authSlots, credentials, pendingAuthSlot);
  }, [reauthItem, pendingAuthSlot, authSlots, credentials]);

  useEffect(() => {
    const fromUrl = parseSettingsTab(searchParams.get("tab"));
    if (fromUrl) setActiveTab(fromUrl);
    const slot = (searchParams.get("slot") || "").trim().toLowerCase();
    if (slot) setPendingAuthSlot(slot);
  }, [searchParams]);

  function switchTab(tab: SettingsTab) {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    if (pendingAuthSlot) {
      next.set("slot", pendingAuthSlot);
    }
    setSearchParams(next, { replace: true });
  }

  function clearAuthSlotParam() {
    if (!searchParams.get("slot")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("slot");
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

  async function handleResetLlm() {
    setResettingLlm(true);
    setLlmError("");
    setEmbedError("");
    try {
      await clearLlmFromServer();
      setDraft({
        llmModel: "",
        embeddingModel: "",
        llmApiKey: "",
        llmApiBase: "",
        llmMaxTokens: DEFAULT_LLM_MAX_TOKENS,
        thinkingStyle: "",
        embeddingApiKey: "",
        embeddingApiBase: "",
      });
      setAvailableModels([]);
      setEmbedModels([]);
      setLlmSaved(false);
      setEmbedSaved(false);
      setEditing(true);
      setEditingEmbed(true);
      setResetConfirmOpen(false);
    } catch (err) {
      setLlmError(err instanceof Error ? err.message : "重置失败");
      setResetConfirmOpen(false);
    } finally {
      setResettingLlm(false);
    }
  }

  async function handleResetEmbed() {
    setResettingEmbed(true);
    setEmbedError("");
    try {
      await saveLlmToServer({
        ...settings,
        embeddingModel: "",
        embeddingApiKey: "",
        embeddingApiBase: "",
      });
      setDraft((current) => ({
        ...current,
        embeddingModel: "",
        embeddingApiKey: "",
        embeddingApiBase: "",
      }));
      setEmbedModels([]);
      setEmbedSaved(false);
      setEditingEmbed(true);
      setResetEmbedConfirmOpen(false);
    } catch (err) {
      setEmbedError(err instanceof Error ? err.message : "重置失败");
      setResetEmbedConfirmOpen(false);
    } finally {
      setResettingEmbed(false);
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

  function buildReauthItemForSlot(slotId: string): AuthPrecheckItem | null {
    return buildReauthItemForSlotFrom(authSlots, credentials, slotId);
  }

  function openReauthForSlot(slotId: string, reason?: string) {
    const item = buildReauthItemForSlot(slotId);
    if (!item?.slot) {
      setCredError(`未找到授权项「${slotId}」，请确认该站点需要登录`);
      return false;
    }
    const slot = item.slot;
    const sameSlot = reauthItem?.slot === slot || pendingAuthSlot === slot;
    setPendingAuthSlot(slot);
    setReauthItem(item);
    if (!sameSlot) {
      setReauthCookie("");
      setReauthKey((value) => value + 1);
      setAutoStartDoneForSlot(null);
      writeAuthAutoStartDone(null);
    }
    if (reason) {
      setCredError(reason);
    } else {
      setCredError("");
    }
    setCredMessage("");
    const next = new URLSearchParams(searchParams);
    next.set("slot", slot);
    next.set("tab", "auth");
    setActiveTab("auth");
    setSearchParams(next, { replace: true });
    return true;
  }

  function openReauthForCredential(cred: CredentialItem, reason?: string) {
    openReauthForSlot(cred.slot, reason);
  }

  function closeReauthPanel() {
    setReauthItem(null);
    setReauthCookie("");
    setPendingAuthSlot(null);
    setAutoStartDoneForSlot(null);
    writeAuthAutoStartDone(null);
    clearAuthSlotParam();
  }

  function markHandoffAutoStarted() {
    if (!pendingAuthSlot) return;
    setAutoStartDoneForSlot(pendingAuthSlot);
    writeAuthAutoStartDone(pendingAuthSlot);
  }

  // 回到「Cookie」Tab 时，按 pendingAuthSlot 恢复引导（切走时面板会卸载，状态仍保留）
  useEffect(() => {
    if (activeTab !== "auth") return;
    if (!pendingAuthSlot) return;
    if (reauthItem?.slot === pendingAuthSlot) return;
    const item = buildReauthItemForSlotFrom(authSlots, credentials, pendingAuthSlot);
    if (!item) return;
    setReauthItem(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, pendingAuthSlot, authSlots, credentials, reauthItem?.slot]);

  async function handleVerifyCredential(credId: string) {
    setCredVerifyingId(credId);
    setCredError("");
    setCredMessage("");
    const cred = credentials.find((item) => item.id === credId) ?? null;
    try {
      const result = await verifyCredential(credId);
      setCredMessage(result.message || "校验成功");
      setReauthItem(null);
      setPendingAuthSlot(null);
      clearAuthSlotParam();
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
    const slotLabel = reauthItem?.slot_label || reauthItem?.slot || "";
    setReauthCookie("");
    setReauthItem(null);
    setPendingAuthSlot(null);
    setAutoStartDoneForSlot(null);
    writeAuthAutoStartDone(null);
    clearAuthSlotParam();
    await reloadCredentials();
    setCredMessage(
      slotLabel ? `已授权并保存「${slotLabel}」凭证` : "已授权并保存凭证",
    );
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
      setEditingCursor(false);
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
      </header>

      <div className="app-content-narrow space-y-6 p-6">
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
          <h2 className="text-base font-semibold">数据源 Cookie</h2>

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
                      重新登录
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
              尚未配置任何 Cookie 凭证。
            </p>
          )}

          {activeHandoffItem ? (
            <div className="mt-4">
              <AuthHandoffPanel
                key={`${activeHandoffItem.slot}-${reauthKey}`}
                item={activeHandoffItem}
                cookieDraft={reauthCookie}
                onCookieChange={setReauthCookie}
                onSaved={() => void handleReauthSaved()}
                onCancel={closeReauthPanel}
                autoStart={autoStartDoneForSlot !== activeHandoffItem.slot}
                onAutoStarted={markHandoffAutoStarted}
                title={
                  credentials.some((c) => c.slot === activeHandoffItem.slot)
                    ? `请重新登录：${activeHandoffItem.slot_label || activeHandoffItem.slot}`
                    : `请完成登录：${activeHandoffItem.slot_label || activeHandoffItem.slot}`
                }
              />
            </div>
          ) : null}

          {credError && <p className="mt-3 text-sm text-red-800">{credError}</p>}
          {credMessage && <p className="mt-3 text-sm text-[var(--success)]">{credMessage}</p>}
        </section>
          </>
        ) : null}

        {activeTab === "model" ? (
        <>
        {/* ── Cursor API Key ── */}
        <section className="rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)] p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold">Cursor API Key</h2>
              {cursorConfigured && !editingCursor ? (
                <p className="mt-1 text-sm text-[var(--ink-muted)]">
                  <span className="font-medium text-[var(--ink)]">{cursorMasked}</span> · 已配置
                </p>
              ) : null}
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                接入未知网站、需自动编写抓取 Skill 时使用。已知网站无需配置。
              </p>
            </div>
            <span
              className={`shrink-0 text-xs font-medium ${
                cursorConfigured ? "text-[var(--success)]" : "text-[var(--accent)]"
              }`}
            >
              {cursorConfigured ? "已配置" : "未配置"}
            </span>
          </div>

          {!cursorConfigured && !editingCursor ? (
            <>
              <p className="mt-3 text-sm text-[var(--ink-muted)]">
                尚未配置 Cursor API Key，接入未知网站时需要。
              </p>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => {
                    setEditingCursor(true);
                    setCursorError("");
                    setCursorMessage("");
                  }}
                  className="rounded-md bg-[var(--ink)] px-4 py-2 text-sm text-[var(--paper-raised)] hover:bg-[color-mix(in_srgb,var(--ink)_88%,white)]"
                >
                  去配置
                </button>
              </div>
            </>
          ) : null}

          {cursorConfigured || editingCursor ? (
            <>
              <label className="mt-4 block text-xs font-medium text-[var(--ink-muted)]">API Key</label>
              <input
                type="password"
                readOnly={!editingCursor && cursorConfigured}
                value={cursorApiKey}
                onChange={(e) => {
                  setCursorApiKey(e.target.value);
                  setCursorMessage("");
                }}
                placeholder={cursorConfigured && !editingCursor ? cursorMasked : "cur_..."}
                autoComplete="off"
                className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none ${
                  !editingCursor && cursorConfigured
                    ? "border-[var(--rule)] bg-[var(--paper)] text-[var(--ink-muted)] cursor-default"
                    : "border-[var(--rule)] bg-white focus:border-[var(--accent)]"
                }`}
              />
              {!editingCursor && cursorConfigured ? (
                <p className="mt-2 text-xs text-[var(--ink-muted)]">
                  请在{" "}
                  <a
                    href="https://cursor.com/settings"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--ink)] underline"
                  >
                    Cursor 设置
                  </a>{" "}
                  创建 API Key。
                </p>
              ) : null}

              {cursorError && <p className="mt-3 text-sm text-red-800">{cursorError}</p>}
              {cursorMessage && <p className="mt-3 text-sm text-[var(--success)]">{cursorMessage}</p>}

              <div className="mt-5 flex justify-end gap-2">
                {editingCursor ? (
                  <>
                    <button
                      type="button"
                      disabled={cursorSaving}
                      onClick={() => {
                        setEditingCursor(false);
                        setCursorApiKey("");
                        setCursorError("");
                      }}
                      className="rounded-md border border-[var(--rule)] px-4 py-2 text-sm hover:bg-[var(--paper)] disabled:opacity-50"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      disabled={cursorSaving}
                      onClick={() => void handleSaveCursorApiKey()}
                      className="rounded-md bg-[var(--ink)] px-4 py-2 text-sm text-[var(--paper-raised)] hover:bg-[color-mix(in_srgb,var(--ink)_88%,white)] disabled:opacity-50"
                    >
                      {cursorSaving ? "保存中…" : "保存"}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCursor(true);
                      setCursorApiKey("");
                      setCursorError("");
                      setCursorMessage("");
                    }}
                    className="rounded-md border border-[var(--rule)] px-4 py-2 text-sm hover:bg-[var(--paper)]"
                  >
                    修改
                  </button>
                )}
              </div>
            </>
          ) : null}
        </section>

        {/* ── 对话模型卡片 ── */}
        <section className="rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)] p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">对话模型</h2>
            <span className={`text-xs font-medium ${configured ? "text-[var(--success)]" : "text-[var(--accent)]"}`}>
              {configured ? "已配置" : "未配置"}
            </span>
          </div>

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

                <label className="mt-4 block text-xs font-medium text-[var(--ink-muted)]">最大输出 Tokens</label>
                <input type="text" inputMode="numeric" readOnly={ro} value={draft.llmMaxTokens}
                  onChange={(e) => { setDraft((c) => ({ ...c, llmMaxTokens: e.target.value === "" ? 32768 : Number(e.target.value) })); setLlmSaved(false); }}
                  placeholder="32768" className={fieldCls} />
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
              <>
                <button
                  type="button"
                  disabled={resettingLlm}
                  onClick={() => setResetConfirmOpen(true)}
                  className="rounded-md border border-[var(--rule)] px-4 py-2 text-sm text-red-800 hover:bg-[var(--error-soft)] disabled:opacity-50"
                >
                  重置
                </button>
                <button type="button" onClick={() => { setEditing(true); setLlmSaved(false); setLlmError(""); }}
                  className="rounded-md border border-[var(--rule)] px-4 py-2 text-sm hover:bg-[var(--paper)]">修改</button>
              </>
            )}
          </div>
        </section>

        {/* ── Embedding（可选，常驻展开） ── */}
        <section className="rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Embedding 模型（可选）</h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                用于检索提问，生成简报可不配。留空 Key / Base URL 则复用对话模型配置。
              </p>
            </div>
            <span className={`shrink-0 text-xs font-medium ${settings.embeddingModel ? "text-[var(--success)]" : "text-[var(--ink-muted)]"}`}>
              {settings.embeddingModel || "未配置"}
            </span>
          </div>

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
                <label className="mt-4 block text-xs font-medium text-[var(--ink-muted)]">Base URL</label>
                <input type="url" readOnly={ro} value={draft.embeddingApiBase}
                  onChange={(e) => { setDraft((c) => ({ ...c, embeddingApiBase: e.target.value })); setEmbedSaved(false); invalidateEmbedModels(); }}
                  placeholder="留空则使用对话模型的 Base URL" className={fieldCls} />

                <label className="mt-4 block text-xs font-medium text-[var(--ink-muted)]">API Key</label>
                <input type="password" readOnly={ro} value={draft.embeddingApiKey}
                  onChange={(e) => { setDraft((c) => ({ ...c, embeddingApiKey: e.target.value })); setEmbedSaved(false); invalidateEmbedModels(); }}
                  placeholder="留空则使用对话模型的 API Key" autoComplete="off" className={fieldCls} />

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
              <>
                <button
                  type="button"
                  disabled={resettingEmbed}
                  onClick={() => setResetEmbedConfirmOpen(true)}
                  className="rounded-md border border-[var(--rule)] px-4 py-2 text-sm text-red-800 hover:bg-[var(--error-soft)] disabled:opacity-50"
                >
                  重置
                </button>
                <button type="button" onClick={() => { setEditingEmbed(true); setEmbedSaved(false); setEmbedError(""); }}
                  className="rounded-md border border-[var(--rule)] px-4 py-2 text-sm hover:bg-[var(--paper)]">修改</button>
              </>
            )}
          </div>
        </section>
        </>) : null}

        {activeTab === "skill" ? <SkillsPanel embedded /> : null}
      </div>

      <ConfirmModal
        open={resetConfirmOpen}
        title="重置模型配置"
        message="将清空对话模型与 Embedding 模型的全部已保存配置（含 API Key、Base URL 等），此操作不可撤销。"
        confirmLabel="确认重置"
        danger
        loading={resettingLlm}
        onCancel={() => {
          if (!resettingLlm) setResetConfirmOpen(false);
        }}
        onConfirm={() => {
          void handleResetLlm();
        }}
      />

      <ConfirmModal
        open={resetEmbedConfirmOpen}
        title="重置 Embedding 配置"
        message="将清空 Embedding 模型、API Key、Base URL 等已保存配置，不影响对话模型。此操作不可撤销。"
        confirmLabel="确认重置"
        danger
        loading={resettingEmbed}
        onCancel={() => {
          if (!resettingEmbed) setResetEmbedConfirmOpen(false);
        }}
        onConfirm={() => {
          void handleResetEmbed();
        }}
      />
    </div>
  );
}
