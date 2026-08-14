import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type OverflowMenuItem = {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  hint?: string;
};

interface OverflowMenuProps {
  items: OverflowMenuItem[];
  label?: string;
  align?: "left" | "right";
  /** 首选展开方向；空间不足时会自动翻转 */
  placement?: "bottom" | "top";
  disabled?: boolean;
}

type MenuCoords = {
  top: number;
  left: number;
  placement: "bottom" | "top";
};

const MENU_MIN_WIDTH = 176;
const VIEWPORT_PAD = 8;

function computeCoords(
  trigger: DOMRect,
  menuWidth: number,
  menuHeight: number,
  preferred: "bottom" | "top",
  align: "left" | "right",
): MenuCoords {
  const spaceBelow = window.innerHeight - trigger.bottom - VIEWPORT_PAD;
  const spaceAbove = trigger.top - VIEWPORT_PAD;
  let placement = preferred;
  if (preferred === "bottom" && spaceBelow < menuHeight && spaceAbove > spaceBelow) {
    placement = "top";
  } else if (preferred === "top" && spaceAbove < menuHeight && spaceBelow > spaceAbove) {
    placement = "bottom";
  }

  const top =
    placement === "top"
      ? Math.max(VIEWPORT_PAD, trigger.top - menuHeight - 6)
      : Math.min(window.innerHeight - menuHeight - VIEWPORT_PAD, trigger.bottom + 6);

  let left =
    align === "right" ? trigger.right - menuWidth : trigger.left;
  left = Math.min(
    Math.max(VIEWPORT_PAD, left),
    window.innerWidth - menuWidth - VIEWPORT_PAD,
  );

  return { top, left, placement };
}

export default function OverflowMenu({
  items,
  label = "更多",
  align = "right",
  placement = "bottom",
  disabled = false,
}: OverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<MenuCoords | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;

    function updatePosition() {
      const trigger = buttonRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const menuEl = menuRef.current;
      const menuWidth = Math.max(menuEl?.offsetWidth ?? MENU_MIN_WIDTH, MENU_MIN_WIDTH);
      const menuHeight = menuEl?.offsetHeight ?? items.length * 36;
      setCoords(computeCoords(trigger, menuWidth, menuHeight, placement, align));
    }

    updatePosition();
    // 菜单渲染后再量一次真实高度
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, items.length, placement, align]);

  useEffect(() => {
    if (!open) return;
    function handleClick(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setCoords(null);
  }, [open]);

  const menu =
    open && typeof document !== "undefined" ? (
      createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={
            coords
              ? {
                  position: "fixed",
                  top: coords.top,
                  left: coords.left,
                  minWidth: MENU_MIN_WIDTH,
                  zIndex: 80,
                }
              : {
                  position: "fixed",
                  top: -9999,
                  left: -9999,
                  minWidth: MENU_MIN_WIDTH,
                  zIndex: 80,
                  visibility: "hidden",
                }
          }
          className="rounded-[var(--radius-control)] border border-[var(--rule)] bg-[var(--paper-raised)] py-1 shadow-md"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.hint}
              onClick={() => {
                setOpen(false);
                item.onClick?.();
              }}
              className={`flex w-full flex-col px-3 py-2 text-left text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
                item.danger
                  ? "text-red-800 hover:bg-[var(--error-soft)]"
                  : "text-[var(--ink)] hover:bg-[var(--paper)]"
              }`}
            >
              <span>{item.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )
    ) : null;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className="ui-btn px-2 py-1.5 text-xs disabled:opacity-50"
      >
        ⋯
      </button>
      {menu}
    </div>
  );
}
