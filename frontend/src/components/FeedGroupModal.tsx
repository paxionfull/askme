import { useEffect, useRef, useState } from "react";
import { fetchDigestSkills, type DigestSkillDetail, type Feed, type FeedGroup } from "../api";
import { isPlatformFeed } from "../utils/platformFeed";

interface FeedGroupModalProps {
  open: boolean;
  feeds: Feed[];
  groups: FeedGroup[];
  onClose: () => void;
  onSave: (groups: FeedGroup[]) => Promise<void>;
  onDeleteFeeds?: (feedIds: string[], removeSkill: boolean) => Promise<void>;
}

function newGroupId() {
  return `group-${Math.random().toString(36).slice(2, 10)}`;
}

function skillName(skills: DigestSkillDetail[], id: string | null | undefined) {
  if (!id) return "";
  return skills.find((skill) => skill.id === id)?.name ?? id;
}

function RulePicker({
  skills,
  value,
  onChange,
}: {
  skills: DigestSkillDetail[];
  value: string;
  onChange: (id: string) => void;
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
        <span className="min-w-0 flex-1 truncate font-medium">
          {label || "未设置整理规则"}
        </span>
        <span className="shrink-0 text-[10px] text-[var(--ink-muted)]">{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-[var(--radius-control)] border border-[var(--rule)] bg-[var(--paper-raised)] py-1 shadow-md">
          <button
            type="button"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className={`flex w-full px-3 py-2 text-left text-xs hover:bg-[var(--paper)] ${
              !value ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]" : "text-[var(--ink-muted)]"
            }`}
          >
            不绑定（无法生成简报）
          </button>
          {skills.length === 0 ? (
            <p className="px-3 py-2 text-xs text-[var(--ink-muted)]">暂无可用整理规则</p>
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
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

function normalizeGroups(groups: FeedGroup[]): FeedGroup[] {
  return groups.map((group) => ({
    ...group,
    feed_ids: [...group.feed_ids],
    digest_skill_id: group.digest_skill_id || null,
    auto_refresh: group.auto_refresh !== false,
  }));
}

function ungroupedFeedIds(feeds: Feed[], groups: FeedGroup[]): string[] {
  const groupedIds = new Set(groups.flatMap((group) => group.feed_ids));
  return feeds.filter((feed) => !groupedIds.has(feed.id)).map((feed) => feed.id);
}

export default function FeedGroupModal({
  open,
  feeds,
  groups,
  onClose,
  onSave,
  onDeleteFeeds,
}: FeedGroupModalProps) {
  const [draftGroups, setDraftGroups] = useState<FeedGroup[]>(groups);
  const [digestSkills, setDigestSkills] = useState<DigestSkillDetail[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [clearingUngrouped, setClearingUngrouped] = useState(false);
  const [pendingClearUngrouped, setPendingClearUngrouped] = useState(false);
  const [clearUngroupedRemoveSkill, setClearUngroupedRemoveSkill] = useState(false);
  const [pendingDeleteGroup, setPendingDeleteGroup] = useState<FeedGroup | null>(null);
  const [deleteGroupRemoveSkill, setDeleteGroupRemoveSkill] = useState(false);
  const focusNewRef = useRef(false);
  const lastInputRef = useRef<HTMLInputElement | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    // 仅在打开瞬间同步；打开期间父级因删源回写 groups 时不要覆盖草稿（否则删掉的分组会回来）
    if (!wasOpenRef.current) {
      setDraftGroups(normalizeGroups(groups));
      setError("");
      setDeletingGroupId(null);
      setPendingClearUngrouped(false);
      setClearUngroupedRemoveSkill(false);
      setClearingUngrouped(false);
      setPendingDeleteGroup(null);
      setDeleteGroupRemoveSkill(false);
      focusNewRef.current = false;
      void fetchDigestSkills()
        .then((data) => setDigestSkills(data.skills))
        .catch(() => setDigestSkills([]));
    }
    wasOpenRef.current = true;
  }, [open, groups]);

  useEffect(() => {
    if (!focusNewRef.current) return;
    focusNewRef.current = false;
    lastInputRef.current?.focus();
    lastInputRef.current?.select();
  }, [draftGroups.length]);

  if (!open) return null;

  const ungroupedIds = ungroupedFeedIds(feeds, draftGroups);
  const ungroupedCount = ungroupedIds.length;
  const ungroupedFeeds = feeds.filter((feed) => ungroupedIds.includes(feed.id));
  const ungroupedAllPlatform =
    ungroupedFeeds.length > 0 && ungroupedFeeds.every((feed) => isPlatformFeed(feed));
  const deletingGroup = deletingGroupId !== null;

  function addGroup() {
    focusNewRef.current = true;
    setPendingClearUngrouped(false);
    setPendingDeleteGroup(null);
    setDraftGroups((current) => [
      ...current,
      {
        id: newGroupId(),
        name: "新分组",
        feed_ids: [],
        digest_skill_id: null,
        auto_refresh: false,
      },
    ]);
  }

  async function persistGroups(nextGroups: FeedGroup[]) {
    const trimmed = nextGroups.map((group) => ({
      ...group,
      name: group.name.trim(),
      feed_ids: [...group.feed_ids],
      digest_skill_id: group.digest_skill_id || null,
      auto_refresh: group.auto_refresh !== false,
    }));
    await onSave(trimmed);
    setDraftGroups(normalizeGroups(trimmed));
  }

  function requestRemoveGroup(group: FeedGroup) {
    setPendingClearUngrouped(false);
    // 新建未保存的分组：只从草稿移除
    if (!groups.some((item) => item.id === group.id)) {
      setDraftGroups((current) => current.filter((item) => item.id !== group.id));
      return;
    }
    setDeleteGroupRemoveSkill(false);
    setPendingDeleteGroup(group);
  }

  async function confirmRemoveGroup() {
    if (!pendingDeleteGroup) return;

    const previousDraft = draftGroups;
    const group = pendingDeleteGroup;
    const feedIds = [...group.feed_ids];
    setDeletingGroupId(group.id);
    setError("");
    try {
      if (feedIds.length > 0) {
        if (!onDeleteFeeds) {
          setError("无法删除组内数据源");
          return;
        }
        await onDeleteFeeds(feedIds, deleteGroupRemoveSkill);
      }
      const nextPersisted = groups
        .filter((item) => item.id !== group.id)
        .map((item) => ({
          ...item,
          name: item.name.trim(),
          feed_ids: [...item.feed_ids].filter((id) => !feedIds.includes(id)),
          digest_skill_id: item.digest_skill_id || null,
          auto_refresh: item.auto_refresh !== false,
        }));
      await onSave(nextPersisted);
      setDraftGroups((current) => current.filter((item) => item.id !== group.id));
      setPendingDeleteGroup(null);
      setDeleteGroupRemoveSkill(false);
    } catch (err) {
      setDraftGroups(previousDraft);
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeletingGroupId(null);
    }
  }

  async function confirmClearUngrouped() {
    if (ungroupedIds.length === 0) {
      setPendingClearUngrouped(false);
      return;
    }
    if (!onDeleteFeeds) {
      setError("无法清空未分组源");
      return;
    }
    setClearingUngrouped(true);
    setError("");
    try {
      await onDeleteFeeds(ungroupedIds, clearUngroupedRemoveSkill);
      setPendingClearUngrouped(false);
      setClearUngroupedRemoveSkill(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "清空未分组失败");
    } finally {
      setClearingUngrouped(false);
    }
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

    setSaving(true);
    setError("");
    try {
      await persistGroups(draftGroups);
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
                const removing = deletingGroupId === group.id;
                return (
                  <li
                    key={group.id}
                    className="rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[color-mix(in_srgb,var(--paper)_45%,var(--paper-raised))] px-3 py-2.5"
                  >
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
                        disabled={removing}
                        className="min-w-0 flex-1 border-0 border-b border-transparent bg-transparent px-0 py-0.5 text-sm font-semibold tracking-tight text-[var(--ink)] outline-none placeholder:font-normal placeholder:text-[var(--ink-muted)] focus:border-[var(--rule)] disabled:opacity-60"
                      />
                      <span className="shrink-0 text-[11px] tabular-nums text-[var(--ink-muted)]">
                        {group.feed_ids.length} 源
                      </span>
                      <button
                        type="button"
                        disabled={deletingGroup || Boolean(pendingDeleteGroup)}
                        onClick={() => requestRemoveGroup(group)}
                        aria-label={`删除 ${group.name || "分组"}`}
                        className="shrink-0 rounded px-1.5 py-0.5 text-sm leading-none text-[var(--ink-muted)] hover:bg-[var(--error-soft)] hover:text-red-800 disabled:opacity-50"
                      >
                        {removing ? "…" : "×"}
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-2 pl-5">
                      <span className="shrink-0 text-[10px] font-medium tracking-wide text-[var(--ink-muted)]">
                        整理规则
                      </span>
                      <RulePicker
                        skills={digestSkills}
                        value={group.digest_skill_id ?? ""}
                        onChange={(id) => updateGroupDigestSkill(group.id, id)}
                      />
                    </div>
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

          <div className="mt-3 border-t border-[var(--rule)] pt-3">
            {pendingDeleteGroup ? (
              <div className="mb-3 space-y-2 rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[color-mix(in_srgb,var(--paper)_45%,var(--paper-raised))] px-3 py-2.5">
                <p className="text-xs text-[var(--ink-muted)] whitespace-pre-line">
                  {pendingDeleteGroup.feed_ids.length === 0
                    ? `确定删除分组「${pendingDeleteGroup.name}」？该分组下没有数据源。`
                    : `确定删除分组「${pendingDeleteGroup.name}」？将同时删除组内 ${pendingDeleteGroup.feed_ids.length} 个数据源（不会移到「未分组」）。默认保留本地 discovery skill。`}
                </p>
                {pendingDeleteGroup.feed_ids.length > 0 ? (
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--ink-muted)]">
                    <input
                      type="checkbox"
                      checked={deleteGroupRemoveSkill}
                      disabled={deletingGroup}
                      onChange={(e) => setDeleteGroupRemoveSkill(e.target.checked)}
                    />
                    {pendingDeleteGroup.feed_ids.every((id) =>
                      isPlatformFeed(feeds.find((feed) => feed.id === id)),
                    )
                      ? "同时移除平台账号登记（不删除共享平台 skill）"
                      : `同时删除这 ${pendingDeleteGroup.feed_ids.length} 个源的本地 skill 目录（不可恢复）`}
                  </label>
                ) : null}
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    disabled={deletingGroup}
                    onClick={() => {
                      setPendingDeleteGroup(null);
                      setDeleteGroupRemoveSkill(false);
                    }}
                    className="ui-btn px-2 py-1 text-xs"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={deletingGroup}
                    onClick={() => void confirmRemoveGroup()}
                    className="ui-btn ui-btn-danger-solid px-2 py-1 text-xs"
                  >
                    {deletingGroup ? "删除中…" : "确认删除"}
                  </button>
                </div>
              </div>
            ) : null}
            {pendingClearUngrouped ? (
              <div className="space-y-2 rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[color-mix(in_srgb,var(--paper)_45%,var(--paper-raised))] px-3 py-2.5">
                <p className="text-xs text-[var(--ink-muted)]">
                  清空未分组的 {ungroupedCount} 个源？此操作不会删除任何已命名分组。
                </p>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--ink-muted)]">
                  <input
                    type="checkbox"
                    checked={clearUngroupedRemoveSkill}
                    disabled={clearingUngrouped}
                    onChange={(e) => setClearUngroupedRemoveSkill(e.target.checked)}
                  />
                  {ungroupedAllPlatform
                    ? "同时移除平台账号登记（不删除共享平台 skill）"
                    : "同时删除源的本地 skill 目录（不可恢复）"}
                </label>
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    disabled={clearingUngrouped}
                    onClick={() => {
                      setPendingClearUngrouped(false);
                      setClearUngroupedRemoveSkill(false);
                    }}
                    className="ui-btn px-2 py-1 text-xs"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={clearingUngrouped}
                    onClick={() => void confirmClearUngrouped()}
                    className="ui-btn ui-btn-danger-solid px-2 py-1 text-xs"
                  >
                    {clearingUngrouped ? "清空中…" : "清空"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-xs text-[var(--ink-muted)]">未分组</span>
                <span className="shrink-0 text-[11px] tabular-nums text-[var(--ink-muted)]">
                  {ungroupedCount} 源
                </span>
                <span className="h-px flex-1 bg-[var(--rule)]" />
                {ungroupedCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPendingDeleteGroup(null);
                      setPendingClearUngrouped(true);
                      setClearUngroupedRemoveSkill(false);
                    }}
                    className="shrink-0 rounded px-1.5 py-0.5 text-xs text-[var(--ink-muted)] hover:bg-[var(--error-soft)] hover:text-red-800"
                  >
                    清空
                  </button>
                ) : null}
              </div>
            )}
          </div>

          {error ? <p className="pt-2 text-sm text-red-800">{error}</p> : null}
        </div>

        <div className="ui-modal-footer">
          <button type="button" onClick={onClose} className="ui-btn">
            取消
          </button>
          <button
            type="button"
            disabled={saving || deletingGroup || clearingUngrouped}
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
