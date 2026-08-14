import { useEffect, useRef, useState } from "react";
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

function skillName(skills: DigestSkillDetail[], id: string | null | undefined) {
  if (!id) return "";
  return skills.find((skill) => skill.id === id)?.name ?? id;
}

function SkillPicker({
  skills,
  value,
  onChange,
  placeholder = "选择概览 Skill",
}: {
  skills: DigestSkillDetail[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const label = skillName(skills, value);
  const missing = !value;

  useEffect(() => {
    if (!open) return;
    function handleClick(event: MouseEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`flex w-full items-center gap-2 rounded-[var(--radius-control)] border px-2.5 py-1.5 text-left text-xs transition-colors ${
          missing
            ? "border-[color-mix(in_srgb,var(--accent)_40%,var(--rule))] bg-[var(--accent-soft)] text-[var(--accent)]"
            : "border-[var(--rule)] bg-[var(--paper)] text-[var(--ink)] hover:border-[color-mix(in_srgb,var(--ink)_18%,var(--rule))]"
        }`}
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            missing ? "bg-[var(--accent)]" : "bg-[var(--success)]"
          }`}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate font-medium">{label || placeholder}</span>
        <span className="shrink-0 text-[10px] text-[var(--ink-muted)]">{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-[var(--radius-control)] border border-[var(--rule)] bg-[var(--paper-raised)] py-1 shadow-md">
          {skills.length === 0 ? (
            <p className="px-3 py-2 text-xs text-[var(--ink-muted)]">暂无可用 Skill</p>
          ) : (
            skills.map((skill) => {
              const active = skill.id === value;
              return (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => {
                    onChange(skill.id);
                    setOpen(false);
                  }}
                  className={`flex w-full flex-col px-3 py-2 text-left hover:bg-[var(--paper)] ${
                    active ? "bg-[var(--accent-soft)]" : ""
                  }`}
                >
                  <span className="text-xs font-medium text-[var(--ink)]">{skill.name}</span>
                  {skill.description ? (
                    <span className="mt-0.5 line-clamp-1 text-[10px] text-[var(--ink-muted)]">
                      {skill.description}
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
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
  const focusNewRef = useRef(false);
  const lastInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setDraftGroups(
        groups.map((group) => ({
          ...group,
          feed_ids: [...group.feed_ids],
          digest_skill_id: group.digest_skill_id || defaultDigestSkill || null,
        })),
      );
      setDraftDefaultSkill(defaultDigestSkill);
      setError("");
      setPendingDeleteId(null);
      focusNewRef.current = false;
      void fetchDigestSkills()
        .then((data) => setDigestSkills(data.skills))
        .catch(() => setDigestSkills([]));
    }
  }, [open, groups, defaultDigestSkill]);

  useEffect(() => {
    if (!focusNewRef.current) return;
    focusNewRef.current = false;
    lastInputRef.current?.focus();
    lastInputRef.current?.select();
  }, [draftGroups.length]);

  if (!open) return null;

  const ungroupedCount = countUngroupedFeeds(feeds, draftGroups);

  function addGroup() {
    focusNewRef.current = true;
    setPendingDeleteId(null);
    setDraftGroups((current) => [
      ...current,
      {
        id: newGroupId(),
        name: "新分组",
        feed_ids: [],
        digest_skill_id: draftDefaultSkill || digestSkills[0]?.id || null,
      },
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
    if (draftGroups.some((group) => !group.name.trim())) {
      setError("分组名称不能为空");
      return;
    }
    if (draftGroups.some((group) => !group.digest_skill_id)) {
      setError("每组都需要选择一个概览 Skill");
      return;
    }

    const trimmed = draftGroups.map((group) => ({
      ...group,
      name: group.name.trim(),
      feed_ids: [...group.feed_ids],
      digest_skill_id: group.digest_skill_id || null,
    }));

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

  return (
    <div className="ui-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="feed-group-title">
      <div className="ui-modal ui-modal-md">
        <div className="ui-modal-header">
          <h2 id="feed-group-title" className="ui-modal-title">
            管理分组
          </h2>
          <p className="ui-modal-desc">每个分组绑定自己的概览 Skill。</p>
        </div>

        <div className="ui-modal-body space-y-1">
          {draftGroups.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-center">
              <p className="text-sm text-[var(--ink-muted)]">还没有分组</p>
              <button type="button" onClick={addGroup} className="ui-btn ui-btn-accent mt-4">
                新建分组
              </button>
            </div>
          ) : (
            <ul className="space-y-2">
              {draftGroups.map((group, index) => {
                const isLast = index === draftGroups.length - 1;
                const confirming = pendingDeleteId === group.id;
                return (
                  <li
                    key={group.id}
                    className="rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[color-mix(in_srgb,var(--paper)_45%,var(--paper-raised))] px-3 py-2.5"
                  >
                    {confirming ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="min-w-0 flex-1 text-xs text-[var(--ink-muted)]">
                          删除「{group.name || "未命名"}」
                          {group.feed_ids.length > 0
                            ? `，${group.feed_ids.length} 个源将回到未分组`
                            : ""}
                          ？
                        </p>
                        <button
                          type="button"
                          onClick={() => setPendingDeleteId(null)}
                          className="ui-btn px-2 py-1 text-xs"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={() => removeGroup(group.id)}
                          className="ui-btn ui-btn-danger-solid px-2 py-1 text-xs"
                        >
                          删除
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <span
                            className="w-5 shrink-0 text-center text-[11px] tabular-nums text-[var(--ink-muted)]"
                            aria-hidden
                          >
                            {index + 1}
                          </span>
                          <input
                            ref={isLast ? lastInputRef : undefined}
                            value={group.name}
                            onChange={(e) => updateGroupName(group.id, e.target.value)}
                            placeholder="分组名称"
                            aria-label="分组名称"
                            className="min-w-0 flex-1 border-0 border-b border-transparent bg-transparent px-0 py-0.5 text-sm font-semibold tracking-tight text-[var(--ink)] outline-none placeholder:font-normal placeholder:text-[var(--ink-muted)] focus:border-[var(--rule)]"
                          />
                          <span className="shrink-0 text-[11px] tabular-nums text-[var(--ink-muted)]">
                            {group.feed_ids.length} 源
                          </span>
                          <button
                            type="button"
                            onClick={() => setPendingDeleteId(group.id)}
                            aria-label={`删除 ${group.name || "分组"}`}
                            className="shrink-0 rounded px-1.5 py-0.5 text-sm leading-none text-[var(--ink-muted)] hover:bg-[var(--error-soft)] hover:text-red-800"
                          >
                            ×
                          </button>
                        </div>
                        <div className="mt-2 flex items-center gap-2 pl-5">
                          <span className="shrink-0 text-[10px] font-medium tracking-wide text-[var(--ink-muted)]">
                            Skill
                          </span>
                          <SkillPicker
                            skills={digestSkills}
                            value={group.digest_skill_id ?? ""}
                            onChange={(id) => updateGroupDigestSkill(group.id, id)}
                          />
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {draftGroups.length > 0 ? (
            <button
              type="button"
              onClick={addGroup}
              className="mt-2 w-full rounded-[var(--radius-control)] border border-dashed border-[var(--rule)] py-2 text-xs text-[var(--ink-muted)] hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--rule))] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
            >
              + 新建分组
            </button>
          ) : null}

          <div className="mt-3 flex items-center gap-2 border-t border-[var(--rule)] pt-3">
            <span className="shrink-0 text-xs text-[var(--ink-muted)]">未分组</span>
            <span className="shrink-0 text-[11px] tabular-nums text-[var(--ink-muted)]">
              {ungroupedCount} 源
            </span>
            <span className="h-px flex-1 bg-[var(--rule)]" />
            <span className="shrink-0 text-[10px] font-medium tracking-wide text-[var(--ink-muted)]">
              Skill
            </span>
            <div className="w-[11.5rem] shrink-0">
              <SkillPicker
                skills={digestSkills}
                value={draftDefaultSkill}
                onChange={setDraftDefaultSkill}
                placeholder="默认 Skill"
              />
            </div>
          </div>

          {error ? <p className="pt-2 text-sm text-red-800">{error}</p> : null}
        </div>

        <div className="ui-modal-footer">
          <button type="button" onClick={onClose} className="ui-btn">
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="ui-btn ui-btn-primary"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
