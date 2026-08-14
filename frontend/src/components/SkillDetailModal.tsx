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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-sm font-semibold">
            {detail?.name?.trim() || title}
            {detail && detail.name?.trim() && detail.name !== detail.id && (
              <span className="ml-2 text-xs font-normal text-slate-400">({detail.id})</span>
            )}
          </h3>
          {detail && (
            <p className="mt-1 text-xs text-slate-500">
              {detail.description || "无描述"}
              {detail.path ? ` · ${detail.path}` : ""}
            </p>
          )}
        </div>

        {loading && <p className="px-5 py-4 text-sm text-slate-500">加载中...</p>}
        {error && <p className="px-5 py-4 text-sm text-red-600">{error}</p>}

        {!loading && !error && detail && tabs.length > 0 && (
          <>
            <div className="flex flex-wrap gap-1 border-b border-slate-200 px-5 py-2">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-md px-2 py-1 text-xs ${
                    active?.id === tab.id
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-auto px-5 py-4">
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
        )}

        {!loading && !error && detail && tabs.length === 0 && (
          <p className="px-5 py-4 text-sm text-slate-500">该 skill 暂无可读文件。</p>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          {repairable && onRepair && (
            <button
              type="button"
              disabled={repairing}
              onClick={onRepair}
              className="mr-auto rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
            >
              {repairing ? "修复中…" : "反馈并修复"}
            </button>
          )}
          {deletable && onDelete && (
            <button
              type="button"
              disabled={deleting}
              onClick={onDelete}
              className={`rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 ${
                repairable ? "" : "mr-auto"
              }`}
            >
              {deleting ? "删除中..." : "删除"}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
