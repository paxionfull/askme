import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchDigestSkills, type DigestSkillDetail } from "../api";
import { useLocale } from "../i18n/LocaleContext";
import { useModalA11y } from "../hooks/useModalA11y";

interface RuleExplainModalProps {
  open: boolean;
  onClose: () => void;
  /** 若已有规则列表可传入，避免重复请求 */
  skills?: DigestSkillDetail[];
}

export default function RuleExplainModal({ open, onClose, skills }: RuleExplainModalProps) {
  const { t } = useLocale();
  const [loaded, setLoaded] = useState<DigestSkillDetail[]>(skills ?? []);
  const backdropRef = useRef<HTMLDivElement>(null);
  useModalA11y(open, onClose, backdropRef);

  useEffect(() => {
    if (skills) {
      setLoaded(skills);
      return;
    }
    if (!open) return;
    let cancelled = false;
    void fetchDigestSkills()
      .then((data) => {
        if (!cancelled) setLoaded(data.skills);
      })
      .catch(() => {
        if (!cancelled) setLoaded([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, skills]);

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      className="ui-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rule-explain-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ui-modal ui-modal-md">
        <div className="ui-modal-header">
          <h2 id="rule-explain-title" className="ui-modal-title">
            {t("ruleExplainTitle")}
          </h2>
          <p className="ui-modal-desc">{t("ruleExplainDesc")}</p>
        </div>
        <div className="ui-modal-body space-y-2">
          {loaded.length === 0 ? (
            <p className="text-sm text-[var(--ink-muted)]">{t("ruleExplainEmpty")}</p>
          ) : (
            <ul className="space-y-2">
              {loaded.map((skill) => (
                <li
                  key={skill.id}
                  className="rounded-[var(--radius-control)] border border-[var(--rule)] bg-[var(--paper)] px-3 py-2.5 text-left"
                >
                  <p className="text-sm font-medium text-[var(--ink)]">{skill.name || skill.id}</p>
                  {skill.description ? (
                    <p className="mt-0.5 text-xs leading-5 text-[var(--ink-muted)]">
                      {skill.description}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="ui-modal-footer">
          <Link to="/settings?tab=skill" onClick={onClose} className="ui-btn text-sm">
            {t("ruleExplainGoSkills")}
          </Link>
          <button type="button" onClick={onClose} className="ui-btn ui-btn-primary text-sm">
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  );
}
