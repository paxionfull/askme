import { useMemo, useRef, useState, type ReactNode } from "react";
import type { DigestCategory, DigestProfile } from "../utils/digestProfile";
import { useLocale } from "../i18n/LocaleContext";
import { useModalA11y } from "../hooks/useModalA11y";

interface DigestProfileModalProps {
  open: boolean;
  title: string;
  loading?: boolean;
  error?: string;
  path?: string;
  skillId: string;
  idReadonly?: boolean;
  onSkillIdChange?: (value: string) => void;
  name: string;
  description: string;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  profile: DigestProfile;
  onProfileChange: (value: DigestProfile) => void;
  onClose: () => void;
  onSave?: () => void;
  saving?: boolean;
  onDelete?: () => void;
  deleting?: boolean;
}

function updateCategory(
  categories: DigestCategory[],
  index: number,
  patch: Partial<DigestCategory>,
): DigestCategory[] {
  return categories.map((item, i) => (i === index ? { ...item, ...patch } : item));
}

function reorderCategories(categories: DigestCategory[], from: number, to: number): DigestCategory[] {
  const next = [...categories];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function FieldBlock({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 border-t border-[var(--rule)] pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold tracking-tight text-[var(--ink)]">{title}</h4>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function DigestProfileModal({
  open,
  title,
  loading = false,
  error = "",
  path: _path,
  skillId,
  idReadonly = true,
  onSkillIdChange,
  name,
  description,
  onNameChange,
  onDescriptionChange,
  profile,
  onProfileChange,
  onClose,
  onSave,
  saving = false,
  onDelete,
  deleting = false,
}: DigestProfileModalProps) {
  const { t } = useLocale();
  const placeholders = useMemo(
    () => ({
      description: t("profileDescPh"),
      focusCriteria: t("profileFocusCriteriaPh"),
      categoryName: t("profileCategoryNamePh"),
      categoryCriteria: t("profileCategoryCriteriaPh"),
      ignoreCriteria: t("profileIgnoreCriteriaPh"),
    }),
    [t],
  );
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  useModalA11y(open, onClose, backdropRef);

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      className="ui-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="digest-profile-title"
    >
      <div className="ui-modal ui-modal-lg">
        <div className="ui-modal-header">
          <h2 id="digest-profile-title" className="ui-modal-title">
            {title}
          </h2>
        </div>

        <div className="ui-modal-body space-y-5">
          {loading ? <p className="text-sm text-[var(--ink-muted)]">{t("loading")}</p> : null}
          {error ? (
            <p className="text-sm text-[var(--danger-text)]" role="alert">
              {error}
            </p>
          ) : null}

          {!loading ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="ui-field">
                  <span className="ui-field-label">{t("settingsSkillIdLabel")}</span>
                  <input
                    value={skillId}
                    disabled={idReadonly}
                    onChange={(e) => onSkillIdChange?.(e.target.value)}
                    className="ui-input w-full disabled:opacity-60"
                  />
                </label>
                <label className="ui-field">
                  <span className="ui-field-label">{t("profileNameLabel")}</span>
                  <input
                    value={name}
                    onChange={(e) => onNameChange(e.target.value)}
                    className="ui-input w-full"
                  />
                </label>
              </div>
              <label className="ui-field">
                <span className="ui-field-label">{t("profileDescLabel")}</span>
                <input
                  value={description}
                  onChange={(e) => onDescriptionChange(e.target.value)}
                  placeholder={placeholders.description}
                  className="ui-input w-full"
                />
              </label>

              <FieldBlock
                title={t("profileFocusTitle")}
                action={
                  <label className="flex items-center gap-1.5 text-xs text-[var(--ink-muted)]">
                    <input
                      type="checkbox"
                      checked={profile.focus.enabled}
                      onChange={(e) =>
                        onProfileChange({
                          ...profile,
                          focus: { ...profile.focus, enabled: e.target.checked },
                        })
                      }
                    />
                    {t("profileEnable")}
                  </label>
                }
              >
                <textarea
                  value={profile.focus.criteria}
                  disabled={!profile.focus.enabled}
                  onChange={(e) =>
                    onProfileChange({
                      ...profile,
                      focus: { ...profile.focus, criteria: e.target.value },
                    })
                  }
                  rows={4}
                  placeholder={placeholders.focusCriteria}
                  className="ui-textarea w-full disabled:opacity-60"
                />
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
                    {t("profileMaxEvents")}
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={profile.focus.max_events}
                      disabled={!profile.focus.enabled}
                      onChange={(e) =>
                        onProfileChange({
                          ...profile,
                          focus: {
                            ...profile.focus,
                            max_events: Number(e.target.value) || 10,
                          },
                        })
                      }
                      className="ui-input w-20 disabled:opacity-60"
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-[var(--ink-muted)]">
                    <input
                      type="checkbox"
                      checked={profile.focus.exclusive}
                      disabled={!profile.focus.enabled}
                      onChange={(e) =>
                        onProfileChange({
                          ...profile,
                          focus: { ...profile.focus, exclusive: e.target.checked },
                        })
                      }
                    />
                    {t("profileFocusDedupe")}
                  </label>
                </div>
              </FieldBlock>

              <FieldBlock
                title={t("profileCategoriesTitle")}
                action={
                  <button
                    type="button"
                    className="ui-btn px-2 py-1 text-[11px]"
                    onClick={() =>
                      onProfileChange({
                        ...profile,
                        categories: [
                          ...profile.categories,
                          {
                            id: `cat-${profile.categories.length + 1}`,
                            name: "",
                            criteria: "",
                          },
                        ],
                      })
                    }
                  >
                    {t("profileAdd")}
                  </button>
                }
              >
                {profile.categories.length === 0 ? (
                  <p className="text-xs text-[var(--ink-muted)]">{t("profileNoCategories")}</p>
                ) : null}
                <ul className="space-y-3">
                  {profile.categories.map((cat, index) => (
                    <li
                      key={`${cat.id}-${index}`}
                      className={`space-y-2 rounded-[var(--radius-control)] border px-3 py-2 transition-colors ${
                        dragOverIndex === index
                          ? "border-[color-mix(in_srgb,var(--accent)_40%,var(--border))] bg-[var(--accent-soft)]"
                          : "border-transparent"
                      } ${draggingIndex === index ? "opacity-45" : ""}`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOverIndex(index);
                      }}
                      onDragLeave={() => {
                        setDragOverIndex((current) => (current === index ? null : current));
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from =
                          draggingIndex ?? Number.parseInt(e.dataTransfer.getData("text/plain"), 10);
                        if (Number.isNaN(from) || from === index) {
                          setDraggingIndex(null);
                          setDragOverIndex(null);
                          return;
                        }
                        onProfileChange({
                          ...profile,
                          categories: reorderCategories(profile.categories, from, index),
                        });
                        setDraggingIndex(null);
                        setDragOverIndex(null);
                      }}
                    >
                      <div className="flex gap-2">
                        <button
                          type="button"
                          draggable
                          onDragStart={(e) => {
                            setDraggingIndex(index);
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData("text/plain", String(index));
                          }}
                          onDragEnd={() => {
                            setDraggingIndex(null);
                            setDragOverIndex(null);
                          }}
                          className="flex h-6 w-6 shrink-0 cursor-grab items-center justify-center rounded-[var(--radius-control)] border-0 bg-transparent text-sm leading-none text-[var(--ink-muted)] active:cursor-grabbing hover:bg-[var(--paper)] hover:text-[var(--ink)]"
                          aria-label={t("profileDragReorder")}
                          title={t("profileDragReorder")}
                        >
                          ⋮⋮
                        </button>
                        <input
                          value={cat.name}
                          onChange={(e) =>
                            onProfileChange({
                              ...profile,
                              categories: updateCategory(profile.categories, index, {
                                name: e.target.value,
                              }),
                            })
                          }
                          placeholder={placeholders.categoryName}
                          className="ui-input min-w-0 flex-1"
                        />
                        <button
                          type="button"
                          className="ui-btn ui-btn-danger shrink-0 px-2 py-1 text-[11px]"
                          onClick={() =>
                            onProfileChange({
                              ...profile,
                              categories: profile.categories.filter((_, i) => i !== index),
                            })
                          }
                        >
                          {t("delete")}
                        </button>
                      </div>
                      <textarea
                        value={cat.criteria}
                        onChange={(e) =>
                          onProfileChange({
                            ...profile,
                            categories: updateCategory(profile.categories, index, {
                              criteria: e.target.value,
                            }),
                          })
                        }
                        rows={2}
                        placeholder={placeholders.categoryCriteria}
                        className="ui-textarea w-full"
                      />
                    </li>
                  ))}
                </ul>
              </FieldBlock>

              <FieldBlock title={t("profileIgnoreTitle")}>
                <textarea
                  value={profile.ignore.criteria}
                  onChange={(e) =>
                    onProfileChange({
                      ...profile,
                      ignore: { criteria: e.target.value },
                    })
                  }
                  rows={3}
                  placeholder={placeholders.ignoreCriteria}
                  className="ui-textarea w-full"
                />
              </FieldBlock>

              <label className="flex items-center gap-1.5 text-xs text-[var(--ink-muted)]">
                <input
                  type="checkbox"
                  checked={profile.cluster.enabled}
                  onChange={(e) =>
                    onProfileChange({
                      ...profile,
                      cluster: { enabled: e.target.checked },
                    })
                  }
                />
                {t("profileClusterEvents")}
              </label>
            </>
          ) : null}
        </div>

        <div className="ui-modal-footer !justify-between">
          <div>
            {onDelete ? (
              <button
                type="button"
                disabled={deleting || saving}
                onClick={onDelete}
                className="ui-btn ui-btn-danger text-xs disabled:opacity-50"
              >
                {deleting ? t("skillDetailDeleting") : t("delete")}
              </button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="ui-btn text-xs">
              {t("cancel")}
            </button>
            {onSave ? (
              <button
                type="button"
                disabled={saving || loading}
                onClick={onSave}
                className="ui-btn ui-btn-primary text-xs disabled:opacity-50"
              >
                {saving ? t("saving") : t("save")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
