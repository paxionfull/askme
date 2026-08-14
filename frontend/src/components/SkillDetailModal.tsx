import { useEffect, useMemo, useState } from "react";
import CodeViewer, { languageFromPath } from "./CodeViewer";
import MarkdownContent from "./MarkdownContent";
import type { SkillDetail } from "../api";

interface SkillDetailModalProps {
  open: boolean;
  title: string;
  loading: boolean;
  error: string;
  detail: SkillDetail | null;
  deletable?: boolean;
  deleting?: boolean;
  repairable?: boolean;
  repairing?: boolean;
  onClose: () => void;
  onDelete?: () => void;
  onRepair?: () => void;
}

type TabFormat = "markdown" | "code";

interface SkillTab {
  id: string;
  label: string;
  content: string;
  format: TabFormat;
  language?: string;
}

function extraFiles(detail: SkillDetail | null) {
  if (!detail?.files?.length) return [];
  const skip = new Set(["SKILL.md", "source.yaml"]);
  return detail.files.filter((file) => !skip.has(file.path));
}

function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith("---\n")) return markdown;
  const end = markdown.indexOf("\n---\n", 4);
  if (end === -1) return markdown;
  return markdown.slice(end + 5).trimStart();
}

function tabFormat(path: string): TabFormat {
  if (path.toLowerCase().endsWith(".md")) {
    return "markdown";
  }
  return "code";
}

export default function SkillDetailModal({
  open,
  title,
  loading,
  error,
  detail,
  deletable = false,
  deleting = false,
  repairable = false,
  repairing = false,
  onClose,
  onDelete,
  onRepair,
}: SkillDetailModalProps) {
  const tabs = useMemo(() => {
    if (!detail) return [] as SkillTab[];
    const items: SkillTab[] = [];
    if (detail.skill_md?.trim()) {
      items.push({
        id: "skill_md",
        label: "SKILL.md",
        content: stripFrontmatter(detail.skill_md),
        format: "markdown",
      });
    }
    if (detail.source_yaml?.trim()) {
      items.push({
        id: "source_yaml",
        label: "source.yaml",
        content: detail.source_yaml,
        format: "code",
        language: "yaml",
      });
    }
    for (const file of extraFiles(detail)) {
      items.push({
        id: file.path,
        label: file.path,
        content: file.content,
        format: tabFormat(file.path),
        language: languageFromPath(file.path),
      });
    }
    return items;
  }, [detail]);

  const [activeTab, setActiveTab] = useState("");

  useEffect(() => {
    if (open && tabs.length > 0) {
      setActiveTab(tabs[0].id);
    }
  }, [open, tabs]);

  if (!open) return null;

  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
  const heading = detail?.name?.trim() || title;

  return (
    <div className="ui-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="skill-detail-title">
      <div className="ui-modal ui-modal-lg">
        <div className="ui-modal-header">
          <h2 id="skill-detail-title" className="ui-modal-title">
            {heading}
            {detail?.name?.trim() && detail.name !== detail.id ? (
              <span className="ml-2 text-xs font-normal text-[var(--ink-muted)]">{detail.id}</span>
            ) : null}
          </h2>
          {detail ? (
            <p className="ui-modal-desc">
              {detail.description || "无描述"}
              {detail.path ? ` · ${detail.path}` : ""}
            </p>
          ) : null}
        </div>

        <div className="ui-modal-body !p-0">
          {loading ? <p className="px-5 py-6 text-sm text-[var(--ink-muted)]">加载中…</p> : null}
          {error ? <p className="px-5 py-6 text-sm text-red-800">{error}</p> : null}

          {!loading && !error && detail && tabs.length > 0 ? (
            <>
              <div className="flex gap-0 overflow-x-auto border-b border-[var(--rule)] px-5">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`shrink-0 border-b-2 px-3 py-2.5 text-xs transition-colors ${
                      active?.id === tab.id
                        ? "border-[var(--ink)] font-medium text-[var(--ink)]"
                        : "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="max-h-[min(52vh,28rem)] overflow-auto px-5 py-4">
                {active?.format === "markdown" ? (
                  <MarkdownContent content={active.content} />
                ) : (
                  <CodeViewer
                    code={active?.content ?? ""}
                    language={active?.language}
                    filename={active?.label}
                  />
                )}
              </div>
            </>
          ) : null}

          {!loading && !error && detail && tabs.length === 0 ? (
            <p className="px-5 py-6 text-sm text-[var(--ink-muted)]">该 Skill 暂无可读文件。</p>
          ) : null}
        </div>

        <div className="ui-modal-footer !justify-between">
          <div className="flex gap-2">
            {repairable && onRepair ? (
              <button
                type="button"
                disabled={repairing}
                onClick={onRepair}
                className="ui-btn ui-btn-accent text-xs disabled:opacity-50"
              >
                {repairing ? "修复中…" : "反馈修复"}
              </button>
            ) : null}
            {deletable && onDelete ? (
              <button
                type="button"
                disabled={deleting}
                onClick={onDelete}
                className="ui-btn ui-btn-danger text-xs disabled:opacity-50"
              >
                {deleting ? "删除中…" : "删除"}
              </button>
            ) : null}
          </div>
          <button type="button" onClick={onClose} className="ui-btn text-xs">
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
