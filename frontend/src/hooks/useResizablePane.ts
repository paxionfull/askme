import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";

interface UseResizablePaneOptions {
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
}

export function useResizablePane({
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
}: UseResizablePaneOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? Number(raw) : NaN;
      if (Number.isFinite(parsed)) {
        return Math.min(maxWidth, Math.max(minWidth, parsed));
      }
    } catch {
      // ignore
    }
    return defaultWidth;
  });
  const draggingRef = useRef(false);

  const clampWidth = useCallback(
    (next: number) => Math.min(maxWidth, Math.max(minWidth, next)),
    [maxWidth, minWidth],
  );

  const startDrag = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      draggingRef.current = true;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (moveEvent: globalThis.MouseEvent) => {
        if (!draggingRef.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const next = clampWidth(moveEvent.clientX - rect.left);
        setWidth(next);
      };

      const onUp = () => {
        draggingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        setWidth((current) => {
          localStorage.setItem(storageKey, String(Math.round(current)));
          return current;
        });
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [clampWidth, storageKey],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      setWidth((current) => {
        const max = Math.min(maxWidth, container.clientWidth - 480);
        return clampWidth(Math.min(current, max));
      });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [clampWidth, maxWidth]);

  return { containerRef, width, startDrag };
}
