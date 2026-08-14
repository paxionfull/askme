export type Locale = "en" | "zh";

export const LOCALE_STORAGE_KEY = "askme.locale";

export function readStoredLocale(): Locale {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (raw === "zh" || raw === "en") return raw;
  } catch {
    // ignore
  }
  return "en";
}

export function writeStoredLocale(locale: Locale) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // ignore
  }
}
