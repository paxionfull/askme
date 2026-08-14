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
    <div className="ui-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="skill-md-title">
      <div className="ui-modal ui-modal-lg">
        <div className="ui-modal-header">
          <h2 id="skill-md-title" className="ui-modal-title">
            {title}
          </h2>
          {path ? <p className="ui-modal-desc">{path}</p> : null}
        </div>

        {onSkillIdChange ? (
          <div className="border-b border-[var(--rule)] px-5 py-3">
            <label className="ui-field">
              <span className="ui-field-label">Skill ID</span>
              <input
                value={skillId ?? ""}
                disabled={idReadonly}
                onChange={(e) => onSkillIdChange(e.target.value)}
                className="ui-input w-full disabled:opacity-60"
              />
            </label>
          </div>
        ) : null}

        <div className="ui-modal-body !p-0">
          {loading ? <p className="px-5 py-6 text-sm text-[var(--ink-muted)]">加载中…</p> : null}
          {error ? <p className="px-5 py-6 text-sm text-red-800">{error}</p> : null}

          {!loading && !error ? (
            <>
              <div className="flex gap-0 border-b border-[var(--rule)] px-5">
                {(
                  [
                    ["preview", "预览"],
                    ["edit", "编辑"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    className={`border-b-2 px-3 py-2.5 text-xs transition-colors ${
                      tab === id
                        ? "border-[var(--ink)] font-medium text-[var(--ink)]"
                        : "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="max-h-[min(52vh,28rem)] overflow-auto px-5 py-4">
                {tab === "preview" ? (
                  <MarkdownContent content={rendered} />
                ) : (
                  <textarea
                    value={document}
                    onChange={(e) => onDocumentChange(e.target.value)}
                    rows={20}
                    className="ui-textarea min-h-[360px] w-full font-mono text-xs leading-5"
                  />
                )}
              </div>
            </>
          ) : null}
        </div>

        <div className="ui-modal-footer !justify-between">
          <div>
            {onDelete ? (
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
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="ui-btn text-xs">
              关闭
            </button>
            {onSave ? (
              <button
                type="button"
                disabled={saving || loading}
                onClick={onSave}
                className="ui-btn ui-btn-primary text-xs disabled:opacity-50"
              >
                {saving ? "保存中…" : "保存"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
