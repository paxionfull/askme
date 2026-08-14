import { useEffect, useMemo, useState } from "react";
import MarkdownContent from "./MarkdownContent";
import { stripFrontmatter } from "../utils/skillDocument";

interface SkillMarkdownModalProps {
  open: boolean;
  title: string;
  loading?: boolean;
  error?: string;
  path?: string;
  document: string;
  onDocumentChange: (value: string) => void;
  skillId?: string;
  onSkillIdChange?: (value: string) => void;
  idReadonly?: boolean;
  previewMode?: "full" | "body";
  onClose: () => void;
  onSave?: () => void;
  saving?: boolean;
  onDelete?: () => void;
  deleting?: boolean;
}

export default function SkillMarkdownModal({
  open,
  title,
  loading = false,
  error = "",
  path,
  document,
  onDocumentChange,
  skillId,
  onSkillIdChange,
  idReadonly = true,
  previewMode = "body",
  onClose,
  onSave,
  saving = false,
  onDelete,
  deleting = false,
}: SkillMarkdownModalProps) {
  const [tab, setTab] = useState<"preview" | "edit">("preview");
  const rendered = useMemo(
    () => (previewMode === "full" ? document : stripFrontmatter(document)),
    [document, previewMode],
  );

  useEffect(() => {
    if (open) {
      setTab("preview");
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-sm font-semibold">{title}</h3>
          {path && <p className="mt-1 text-xs text-slate-500">{path}</p>}
        </div>

        {onSkillIdChange && (
          <div className="border-b border-slate-200 px-5 py-3">
            <label className="text-xs text-slate-500">Skill ID</label>
            <input
              value={skillId ?? ""}
              disabled={idReadonly}
              onChange={(e) => onSkillIdChange(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:bg-slate-100"
            />
          </div>
        )}

        {loading && <p className="px-5 py-4 text-sm text-slate-500">加载中...</p>}
        {error && <p className="px-5 py-4 text-sm text-red-600">{error}</p>}

        {!loading && !error && (
          <>
            <div className="flex gap-1 border-b border-slate-200 px-5 py-2">
              <button
                type="button"
                onClick={() => setTab("preview")}
                className={`rounded-md px-2 py-1 text-xs ${
                  tab === "preview" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                预览
              </button>
              <button
                type="button"
                onClick={() => setTab("edit")}
                className={`rounded-md px-2 py-1 text-xs ${
                  tab === "edit" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                编辑
              </button>
            </div>
            <div className="flex-1 overflow-auto px-5 py-4">
              {tab === "preview" ? (
                <MarkdownContent content={rendered} />
              ) : (
                <textarea
                  value={document}
                  onChange={(e) => onDocumentChange(e.target.value)}
                  rows={20}
                  className="h-full min-h-[360px] w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-slate-500"
                />
              )}
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          {onDelete && (
            <button
              type="button"
              disabled={deleting}
              onClick={onDelete}
              className="mr-auto rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
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
          {onSave && (
            <button
              type="button"
              disabled={saving || loading}
              onClick={onSave}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
