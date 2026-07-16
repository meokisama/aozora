import { useMemo, type RefObject } from "react";

/** Pointer travel (px) before a press becomes a drag — below this it stays a
 *  click, so a stray mousedown doesn't nudge the strip (and clicks stay free for
 *  future UI toggles). */
const DRAG_THRESHOLD = 5;

export interface StripPanHandle {
  /** Begin a grab-to-pan on the strip scroller. Tracks the pointer on window and
   *  drives the scroller directly; the caller gates this to continuous mode. */
  handlePointerDown: (e: React.PointerEvent) => void;
}

/**
 * Grab-hand panning for the continuous fixed-layout strip. The strip is a native
 * scroller, so a pan just writes scrollLeft/scrollTop — the viewer's own scroll
 * listener then re-mounts the visible window and reports the page under the centre
 * for free. Works for both axes (the non-scrollable one is a no-op) and for RTL
 * (scrollLeft is the physical offset regardless of layout order). No React
 * re-render — everything runs through the DOM node. Paginated zoom-pan is a
 * separate concern (see useFxlZoom).
 */
export function useStripPan(stageRef: RefObject<Element | null>): StripPanHandle {
  return useMemo<StripPanHandle>(
    () => ({
      handlePointerDown: (e) => {
        if (e.button !== 0) return; // left-drag only
        const stage = stageRef.current as HTMLElement | null;
        if (!stage) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const baseLeft = stage.scrollLeft;
        const baseTop = stage.scrollTop;
        let dragging = false;

        const move = (ev: PointerEvent) => {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          if (!dragging) {
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
            dragging = true;
            stage.style.cursor = "grabbing";
          }
          // Drag the content with the pointer: pull right → scroll toward the start.
          stage.scrollLeft = baseLeft - dx;
          stage.scrollTop = baseTop - dy;
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          stage.style.cursor = ""; // fall back to the CSS `grab` affordance
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      },
    }),
    [stageRef],
  );
}
