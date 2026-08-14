import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute("disabled") && element.tabIndex !== -1,
  );
}

type UseModalA11yOptions = {
  /** @default true */
  closeOnEscape?: boolean;
};

/** Focus trap, Esc to close, restore focus on unmount — attach ref to the dialog root (backdrop). */
export function useModalA11y(
  open: boolean,
  onClose: () => void,
  dialogRef: RefObject<HTMLElement | null>,
  options?: UseModalA11yOptions,
) {
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const closeOnEscape = options?.closeOnEscape !== false;

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement as HTMLElement | null;

    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = getFocusableElements(dialog);
      (focusables[0] ?? dialog).focus({ preventScroll: true });
    });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && closeOnEscape) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusables = getFocusableElements(dialog);
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (!active || active === first || !dialog.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, true);
      previousFocusRef.current?.focus?.({ preventScroll: true });
    };
  }, [closeOnEscape, dialogRef, onClose, open]);
}
