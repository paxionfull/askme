import { useState } from "react";

export const REPAIR_ISSUE_OPTIONS = [
  { id: "empty_list", label: "列表为空或文章过少" },
  { id: "empty_body", label: "正文缺失或过短" },
  { id: "wrong_fields", label: "标题/时间/链接字段错误" },
  { id: "pagination", label: "分页或加载更多有问题" },
  { id: "wrong_content", label: "抓到了错误的内容" },
  { id: "other", label: "其他问题" },
] as const;

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
  const [feedback, setFeedback] = useState("");
  const [sampleUrl, setSampleUrl] = useState("");
  const [issueTypes, setIssueTypes] = useState<string[]>([]);
  const [localError, setLocalError] = useState("");

  if (!open) return null;

  function toggleIssue(id: string) {
    setIssueTypes((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function handleSubmit() {
    if (!feedback.trim()) {
      setLocalError("请描述遇到的问题");
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
      className="ui-modal-backdrop ui-modal-backdrop-nested"
      role="dialog"
      aria-modal="true"
      aria-labelledby="skill-repair-title"
    >
      <div className="ui-modal ui-modal-md">
        <div className="ui-modal-header">
          <h2 id="skill-repair-title" className="ui-modal-title">
            反馈并修复
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
            <p className="ui-field-label mb-2">问题类型（可选）</p>
            <div className="flex flex-wrap gap-1.5">
              {REPAIR_ISSUE_OPTIONS.map((option) => {
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
            <span className="ui-field-label">问题描述</span>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={4}
              placeholder="例如：刷新后只有 3 条文章，且正文只有标题没有内容…"
              className="ui-textarea w-full"
            />
          </label>

          <label className="ui-field">
            <span className="ui-field-label">样例文章链接（可选）</span>
            <input
              value={sampleUrl}
              onChange={(e) => setSampleUrl(e.target.value)}
              placeholder="https://…"
              className="ui-input w-full"
            />
          </label>

          {localError ? <p className="text-sm text-red-700">{localError}</p> : null}
        </div>

        <div className="ui-modal-footer">
          <button type="button" disabled={busy} onClick={onClose} className="ui-btn text-xs disabled:opacity-50">
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleSubmit}
            className="ui-btn ui-btn-primary text-xs disabled:opacity-50"
          >
            提交修复
          </button>
        </div>
      </div>
    </div>
  );
}
