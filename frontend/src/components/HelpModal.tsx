import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import GettingStartedGuide, { useGettingStartedCopy } from "./GettingStartedGuide";
import RuleExplainModal from "./RuleExplainModal";
import { useLocale } from "../i18n/LocaleContext";
import { isLlmConfigured, useSettings } from "../hooks/useSettings";
import { useModalA11y } from "../hooks/useModalA11y";

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
}

function TodayGuide({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useLocale();
  return (
    <ol className="guide-steps">
      <li>
        <strong>{t("helpTodayUpdate")}</strong>
        <span>
          {t("helpTodayUpdateBody")}{" "}
          <Link to="/sources" className="guide-step-link" onClick={onNavigate}>
            {t("navSources")}
          </Link>
        </span>
      </li>
      <li>
        <strong>{t("helpTodayScan")}</strong>
        <span>
          {t("helpTodayScanBody")}{" "}
          <Link to="/" className="guide-step-link" onClick={onNavigate}>
            {t("navBrief")}
          </Link>
        </span>
      </li>
      <li>
        <strong>{t("helpTodayAsk")}</strong>
        <span>{t("helpTodayAskBody")}</span>
      </li>
    </ol>
  );
}

export default function HelpModal({ open, onClose }: HelpModalProps) {
  const { t } = useLocale();
  const { settings } = useSettings();
  const configured = isLlmConfigured(settings);
  const [mode, setMode] = useState<"today" | "setup">(configured ? "today" : "setup");
  const [ruleExplainOpen, setRuleExplainOpen] = useState(false);
  const gettingStarted = useGettingStartedCopy();
  const backdropRef = useRef<HTMLDivElement>(null);
  useModalA11y(open, onClose, backdropRef);

  useEffect(() => {
    if (!open) return;
    setMode(configured ? "today" : "setup");
  }, [open, configured]);

  const title = mode === "today" ? t("helpTodayTitle") : gettingStarted.title;
  const intro = mode === "today" ? t("helpTodayIntro") : gettingStarted.intro;

  return (
    <>
      {open ? (
        <div
          ref={backdropRef}
          className="ui-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <div className="ui-modal ui-modal-md">
            <div className="ui-modal-header">
              <h2 id="help-modal-title" className="ui-modal-title">
                {title}
              </h2>
              <p className="ui-modal-desc">{intro}</p>
            </div>
            <div className="ui-modal-body">
              {mode === "today" ? (
                <TodayGuide onNavigate={onClose} />
              ) : (
                <GettingStartedGuide
                  onNavigate={onClose}
                  onExplainRule={() => {
                    onClose();
                    setRuleExplainOpen(true);
                  }}
                />
              )}
            </div>
            <div className="ui-modal-footer flex flex-wrap items-center justify-between gap-2">
              {configured ? (
                <button
                  type="button"
                  className="text-xs text-[var(--accent)] hover:underline"
                  onClick={() => setMode((m) => (m === "today" ? "setup" : "today"))}
                >
                  {mode === "today" ? t("helpShowSetup") : t("helpShowToday")}
                </button>
              ) : (
                <span />
              )}
              <button type="button" onClick={onClose} className="ui-btn text-sm">
                {t("close")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <RuleExplainModal open={ruleExplainOpen} onClose={() => setRuleExplainOpen(false)} />
    </>
  );
}
