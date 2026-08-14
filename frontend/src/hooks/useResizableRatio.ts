import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

interface UseResizableRatioOptions {
  storageKey: string;
  /** 右侧面板占比，0–1 */
  defaultRatio?: number;
  minRatio?: number;
  maxRatio?: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function useResizableRatio({
  storageKey,
  defaultRatio = 0.32,
  minRatio = 0.22,
  maxRatio = 0.55,
}: UseResizableRatioOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? Number(raw) : NaN;
      if (Number.isFinite(parsed)) return clamp(parsed, minRatio, maxRatio);
    } catch {
      // ignore
    }
    return defaultRatio;
  });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startRatio: number } | null>(null);

  const applyRatio = useCallback(
    (next: number) => {
      setRatio(clamp(next, minRatio, maxRatio));
    },
    [minRatio, maxRatio],
  );

  const persist = useCallback(
    (value: number) => {
      try {
        localStorage.setItem(storageKey, String(value));
      } catch {
        // ignore
      }
    },
    [storageKey],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragRef.current = { startX: event.clientX, startRatio: ratio };
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [ratio],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current || !containerRef.current) return;
      const width = containerRef.current.getBoundingClientRect().width;
      if (width <= 0) return;
      // 分隔条左移 → 右侧面板变宽
      const delta = (dragRef.current.startX - event.clientX) / width;
      applyRatio(dragRef.current.startRatio + delta);
    },
    [applyRatio],
  );

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setDragging(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setRatio((current) => {
        persist(current);
        return current;
      });
    },
    [persist],
  );

  const resetRatio = useCallback(() => {
    applyRatio(defaultRatio);
    persist(defaultRatio);
  }, [applyRatio, defaultRatio, persist]);

  const nudgeRatio = useCallback(
    (delta: number) => {
      setRatio((current) => {
        const next = clamp(current + delta, minRatio, maxRatio);
        persist(next);
        return next;
      });
    },
    [minRatio, maxRatio, persist],
  );

  return {
    containerRef,
    ratio,
    askPercent: Math.round(ratio * 100),
    briefPercent: Math.round((1 - ratio) * 100),
    dragging,
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    resetRatio,
    nudgeRatio,
  };
}
