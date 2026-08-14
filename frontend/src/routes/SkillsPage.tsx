import { useCallback, useEffect, useMemo, useState } from "react";
import ConfirmModal from "../components/ConfirmModal";
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
  type SkillDetail,
  type SkillItem,
  type SkillsCatalog,
} from "../api";
import { newDigestSkillMd } from "../utils/skillDocument";

function newDigestSkillId() {
  return `custom-${Math.random().toString(36).slice(2, 8)}-digest`;
}

function SkillListItem({
  skill,
  onEdit,
  onView,
  onDelete,
  editLabel = "编辑",
}: {
  skill: SkillItem;
  onEdit?: () => void;
  onView?: () => void;
  onDelete?: () => void;
  editLabel?: string;
}) {
  const displayName = skill.name?.trim() || skill.id;
  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="font-medium text-slate-900">
          {displayName}
          {displayName !== skill.id && (
            <span className="ml-2 text-xs font-normal text-slate-400">({skill.id})</span>
          )}
        </p>
        {skill.builtin && <span className="mt-1 inline-block text-xs text-slate-400">内置</span>}
        <p className="mt-1 text-xs text-slate-500">{skill.description || "无描述"}</p>
        {skill.path && <p className="mt-1 text-xs text-slate-400">{skill.path}</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        {onView && (
          <button type="button" onClick={onView} className="text-xs text-slate-600 underline">
            查看
          </button>
        )}
        {onEdit && (
          <button type="button" onClick={onEdit} className="text-xs text-slate-600 underline">
            {editLabel}
          </button>
        )}
        {onDelete && (
          <button type="button" onClick={onDelete} className="text-xs text-red-600 underline">
            删除
          </button>
        )}
      </div>
    </li>
  );
}

function DigestSkillListItem({
  skill,
  isDefault,
  onSetDefault,
  onEdit,
  onDelete,
  settingDefault,
}: {
  skill: SkillItem;
  isDefault: boolean;
  onSetDefault: () => void;
  onEdit: () => void;
  onDelete: () => void;
  settingDefault: boolean;
}) {
  const displayName = skill.name?.trim() || skill.id;
  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="font-medium text-slate-900">
          {displayName}
          {displayName !== skill.id && (
            <span className="ml-2 text-xs font-normal text-slate-400">({skill.id})</span>
          )}
        </p>
        {skill.builtin && <span className="mt-1 inline-block text-xs text-slate-400">内置</span>}
        <p className="mt-1 text-xs text-slate-500">{skill.description || "无描述"}</p>
        {skill.path && <p className="mt-1 text-xs text-slate-400">{skill.path}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {isDefault ? (
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">默认</span>
        ) : (
          <button
            type="button"
            disabled={settingDefault}
            onClick={onSetDefault}
            className="text-xs text-slate-600 underline disabled:opacity-50"
          >
            设为默认
          </button>
        )}
        <button type="button" onClick={onEdit} className="text-xs text-slate-600 underline">
          编辑
        </button>
        <button type="button" onClick={onDelete} className="text-xs text-red-600 underline">
          删除
        </button>
      </div>
    </li>
  );
}

