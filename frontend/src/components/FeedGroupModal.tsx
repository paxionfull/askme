import { useEffect, useState } from "react";
import { fetchDigestSkills, type DigestSkillDetail, type Feed, type FeedGroup } from "../api";
import { countUngroupedFeeds } from "../utils/feedLayout";

interface FeedGroupModalProps {
  open: boolean;
  feeds: Feed[];
  groups: FeedGroup[];
  defaultDigestSkill: string;
  onClose: () => void;
  onSave: (groups: FeedGroup[], defaultDigestSkill: string) => Promise<void>;
}

function newGroupId() {
  return `group-${Math.random().toString(36).slice(2, 10)}`;
}

export default function FeedGroupModal({
  open,
  feeds,
  groups,
  defaultDigestSkill,
  onClose,
  onSave,
}: FeedGroupModalProps) {
  const [draftGroups, setDraftGroups] = useState<FeedGroup[]>(groups);
  const [draftDefaultSkill, setDraftDefaultSkill] = useState(defaultDigestSkill);
  const [digestSkills, setDigestSkills] = useState<DigestSkillDetail[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraftGroups(
        groups.map((group) => ({
          ...group,
          feed_ids: [...group.feed_ids],
          digest_skill_id: group.digest_skill_id ?? null,
        })),
      );
      setDraftDefaultSkill(defaultDigestSkill);
      setError("");
      setPendingDeleteId(null);
      void fetchDigestSkills()
        .then((data) => setDigestSkills(data.skills))
        .catch(() => setDigestSkills([]));
    }
  }, [open, groups, defaultDigestSkill]);

  if (!open) return null;

  const ungroupedCount = countUngroupedFeeds(feeds, draftGroups);

  function addGroup() {
    setDraftGroups((current) => [
      ...current,
      { id: newGroupId(), name: "新分组", feed_ids: [], digest_skill_id: draftDefaultSkill },
    ]);
  }

  function removeGroup(groupId: string) {
    setDraftGroups((current) => current.filter((group) => group.id !== groupId));
    setPendingDeleteId(null);
  }

  function updateGroupName(groupId: string, name: string) {
    setDraftGroups((current) =>
      current.map((group) => (group.id === groupId ? { ...group, name } : group)),
    );
  }

  function updateGroupDigestSkill(groupId: string, digestSkillId: string) {
    setDraftGroups((current) =>
      current.map((group) =>
        group.id === groupId ? { ...group, digest_skill_id: digestSkillId || null } : group,
      ),
    );
  }

  async function handleSave() {
    const trimmed = draftGroups
      .map((group) => ({
        ...group,
        name: group.name.trim(),
        feed_ids: [...group.feed_ids],
        digest_skill_id: group.digest_skill_id || null,
      }))
      .filter((group) => group.name);

    if (trimmed.some((group) => !group.name)) {
      setError("分组名称不能为空");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await onSave(trimmed, draftDefaultSkill);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  const pendingDeleteGroup = draftGroups.find((group) => group.id === pendingDeleteId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold">管理分组</h2>
          <p className="mt-1 text-xs text-slate-500">
            每个数据源只能属于一个分组。删除分组后，其下数据源会自动移到「未分组」。
          </p>
        </div>

        <div className="max-h-[55vh] space-y-2 overflow-y-auto px-5 py-4">
          {draftGroups.map((group) => (
            <div key={group.id} className="space-y-2 rounded-lg border border-slate-200 px-3 py-2">
              <div className="flex items-center gap-2">
                <input
                  value={group.name}
                  onChange={(e) => updateGroupName(group.id, e.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-500"
                />
                <span className="shrink-0 text-xs text-slate-500">{group.feed_ids.length} 个源</span>
                <button
                  type="button"
                  onClick={() => setPendingDeleteId(group.id)}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                >
                  删除
                </button>
              </div>
              <select
                value={group.digest_skill_id ?? ""}
                onChange={(e) => updateGroupDigestSkill(group.id, e.target.value)}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
              >
                <option value="">使用未分组默认 skill</option>
                {digestSkills.map((skill) => (
                  <option key={skill.id} value={skill.id}>
                    {skill.name}
                  </option>
                ))}
              </select>
            </div>
          ))}

          <div className="space-y-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 text-sm text-slate-700">未分组</span>
              <span className="shrink-0 text-xs text-slate-500">{ungroupedCount} 个源</span>
              <span className="shrink-0 text-xs text-slate-400">系统分组</span>
            </div>
            <select
              value={draftDefaultSkill}
              onChange={(e) => setDraftDefaultSkill(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
            >
              {digestSkills.map((skill) => (
                <option key={skill.id} value={skill.id}>
                  默认：{skill.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={addGroup}
            className="w-full rounded-md border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
          >
            + 新建分组
          </button>
        </div>

        {error && <p className="px-5 text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>

      {pendingDeleteGroup && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white shadow-xl">
            <div className="px-5 py-4">
              <h3 className="text-sm font-semibold">删除分组</h3>
              <p className="mt-2 text-sm text-slate-600">
                确定删除「{pendingDeleteGroup.name}」？
                {pendingDeleteGroup.feed_ids.length > 0
                  ? ` 其下 ${pendingDeleteGroup.feed_ids.length} 个数据源将移到「未分组」。`
                  : ""}
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button type="button" onClick={() => setPendingDeleteId(null)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
                取消
              </button>
              <button type="button" onClick={() => removeGroup(pendingDeleteGroup.id)} className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700">
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
