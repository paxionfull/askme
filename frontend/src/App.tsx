import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/layout/AppShell";
import { useT } from "./i18n/LocaleContext";
import type { MessageKey } from "./i18n/messages";

const ChatPage = lazy(() => import("./routes/ChatPage"));
const ReadPage = lazy(() => import("./routes/ReadPage"));
const SettingsPage = lazy(() => import("./routes/SettingsPage"));

const BannerCatalogPage = import.meta.env.DEV
  ? lazy(() => import("./routes/BannerCatalogPage"))
  : null;
const UiCatalogPage = import.meta.env.DEV
  ? lazy(() => import("./routes/UiCatalogPage"))
  : null;

export function RouteFallback({ labelKey }: { labelKey: MessageKey }) {
  const t = useT();
  return (
    <div
      className="flex flex-1 flex-col bg-[var(--paper)]"
      aria-busy="true"
      aria-label={`${t(labelKey)} · ${t("loading")}`}
    >
      <div className="shrink-0 border-b border-[var(--rule)] bg-[var(--paper-raised)] px-5 pb-3 pt-4">
        <div
          className="h-[1.75rem] w-40 max-w-[60%] animate-pulse rounded bg-[color-mix(in_srgb,var(--rule)_70%,white)]"
          aria-hidden="true"
        />
        <div className="mt-3 h-10 w-full max-w-md animate-pulse rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--rule)_55%,white)]" />
      </div>
      <div className="flex flex-1 flex-col gap-3 px-5 py-5 sm:px-8">
        <div className="h-4 w-2/3 max-w-sm animate-pulse rounded bg-[color-mix(in_srgb,var(--rule)_60%,white)]" />
        <div className="h-4 w-full max-w-xl animate-pulse rounded bg-[color-mix(in_srgb,var(--rule)_50%,white)]" />
        <div className="h-4 w-5/6 max-w-lg animate-pulse rounded bg-[color-mix(in_srgb,var(--rule)_50%,white)]" />
        <p className="mt-4 text-sm text-[var(--ink-muted)]">{t("loading")}</p>
      </div>
    </div>
  );
}

function LazyPage({ children, labelKey }: { children: ReactNode; labelKey: MessageKey }) {
  return <Suspense fallback={<RouteFallback labelKey={labelKey} />}>{children}</Suspense>;
}

export default function App() {
  return (
    <Routes>
      {import.meta.env.DEV && UiCatalogPage && BannerCatalogPage ? (
        <>
          <Route
            path="dev/banners"
            element={
              <LazyPage labelKey="settingsTitle">
                <BannerCatalogPage />
              </LazyPage>
            }
          />
          <Route
            path="dev/ui"
            element={
              <LazyPage labelKey="settingsTitle">
                <UiCatalogPage />
              </LazyPage>
            }
          />
        </>
      ) : null}
      <Route element={<AppShell />}>
        <Route
          index
          element={
            <LazyPage labelKey="briefLabel">
              <ChatPage />
            </LazyPage>
          }
        />
        <Route
          path="sources"
          element={
            <LazyPage labelKey="sourcesTitle">
              <ReadPage />
            </LazyPage>
          }
        />
        <Route path="read" element={<Navigate to="/sources" replace />} />
        <Route path="chat" element={<Navigate to="/" replace />} />
        <Route
          path="settings"
          element={
            <LazyPage labelKey="settingsTitle">
              <SettingsPage />
            </LazyPage>
          }
        />
      </Route>
    </Routes>
  );
}
