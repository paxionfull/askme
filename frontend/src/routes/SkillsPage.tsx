import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import ConfirmModal from "../components/ConfirmModal";
import DigestProfileModal from "../components/DigestProfileModal";
import OverflowMenu, { type OverflowMenuItem } from "../components/OverflowMenu";
import SkillDetailModal from "../components/SkillDetailModal";
import SkillMarkdownModal from "../components/SkillMarkdownModal";
import SkillRepairModal from "../components/SkillRepairModal";
import { useOnboarding } from "../contexts/OnboardingContext";
import {
  createDigestSkill,
  deleteDigestSkill,
  deleteDiscoverySkill,
  deleteOtherSkill,
  fetchChatSkill,
  fetchDigestSkillDetail,
  fetchDiscoverySkillDetail,
  fetchOtherSkillDetail,
  fetchSkillsCatalog,
  saveChatSkill,
  saveDigestSkill,
  saveSkillConfig,
  type DigestProfile,
  type SkillDetail,
  type SkillItem,
  type SkillsCatalog,
} from "../api";
import { defaultDigestProfile } from "../utils/digestProfile";

const DISCOVERY_ROW_HEIGHT = 44;
const DISCOVERY_LIST_MAX_HEIGHT = 360;

function newDigestSkillId() {
  return `custom-${Math.random().toString(36).slice(2, 8)}-digest`;
}

function SkillMetaBadges({
  skill,
  isDefault,
}: {
  skill: SkillItem;
  isDefault?: boolean;
}) {
  return (
    <span className="mt-1 flex flex-wrap gap-1.5">
      {skill.builtin ? (
        <span className="text-[11px] text-[var(--ink-muted)]">内置</span>
      ) : null}
      {skill.has_profile ? (
        <span className="text-[11px] text-[var(--success)]">结构化</span>
      ) : null}
      {isDefault ? (
        <span className="text-[11px] text-[var(--accent)]">默认</span>
      ) : null}
    </span>
  );
}

function SkillRow({
  title,
  subtitle,
  description,
  badges,
  menuItems,
}: {
  title: string;
  subtitle?: string;
  description?: string;
  badges?: ReactNode;
  menuItems: OverflowMenuItem[];
}) {
  return (
    <li className="group flex items-start justify-between gap-3 border-b border-[var(--rule)] py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium tracking-tight text-[var(--ink)]">
          {title}
          {subtitle ? (
            <span className="ml-2 text-[11px] font-normal text-[var(--ink-muted)]">{subtitle}</span>
          ) : null}
        </p>
        {badges}
        {description ? (
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--ink-muted)]">{description}</p>
        ) : null}
      </div>
      <div className="shrink-0 opacity-70 transition-opacity group-hover:opacity-100">
        <OverflowMenu items={menuItems} label="Skill 操作" />
      </div>
    </li>
  );
}

function DiscoverySkillRow({
  skill,
  onView,
  onDelete,
}: {
  skill: SkillItem;
  onView: () => void;
  onDelete: () => void;
}) {
  const displayName = skill.name?.trim() || skill.id;
  return (
    <div className="flex h-full items-center justify-between gap-3 border-b border-[var(--rule)] px-1 text-sm last:border-b-0">
      <button
        type="button"
        onClick={onView}
        className="min-w-0 flex-1 truncate text-left hover:text-[var(--accent)]"
        title={skill.description || displayName}
      >
        <span className="font-medium text-[var(--ink)]">{displayName}</span>
        {displayName !== skill.id ? (
          <span className="ml-2 text-[11px] font-normal text-[var(--ink-muted)]">{skill.id}</span>
        ) : null}
        {skill.builtin ? (
          <span className="ml-2 text-[11px] text-[var(--ink-muted)]">内置</span>
        ) : null}
      </button>
      <OverflowMenu
        items={[
          { label: "查看", onClick: onView },
          { label: "删除", danger: true, onClick: onDelete },
        ]}
        label="Discovery 操作"
      />
    </div>
  );
}

