import type { ReactNode } from "react";
import { useLocale } from "../../i18n/LocaleContext";

export function SampleCard({
  label,
  appearsIn,
  children,
}: {
  label: string;
  appearsIn?: string;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)]">
      <div className="border-b border-[var(--rule)] px-3 py-2 text-xs text-[var(--ink-muted)]">
        <div className="font-medium text-[var(--ink)]">{label}</div>
        {appearsIn ? <div className="mt-0.5">{appearsIn}</div> : null}
      </div>
      <div className="bg-[var(--surface)]">{children}</div>
    </div>
  );
}

export function CatalogNote({ children }: { children: ReactNode }) {
  return <p className="mb-3 text-xs text-[var(--ink-muted)]">{children}</p>;
}

export function AppearsIn({ zh, en }: { zh: string; en: string }) {
  const { locale } = useLocale();
  return (
    <span className="text-xs text-[var(--ink-muted)]">
      {locale === "zh" ? `出现在：${zh}` : `Appears in: ${en}`}
    </span>
  );
}

export function CatalogHeader({
  titleZh,
  titleEn,
  appearsZh,
  appearsEn,
  noteZh,
  noteEn,
}: {
  titleZh: string;
  titleEn: string;
  appearsZh: string;
  appearsEn: string;
  noteZh?: string;
  noteEn?: string;
}) {
  const { locale } = useLocale();
  const isZh = locale === "zh";
  return (
    <div className="mb-4 space-y-1">
      <h3 className="text-sm font-semibold text-[var(--ink)]">{isZh ? titleZh : titleEn}</h3>
      <AppearsIn zh={appearsZh} en={appearsEn} />
      {noteZh || noteEn ? (
        <CatalogNote>{isZh ? noteZh : noteEn}</CatalogNote>
      ) : null}
    </div>
  );
}
