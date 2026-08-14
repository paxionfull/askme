import { useEffect, useMemo, useState } from "react";
import { ONBOARD_BATCH_MAX_SIZE, parseOnboardUrls, type FeedGroup } from "../api";
import { UNGROUPED_GROUP_ID } from "../utils/feedLayout";
import { useOnboarding } from "../contexts/OnboardingContext";

interface AddSourceModalProps {
  open: boolean;
  onClose: () => void;
  groups: FeedGroup[];
  defaultGroupId?: string;
}

export default function AddSourceModal({
  open,
  onClose,
  groups,
  defaultGroupId = UNGROUPED_GROUP_ID,
}: AddSourceModalProps) {
  const { batch, job, startBatchOnboarding } = useOnboarding();
  const [siteUrls, setSiteUrls] = useState("");
  const [groupId, setGroupId] = useState<string>(defaultGroupId);
  const [localError, setLocalError] = useState("");

  const parsedUrls = useMemo(() => parseOnboardUrls(siteUrls), [siteUrls]);
  const busy = Boolean(batch?.status === "running" || job?.running);

  // 每次打开弹窗时同步默认分组（例如当前选中源所在分组）
  useEffect(() => {
    if (!open) return;
    setGroupId(defaultGroupId || UNGROUPED_GROUP_ID);
    setLocalError("");
  }, [open, defaultGroupId]);

  if (!open) return null;

  async function handleStart() {
    const urls = parseOnboardUrls(siteUrls);
    if (urls.length === 0) {
      setLocalError("请填写至少一个网站链接");
      return;
    }
    if (urls.length > ONBOARD_BATCH_MAX_SIZE) {
      setLocalError(`单次最多 ${ONBOARD_BATCH_MAX_SIZE} 个链接`);
      return;
    }
    if (busy) {
      setLocalError("已有接入或修复任务在后台运行");
      return;
    }

    setLocalError("");
    onClose();
    void startBatchOnboarding(urls, groupId);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">添加数据源</h2>
          <p className="mt-1 text-xs text-slate-500">
            每行一个链接，或用逗号分隔；最多 {ONBOARD_BATCH_MAX_SIZE} 个。后台并行接入，进度显示在顶部。
          </p>
        </div>

        <div className="space-y-4 px-5 py-4">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">添加到分组</span>
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value={UNGROUPED_GROUP_ID}>未分组</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="font-medium text-slate-700">网站链接</span>
            <textarea
              value={siteUrls}
              onChange={(e) => setSiteUrls(e.target.value)}
              rows={6}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder={"https://example.com\nhttps://another.com/articles"}
            />
          </label>

          {parsedUrls.length > 0 && (
            <p className="text-xs text-slate-500">将接入 {parsedUrls.length} 个数据源</p>
          )}

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
            disabled={parsedUrls.length === 0 || busy}
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
