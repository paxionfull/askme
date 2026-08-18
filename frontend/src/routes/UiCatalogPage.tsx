/**
 * Dev-only hub: component catalog moved to Storybook.
 */
import { Link } from "react-router-dom";
import { useLocale } from "../i18n/LocaleContext";

const STORYBOOK_URL = "http://127.0.0.1:6006";

export default function UiCatalogPage() {
  const { t, locale, setLocale } = useLocale();
  const isZh = locale === "zh";

  return (
    <div className="flex min-h-screen flex-col bg-[var(--paper)] text-[var(--ink)]">
      <header className="shrink-0 border-b border-[var(--rule)] bg-[var(--paper-raised)] px-5 py-3">
        <div className="mx-auto flex max-w-2xl flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">
              {isZh ? "组件图鉴" : "Component catalog"}
            </p>
            <h1 className="mt-0.5 text-lg font-semibold">
              {isZh ? "已迁到 Storybook" : "Moved to Storybook"}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="app-lang-toggle" role="group" aria-label={t("langSwitchLabel")}>
              <button
                type="button"
                className={locale === "en" ? "is-active" : ""}
                onClick={() => setLocale("en")}
                aria-pressed={locale === "en"}
              >
                {t("langEn")}
              </button>
              <button
                type="button"
                className={locale === "zh" ? "is-active" : ""}
                onClick={() => setLocale("zh")}
                aria-pressed={locale === "zh"}
              >
                {t("langZh")}
              </button>
            </div>
            <Link to="/" className="ui-btn text-xs">
              {isZh ? "回应用" : "Back to app"}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-8">
        <div className="rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)] p-5">
          <p className="text-sm text-[var(--ink)]">
            {isZh
              ? "真组件隔离验收改在 Storybook。本地在 frontend 目录运行："
              : "Isolated production-component review lives in Storybook. From frontend, run:"}
          </p>
          <pre className="mt-3 overflow-x-auto rounded-[var(--radius-control)] border border-[var(--rule)] bg-[var(--paper)] px-3 py-2 text-xs text-[var(--ink)]">
            npm run storybook
          </pre>
          <p className="mt-4 text-sm text-[var(--ink-muted)]">
            {isZh ? "然后打开：" : "Then open:"}
          </p>
          <a
            href={STORYBOOK_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex text-sm font-medium text-[var(--accent)] underline-offset-2 hover:underline"
          >
            {STORYBOOK_URL}
          </a>
          <p className="mt-4 text-xs text-[var(--ink-muted)]">
            {isZh
              ? "侧栏分组：通知｜弹层｜Sources｜Settings｜其它。顶栏可切换中英文。"
              : "Sidebar groups: Notify · Overlay · Sources · Settings · Other. Use the locale toolbar for zh/en."}
          </p>
        </div>
      </main>
    </div>
  );
}
