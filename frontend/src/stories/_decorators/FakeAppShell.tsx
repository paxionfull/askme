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
          <img src="/logo.svg" alt="" width={24} height={24} />
          <span className="app-sidebar-wordmark">{t("appName")}</span>
        </div>
        <nav className="flex flex-1 flex-col py-2">
          {items.map(({ id, label, Icon }) => (
            <div
              key={id}
              className={`app-nav-link${activeNav === id ? " is-active" : ""}`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="app-nav-label">{label}</span>
            </div>
          ))}
          <div className="min-h-2 flex-1" />
          <div className="app-nav-link">
            <IconHelp className="h-4 w-4 shrink-0" />
            <span className="app-nav-label">{t("navHelp")}</span>
          </div>
        </nav>
      </aside>
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--paper)]">{children}</div>
    </div>
  );
}
