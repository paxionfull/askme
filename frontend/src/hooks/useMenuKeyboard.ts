import { useEffect, type RefObject } from "react";

const MENU_ITEM_SELECTOR = '[role="menuitem"]:not([disabled])';

function getMenuItems(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR));
}

type UseMenuKeyboardOptions = {
  /** When set, ArrowRight opens submenu on focused item; ArrowLeft closes it. */
  onOpenSubmenu?: (index: number) => void;
  onCloseSubmenu?: () => void;
  submenuOpen?: boolean;
};

/** Roving focus, Home/End, Escape — attach to the menu root with role="menu". */
export function useMenuKeyboard(
  open: boolean,
  menuRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  options?: UseMenuKeyboardOptions,
) {
  const { onOpenSubmenu, onCloseSubmenu, submenuOpen } = options ?? {};

  useEffect(() => {
    if (!open) return;

    const menu = menuRef.current;
    if (!menu) return;

    const frame = window.requestAnimationFrame(() => {
      getMenuItems(menu)[0]?.focus({ preventScroll: true });
    });

    function onKeyDown(event: KeyboardEvent) {
      const container = menuRef.current;
      if (!container) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }

      const items = getMenuItems(container);
      if (items.length === 0) return;

      const active = document.activeElement as HTMLElement | null;
      const index = active ? items.indexOf(active) : -1;

      if (event.key === "ArrowRight" && onOpenSubmenu && index >= 0) {
        event.preventDefault();
        onOpenSubmenu(index);
        return;
      }

      if (event.key === "ArrowLeft" && submenuOpen && onCloseSubmenu) {
        event.preventDefault();
        onCloseSubmenu();
        return;
      }

      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;

      event.preventDefault();
      if (event.key === "Home") {
        items[0]?.focus({ preventScroll: true });
      } else if (event.key === "End") {
        items[items.length - 1]?.focus({ preventScroll: true });
      } else if (event.key === "ArrowDown") {
        const next = index < 0 ? 0 : (index + 1) % items.length;
        items[next]?.focus({ preventScroll: true });
      } else if (event.key === "ArrowUp") {
        const prev = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
        items[prev]?.focus({ preventScroll: true });
      }
    }

    menu.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      menu.removeEventListener("keydown", onKeyDown);
    };
  }, [menuRef, onClose, onCloseSubmenu, onOpenSubmenu, open, submenuOpen]);
}
