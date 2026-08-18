import type { ReactNode } from "react";
import { IconBrief, IconHelp, IconSettings, IconSources } from "../../components/icons/NavIcons";
import { useLocale } from "../../i18n/LocaleContext";

type NavId = "brief" | "sources" | "settings";

type FakeAppShellProps = {
  activeNav?: NavId;
  heightClassName?: string;
  children: ReactNode;
};

export default function FakeAppShell({
  activeNav = "sources",
  heightClassName = "h-[28rem]",
  children,
}: FakeAppShellProps) {
  const { t } = useLocale();
  const items: Array<{ id: NavId; label: string; Icon: typeof IconBrief }> = [
    { id: "brief", label: t("navBrief"), Icon: IconBrief },
    { id: "sources", label: t("navSources"), Icon: IconSources },
    { id: "settings", label: t("navSettings"), Icon: IconSettings },
  ];

  return (
    <div className={`sb-app-shell flex ${heightClassName} bg-[var(--surface)] text-[var(--ink)]`}>
      <aside className="app-sidebar shrink-0" aria-hidden="true">
        <div className="app-sidebar-brand">
          <span className="text-xs font-semibold text-[var(--ink)]">{t("appName")}</span>
        </div>
        <nav className="flex flex-1 flex-col py-2">
          {items.map(({ id, label, Icon }) => (
            <div
              key={id}
              className={`app-nav-link${activeNav === id ? " is-active" : ""}`}
              title={label}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="app-nav-label">{label}</span>
            </div>
          ))}
          <div className="min-h-2 flex-1" />
          <div className="app-nav-link mx-auto" title={t("navHelp")}>
            <IconHelp className="h-5 w-5 shrink-0" />
            <span className="app-nav-label">{t("navHelp")}</span>
          </div>
        </nav>
      </aside>
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--paper)]">{children}</div>
    </div>
  );
}
