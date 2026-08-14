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
  const scrollRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  useEffect(() => {
    if (!open || activeIndex == null) return;
    const target = itemRefs.current.get(activeIndex);
    if (!target) return;
    window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "nearest" });
      target.focus({ preventScroll: true });
    });
  }, [activeIndex, open, items]);

  return (
    <div className="hidden h-full shrink-0 md:flex">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        title={open ? "向右收起引用来源" : "向左展开引用来源"}
        aria-expanded={open}
        className="flex w-9 shrink-0 flex-col items-center justify-center gap-2 border-l border-slate-200 bg-slate-50 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
      >
        <span className="text-xs" aria-hidden>
          {open ? "›" : "‹"}
        </span>
        <span
          className="text-[11px] font-medium leading-4 tracking-wide text-slate-600"
          style={{ writingMode: "vertical-rl" }}
        >
          引用来源
        </span>
        {items.length > 0 && (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
            {items.length}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={scrollRef}
          className="flex h-full w-[min(360px,38vw)] min-w-[260px] max-w-[360px] border-l border-slate-200 bg-white"
        >
          <CitationPanel
            items={items}
            activeIndex={activeIndex}
            onSelect={onSelect}
            itemRefs={itemRefs}
          />
        </div>
      )}
    </div>
  );
}
