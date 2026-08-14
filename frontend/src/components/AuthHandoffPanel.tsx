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
  title,
  onCancel,
}: AuthHandoffPanelProps) {
  const slot = item.slot || "";
  const [session, setSession] = useState<LoginSessionStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [iframeBlocked, setIframeBlocked] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStartedRef = useRef(false);
  const sessionRef = useRef<LoginSessionStatus | null>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

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
          setSession(next);
          if (next.status === "done") {
            onSaved();
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
  }, [session, onSaved]);

  async function handleOpenLoginWindow() {
    if (!slot) return;
    setStarting(true);
    setError("");
    try {
      const started = await startCredentialLoginSession({
        slot,
        login_url: item.login_url || "",
        label: item.slot_label || slot,
        entry_url: item.entry_url,
      });
      setSession(started);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "无法打开登录窗口（可改用下方粘贴 Cookie）",
      );
    } finally {
      setStarting(false);
    }
  }

  useEffect(() => {
    if (!autoStart || autoStartedRef.current || !slot) return;
    autoStartedRef.current = true;
    void handleOpenLoginWindow();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only auto-start once per mount
  }, [autoStart, slot]);

  async function handleCancelSession() {
    const current = sessionRef.current;
    if (!current || current.done) {
      setSession(null);
      return;
    }
    try {
      const stopped = await cancelCredentialLoginSession(current.session_id);
      setSession(stopped);
    } catch {
      setSession(null);
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
              "请在登录窗口完成登录；系统会自动读取 Cookie。若窗口无法打开，可改用粘贴。"}
          </p>
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

      <div className="mt-3 overflow-hidden rounded-[var(--radius-control)] border border-[var(--rule)] bg-[var(--paper-raised)]">
        <div className="flex items-center justify-between border-b border-[var(--rule)] px-2 py-1.5 text-xs text-[var(--ink-muted)]">
          <span className="truncate">{loginUrl}</span>
          <a href={loginUrl} target="_blank" rel="noreferrer" className="ui-link shrink-0 text-xs">
            新标签打开
          </a>
        </div>
        {!iframeBlocked ? (
          <iframe
            title={`${item.slot_label || slot} 登录预览`}
            src={loginUrl}
            className="h-48 w-full bg-[var(--paper-raised)]"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onError={() => setIframeBlocked(true)}
            onLoad={(event) => {
              // 多数站点禁止嵌入；空白/跨域时提示改用系统登录窗
              try {
                void event.currentTarget.contentWindow?.location.href;
              } catch {
                setIframeBlocked(true);
              }
            }}
          />
        ) : (
          <div className="flex h-32 items-center justify-center px-4 text-center text-xs text-[var(--ink-muted)]">
            该站点禁止页面内嵌登录。请点击「打开登录窗口」，在弹出的浏览器中登录，系统会自动读取 Cookie。
          </div>
        )}
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
