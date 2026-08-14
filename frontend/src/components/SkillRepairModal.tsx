import { useMemo, useRef, useState } from "react";
import { useLocale } from "../i18n/LocaleContext";
import type { MessageKey } from "../i18n/messages";
import { useModalA11y } from "../hooks/useModalA11y";

const REPAIR_ISSUE_KEYS: Array<{ id: string; labelKey: MessageKey }> = [
  { id: "empty_list", labelKey: "skillRepairIssueEmpty" },
  { id: "empty_body", labelKey: "skillRepairIssueBody" },
  { id: "wrong_fields", labelKey: "skillRepairIssueFields" },
  { id: "pagination", labelKey: "skillRepairIssuePagination" },
  { id: "wrong_content", labelKey: "skillRepairIssueContent" },
  { id: "other", labelKey: "skillRepairIssueOther" },
];

export const REPAIR_ISSUE_OPTIONS = REPAIR_ISSUE_KEYS;

interface SkillRepairModalProps {
  open: boolean;
  skillName: string;
  skillId: string;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    feedback: string;
    issueTypes: string[];
    sampleUrl: string;
  }) => void;
}

export default function SkillRepairModal({
  open,
  skillName,
  skillId,
  busy = false,
  onClose,
  onSubmit,
}: SkillRepairModalProps) {
  const { t } = useLocale();
  const issueOptions = useMemo(
    () => REPAIR_ISSUE_KEYS.map((option) => ({ id: option.id, label: t(option.labelKey) })),
    [t],
  );
  const [feedback, setFeedback] = useState("");
  const [sampleUrl, setSampleUrl] = useState("");
  const [issueTypes, setIssueTypes] = useState<string[]>([]);
  const [localError, setLocalError] = useState("");
  const backdropRef = useRef<HTMLDivElement>(null);
  useModalA11y(open, onClose, backdropRef);

  if (!open) return null;

  function toggleIssue(id: string) {
    setIssueTypes((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function handleSubmit() {
    if (!feedback.trim()) {
      setLocalError(t("skillRepairErrDesc"));
      return;
    }
    setLocalError("");
    onSubmit({
      feedback: feedback.trim(),
      issueTypes,
      sampleUrl: sampleUrl.trim(),
    });
  }

  return (
    <div
      ref={backdropRef}
      className="ui-modal-backdrop ui-modal-backdrop-nested"
      role="dialog"
      aria-modal="true"
      aria-labelledby="skill-repair-title"
    >
      <div className="ui-modal ui-modal-md">
        <div className="ui-modal-header">
          <h2 id="skill-repair-title" className="ui-modal-title">
            {t("skillRepairTitle")}
            {skillName ? (
              <span className="ml-2 text-xs font-normal text-[var(--ink-muted)]">
                {skillName}
                {skillId && skillId !== skillName ? ` · ${skillId}` : ""}
              </span>
            ) : null}
          </h2>
        </div>

        <div className="ui-modal-body space-y-4">
          <div>
            <p className="ui-field-label mb-2">{t("skillRepairIssueLabel")}</p>
            <div className="flex flex-wrap gap-1.5">
              {issueOptions.map((option) => {
                const selected = issueTypes.includes(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => toggleIssue(option.id)}
                    className={`rounded-[var(--radius-control)] border px-2.5 py-1 text-xs transition-colors ${
                      selected
                        ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper-raised)]"
                        : "border-[var(--rule)] text-[var(--ink-muted)] hover:bg-[var(--paper)]"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="ui-field">
            <span className="ui-field-label">{t("skillRepairDescLabel")}</span>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={4}
              placeholder={t("skillRepairDescPh")}
              className="ui-textarea w-full"
            />
          </label>

          <label className="ui-field">
            <span className="ui-field-label">{t("skillRepairSampleLabel")}</span>
            <input
              value={sampleUrl}
              onChange={(e) => setSampleUrl(e.target.value)}
              placeholder="https://…"
              className="ui-input w-full"
            />
          </label>

          {localError ? (
            <p className="text-sm text-[var(--danger-text)]" role="alert">
              {localError}
            </p>
          ) : null}
        </div>

        <div className="ui-modal-footer">
          <button type="button" disabled={busy} onClick={onClose} className="ui-btn text-xs disabled:opacity-50">
            {t("cancel")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleSubmit}
            className="ui-btn ui-btn-primary text-xs disabled:opacity-50"
          >
            {t("skillRepairSubmit")}
          </button>
        </div>
      </div>
    </div>
  );
}
