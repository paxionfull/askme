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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">反馈并修复 Skill</h2>
          <p className="mt-1 text-xs text-slate-500">
            {skillName}（{skillId}）· 由 Cursor Agent 根据反馈修改 discover.py 并自动验证
          </p>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">问题类型（可选）</p>
            <div className="flex flex-wrap gap-2">
              {REPAIR_ISSUE_OPTIONS.map((option) => (
                <label
                  key={option.id}
                  className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs ${
                    issueTypes.includes(option.id)
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={issueTypes.includes(option.id)}
                    onChange={() => toggleIssue(option.id)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>

          <label className="block text-sm">
            <span className="font-medium text-slate-700">问题描述</span>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={4}
              placeholder="例如：刷新后只有 3 条文章，且正文只有标题没有内容…"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-sm">
            <span className="font-medium text-slate-700">样例文章链接（可选）</span>
            <input
              value={sampleUrl}
              onChange={(e) => setSampleUrl(e.target.value)}
              placeholder="https://..."
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          {localError && <p className="text-sm text-red-600">{localError}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleSubmit}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
          >
            提交修复
          </button>
        </div>
      </div>
    </div>
  );
}
