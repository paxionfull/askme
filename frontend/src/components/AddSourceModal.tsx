import { useState } from "react";
import { useOnboarding } from "../contexts/OnboardingContext";

interface AddSourceModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AddSourceModal({ open, onClose }: AddSourceModalProps) {
  const { job, startOnboarding } = useOnboarding();
  const [siteUrl, setSiteUrl] = useState("");
  const [localError, setLocalError] = useState("");

  if (!open) return null;

  async function handleStart() {
    if (!siteUrl.trim()) {
      setLocalError("请填写网站链接");
      return;
    }
    if (job?.running) {
      setLocalError("已有接入任务在后台运行");
      return;
    }

    setLocalError("");
    const url = siteUrl.trim();
    onClose();
    void startOnboarding(url);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">添加数据源</h2>
          <p className="mt-1 text-xs text-slate-500">
            由 Cursor Agent 分析并编写 skill；知乎/金十走内置模板。进度显示在顶部。
          </p>
        </div>

        <div className="space-y-4 px-5 py-4">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">网站链接</span>
            <input
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="https://example.com 或 example.com/articles"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void handleStart();
                }
              }}
            />
          </label>

          {localError && <p className="text-sm text-red-600">{localError}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!siteUrl.trim()}
            onClick={() => void handleStart()}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
          >
            开始接入
          </button>
        </div>
      </div>
    </div>
  );
}
