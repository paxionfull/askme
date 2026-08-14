import type { ReactNode } from "react";
import { useRef } from "react";
import { useT } from "../i18n/LocaleContext";
import { useModalA11y } from "../hooks/useModalA11y";

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
  confirmLabel,
  cancelLabel,
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const t = useT();
  const resolvedConfirmLabel = confirmLabel ?? t("confirm");
  const resolvedCancelLabel = cancelLabel ?? t("cancel");
  const backdropRef = useRef<HTMLDivElement>(null);
  useModalA11y(open, onCancel, backdropRef);

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      className="ui-modal-backdrop ui-modal-backdrop-nested"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div className="ui-modal ui-modal-sm">
        <div className="ui-modal-header">
          <h2 id="confirm-modal-title" className="ui-modal-title">{title}</h2>
          <p className="ui-modal-desc whitespace-pre-line">{message}</p>
          {extraContent ? <div className="mt-3">{extraContent}</div> : null}
        </div>
        <div className="ui-modal-footer">
          <button type="button" disabled={loading} onClick={onCancel} className="ui-btn">
            {resolvedCancelLabel}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className={`ui-btn ${danger ? "ui-btn-danger-solid" : "ui-btn-primary"}`}
          >
            {loading ? t("loading") : resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
