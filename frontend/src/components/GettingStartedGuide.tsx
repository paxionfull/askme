import { Link } from "react-router-dom";
import { useT } from "../i18n/LocaleContext";

interface GettingStartedGuideProps {
  onNavigate?: () => void;
  onExplainRule?: () => void;
}

export default function GettingStartedGuide({
  onNavigate,
  onExplainRule,
}: GettingStartedGuideProps) {
  const t = useT();

  return (
    <ol className="guide-steps">
      <li>
        <strong>{t("stepApiKeyTitle")}</strong>
        <span>
          {t("stepApiKeyBody")}{" "}
          <Link to="/settings?tab=model" className="guide-step-link" onClick={onNavigate}>
            {t("stepApiKeyLink")}
          </Link>
        </span>
      </li>
      <li>
        <strong>{t("stepAddSourceTitle")}</strong>
        <span>
          {t("stepAddSourceBody")}
          <Link to="/sources" className="guide-step-link" onClick={onNavigate}>
            {t("stepAddSourceLink")}
          </Link>
          {t("stepAddSourcePage")}
        </span>
      </li>
      <li>
        <strong>{t("stepRefreshTitle")}</strong>
        <span>{t("stepRefreshBody")}</span>
      </li>
      <li>
        <strong>{t("stepRulesTitle")}</strong>
        <span>
          {t("stepRulesBody")}
          {onExplainRule ? (
            <button type="button" onClick={onExplainRule} className="guide-step-hint">
              {t("stepRulesHint")}
            </button>
          ) : null}
        </span>
      </li>
      <li>
        <strong>{t("stepGenerateTitle")}</strong>
        <span>{t("stepGenerateBody")}</span>
      </li>
      <li>
        <strong>{t("stepScheduleTitle")}</strong>
        <span>
          {t("stepScheduleBody")}{" "}
          <Link to="/settings?tab=sync" className="guide-step-link" onClick={onNavigate}>
            {t("stepScheduleLink")}
          </Link>
        </span>
      </li>
    </ol>
  );
}

export function useGettingStartedCopy() {
  const t = useT();
  return {
    title: t("gettingStartedTitle"),
    intro: t("gettingStartedIntro"),
  };
}
