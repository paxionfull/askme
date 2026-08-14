import type { ReactNode } from "react";
import type { DigestCategory, DigestProfile } from "../utils/digestProfile";

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
  path,
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
  if (!open) return null;

  return (
    <div className="ui-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="digest-profile-title">
      <div className="ui-modal ui-modal-lg">
        <div className="ui-modal-header">
          <h2 id="digest-profile-title" className="ui-modal-title">
            {title}
          </h2>
          <p className="ui-modal-desc">
            {path ? `${path} · ` : ""}
            配置分类与重点规则，系统按固定模板生成目录
          </p>
        </div>

        <div className="ui-modal-body space-y-5">
          {loading ? <p className="text-sm text-[var(--ink-muted)]">加载中…</p> : null}
          {error ? <p className="text-sm text-red-800">{error}</p> : null}

          {!loading ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="ui-field">
                  <span className="ui-field-label">Skill ID</span>
                  <input
                    value={skillId}
                    disabled={idReadonly}
                    onChange={(e) => onSkillIdChange?.(e.target.value)}
                    className="ui-input w-full disabled:opacity-60"
                  />
                </label>
                <label className="ui-field">
                  <span className="ui-field-label">名称</span>
                  <input
                    value={name}
                    onChange={(e) => onNameChange(e.target.value)}
                    className="ui-input w-full"
                  />
                </label>
              </div>
              <label className="ui-field">
                <span className="ui-field-label">描述</span>
                <input
                  value={description}
                  onChange={(e) => onDescriptionChange(e.target.value)}
                  className="ui-input w-full"
                />
              </label>

              <FieldBlock
                title="重点关注"
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
                    启用
                  </label>
                }
              >
                <label className="ui-field">
                  <span className="ui-field-label">判定标准</span>
                  <textarea
                    value={profile.focus.criteria}
                    disabled={!profile.focus.enabled}
                    onChange={(e) =>
                      onProfileChange({
                        ...profile,
                        focus: { ...profile.focus, criteria: e.target.value },
                      })
                    }
                    rows={3}
                    className="ui-textarea w-full disabled:opacity-60"
                  />
                </label>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
                    最多事件数
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
                    重点文章不在分类中重复
                  </label>
                </div>
              </FieldBlock>

              <FieldBlock
                title="分类"
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
                            name: `分类 ${profile.categories.length + 1}`,
                            criteria: "",
                          },
                        ],
                      })
                    }
                  >
                    添加
                  </button>
                }
              >
                {profile.categories.length === 0 ? (
                  <p className="text-xs text-[var(--ink-muted)]">暂无分类（仍会有「其他」）</p>
                ) : null}
                <ul className="space-y-3">
                  {profile.categories.map((cat, index) => (
                    <li key={`${cat.id}-${index}`} className="space-y-2 border-l-2 border-[var(--rule)] pl-3">
                      <div className="flex gap-2">
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
                          placeholder="分类名"
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
                          删除
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
                        placeholder="分类标准"
                        className="ui-textarea w-full"
                      />
                    </li>
                  ))}
                </ul>
              </FieldBlock>

              <FieldBlock title="不重要">
                <p className="text-xs text-[var(--ink-muted)]">
                  作为分类桶之一；被标为不重要的文章不会进入聚类与渲染。
                </p>
                <textarea
                  value={profile.ignore.criteria}
                  onChange={(e) =>
                    onProfileChange({
                      ...profile,
                      ignore: { criteria: e.target.value },
                    })
                  }
                  rows={2}
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
                启用类内事件聚类
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
                {deleting ? "删除中…" : "删除"}
              </button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="ui-btn text-xs">
              取消
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
