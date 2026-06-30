import { useLayoutEffect, useState, type RefObject } from "react";

const GAP = 6; // px between the anchor and the popup
const MARGIN = 8; // min gap from the viewport edge

export interface PopupRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Places a floating popup against an anchor box (a DOMRect in viewport
 * coordinates): below the anchor by default, flipping above when there isn't
 * room, then clamping to the viewport on both axes. Measures after layout, so
 * the popup must render at its natural size first — callers render it off-screen
 * and hidden until this returns a position.
 *
 * `contentKey` re-runs the measurement when the popup's content (hence size)
 * changes; `onLayout` reports the final placed box (e.g. for the dictionary's
 * sticky zone).
 */
export function useAnchoredPosition(
  ref: RefObject<HTMLElement | null>,
  anchor: DOMRect | null,
  contentKey: unknown,
  onLayout?: (rect: PopupRect) => void,
): { left: number; top: number } | null {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) {
      setPos(null);
      return;
    }
    const { offsetWidth: w, offsetHeight: h } = el;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = anchor.bottom + GAP;
    if (top + h > vh - MARGIN && anchor.top - GAP - h >= MARGIN) {
      top = anchor.top - GAP - h; // flip above
    }
    top = Math.max(MARGIN, Math.min(top, vh - h - MARGIN));

    let left = anchor.left;
    left = Math.max(MARGIN, Math.min(left, vw - w - MARGIN));

    setPos({ left, top });
    onLayout?.({ left, top, right: left + w, bottom: top + h });
  }, [ref, contentKey, anchor, onLayout]);

  return pos;
}
