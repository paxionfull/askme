import { useEffect, useRef } from "react";
import CitationPanel, { type CitationItem } from "./CitationPanel";

interface CitationSidebarProps {
  items: CitationItem[];
  activeIndex: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (index: number) => void;
}

export default function CitationSidebar({
  items,
  activeIndex,
  open,
  onOpenChange,
  onSelect,
}: CitationSidebarProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open || activeIndex == null) return;
    const target = itemRefs.current.get(activeIndex);
    if (!target) return;
    window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "nearest" });
      target.focus({ preventScroll: true });
    });
  }, [activeIndex, open, items]);

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-30 flex justify-end">
      <button
        type="button"
        aria-label="关闭引用来源"
        className="absolute inset-0 bg-[color-mix(in_srgb,var(--ink)_18%,transparent)] transition-opacity"
        onClick={() => onOpenChange(false)}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="引用来源"
        className="relative flex h-full w-[min(22rem,92%)] flex-col border-l border-[var(--rule)] bg-[var(--paper-raised)] shadow-[-8px_0_24px_rgba(28,25,23,0.08)]"
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--rule)] px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight text-[var(--ink)]">引用来源</h2>
            <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">
              {items.length > 0
                ? `${items.length} 个片段 · 点回答中的 [n] 定位`
                : "发送问题后显示检索片段"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="ui-btn shrink-0 px-2 py-1 text-xs"
            aria-label="关闭"
          >
            关闭
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <CitationPanel
            items={items}
            activeIndex={activeIndex}
            onSelect={onSelect}
            itemRefs={itemRefs}
            hideHeader
          />
        </div>
      </aside>
    </div>
  );
}
