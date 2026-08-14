import { useEffect, useRef, useState } from "react";
import {
  cancelCredentialLoginSession,
  fetchCredentialLoginSession,
  saveCredential,
  startCredentialLoginSession,
  type AuthPrecheckItem,
  type LoginSessionStatus,
} from "../api";
import { useLocale } from "../i18n/LocaleContext";
import { formatMessage } from "../i18n/messages";

interface AuthHandoffPanelProps {
  item: AuthPrecheckItem;
  cookieDraft: string;
  onCookieChange: (value: string) => void;
  onSaved: () => void;
  saving?: boolean;
  autoStart?: boolean;
  onAutoStarted?: () => void;
  title?: string;
  onCancel?: () => void;
}

export default function AuthHandoffPanel({
  item,
  cookieDraft,
  onCookieChange,
  onSaved,
  saving = false,
  autoStart = false,
  onAutoStarted,
  title,
  onCancel,
}: AuthHandoffPanelProps) {
  const { t, locale } = useLocale();
  const slot = item.slot || "";
  const [session, setSession] = useState<LoginSessionStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStartedRef = useRef(false);
  const sessionRef = useRef<LoginSessionStatus | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const userCancelledRef = useRef(false);
  const aliveRef = useRef(true);
  const onSavedRef = useRef(onSaved);
  const onAutoStartedRef = useRef(onAutoStarted);

  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  useEffect(() => {
    onAutoStartedRef.current = onAutoStarted;
  }, [onAutoStarted]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    sessionRef.current = session;
    if (session?.session_id) {
      sessionIdRef.current = session.session_id;
    }
  }, [session]);

  useEffect(() => {
    if (!session || session.done) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    pollRef.current = setInterval(() => {
      void fetchCredentialLoginSession(session.session_id)
        .then((next) => {
          if (!aliveRef.current || userCancelledRef.current) return;
          setSession(next);
          if (next.status === "done") {
            onSavedRef.current();
          }
        })
        .catch(() => {
          /* ignore transient poll errors */
        });
    }, 1200);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [session]);

  async function handleOpenLoginWindow() {
    if (!slot) return;
    userCancelledRef.current = false;
    setStarting(true);
    setError("");
    try {
      const started = await startCredentialLoginSession({
        slot,
        login_url: item.login_url || "",
        label: item.slot_label || slot,
        entry_url: item.entry_url,
      });
      sessionIdRef.current = started.session_id;
      if (userCancelledRef.current) {
        void cancelCredentialLoginSession(started.session_id).catch(() => {});
        return;
      }
      if (!aliveRef.current) return;
      setSession(started);
    } catch (err) {
      if (!aliveRef.current || userCancelledRef.current) return;
      setError(err instanceof Error ? err.message : t("authOpenFailed"));
    } finally {
      if (aliveRef.current && !userCancelledRef.current) setStarting(false);
    }
  }

  useEffect(() => {
    if (!autoStart || autoStartedRef.current || !slot) return;
    autoStartedRef.current = true;
    onAutoStartedRef.current?.();
    void handleOpenLoginWindow();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only auto-start once when allowed
  }, [autoStart, slot]);

  async function handleCancelSession() {
    userCancelledRef.current = true;
    const sessionId = sessionIdRef.current || sessionRef.current?.session_id;
    if (!sessionId) {
      setSession(null);
      return;
    }
    try {
      const stopped = await cancelCredentialLoginSession(sessionId);
      if (aliveRef.current) setSession(stopped);
    } catch {
      if (aliveRef.current) setSession(null);
    }
  }

  async function handleCancelAll() {
    await handleCancelSession();
    onCancel?.();
  }

  async function handlePasteSave() {
    if (!slot || !cookieDraft.trim()) {
      setError(t("authPasteFirst"));
      return;
    }
    setError("");
    try {
      await saveCredential({
        slot,
        cookie: cookieDraft.trim(),
        label: item.slot_label || slot,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("groupModalErrSave"));
    }
  }

  const loginUrl = item.login_url || item.entry_url;
  const panelTitle =
    title ||
    formatMessage(locale, "authNeedTitle", {
      label: item.slot_label || item.slot || "",
    });

  return (
    <div className="rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--accent)_35%,var(--border))] bg-[var(--accent-soft)] px-3 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--accent)]">{panelTitle}</p>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            {item.cookie_hint || t("authNeedHint")}
          </p>
          {loginUrl ? (
            <p className="mt-1 truncate text-xs text-[var(--ink-muted)]">
              {t("authLoginPage")}{" "}
              <a href={loginUrl} target="_blank" rel="noreferrer" className="ui-link">
                {loginUrl}
              </a>
            </p>
          ) : null}
        </div>
        {onCancel ? (
          <button
            type="button"
            onClick={() => void handleCancelAll()}
            className="ui-btn shrink-0 text-xs"
          >
            {t("cancel")}
          </button>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={starting || Boolean(session && !session.done)}
          onClick={() => void handleOpenLoginWindow()}
          className="ui-btn ui-btn-primary text-xs"
        >
          {starting
            ? t("authOpenLoading")
            : session && !session.done
              ? t("authWaiting")
              : t("authOpenWindow")}
        </button>
        {session && !session.done ? (
          <button type="button" onClick={() => void handleCancelSession()} className="ui-btn text-xs">
            {t("authCancelWindow")}
          </button>
        ) : null}
      </div>

      {session ? (
        <p
          className={`mt-2 text-xs ${
            session.status === "done"
              ? "text-[var(--success)]"
              : session.status === "error"
                ? "text-[var(--danger-text)]"
                : "text-[var(--accent)]"
          }`}
        >
          {session.message}
          {session.masked ? ` · ${session.masked}` : ""}
        </p>
      ) : null}

      <p className="mt-3 text-xs font-medium text-[var(--ink-muted)]">{t("authPasteLabel")}</p>
      <textarea
        value={cookieDraft}
        onChange={(e) => onCookieChange(e.target.value)}
        rows={3}
        placeholder={t("authPastePlaceholder")}
        className="ui-textarea mt-1 w-full"
      />
      <button
        type="button"
        disabled={saving}
        onClick={() => void handlePasteSave()}
        className="ui-btn ui-btn-accent mt-2 text-xs"
      >
        {saving ? t("saving") : t("authSaveCookie")}
      </button>

      {error ? (
        <p className="mt-2 text-xs text-[var(--danger-text)]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
