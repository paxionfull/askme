import { useEffect, useRef, useState } from "react";
import {
  cancelCredentialLoginSession,
  fetchCredentialLoginSession,
  saveCredential,
  startCredentialLoginSession,
  type AuthPrecheckItem,
  type LoginSessionStatus,
} from "../api";

interface AuthHandoffPanelProps {
  item: AuthPrecheckItem;
  cookieDraft: string;
  onCookieChange: (value: string) => void;
  onSaved: () => void;
  saving?: boolean;
  /** 挂载后自动打开系统登录窗口（用于授权失效后立刻重登） */
  autoStart?: boolean;
  /** 自动打开登录窗后回调（父级可据此避免切 tab 回来再次打开） */
  onAutoStarted?: () => void;
  /** 覆盖默认标题 */
  title?: string;
  /** 提供后显示「取消」：关闭登录会话并回调（如收起重新授权面板） */
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
        // 启动过程中点了取消：关掉刚弹出的扫码窗
        void cancelCredentialLoginSession(started.session_id).catch(() => {});
        return;
      }
      if (!aliveRef.current) return;
      setSession(started);
    } catch (err) {
      if (!aliveRef.current || userCancelledRef.current) return;
      setError(
        err instanceof Error
          ? err.message
          : "无法打开登录窗口（可改用下方粘贴 Cookie）",
      );
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
      setError("请先粘贴 Cookie");
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
      setError(err instanceof Error ? err.message : "保存失败");
    }
  }

  const loginUrl = item.login_url || item.entry_url;

  return (
    <div className="border-l-2 border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--accent)]">
            {title || `需要登录授权：${item.slot_label || item.slot}`}
          </p>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            {item.cookie_hint ||
              "请点击下方按钮在弹出窗口中完成登录，系统会自动读取 Cookie；也可手动粘贴。"}
          </p>
          {loginUrl ? (
            <p className="mt-1 truncate text-xs text-[var(--ink-muted)]">
              登录页：{" "}
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
            取消
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
            ? "正在打开…"
            : session && !session.done
              ? "等待登录中…"
              : "打开登录窗口（自动读 Cookie）"}
        </button>
        {session && !session.done ? (
          <button type="button" onClick={() => void handleCancelSession()} className="ui-btn text-xs">
            取消窗口
          </button>
        ) : null}
      </div>

      {session ? (
        <p
          className={`mt-2 text-xs ${
            session.status === "done"
              ? "text-[var(--success)]"
              : session.status === "error"
                ? "text-red-700"
                : "text-[var(--accent)]"
          }`}
        >
          {session.message}
          {session.masked ? ` · ${session.masked}` : ""}
        </p>
      ) : null}

      <p className="mt-3 text-xs font-medium text-[var(--ink-muted)]">或手动粘贴 Cookie</p>
      <textarea
        value={cookieDraft}
        onChange={(e) => onCookieChange(e.target.value)}
        rows={3}
        placeholder="粘贴完整 Cookie…"
        className="ui-textarea mt-1 w-full"
      />
      <button
        type="button"
        disabled={saving}
        onClick={() => void handlePasteSave()}
        className="ui-btn ui-btn-accent mt-2 text-xs"
      >
        {saving ? "保存中…" : "保存粘贴的 Cookie"}
      </button>

      {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
