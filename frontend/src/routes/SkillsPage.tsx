import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import ConfirmModal from "../components/ConfirmModal";
import DigestProfileModal from "../components/DigestProfileModal";
import SkillDetailModal from "../components/SkillDetailModal";
import SkillMarkdownModal from "../components/SkillMarkdownModal";
import SkillRepairModal from "../components/SkillRepairModal";
import { useOnboarding } from "../contexts/OnboardingContext";
import {
  createDigestSkill,
  deleteDigestSkill,
  deleteDiscoverySkill,
  deleteOtherSkill,
  downloadBlob,
  exportDiscoverySkills,
  fetchChatSkill,
  fetchDigestSkillDetail,
  fetchDiscoverySkillDetail,
  fetchFeeds,
  fetchOtherSkillDetail,
  fetchSkillsCatalog,
  restoreDigestSkill,
  saveChatSkill,
  saveDigestSkill,
  type DigestProfile,
  type Feed,
  type FeedGroup,
  type SkillDetail,
  type SkillItem,
  type SkillsCatalog,
} from "../api";
import { defaultDigestProfile } from "../utils/digestProfile";
import { UNGROUPED_GROUP_ID } from "../utils/feedLayout";

const DISCOVERY_ROW_HEIGHT = 44;
const DISCOVERY_LIST_MAX_HEIGHT = 360;
const PLATFORM_SKILL_IDS = new Set(["x-platform", "zhihu-platform", "reddit-platform"]);

function isExportableDiscovery(skill: SkillItem) {
  return !PLATFORM_SKILL_IDS.has(skill.id) && !skill.id.endsWith("-platform");
}

function buildFeedIdToDiscoverySkillId(skills: SkillItem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const skill of skills) {
    if (!isExportableDiscovery(skill)) continue;
    map.set(skill.id, skill.id);
    if (skill.feed_id) map.set(skill.feed_id, skill.id);
    map.set(`website:${skill.id}`, skill.id);
    map.set(`${skill.id}-discovery`, skill.id);
  }
  return map;
}

function feedIdsForGroup(groupId: string, groups: FeedGroup[], feeds: Feed[]): string[] {
  const groupedFeedIds = new Set(groups.flatMap((group) => group.feed_ids));
  if (groupId === UNGROUPED_GROUP_ID) {
    return feeds.filter((feed) => !groupedFeedIds.has(feed.id)).map((feed) => feed.id);
  }
  return groups.find((group) => group.id === groupId)?.feed_ids ?? [];
}

function exportableSkillIdsForGroup(
  groupId: string,
  groups: FeedGroup[],
  feeds: Feed[],
  feedToSkillId: Map<string, string>,
  exportableSkillIds: Set<string>,
): string[] {
  const feedIds = feedIdsForGroup(groupId, groups, feeds);

  const skillIds = new Set<string>();
  for (const feedId of feedIds) {
    const skillId = feedToSkillId.get(feedId);
    if (skillId && exportableSkillIds.has(skillId)) skillIds.add(skillId);
  }
  return [...skillIds];
}

function platformFeedIdsForGroup(groupId: string, groups: FeedGroup[], feeds: Feed[]): string[] {
  const feedIds = feedIdsForGroup(groupId, groups, feeds);
  const feedMap = new Map(feeds.map((feed) => [feed.id, feed]));
  return feedIds.filter((feedId) => Boolean(feedMap.get(feedId)?.platform_account));
}

function groupExportChipLabel(
  groupName: string,
  skillCount: number,
  platformCount: number,
): string {
  if (skillCount > 0 && platformCount > 0) {
    return `${groupName} · ${skillCount}+${platformCount}`;
  }
  return `${groupName} · ${skillCount + platformCount}`;
}

function newDigestSkillId() {
  return `custom-${Math.random().toString(36).slice(2, 8)}-digest`;
}

