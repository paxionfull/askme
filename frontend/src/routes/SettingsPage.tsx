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
import { useLocale } from "../i18n/LocaleContext";
import { formatMessage } from "../i18n/messages";
import type { MessageKey } from "../i18n/messages";

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

const SETTINGS_TAB_KEYS: Array<{ id: SettingsTab; labelKey: MessageKey }> = [
  { id: "skill", labelKey: "settingsTabSkill" },
  { id: "sync", labelKey: "settingsTabSync" },
  { id: "model", labelKey: "settingsTabModel" },
  { id: "auth", labelKey: "settingsTabAuth" },
];

function parseSettingsTab(value: string | null): SettingsTab | null {
  if (!value) return null;
  return SETTINGS_TAB_KEYS.some((tab) => tab.id === value) ? (value as SettingsTab) : null;
}

const PENDING_AUTH_SLOT_KEY = "askme.settings.pendingAuthSlot";
const AUTH_AUTOSTART_DONE_KEY = "askme.settings.authAutoStartDone";
const ACTIVE_TAB_STORAGE_KEY = "askme.settings.activeTab";
const DEFAULT_SETTINGS_TAB: SettingsTab = "skill";

function readStoredSettingsTab(): SettingsTab | null {
  try {
    return parseSettingsTab(localStorage.getItem(ACTIVE_TAB_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeStoredSettingsTab(tab: SettingsTab) {
  try {
    localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, tab);
  } catch {
    // ignore
  }
}

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
  const { t, locale } = useLocale();
  const { settings, setSettings, saveLlmToServer, clearLlmFromServer } = useSettings();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    () => parseSettingsTab(searchParams.get("tab")) ?? readStoredSettingsTab() ?? DEFAULT_SETTINGS_TAB,
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
    if (fromUrl) {
      setActiveTab(fromUrl);
      writeStoredSettingsTab(fromUrl);
    } else {
      const next = new URLSearchParams(searchParams);
      next.set("tab", activeTab);
      setSearchParams(next, { replace: true });
    }
    const slot = (searchParams.get("slot") || "").trim().toLowerCase();
    if (slot) setPendingAuthSlot(slot);
    // Restore last tab into the URL when arriving at /settings without ?tab=
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function switchTab(tab: SettingsTab) {
    setActiveTab(tab);
    writeStoredSettingsTab(tab);
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
      setLlmError(t("settingsErrNeedApiKey"));
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
      setLlmError(err instanceof Error ? err.message : t("settingsErrLoadModels"));
    } finally {
      setModelsLoading(false);
    }
  }

  async function handleLoadEmbedModels() {
    const key = draft.embeddingApiKey.trim() || draft.llmApiKey.trim();
    if (!key) {
      setEmbedError(t("settingsErrNeedApiKey"));
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
      setEmbedError(err instanceof Error ? err.message : t("settingsErrLoadModels"));
    } finally {
      setEmbedModelsLoading(false);
    }
  }

  async function handleSaveLlm() {
    setLlmError("");
    setLlmSaved(false);

    if (!draft.llmApiKey.trim()) {
      setLlmError(t("settingsErrNeedApiKeyFill"));
      return;
    }
    if (!draft.llmModel.trim()) {
      setLlmError(t("settingsErrSelectChatModel"));
      return;
    }

    const maxTokens = normalizeLlmMaxTokens(draft.llmMaxTokens);
    const modelsReady = availableModels.length > 0;
    const reusingSavedModel =
      !modelsReady && draft.llmModel === settings.llmModel && Boolean(settings.llmModel.trim());

    if (!modelsReady && !reusingSavedModel) {
      setLlmError(t("settingsErrLoadModelsFirst"));
      return;
    }
    if (modelsReady && !availableModels.includes(draft.llmModel)) {
      setLlmError(t("settingsErrInvalidChatModel"));
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
      setLlmError(err instanceof Error ? err.message : t("settingsErrSave"));
    }
  }

  async function handleSaveEmbed() {
    setEmbedError("");
    setEmbedSaved(false);
    if (!draft.embeddingModel.trim()) {
      setEmbedError(t("settingsErrSelectEmbedModel"));
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
      setEmbedError(err instanceof Error ? err.message : t("settingsErrSave"));
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
      setLlmError(err instanceof Error ? err.message : t("settingsErrReset"));
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
      setEmbedError(err instanceof Error ? err.message : t("settingsErrReset"));
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
      setCredError(formatMessage(locale, "settingsErrSlotNotFound", { slot: slotId }));
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
    writeStoredSettingsTab("auth");
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
      setCredMessage(result.message || t("settingsCredVerified"));
      setReauthItem(null);
      setPendingAuthSlot(null);
      clearAuthSlotParam();
    } catch (err) {
      const message = err instanceof Error ? err.message : t("settingsCredVerifyFailed");
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
      slotLabel
        ? formatMessage(locale, "settingsCredSaved", { label: slotLabel })
        : t("settingsCredSavedGeneric"),
    );
    setCredError("");
  }

  async function handleDeleteCredential(credId: string) {
    setCredError("");
    setCredMessage("");
    try {
      await deleteCredential(credId);
      await reloadCredentials();
      setCredMessage(t("settingsCredDeleted"));
    } catch (err) {
      setCredError(err instanceof Error ? err.message : t("settingsCredDeleteFailed"));
    }
  }

  async function handleSaveCursorApiKey() {
    if (!cursorApiKey.trim()) {
      setCursorError(t("settingsCursorNeedKey"));
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
      setCursorMessage(t("settingsCursorSaved"));
      setEditingCursor(false);
    } catch (err) {
      setCursorError(err instanceof Error ? err.message : t("settingsErrSave"));
    } finally {
      setCursorSaving(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-[var(--paper)]">
      <header className="border-b border-[var(--rule)] bg-[var(--paper-raised)] px-5 pb-3 pt-4">
        <h1 className="app-page-title text-[var(--ink)]">{t("settingsTitle")}</h1>
      </header>

      <div className="app-content-narrow space-y-6 px-5 py-5 sm:px-6">
        <nav
          aria-label={t("settingsSectionsLabel")}
          className="flex flex-wrap gap-1 rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)] p-1"
        >
          {SETTINGS_TAB_KEYS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => switchTab(tab.id)}
                className={`rounded-[var(--radius-control)] px-3.5 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-[var(--accent)] text-[var(--paper-raised)]"
                    : "text-[var(--ink-muted)] hover:bg-[var(--paper)] hover:text-[var(--ink)]"
                }`}
              >
                {t(tab.labelKey)}
              </button>
            );
          })}
        </nav>

        {activeTab === "sync" ? (
          <>
            <FeedSchedulerSection />
            <section className="rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)] p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">{t("settingsDefaultRange")}</h2>
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
          <h2 className="text-base font-semibold">{t("settingsCookieTitle")}</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">{t("settingsAuthHint")}</p>

          {visibleCredentials.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {visibleCredentials.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 border-b border-[var(--rule)] px-1 py-3 text-sm last:border-b-0"
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
                  <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                    <button
                      type="button"
                      disabled={credVerifyingId === item.id}
                      onClick={() => void handleVerifyCredential(item.id)}
                      className="ui-btn ui-btn-ghost px-2.5 text-xs disabled:opacity-50"
                    >
                      {credVerifyingId === item.id ? t("settingsCookieTesting") : t("settingsCookieTest")}
                    </button>
                    <button
                      type="button"
                      onClick={() => openReauthForCredential(item)}
                      className="ui-btn ui-btn-accent px-2.5 text-xs"
                    >
                      {t("settingsCookieRelogin")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteCredential(item.id)}
                      className="ui-btn ui-btn-danger px-2.5 text-xs"
                    >
                      {t("delete")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-[var(--ink-muted)]">
              {t("settingsCookieEmpty")}
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
                    ? formatMessage(locale, "settingsAuthRelogin", {
                        label: activeHandoffItem.slot_label || activeHandoffItem.slot || "",
                      })
                    : formatMessage(locale, "settingsAuthCompleteLogin", {
                        label: activeHandoffItem.slot_label || activeHandoffItem.slot || "",
                      })
                }
              />
            </div>
          ) : null}

          {credError ? (
            <p className="mt-3 text-sm text-[var(--danger-text)]" role="alert">
              {credError}
            </p>
          ) : null}
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
              <h2 className="text-base font-semibold">{t("settingsCursorApiKeyTitle")}</h2>
              {cursorConfigured && !editingCursor ? (
                <p className="mt-1 text-sm text-[var(--ink-muted)]">
                  <span className="font-medium text-[var(--ink)]">{cursorMasked}</span> · {t("configured")}
                </p>
              ) : null}
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                {t("settingsCursorHint")}
              </p>
            </div>
            <span
              className={`shrink-0 text-xs font-medium ${
                cursorConfigured ? "text-[var(--success)]" : "text-[var(--accent)]"
              }`}
            >
              {cursorConfigured ? t("configured") : t("notConfigured")}
            </span>
          </div>

          {!cursorConfigured && !editingCursor ? (
            <>
              <p className="mt-3 text-sm text-[var(--ink-muted)]">
                {t("settingsCursorEmpty")}
              </p>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => {
                    setEditingCursor(true);
                    setCursorError("");
                    setCursorMessage("");
                  }}
                  className="ui-btn ui-btn-primary text-sm"
                >
                  {t("settingsConfigure")}
                </button>
              </div>
            </>
          ) : null}

          {cursorConfigured || editingCursor ? (
            <>
              <label className="ui-field mt-4">
                <span className="ui-field-label">{t("settingsApiKeyLabel")}</span>
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
                  className={`ui-input w-full ${
                    !editingCursor && cursorConfigured
                      ? "cursor-default bg-[var(--paper)] text-[var(--ink-muted)]"
                      : ""
                  }`}
                />
              </label>
              {!editingCursor && cursorConfigured ? (
                <p className="mt-2 text-xs text-[var(--ink-muted)]">
                  {t("settingsCursorCreatePrefix")}{" "}
                  <a
                    href="https://cursor.com/settings"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--ink)] underline"
                  >
                    {t("settingsCursorSettingsLink")}
                  </a>
                  {locale === "zh" ? "" : " "}
                  {t("settingsCursorCreateSuffix")}
                </p>
              ) : null}

              {cursorError ? (
                <p className="mt-3 text-sm text-[var(--danger-text)]" role="alert">
                  {cursorError}
                </p>
              ) : null}
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
                      className="ui-btn text-sm disabled:opacity-50"
                    >
                      {t("cancel")}
                    </button>
                    <button
                      type="button"
                      disabled={cursorSaving}
                      onClick={() => void handleSaveCursorApiKey()}
                      className="ui-btn ui-btn-primary text-sm disabled:opacity-50"
                    >
                      {cursorSaving ? t("saving") : t("save")}
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
                    className="ui-btn text-sm"
                  >
                    {t("edit")}
                  </button>
                )}
              </div>
            </>
          ) : null}
        </section>

        {/* ── 对话模型卡片 ── */}
        <section className="rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)] p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">{t("settingsChatModel")}</h2>
            <span className={`text-xs font-medium ${configured ? "text-[var(--success)]" : "text-[var(--accent)]"}`}>
              {configured ? t("configured") : t("notConfigured")}
            </span>
          </div>

          {(() => {
            const ro = !editing;
            const fieldCls = `ui-input w-full ${ro ? "cursor-default bg-[var(--paper)] text-[var(--ink-muted)]" : ""}`;
            const selectCls = `ui-select w-full ${ro ? "cursor-default bg-[var(--paper)] text-[var(--ink-muted)]" : ""}`;
            return (
              <>
                <label className="ui-field mt-4">
                  <span className="ui-field-label">{t("settingsBaseUrlLabel")}</span>
                  <input type="url" readOnly={ro} value={draft.llmApiBase}
                    onChange={(e) => { setDraft((c) => ({ ...c, llmApiBase: e.target.value })); setLlmSaved(false); invalidateModels(); }}
                    placeholder="https://api.openai.com/v1" className={fieldCls} />
                </label>

                <label className="ui-field mt-4">
                  <span className="ui-field-label">{t("settingsApiKeyLabel")}</span>
                  <input type="password" readOnly={ro} value={draft.llmApiKey}
                    onChange={(e) => { setDraft((c) => ({ ...c, llmApiKey: e.target.value })); setLlmSaved(false); invalidateModels(); }}
                    placeholder="sk-..." autoComplete="off" className={fieldCls} />
                </label>

                {!ro && (
                  <div className="mt-4 flex items-center gap-2">
                    <button type="button" disabled={modelsLoading || !draft.llmApiKey.trim()}
                      onClick={() => void handleLoadModels()}
                      className="ui-btn text-sm disabled:opacity-50">
                      {modelsLoading ? t("loading") : t("settingsLoadModels")}
                    </button>
                    {availableModels.length > 0 && <span className="text-xs text-[var(--ink-muted)]">{availableModels.length} {t("settingsModelsCount")}</span>}
                  </div>
                )}

                <label className="ui-field mt-4">
                  <span className="ui-field-label">{t("settingsChatModelLabel")}</span>
                  <select disabled={ro || availableModels.length === 0} value={draft.llmModel}
                    onChange={(e) => { setDraft((c) => ({ ...c, llmModel: e.target.value })); setLlmSaved(false); }}
                    className={selectCls}>
                    {draft.llmModel && !availableModels.includes(draft.llmModel) && <option value={draft.llmModel}>{draft.llmModel}</option>}
                    {availableModels.length === 0 && !draft.llmModel && (
                      <option value="">{t("settingsOptLoadModelsFirst")}</option>
                    )}
                    {availableModels.length > 0 && !draft.llmModel && (
                      <option value="">{t("settingsOptSelectChatModel")}</option>
                    )}
                    {availableModels.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>

                <details className="mt-4" open={draft.thinkingStyle !== ""}>
                  <summary className="cursor-pointer text-xs font-medium text-[var(--ink-muted)]">
                    {t("settingsThinkingAdvanced")}
                    {draft.thinkingStyle === "" ? (
                      <span className="ml-1.5 font-normal text-[var(--ink-muted)]">· {t("thinkingAuto")}</span>
                    ) : null}
                  </summary>
                  <p className="mt-1 text-[11px] leading-4 text-[var(--ink-muted)]">{t("settingsThinkingAdvancedHint")}</p>
                  <label className="ui-field mt-2">
                    <span className="ui-field-label">{t("settingsThinkingStyle")}</span>
                    <select
                      disabled={ro}
                      value={draft.thinkingStyle}
                      onChange={(e) => {
                        setDraft((c) => ({ ...c, thinkingStyle: e.target.value }));
                        setLlmSaved(false);
                      }}
                      className={selectCls}
                    >
                      {THINKING_STYLES.map((s) => (
                        <option key={s.id} value={s.id}>
                          {t(s.labelKey)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="mt-1 text-[11px] leading-4 text-[var(--ink-muted)]">{t("settingsThinkingStyleHint")}</p>
                </details>

                <label className="ui-field mt-4">
                  <span className="ui-field-label">{t("settingsMaxTokens")}</span>
                  <input type="text" inputMode="numeric" readOnly={ro} value={draft.llmMaxTokens}
                    onChange={(e) => { setDraft((c) => ({ ...c, llmMaxTokens: e.target.value === "" ? 32768 : Number(e.target.value) })); setLlmSaved(false); }}
                    placeholder="32768" className={fieldCls} />
                </label>
              </>
            );
          })()}

          {llmError ? (
            <p className="mt-3 text-sm text-[var(--danger-text)]" role="alert">
              {llmError}
            </p>
          ) : null}
          {llmSaved && !editing && <p className="mt-3 text-sm text-[var(--success)]">{t("settingsChatSaved")}</p>}

          <div className="mt-5 flex justify-end gap-2">
            {editing ? (
              <>
                <button type="button"
                  onClick={() => { setEditing(false); setLlmError(""); setAvailableModels([]);
                    setDraft((c) => ({ ...c, llmModel: settings.llmModel, llmApiKey: settings.llmApiKey, llmApiBase: settings.llmApiBase, llmMaxTokens: settings.llmMaxTokens, thinkingStyle: settings.thinkingStyle })); }}
                  className="ui-btn text-sm">{t("cancel")}</button>
                <button type="button" onClick={() => void handleSaveLlm()}
                  className="ui-btn ui-btn-primary text-sm">{t("save")}</button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={resettingLlm}
                  onClick={() => setResetConfirmOpen(true)}
                  className="ui-btn ui-btn-danger text-sm disabled:opacity-50"
                >
                  {t("reset")}
                </button>
                <button type="button" onClick={() => { setEditing(true); setLlmSaved(false); setLlmError(""); }}
                  className="ui-btn text-sm">{t("edit")}</button>
              </>
            )}
          </div>
        </section>

        {/* ── Embedding（可选，常驻展开） ── */}
        <section className="rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">{t("settingsEmbedModel")}</h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                {t("settingsEmbedHint")}
              </p>
            </div>
            <span className={`shrink-0 text-xs font-medium ${settings.embeddingModel ? "text-[var(--success)]" : "text-[var(--ink-muted)]"}`}>
              {settings.embeddingModel || t("notConfigured")}
            </span>
          </div>

          {(() => {
            const ro = !editingEmbed;
            const fieldCls = `ui-input w-full ${ro ? "cursor-default bg-[var(--paper)] text-[var(--ink-muted)]" : ""}`;
            const selectCls = `ui-select w-full ${ro ? "cursor-default bg-[var(--paper)] text-[var(--ink-muted)]" : ""}`;
            return (
              <>
                <label className="ui-field mt-4">
                  <span className="ui-field-label">{t("settingsBaseUrlLabel")}</span>
                  <input type="url" readOnly={ro} value={draft.embeddingApiBase}
                    onChange={(e) => { setDraft((c) => ({ ...c, embeddingApiBase: e.target.value })); setEmbedSaved(false); invalidateEmbedModels(); }}
                    placeholder={t("settingsEmbedBasePh")} className={fieldCls} />
                </label>

                <label className="ui-field mt-4">
                  <span className="ui-field-label">{t("settingsApiKeyLabel")}</span>
                  <input type="password" readOnly={ro} value={draft.embeddingApiKey}
                    onChange={(e) => { setDraft((c) => ({ ...c, embeddingApiKey: e.target.value })); setEmbedSaved(false); invalidateEmbedModels(); }}
                    placeholder={t("settingsEmbedKeyPh")} autoComplete="off" className={fieldCls} />
                </label>

                {!ro && (
                  <div className="mt-4 flex items-center gap-2">
                    <button type="button"
                      disabled={embedModelsLoading || (!draft.embeddingApiKey.trim() && !draft.llmApiKey.trim())}
                      onClick={() => void handleLoadEmbedModels()}
                      className="ui-btn text-sm disabled:opacity-50">
                      {embedModelsLoading ? t("loading") : t("settingsLoadModels")}
                    </button>
                    {embedModels.length > 0 && <span className="text-xs text-[var(--ink-muted)]">{embedModels.length} {t("settingsModelsCount")}</span>}
                  </div>
                )}

                <label className="ui-field mt-4">
                  <span className="ui-field-label">{t("settingsEmbedModelLabel")}</span>
                  <select disabled={ro || (embedModels.length === 0 && !draft.embeddingModel)} value={draft.embeddingModel}
                    onChange={(e) => { setDraft((c) => ({ ...c, embeddingModel: e.target.value })); setEmbedSaved(false); }}
                    className={selectCls}>
                    {draft.embeddingModel && !embedModels.includes(draft.embeddingModel) && <option value={draft.embeddingModel}>{draft.embeddingModel}</option>}
                    {embedModels.length === 0 && !draft.embeddingModel && (
                      <option value="">{t("settingsOptLoadModelsFirst")}</option>
                    )}
                    {embedModels.length > 0 && !draft.embeddingModel && (
                      <option value="">{t("settingsOptSelectEmbedModel")}</option>
                    )}
                    {embedModels.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
              </>
            );
          })()}

          {embedError ? (
            <p className="mt-3 text-sm text-[var(--danger-text)]" role="alert">
              {embedError}
            </p>
          ) : null}
          {embedSaved && !editingEmbed && <p className="mt-3 text-sm text-[var(--success)]">{t("settingsEmbedSaved")}</p>}

          <div className="mt-5 flex justify-end gap-2">
            {editingEmbed ? (
              <>
                <button type="button"
                  onClick={() => { setEditingEmbed(false); setEmbedError(""); setEmbedModels([]);
                    setDraft((c) => ({ ...c, embeddingModel: settings.embeddingModel, embeddingApiKey: settings.embeddingApiKey, embeddingApiBase: settings.embeddingApiBase })); }}
                  className="ui-btn text-sm">{t("cancel")}</button>
                <button type="button" onClick={() => void handleSaveEmbed()}
                  className="ui-btn ui-btn-primary text-sm">{t("save")}</button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={resettingEmbed}
                  onClick={() => setResetEmbedConfirmOpen(true)}
                  className="ui-btn ui-btn-danger text-sm disabled:opacity-50"
                >
                  {t("reset")}
                </button>
                <button type="button" onClick={() => { setEditingEmbed(true); setEmbedSaved(false); setEmbedError(""); }}
                  className="ui-btn text-sm">{t("edit")}</button>
              </>
            )}
          </div>
        </section>
        </>) : null}

        {activeTab === "skill" ? <SkillsPanel embedded /> : null}
      </div>

      <ConfirmModal
        open={resetConfirmOpen}
        title={t("settingsResetLlmTitle")}
        message={t("settingsResetLlmMessage")}
        confirmLabel={t("settingsResetConfirm")}
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
        title={t("settingsResetEmbedTitle")}
        message={t("settingsResetEmbedMessage")}
        confirmLabel={t("settingsResetConfirm")}
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
