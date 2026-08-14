import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "../i18n/LocaleContext";
import { useMenuKeyboard } from "../hooks/useMenuKeyboard";

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
  label,
  align = "right",
  placement = "bottom",
  disabled = false,
}: OverflowMenuProps) {
  const { t } = useLocale();
  const menuLabel = label ?? t("more");
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<MenuCoords | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  function closeMenu() {
    setOpen(false);
    previousFocusRef.current?.focus?.({ preventScroll: true });
  }

  useMenuKeyboard(open, menuRef, closeMenu);

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
      closeMenu();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
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
          aria-label={menuLabel}
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
                closeMenu();
                item.onClick?.();
              }}
              className={`flex min-h-9 w-full flex-col px-3 py-2 text-left text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
                item.danger
                  ? "text-[var(--danger-text)] hover:bg-[var(--error-soft)]"
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
        aria-label={menuLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          if (open) {
            closeMenu();
            return;
          }
          previousFocusRef.current = document.activeElement as HTMLElement | null;
          setOpen(true);
        }}
        className="ui-icon-btn border border-[var(--rule)] bg-[var(--paper-raised)] text-xs disabled:opacity-50"
      >
        ⋯
      </button>
      {menu}
    </div>
  );
}