function SkillMetaBadges({
  skill,
  usageLabel,
}: {
  skill: SkillItem;
  usageLabel?: string;
}) {
  return (
    <span className="mt-1 flex flex-wrap gap-1.5">
      {skill.builtin ? (
        <span className="text-[11px] text-[var(--ink-muted)]">内置</span>
      ) : null}
      {skill.has_profile ? (
        <span className="text-[11px] text-[var(--success)]">结构化</span>
      ) : null}
      {usageLabel ? (
        <span className="text-[11px] text-[var(--ink-muted)]">{usageLabel}</span>
      ) : null}
    </span>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
      <path
        d="M4 7h16M9 7V5h6v2M10 11v6M14 11v6M6 7l1 12h10l1-12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SkillActionButton({
  title,
  danger = false,
  disabled = false,
  onClick,
  children,
}: {
  title: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-control)] p-0 transition ${
        danger
          ? "text-[var(--ink-muted)] hover:bg-[var(--error-soft)] hover:text-red-800"
          : "text-[var(--ink-muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
      } disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-[var(--ink-muted)]`}
    >
      {children}
    </button>
  );
}

function DigestRuleRow({
  skill,
  onEdit,
  onDelete,
  onRestore,
}: {
  skill: SkillItem;
  onEdit: () => void;
  onDelete: () => void;
  onRestore: () => void;
}) {
  const displayName = skill.name?.trim() || skill.id;
  return (
    <li className="flex items-start justify-between gap-3 border-b border-[var(--rule)] py-3 first:border-t first:border-[var(--rule)] last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--ink)]">
          {displayName}
          <span className="ml-2 font-mono text-[11px] font-normal text-[var(--ink-muted)]">{skill.id}</span>
        </p>
        <SkillMetaBadges skill={skill} />
        {skill.description ? (
          <p className="mt-1 text-xs leading-relaxed text-[var(--ink-muted)]">{skill.description}</p>
        ) : null}
      </div>
      <div className="shrink-0">
        <div className="flex items-center gap-0.5">
          <SkillActionButton title={`查看 ${displayName}`} onClick={onEdit}>
            <EyeIcon />
          </SkillActionButton>
        {skill.builtin ? (
            <SkillActionButton title={`还原 ${displayName}`} onClick={onRestore}>
              ↺
            </SkillActionButton>
        ) : (
            <SkillActionButton title={`删除 ${displayName}`} danger onClick={onDelete}>
              <TrashIcon />
            </SkillActionButton>
        )}
        </div>
      </div>
    </li>
  );
}

function DiscoverySkillRow({
  skill,
  onView,
  onDelete,
  exportMode = false,
  exportChecked = false,
  onToggleExport,
}: {
  skill: SkillItem;
  onView: () => void;
  onDelete: () => void;
  exportMode?: boolean;
  exportChecked?: boolean;
  onToggleExport?: (checked: boolean) => void;
}) {
  const displayName = skill.name?.trim() || skill.id;
  const exportable = isExportableDiscovery(skill);
  return (
    <div className="group flex h-full items-center justify-between gap-3 border-b border-[var(--rule)] px-1 text-sm last:border-b-0">
      {exportMode ? (
        exportable ? (
          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={exportChecked}
              onChange={(e) => onToggleExport?.(e.target.checked)}
              aria-label={`选中 ${displayName}`}
            />
            <span className="truncate font-medium text-[var(--ink)]">{displayName}</span>
            {displayName !== skill.id ? (
              <span className="truncate text-[11px] font-normal text-[var(--ink-muted)]">{skill.id}</span>
            ) : null}
          </label>
        ) : (
          <div className="min-w-0 flex-1 truncate text-[var(--ink-muted)]">
            <span className="font-medium">{displayName}</span>
            <span className="ml-2 text-[11px]">内置平台 · 不可导出</span>
          </div>
        )
      ) : (
        <button
          type="button"
          onClick={onView}
          className="min-w-0 flex-1 truncate text-left hover:text-[var(--accent)]"
          title={displayName}
        >
          <span className="font-medium text-[var(--ink)]">{displayName}</span>
          {displayName !== skill.id ? (
            <span className="ml-2 text-[11px] font-normal text-[var(--ink-muted)]">{skill.id}</span>
          ) : null}
          {skill.builtin ? (
            <span className="ml-2 text-[11px] text-[var(--ink-muted)]">内置</span>
          ) : null}
        </button>
      )}
      {!exportMode ? (
        <div className="shrink-0">
          <div className="flex items-center gap-0.5">
            <SkillActionButton title={`查看 ${displayName}`} onClick={onView}>
              <EyeIcon />
            </SkillActionButton>
            <SkillActionButton
              title={`删除 ${displayName}`}
              danger
              disabled={Boolean(skill.builtin && PLATFORM_SKILL_IDS.has(skill.id))}
              onClick={onDelete}
            >
              <TrashIcon />
            </SkillActionButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function VirtualDiscoveryList({
  skills,
  onView,
  onDelete,
  exportMode = false,
  exportSelected,
  onToggleExport,
}: {
  skills: SkillItem[];
  onView: (skill: SkillItem) => void;
  onDelete: (skill: SkillItem) => void;
  exportMode?: boolean;
  exportSelected?: Set<string>;
  onToggleExport?: (skillId: string, checked: boolean) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: skills.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => DISCOVERY_ROW_HEIGHT,
    overscan: 8,
  });

  const listHeight = Math.min(skills.length * DISCOVERY_ROW_HEIGHT, DISCOVERY_LIST_MAX_HEIGHT);

  return (
    <div ref={parentRef} className="mt-2 overflow-y-auto" style={{ height: listHeight }}>
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const skill = skills[item.index];
          return (
            <div
              key={skill.id}
              className="absolute top-0 left-0 w-full"
              style={{
                height: item.size,
                transform: `translateY(${item.start}px)`,
              }}
            >
              <DiscoverySkillRow
                skill={skill}
                onView={() => onView(skill)}
                onDelete={() => onDelete(skill)}
                exportMode={exportMode}
                exportChecked={Boolean(exportSelected?.has(skill.id))}
                onToggleExport={(checked) => onToggleExport?.(skill.id, checked)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-[var(--ink)]">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm leading-relaxed text-[var(--ink-muted)]">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function GenericSkillRow({
  title,
  subtitle,
  badges,
  onView,
  onDelete,
  deleteDisabled = false,
}: {
  title: string;
  subtitle?: string;
  badges?: ReactNode;
  onView: () => void;
  onDelete?: () => void;
  deleteDisabled?: boolean;
}) {
  return (
    <li className="flex items-start justify-between gap-3 border-b border-[var(--rule)] py-3 first:border-t first:border-[var(--rule)] last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium tracking-tight text-[var(--ink)]">
          {title}
          {subtitle ? (
            <span className="ml-2 text-[11px] font-normal text-[var(--ink-muted)]">{subtitle}</span>
          ) : null}
        </p>
        {badges}
      </div>
      <div className="shrink-0">
        <div className="flex items-center gap-0.5">
          <SkillActionButton title={`查看 ${title}`} onClick={onView}>
            <EyeIcon />
          </SkillActionButton>
          {onDelete ? (
            <SkillActionButton
              title={`删除 ${title}`}
              danger
              disabled={deleteDisabled}
              onClick={onDelete}
            >
              <TrashIcon />
            </SkillActionButton>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function SkillsCatalogSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="加载 Skill 目录">
      {[
        { title: "简报生成规则", rows: 2 },
        { title: "抓取", rows: 4 },
        { title: "对话", rows: 1 },
      ].map(({ title, rows }) => (
        <section
          key={title}
          className="rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)] p-5"
        >
          <div className="space-y-2">
            <div className="h-5 w-28 animate-pulse rounded bg-[color-mix(in_srgb,var(--rule)_70%,white)]" />
            <div className="h-3 w-64 animate-pulse rounded bg-[color-mix(in_srgb,var(--rule)_55%,white)]" />
          </div>
          <ul className="mt-3 divide-y divide-[var(--rule)] border-t border-[var(--rule)]">
            {Array.from({ length: rows }).map((_, index) => (
              <li key={index} className="py-3">
                <div
                  className="h-4 animate-pulse rounded bg-[color-mix(in_srgb,var(--rule)_70%,white)]"
                  style={{ width: `${68 - index * 8}%` }}
                />
                <div className="mt-2 h-3 max-w-xs animate-pulse rounded bg-[color-mix(in_srgb,var(--rule)_55%,white)]" />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function SkillsPanel({ embedded = false }: { embedded?: boolean }) {
  const { job: onboardJob, startSkillRepair } = useOnboarding();
  const [catalog, setCatalog] = useState<SkillsCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const [viewingSkill, setViewingSkill] = useState<{
    category: "discovery" | "other";
    title: string;
  } | null>(null);
  const [skillDetail, setSkillDetail] = useState<SkillDetail | null>(null);
  const [skillDetailLoading, setSkillDetailLoading] = useState(false);
  const [skillDetailError, setSkillDetailError] = useState("");

  const [markdownEditor, setMarkdownEditor] = useState<{
    category: "digest" | "chat";
    title: string;
    skillId: string;
    isNew: boolean;
    path?: string;
  } | null>(null);
  const [markdownDocument, setMarkdownDocument] = useState("");
  const [markdownLoading, setMarkdownLoading] = useState(false);
  const [markdownError, setMarkdownError] = useState("");

  const [profileEditor, setProfileEditor] = useState<{
    title: string;
    skillId: string;
    isNew: boolean;
    path?: string;
  } | null>(null);
  const [profileDraft, setProfileDraft] = useState<DigestProfile>(defaultDigestProfile());
  const [profileName, setProfileName] = useState("");
  const [profileDescription, setProfileDescription] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{
    category: "digest" | "discovery" | "other";
    id: string;
    name: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [repairOpen, setRepairOpen] = useState(false);
  const [discoveryQuery, setDiscoveryQuery] = useState("");
  const [discoveryExportMode, setDiscoveryExportMode] = useState(false);
  const [discoveryExportSelected, setDiscoveryExportSelected] = useState<Set<string>>(() => new Set());
  const [discoveryExportPlatformSelected, setDiscoveryExportPlatformSelected] = useState<Set<string>>(
    () => new Set(),
  );
  const [exportingDiscovery, setExportingDiscovery] = useState(false);
  const [exportLayout, setExportLayout] = useState<{
    groups: FeedGroup[];
    feeds: Feed[];
    groupOrder: string[];
  } | null>(null);

  const repairing = Boolean(onboardJob?.running && onboardJob.kind === "repair");

  const filteredDiscovery = useMemo(() => {
    const skills = catalog?.discovery ?? [];
    const q = discoveryQuery.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((skill) => {
      const haystack = [skill.id, skill.name, skill.description, skill.path]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [catalog?.discovery, discoveryQuery]);

  const exportableDiscovery = useMemo(
    () => filteredDiscovery.filter(isExportableDiscovery),
    [filteredDiscovery],
  );

  const catalogExportableDiscovery = useMemo(
    () => (catalog?.discovery ?? []).filter(isExportableDiscovery),
    [catalog?.discovery],
  );

  const exportableSkillIdSet = useMemo(
    () => new Set(catalogExportableDiscovery.map((skill) => skill.id)),
    [catalogExportableDiscovery],
  );

  const feedIdToDiscoverySkillId = useMemo(
    () => buildFeedIdToDiscoverySkillId(catalog?.discovery ?? []),
    [catalog?.discovery],
  );

  const exportGroupOptions = useMemo(() => {
    if (!exportLayout) return [];
    const { groups, groupOrder } = exportLayout;
    const ordered: Array<{ id: string; name: string }> = [];
    const seen = new Set<string>();
    for (const groupId of groupOrder) {
      const group = groups.find((item) => item.id === groupId);
      if (!group || seen.has(group.id)) continue;
      seen.add(group.id);
      ordered.push({ id: group.id, name: group.name });
    }
    for (const group of groups) {
      if (seen.has(group.id)) continue;
      seen.add(group.id);
      ordered.push({ id: group.id, name: group.name });
    }
    ordered.push({ id: UNGROUPED_GROUP_ID, name: "未分组" });
    return ordered.filter((option) => {
      const skillCount = exportableSkillIdsForGroup(
        option.id,
        groups,
        exportLayout.feeds,
        feedIdToDiscoverySkillId,
        exportableSkillIdSet,
      ).length;
      const platformCount = platformFeedIdsForGroup(option.id, groups, exportLayout.feeds).length;
      return skillCount > 0 || platformCount > 0;
    });
  }, [exportLayout, feedIdToDiscoverySkillId, exportableSkillIdSet]);

  const loadCatalog = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
    setError("");
    try {
      const data = await fetchSkillsCatalog();
      setCatalog(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (onboardJob?.kind === "repair" && onboardJob.phase === "done" && !onboardJob.running) {
      void fetchSkillsCatalog()
        .then(setCatalog)
        .catch(() => {});
    }
  }, [onboardJob?.kind, onboardJob?.phase, onboardJob?.running, onboardJob?.jobId]);

  async function openSkillViewer(category: "discovery" | "other", skill: SkillItem) {
    const displayName = skill.name?.trim() || skill.id;
    const title = category === "discovery" ? `Discovery · ${displayName}` : `其他 · ${displayName}`;
    setViewingSkill({ category, title });
    setSkillDetail(null);
    setSkillDetailError("");
    setSkillDetailLoading(true);
    try {
      const detail =
        category === "discovery"
          ? await fetchDiscoverySkillDetail(skill.id)
          : await fetchOtherSkillDetail(skill.id);
      setSkillDetail(detail);
    } catch (err) {
      setSkillDetailError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setSkillDetailLoading(false);
    }
  }

  function closeSkillViewer() {
    setViewingSkill(null);
    setSkillDetail(null);
    setSkillDetailError("");
  }

  async function openDigestEditor(skill?: SkillItem) {
    if (!skill) {
      const id = newDigestSkillId();
      setProfileEditor({
        title: "新建整理规则",
        skillId: id,
        isNew: true,
      });
      setProfileDraft(defaultDigestProfile());
      setProfileName(id);
      setProfileDescription("");
      setProfileError("");
      return;
    }

    if (skill.has_profile) {
      setProfileEditor({
        title: skill.name || skill.id,
        skillId: skill.id,
        isNew: false,
        path: skill.path,
      });
      setProfileDraft(defaultDigestProfile());
      setProfileName(skill.name || skill.id);
      setProfileDescription(skill.description || "");
      setProfileError("");
      setProfileLoading(true);
      try {
        const detail = await fetchDigestSkillDetail(skill.id);
        if (detail.profile) {
          setProfileDraft(detail.profile);
        }
        setProfileName(detail.name || skill.id);
        setProfileDescription(detail.description || "");
      } catch (err) {
        setProfileError(err instanceof Error ? err.message : "加载失败");
      } finally {
        setProfileLoading(false);
      }
      return;
    }

    setMarkdownEditor({
      category: "digest",
      title: skill.name || skill.id,
      skillId: skill.id,
      isNew: false,
      path: skill.path,
    });
    setMarkdownDocument("");
    setMarkdownError("");
    setMarkdownLoading(true);
    try {
      const detail = await fetchDigestSkillDetail(skill.id);
      if (detail.has_profile && detail.profile) {
        closeMarkdownEditor();
        setProfileEditor({
          title: skill.name || skill.id,
          skillId: skill.id,
          isNew: false,
          path: skill.path,
        });
        setProfileDraft(detail.profile);
        setProfileName(detail.name || skill.id);
        setProfileDescription(detail.description || "");
        return;
      }
      setMarkdownDocument(detail.skill_md || "");
    } catch (err) {
      setMarkdownError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setMarkdownLoading(false);
    }
  }

  function closeProfileEditor() {
    setProfileEditor(null);
    setProfileError("");
  }

  async function openChatEditor() {
    if (!catalog) return;
    const chat = catalog.chat;
    const displayName = chat.name?.trim() || chat.id;
    setMarkdownEditor({
      category: "chat",
      title: displayName,
      skillId: chat.id,
      isNew: false,
      path: chat.path,
    });
    setMarkdownDocument("");
    setMarkdownError("");
    setMarkdownLoading(true);
    try {
      const detail = await fetchChatSkill();
      setMarkdownDocument(detail.skill_md || "");
    } catch (err) {
      setMarkdownError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setMarkdownLoading(false);
    }
  }

  function closeMarkdownEditor() {
    setMarkdownEditor(null);
    setMarkdownDocument("");
    setMarkdownError("");
  }

  function requestDeleteSkill(category: "digest" | "discovery" | "other", skill: SkillItem) {
    setDeleteTarget({ category, id: skill.id, name: skill.name || skill.id });
  }

  async function confirmDeleteSkill() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError("");
    try {
      if (deleteTarget.category === "digest") {
        await deleteDigestSkill(deleteTarget.id);
      } else if (deleteTarget.category === "discovery") {
        await deleteDiscoverySkill(deleteTarget.id);
      } else {
        await deleteOtherSkill(deleteTarget.id);
      }
      if (viewingSkill && skillDetail?.id === deleteTarget.id) {
        closeSkillViewer();
      }
      if (markdownEditor?.skillId === deleteTarget.id) {
        closeMarkdownEditor();
      }
      if (profileEditor?.skillId === deleteTarget.id) {
        closeProfileEditor();
      }
      setMessage(`已删除「${deleteTarget.name}」`);
      setDeleteTarget(null);
      await loadCatalog();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  }

  async function handleSaveMarkdown() {
    if (!markdownEditor) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      if (markdownEditor.category === "chat") {
        const skill_md = markdownDocument.trim();
        if (!skill_md) {
          throw new Error("SKILL.md 内容不能为空");
        }
        await saveChatSkill({ skill_md });
        setMessage("对话 Skill 已保存");
      } else {
        const skillId = markdownEditor.skillId.trim();
        const skill_md = markdownDocument.trim();
        if (!skillId.endsWith("-digest")) {
          throw new Error("整理规则 id 需以 -digest 结尾");
        }
        if (!skill_md) {
          throw new Error("SKILL.md 内容不能为空");
        }
        const payload = { id: skillId, skill_md };
        if (markdownEditor.isNew) {
          await createDigestSkill(payload);
        } else {
          await saveDigestSkill(payload);
        }
        setMessage("整理规则已保存");
      }
      closeMarkdownEditor();
      await loadCatalog();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveProfile() {
    if (!profileEditor) return;
    setSaving(true);
    setError("");
    setMessage("");
    setProfileError("");
    try {
      const skillId = profileEditor.skillId.trim();
      if (!skillId.endsWith("-digest")) {
        throw new Error("整理规则 id 需以 -digest 结尾");
      }
      const displayName = profileName.trim() || skillId;
      const desc = profileDescription.trim() || "结构化整理规则";
      const skill_md = `---