export default function SkillsPage() {
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

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchSkillsCatalog();
      setCatalog(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (
      onboardJob?.kind === "repair" &&
      onboardJob.phase === "done" &&
      !onboardJob.running
    ) {
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
      setMarkdownEditor({
        category: "digest",
        title: "新建 Digest Skill",
        skillId: id,
        isNew: true,
      });
      setMarkdownDocument(newDigestSkillMd(id));
      setMarkdownError("");
      return;
    }

    setMarkdownEditor({
      category: "digest",
      title: `Digest · ${skill.name || skill.id}`,
      skillId: skill.id,
      isNew: false,
      path: skill.path,
    });
    setMarkdownDocument("");
    setMarkdownError("");
    setMarkdownLoading(true);
    try {
      const detail = await fetchDigestSkillDetail(skill.id);
      setMarkdownDocument(detail.skill_md || "");
    } catch (err) {
      setMarkdownError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setMarkdownLoading(false);
    }
  }

  async function openChatEditor() {
    if (!catalog) return;
    const chat = catalog.chat;
    const displayName = chat.name?.trim() || chat.id;
    setMarkdownEditor({
      category: "chat",
      title: `对话 · ${displayName}`,
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
      setMessage("已设为默认 digest skill");
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
        setMessage("对话 skill 已保存");
      } else {
        const skillId = markdownEditor.skillId.trim();
        const skill_md = markdownDocument.trim();
        if (!skillId.endsWith("-digest")) {
          throw new Error("Digest skill id 需以 -digest 结尾");
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
        setMessage("Digest skill 已保存");
      }
      closeMarkdownEditor();
      await loadCatalog();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  function deleteConfirmMessage() {
    if (!deleteTarget) return "";
    if (deleteTarget.category === "digest") {
      return `确定删除 digest skill「${deleteTarget.name}」？\n\n删除后无法恢复。内置 skill 需从仓库重新检出才能恢复。`;
    }
    if (deleteTarget.category === "discovery") {
      return `确定删除 discovery skill「${deleteTarget.name}」？\n\n将删除 skill 目录并隐藏对应数据源。内置 skill 需从仓库重新检出才能恢复。`;
    }
    return `确定删除 skill「${deleteTarget.name}」？\n\n将删除 skill 目录，删除后无法恢复。`;
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-base font-semibold">Skill 管理</h1>
        <p className="mt-1 text-sm text-slate-500">
          管理 Discovery、Digest、对话等 skill。分组可在「数据源 → 管理分组」绑定 digest skill。
        </p>
      </header>

      <div className="mx-auto max-w-4xl space-y-6 p-6">
        {loading && <p className="text-sm text-slate-500">加载中...</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {message && <p className="text-sm text-green-700">{message}</p>}

        {catalog && (
          <>
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Digest 概览 Skill</h2>
                <button
                  type="button"
                  onClick={() => void openDigestEditor()}
                  className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-700"
                >
                  新建
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                按 SKILL.md 格式编写概览 skill；生成概览时使用完整 skill 内容作为指令。
              </p>
              <ul className="mt-4 space-y-2">
                {catalog.digest.map((skill) => (
                  <DigestSkillListItem
                    key={skill.id}
                    skill={skill}
                    isDefault={skill.id === defaultDigestSkillId || Boolean(skill.is_default)}
                    settingDefault={settingDefaultId === skill.id}
                    onSetDefault={() => void handleSetDefaultDigest(skill.id)}
                    onEdit={() => void openDigestEditor(skill)}
                    onDelete={() => requestDeleteSkill("digest", skill)}
                  />
                ))}
              </ul>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold">对话 Skill</h2>
              <p className="mt-1 text-xs text-slate-500">
                按 SKILL.md 格式编写对话 skill；引用规则由系统在每次请求时追加。
              </p>
              <ul className="mt-3 space-y-2">
                <SkillListItem skill={catalog.chat} onEdit={openChatEditor} />
              </ul>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">Discovery Skill</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    数据源抓取 skill，可查看详情、反馈问题让 Cursor 修复，或删除（删除后隐藏对应数据源）。
                  </p>
                </div>
                <label className="block w-full max-w-xs text-xs text-slate-500 sm:w-56">
                  <span className="sr-only">搜索 Discovery Skill</span>
                  <input
                    type="search"
                    value={discoveryQuery}
                    onChange={(e) => setDiscoveryQuery(e.target.value)}
                    placeholder="搜索 id / 名称 / 描述…"
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-800"
                  />
                </label>
              </div>
              <ul className="mt-3 space-y-2">
                {filteredDiscovery.length === 0 ? (
                  <li className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-500">
                    {discoveryQuery.trim()
                      ? `没有匹配「${discoveryQuery.trim()}」的 discovery skill`
                      : "暂无 discovery skill"}
                  </li>
                ) : (
                  filteredDiscovery.map((skill) => (
                    <SkillListItem
                      key={skill.id}
                      skill={skill}
                      onView={() => void openSkillViewer("discovery", skill)}
                      onDelete={() => requestDeleteSkill("discovery", skill)}
                    />
                  ))
                )}
              </ul>
              {discoveryQuery.trim() && filteredDiscovery.length > 0 && (
                <p className="mt-2 text-xs text-slate-400">
                  显示 {filteredDiscovery.length} / {catalog.discovery.length} 个
                </p>
              )}
            </section>

            {catalog.other.length > 0 && (
              <section className="rounded-xl border border-slate-200 bg-white p-5">
                <h2 className="text-sm font-semibold">其他 Skill</h2>
                <ul className="mt-3 space-y-2">
                  {catalog.other.map((skill) => (
                    <SkillListItem
                      key={skill.id}
                      skill={skill}
                      onView={() => void openSkillViewer("other", skill)}
                      onDelete={() => requestDeleteSkill("other", skill)}
                    />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
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
        previewMode={markdownEditor?.category === "digest" || markdownEditor?.category === "chat" ? "body" : "full"}
        skillId={markdownEditor?.category === "digest" && markdownEditor.isNew ? markdownEditor.skillId : undefined}
        onSkillIdChange={
          markdownEditor?.category === "digest" && markdownEditor.isNew
            ? (value) => setMarkdownEditor((current) => (current ? { ...current, skillId: value } : current))
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
                  name: markdownEditor.title.replace(/^Digest · /, ""),
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