function VirtualDiscoveryList({
  skills,
  onView,
  onDelete,
}: {
  skills: SkillItem[];
  onView: (skill: SkillItem) => void;
  onDelete: (skill: SkillItem) => void;
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
    <section>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-[var(--ink)]">{title}</h2>
          {description ? (
            <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function SkillsCatalogSkeleton() {
  return (
    <div className="space-y-10" aria-busy="true" aria-label="加载 Skill 目录">
      {["概览", "数据源 Discovery", "对话与其他"].map((label) => (
        <div key={label} className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-2">
              <div className="h-4 w-24 animate-pulse rounded bg-[color-mix(in_srgb,var(--rule)_70%,white)]" />
              <div className="h-3 w-56 animate-pulse rounded bg-[color-mix(in_srgb,var(--rule)_55%,white)]" />
            </div>
            <div className="h-7 w-14 animate-pulse rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--rule)_70%,white)]" />
          </div>
          <ul className="divide-y divide-[var(--rule)]">
            {Array.from({ length: label === "数据源 Discovery" ? 5 : 3 }).map((_, index) => (
              <li key={index} className="py-3">
                <div
                  className="h-4 animate-pulse rounded bg-[color-mix(in_srgb,var(--rule)_70%,white)]"
                  style={{ width: `${68 - index * 8}%` }}
                />
                <div className="mt-2 h-3 max-w-xs animate-pulse rounded bg-[color-mix(in_srgb,var(--rule)_55%,white)]" />
              </li>
            ))}
          </ul>
        </div>
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
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);

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

  const defaultDigestSkillId = catalog?.default_digest_skill ?? "";
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
        title: "新建概览 Skill",
        skillId: id,
        isNew: true,
      });
      setProfileDraft(defaultDigestProfile());
      setProfileName(id);
      setProfileDescription("结构化概览 skill");
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

  async function handleSetDefaultDigest(skillId: string) {
    setSettingDefaultId(skillId);
    setError("");
    try {
      await saveSkillConfig({ default_digest_skill: skillId });
      setMessage("已设为默认概览 Skill");
      await loadCatalog();
    } catch (err) {
      setError(err instanceof Error ? err.message : "设置失败");
    } finally {
      setSettingDefaultId(null);
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
          throw new Error("概览 Skill id 需以 -digest 结尾");
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
        setMessage("概览 Skill 已保存");
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
        throw new Error("概览 Skill id 需以 -digest 结尾");
      }
      const displayName = profileName.trim() || skillId;
      const desc = profileDescription.trim() || "结构化概览 skill";
      const skill_md = `---
name: ${displayName}
description: ${desc}
---

结构化概览 skill（分类 → 重点关注 → 类内聚类 → 渲染）。

规则与类别定义见同目录 \`digest_profile.json\`。系统按配置执行两步 LLM，再渲染为固定 Markdown，不直接使用本文件作为生成 prompt。
`;
      const payload = { id: skillId, skill_md, profile: profileDraft };
      if (profileEditor.isNew) {
        await createDigestSkill(payload);
      } else {
        await saveDigestSkill(payload);
      }
      setMessage("概览 Skill 已保存");
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

  function deleteConfirmMessage() {
    if (!deleteTarget) return "";
    if (deleteTarget.category === "digest") {
      return `确定删除概览 Skill「${deleteTarget.name}」？\n\n删除后无法恢复。内置 Skill 需从仓库重新检出才能恢复。`;
    }
    if (deleteTarget.category === "discovery") {
      return `确定删除 Discovery Skill「${deleteTarget.name}」？\n\n将删除 skill 目录并隐藏对应数据源。内置 Skill 需从仓库重新检出才能恢复。`;
    }
    return `确定删除 Skill「${deleteTarget.name}」？\n\n将删除 skill 目录，删除后无法恢复。`;
  }

  return (
    <div className={embedded ? "space-y-4" : "h-full overflow-y-auto bg-[var(--paper)]"}>
      {!embedded ? (
        <header className="border-b border-[var(--rule)] bg-[var(--paper-raised)] px-6 py-4">
          <h1 className="text-lg font-semibold tracking-tight text-[var(--ink)]">Skill</h1>
          <p className="mt-1 text-[clamp(0.92rem,0.15vw+0.86rem,1rem)] text-[var(--ink-muted)]">
            管理抓取、概览与对话 Skill。分组可在「源 → 管理分组」绑定概览 Skill。
          </p>
        </header>
      ) : null}

      <div className={embedded ? "space-y-10" : "app-content-wide space-y-10 px-6 py-8"}>
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
              title="概览"
              description="定义分类与重点关注规则，用于简报页目录生成。"
              action={
                <button type="button" onClick={() => void openDigestEditor()} className="ui-btn ui-btn-primary text-sm">
                  新建
                </button>
              }
            >
              <ul>
                {catalog.digest.map((skill) => {
                  const displayName = skill.name?.trim() || skill.id;
                  const isDefault = skill.id === defaultDigestSkillId || Boolean(skill.is_default);
                  const menuItems: OverflowMenuItem[] = [
                    {
                      label: "编辑",
                      onClick: () => void openDigestEditor(skill),
                    },
                  ];
                  if (!isDefault) {
                    menuItems.push({
                      label: settingDefaultId === skill.id ? "设置中…" : "设为默认",
                      disabled: settingDefaultId === skill.id,
                      onClick: () => void handleSetDefaultDigest(skill.id),
                    });
                  }
                  menuItems.push({
                    label: "删除",
                    danger: true,
                    onClick: () => requestDeleteSkill("digest", skill),
                  });
                  return (
                    <SkillRow
                      key={skill.id}
                      title={displayName}
                      subtitle={displayName !== skill.id ? skill.id : undefined}
                      description={skill.description || undefined}
                      badges={<SkillMetaBadges skill={skill} isDefault={isDefault} />}
                      menuItems={menuItems}
                    />
                  );
                })}
              </ul>
            </Section>

            <Section
              title="对话"
              description="系统角色与回答风格；引用规则由系统自动追加。"
            >
              <ul>
                <SkillRow
                  title={catalog.chat.name?.trim() || catalog.chat.id}
                  subtitle={
                    catalog.chat.name?.trim() && catalog.chat.name !== catalog.chat.id
                      ? catalog.chat.id
                      : undefined
                  }
                  description={catalog.chat.description || undefined}
                  badges={<SkillMetaBadges skill={catalog.chat} />}
                  menuItems={[{ label: "编辑", onClick: () => void openChatEditor() }]}
                />
              </ul>
            </Section>

            <Section
              title={`抓取${filteredDiscovery.length ? ` · ${filteredDiscovery.length}` : ""}`}
              description="数据源 Discovery Skill。可查看源码、反馈修复或删除。"
              action={
                <input
                  type="search"
                  value={discoveryQuery}
                  onChange={(e) => setDiscoveryQuery(e.target.value)}
                  placeholder="搜索…"
                  aria-label="搜索抓取 Skill"
                  className="ui-input w-52 text-sm sm:w-60"
                />
              }
            >
              {filteredDiscovery.length === 0 ? (
                <p className="border-t border-[var(--rule)] py-8 text-center text-sm text-[var(--ink-muted)]">
                  {discoveryQuery.trim()
                    ? `没有匹配「${discoveryQuery.trim()}」的 Skill`
                    : "暂无抓取 Skill"}
                </p>
              ) : (
                <VirtualDiscoveryList
                  skills={filteredDiscovery}
                  onView={(skill) => void openSkillViewer("discovery", skill)}
                  onDelete={(skill) => requestDeleteSkill("discovery", skill)}
                />
              )}
            </Section>

            {catalog.other.length > 0 ? (
              <Section title="其他" description="未归类的 Skill。">
                <ul>
                  {catalog.other.map((skill) => {
                    const displayName = skill.name?.trim() || skill.id;
                    return (
                      <SkillRow
                        key={skill.id}
                        title={displayName}
                        subtitle={displayName !== skill.id ? skill.id : undefined}
                        description={skill.description || undefined}
                        badges={<SkillMetaBadges skill={skill} />}
                        menuItems={[
                          {
                            label: "查看",
                            onClick: () => void openSkillViewer("other", skill),
                          },
                          {
                            label: "删除",
                            danger: true,
                            onClick: () => requestDeleteSkill("other", skill),
                          },
                        ]}
                      />
                    );
                  })}
                </ul>
              </Section>
            ) : null}
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
        title={profileEditor?.title ?? "概览 Skill"}
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
