import type { ReactNode } from "react";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  extraContent?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  open,
  title,
  message,
  extraContent,
  confirmLabel = "确认",
  cancelLabel = "取消",
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!open) return null;

  return (
    <div className="ui-modal-backdrop ui-modal-backdrop-nested" role="dialog" aria-modal="true">
      <div className="ui-modal ui-modal-sm">
        <div className="ui-modal-header">
          <h2 className="ui-modal-title">{title}</h2>
          <p className="ui-modal-desc whitespace-pre-line">{message}</p>
          {extraContent ? <div className="mt-3">{extraContent}</div> : null}
        </div>
        <div className="ui-modal-footer">
          <button type="button" disabled={loading} onClick={onCancel} className="ui-btn">
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className={`ui-btn ${danger ? "ui-btn-danger-solid" : "ui-btn-primary"}`}
          >
            {loading ? "处理中…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