name: ${displayName}
description: ${desc}
---

结构化整理规则（分类 → 重点关注 → 类内聚类 → 渲染）。

规则与类别定义见同目录 \`digest_profile.json\`。系统按配置执行两步 LLM，再渲染为固定 Markdown，不直接使用本文件作为生成 prompt。
`;
      const payload = { id: skillId, skill_md, profile: profileDraft };
      if (profileEditor.isNew) {
        await createDigestSkill(payload);
      } else {
        await saveDigestSkill(payload);
      }
      setMessage("整理规则已保存");
      closeProfileEditor();
      await loadCatalog();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "保存失败";
      setProfileError(msg);
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleRestoreDigestSkill(skill: SkillItem) {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await restoreDigestSkill(skill.id);
      setMessage(`已还原「${skill.name || skill.id}」`);
      await loadCatalog({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "还原失败");
    } finally {
      setSaving(false);
    }
  }

  function deleteConfirmMessage() {
    if (!deleteTarget) return "";
    if (deleteTarget.category === "digest") {
      return `确定删除整理规则「${deleteTarget.name}」？\n\n删除后无法恢复。内置 Skill 需从仓库重新检出才能恢复。`;
    }
    if (deleteTarget.category === "discovery") {
      return `确定删除 Discovery Skill「${deleteTarget.name}」？\n\n将删除 skill 目录并隐藏对应数据源。内置 Skill 需从仓库重新检出才能恢复。`;
    }
    return `确定删除 Skill「${deleteTarget.name}」？\n\n将删除 skill 目录，删除后无法恢复。`;
  }

  function enterDiscoveryExportMode() {
    setDiscoveryExportMode(true);
    setDiscoveryExportSelected(new Set());
    setDiscoveryExportPlatformSelected(new Set());
    void fetchFeeds()
      .then((data) =>
        setExportLayout({
          groups: data.groups,
          feeds: data.feeds,
          groupOrder: data.group_order ?? [],
        }),
      )
      .catch(() => setExportLayout(null));
  }

  function exitDiscoveryExportMode() {
    setDiscoveryExportMode(false);
    setDiscoveryExportSelected(new Set());
    setDiscoveryExportPlatformSelected(new Set());
    setExportLayout(null);
  }

  function isDiscoveryExportGroupFullySelected(groupId: string): boolean {
    if (!exportLayout) return false;
    const skillIds = exportableSkillIdsForGroup(
      groupId,
      exportLayout.groups,
      exportLayout.feeds,
      feedIdToDiscoverySkillId,
      exportableSkillIdSet,
    );
    const platformIds = platformFeedIdsForGroup(groupId, exportLayout.groups, exportLayout.feeds);
    if (skillIds.length === 0 && platformIds.length === 0) return false;
    const skillsOk = skillIds.length === 0 || skillIds.every((id) => discoveryExportSelected.has(id));
    const platformsOk =
      platformIds.length === 0 || platformIds.every((id) => discoveryExportPlatformSelected.has(id));
    return skillsOk && platformsOk;
  }

  function toggleDiscoveryExportGroup(groupId: string) {
    if (!exportLayout) return;
    const skillIds = exportableSkillIdsForGroup(
      groupId,
      exportLayout.groups,
      exportLayout.feeds,
      feedIdToDiscoverySkillId,
      exportableSkillIdSet,
    );
    const platformIds = platformFeedIdsForGroup(groupId, exportLayout.groups, exportLayout.feeds);
    if (skillIds.length === 0 && platformIds.length === 0) return;
    const allSelected =
      skillIds.every((id) => discoveryExportSelected.has(id)) &&
      platformIds.every((id) => discoveryExportPlatformSelected.has(id));
    setDiscoveryExportSelected((current) => {
      const next = new Set(current);
      if (allSelected) skillIds.forEach((id) => next.delete(id));
      else skillIds.forEach((id) => next.add(id));
      return next;
    });
    setDiscoveryExportPlatformSelected((current) => {
      const next = new Set(current);
      if (allSelected) platformIds.forEach((id) => next.delete(id));
      else platformIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function toggleDiscoveryExportSelection(skillId: string, checked: boolean) {
    setDiscoveryExportSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(skillId);
      else next.delete(skillId);
      return next;
    });
  }

  function toggleSelectAllExportableDiscovery() {
    const allSelected =
      exportableDiscovery.length > 0 &&
      exportableDiscovery.every((skill) => discoveryExportSelected.has(skill.id));
    if (allSelected) {
      setDiscoveryExportSelected(new Set());
      return;
    }
    setDiscoveryExportSelected(new Set(exportableDiscovery.map((skill) => skill.id)));
  }

  async function exportSelectedDiscoverySkills() {
    const ids = catalogExportableDiscovery
      .filter((skill) => discoveryExportSelected.has(skill.id))
      .map((skill) => skill.id);
    const platformFeedIds = [...discoveryExportPlatformSelected];
    if (ids.length === 0 && platformFeedIds.length === 0) return;
    setExportingDiscovery(true);
    setError("");
    try {
      const { blob, filename } = await exportDiscoverySkills(ids, platformFeedIds);
      downloadBlob(blob, filename);
      const parts: string[] = [];
      if (ids.length > 0) parts.push(`${ids.length} 个 skill`);
      if (platformFeedIds.length > 0) parts.push(`${platformFeedIds.length} 个平台账号`);
      setMessage(`已导出 ${parts.join("、")}（${filename}），请查看浏览器下载`);
      exitDiscoveryExportMode();
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出失败");
    } finally {
      setExportingDiscovery(false);
    }
  }

  const allExportableSelected =
    exportableDiscovery.length > 0 &&
    exportableDiscovery.every((skill) => discoveryExportSelected.has(skill.id));

  const hasOnboardingSkill = catalog?.other.some((skill) => skill.id === "source-onboarding") ?? false;

  return (
    <div className={embedded ? "space-y-6" : "h-full overflow-y-auto bg-[var(--paper)]"}>
      {!embedded ? (
        <header className="border-b border-[var(--rule)] bg-[var(--paper-raised)] px-6 py-4">
          <h1 className="text-lg font-semibold tracking-tight text-[var(--ink)]">Skills</h1>
        </header>
      ) : null}

      <div className={embedded ? "space-y-6" : "app-content-wide space-y-6 px-6 py-8"}>
        {error ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-red-800">{error}</p>
            <button
              type="button"
              onClick={() => void loadCatalog()}
              className="ui-btn text-xs"
            >
              重试
            </button>
          </div>
        ) : null}
        {message ? <p className="text-sm text-[var(--success)]">{message}</p> : null}

        {loading && !catalog ? <SkillsCatalogSkeleton /> : null}

        {catalog ? (
          <>
            <Section
              title="简报生成规则"
              description="决定简报如何分类、关注什么、如何呈现；每个板块须手动绑定一套规则。"
              action={
                <button type="button" onClick={() => void openDigestEditor()} className="ui-btn ui-btn-primary text-sm">
                  新建
                </button>
              }
            >
              <ul>
                {catalog.digest.map((skill) => (
                  <DigestRuleRow
                    key={skill.id}
                    skill={skill}
                    onEdit={() => void openDigestEditor(skill)}
                    onDelete={() => requestDeleteSkill("digest", skill)}
                    onRestore={() => void handleRestoreDigestSkill(skill)}
                  />
                ))}
              </ul>
            </Section>

            <Section
              title="抓取"
              description="接入新网站时生成抓取 Skill，并管理已保存的抓取规则。"
            >
              {hasOnboardingSkill ? (
                <div>
                  <p className="text-[11px] font-semibold text-[var(--ink-muted)]">Skill 生成</p>
                  <ul className="mt-1">
                    {catalog.other
                      .filter((skill) => skill.id === "source-onboarding")
                      .map((skill) => (
                        <GenericSkillRow
                          key={skill.id}
                          title={skill.name?.trim() || skill.id}
                          subtitle={skill.name?.trim() ? skill.id : undefined}
                          badges={
                            <span className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-[var(--ink-muted)]">
                              <span>工具</span>
                              <span className="text-[var(--accent)]">生成器</span>
                            </span>
                          }
                          onView={() => void openSkillViewer("other", skill)}
                          onDelete={() => requestDeleteSkill("other", skill)}
                        />
                      ))}
                  </ul>
                </div>
              ) : null}
              <div className={hasOnboardingSkill ? "mt-5 border-t border-[var(--rule)] pt-5" : ""}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[11px] font-semibold text-[var(--ink-muted)]">
                    {filteredDiscovery.length > 0
                      ? `抓取 Skill · ${filteredDiscovery.length}`
                      : "抓取 Skill"}
                  </p>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {!discoveryExportMode ? (
                      <button
                        type="button"
                        className="ui-btn text-xs"
                        onClick={enterDiscoveryExportMode}
                      >
                        导出 skill
                      </button>
                    ) : null}
                    <input
                      type="search"
                      value={discoveryQuery}
                      onChange={(e) => setDiscoveryQuery(e.target.value)}
                      placeholder="搜索…"
                      aria-label="搜索抓取 Skill"
                      className="ui-input w-52 text-sm sm:w-60"
                    />
                  </div>
                </div>
                {discoveryExportMode ? (
                  <div className="mb-3 mt-3 space-y-2 rounded border border-[var(--rule)] bg-[var(--paper)] px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <button type="button" className="ui-btn text-xs" onClick={toggleSelectAllExportableDiscovery}>
                          {allExportableSelected ? "取消全选" : "全选"}
                        </button>
                        <span className="text-[var(--ink-muted)] tabular-nums">
                          已选 {discoveryExportSelected.size} skill
                          {discoveryExportPlatformSelected.size > 0
                            ? ` · ${discoveryExportPlatformSelected.size} 平台账号`
                            : ""}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button type="button" className="ui-btn text-xs" onClick={exitDiscoveryExportMode}>
                          取消
                        </button>
                        <button
                          type="button"
                          className="ui-btn ui-btn-primary text-xs"
                          disabled={
                            (discoveryExportSelected.size === 0 &&
                              discoveryExportPlatformSelected.size === 0) ||
                            exportingDiscovery
                          }
                          onClick={() => void exportSelectedDiscoverySkills()}
                        >
                          {exportingDiscovery ? "导出中…" : "导出所选"}
                        </button>
                      </div>
                    </div>
                    {exportGroupOptions.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[var(--ink-muted)]">按分组</span>
                        {exportGroupOptions.map((option) => {
                          const skillCount = exportableSkillIdsForGroup(
                            option.id,
                            exportLayout?.groups ?? [],
                            exportLayout?.feeds ?? [],
                            feedIdToDiscoverySkillId,
                            exportableSkillIdSet,
                          ).length;
                          const platformCount = platformFeedIdsForGroup(
                            option.id,
                            exportLayout?.groups ?? [],
                            exportLayout?.feeds ?? [],
                          ).length;
                          const active = isDiscoveryExportGroupFullySelected(option.id);
                          return (
                            <button
                              key={option.id}
                              type="button"
                              className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                                active
                                  ? "border-[var(--accent)] bg-[var(--accent-soft)] font-semibold text-[var(--accent)]"
                                  : "border-[var(--rule)] bg-[var(--paper-raised)] text-[var(--ink-muted)] hover:border-[var(--accent)] hover:text-[var(--ink)]"
                              }`}
                              title={`切换「${option.name}」内 ${skillCount} 个 skill、${platformCount} 个平台账号`}
                              onClick={() => toggleDiscoveryExportGroup(option.id)}
                            >
                              {groupExportChipLabel(option.name, skillCount, platformCount)}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {filteredDiscovery.length === 0 ? (
                  <p className="border-t border-[var(--rule)] py-8 text-center text-sm text-[var(--ink-muted)]">
                    {discoveryQuery.trim() ? `没有匹配「${discoveryQuery.trim()}」的 Skill` : "暂无抓取 Skill"}
                  </p>
                ) : (
                  <div className="border-t border-[var(--rule)]">
                    <VirtualDiscoveryList
                      skills={filteredDiscovery}
                      onView={(skill) => void openSkillViewer("discovery", skill)}
                      onDelete={(skill) => requestDeleteSkill("discovery", skill)}
                      exportMode={discoveryExportMode}
                      exportSelected={discoveryExportSelected}
                      onToggleExport={toggleDiscoveryExportSelection}
                    />
                  </div>
                )}
              </div>
            </Section>

            <Section title="对话" description="提问时使用的对话 Skill。">
              <ul>
                <GenericSkillRow
                  title={catalog.chat.name?.trim() || catalog.chat.id}
                  subtitle={
                    catalog.chat.name?.trim() && catalog.chat.name !== catalog.chat.id
                      ? catalog.chat.id
                      : undefined
                  }
                  badges={<SkillMetaBadges skill={catalog.chat} />}
                  onView={() => void openChatEditor()}
                />
              </ul>
            </Section>
          </>
        ) : null}
      </div>

      <SkillDetailModal
        open={Boolean(viewingSkill)}
        title={viewingSkill?.title ?? ""}
        loading={skillDetailLoading}
        error={skillDetailError}
        detail={skillDetail}
        deletable={Boolean(skillDetail)}
        deleting={deleting}
        repairable={viewingSkill?.category === "discovery" && Boolean(skillDetail)}
        repairing={repairing}
        onClose={closeSkillViewer}
        onRepair={() => setRepairOpen(true)}
        onDelete={() => {
          if (!skillDetail || !viewingSkill) return;
          requestDeleteSkill(viewingSkill.category, skillDetail);
        }}
      />

      <SkillRepairModal
        open={repairOpen && Boolean(skillDetail)}
        skillName={skillDetail?.name?.trim() || skillDetail?.id || ""}
        skillId={skillDetail?.id ?? ""}
        busy={repairing}
        onClose={() => setRepairOpen(false)}
        onSubmit={(payload) => {
          if (!skillDetail) return;
          setRepairOpen(false);
          closeSkillViewer();
          void startSkillRepair(skillDetail.id, payload);
        }}
      />

      <SkillMarkdownModal
        open={Boolean(markdownEditor)}
        title={markdownEditor?.title ?? ""}
        loading={markdownLoading}
        error={markdownError}
        path={markdownEditor?.path}
        document={markdownDocument}
        onDocumentChange={setMarkdownDocument}
        previewMode={
          markdownEditor?.category === "digest" || markdownEditor?.category === "chat"
            ? "body"
            : "full"
        }
        skillId={
          markdownEditor?.category === "digest" && markdownEditor.isNew
            ? markdownEditor.skillId
            : undefined
        }
        onSkillIdChange={
          markdownEditor?.category === "digest" && markdownEditor.isNew
            ? (value) =>
                setMarkdownEditor((current) =>
                  current ? { ...current, skillId: value } : current,
                )
            : undefined
        }
        idReadonly={!markdownEditor?.isNew}
        onClose={closeMarkdownEditor}
        onSave={() => void handleSaveMarkdown()}
        saving={saving}
        onDelete={
          markdownEditor?.category === "digest" && !markdownEditor.isNew
            ? () => {
                if (!markdownEditor) return;
                requestDeleteSkill("digest", {
                  id: markdownEditor.skillId,
                  name: markdownEditor.title,
                  category: "digest",
                });
              }
            : undefined
        }
        deleting={deleting}
      />

      <DigestProfileModal
        open={Boolean(profileEditor)}
        title={profileEditor?.title ?? "整理规则"}
        loading={profileLoading}
        error={profileError}
        path={profileEditor?.path}
        skillId={profileEditor?.skillId ?? ""}
        idReadonly={!profileEditor?.isNew}
        onSkillIdChange={
          profileEditor?.isNew
            ? (value) =>
                setProfileEditor((current) =>
                  current ? { ...current, skillId: value } : current,
                )
            : undefined
        }
        name={profileName}
        description={profileDescription}
        onNameChange={setProfileName}
        onDescriptionChange={setProfileDescription}
        profile={profileDraft}
        onProfileChange={setProfileDraft}
        onClose={closeProfileEditor}
        onSave={() => void handleSaveProfile()}
        saving={saving}
        onDelete={
          profileEditor && !profileEditor.isNew
            ? () => {
                requestDeleteSkill("digest", {
                  id: profileEditor.skillId,
                  name: profileName || profileEditor.skillId,
                  category: "digest",
                });
              }
            : undefined
        }
        deleting={deleting}
      />

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="删除 Skill"
        message={deleteConfirmMessage()}
        confirmLabel="确认删除"
        danger
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDeleteSkill()}
      />
    </div>
  );
}
