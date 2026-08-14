import { useState } from "react";
import GettingStartedGuide, {
  GETTING_STARTED_INTRO,
  GETTING_STARTED_TITLE,
} from "./GettingStartedGuide";
import RuleExplainModal from "./RuleExplainModal";

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
}

export default function HelpModal({ open, onClose }: HelpModalProps) {
  const [ruleExplainOpen, setRuleExplainOpen] = useState(false);

  return (
    <>
      {open ? (
        <div
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
                {GETTING_STARTED_TITLE}
              </h2>
              <p className="ui-modal-desc">{GETTING_STARTED_INTRO}</p>
            </div>
            <div className="ui-modal-body">
              <GettingStartedGuide
                onNavigate={onClose}
                onExplainRule={() => {
                  onClose();
                  setRuleExplainOpen(true);
                }}
              />
            </div>
            <div className="ui-modal-footer">
              <button type="button" onClick={onClose} className="ui-btn text-sm">
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <RuleExplainModal open={ruleExplainOpen} onClose={() => setRuleExplainOpen(false)} />
    </>
  );
}
