import { useCallback, useState } from "react";

export function readStoredFlag(key: string, defaultValue = false): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return raw === "true";
  } catch {
    return defaultValue;
  }
}

export function useStoredFlag(key: string, defaultValue = false) {
  const [value, setValueState] = useState(() => readStoredFlag(key, defaultValue));

  const setValue = useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      setValueState((current) => {
        const resolved = typeof next === "function" ? next(current) : next;
        localStorage.setItem(key, String(resolved));
        return resolved;
      });
    },
    [key],
  );

  return [value, setValue] as const;
}
