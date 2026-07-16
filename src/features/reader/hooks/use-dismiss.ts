import { useEffect, type RefObject } from "react";

/**
 * Dismisses a floating element on Escape or a pointer press outside it. Attached
 * in an effect (after the opening click has settled) and only while `active`, so
 * it never self-closes on the click that opened it. The outside check runs in the
 * capture phase so it fires before the pressed element's own handlers.
 */
export function useDismiss(active: boolean, ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [active, ref, onClose]);
}
