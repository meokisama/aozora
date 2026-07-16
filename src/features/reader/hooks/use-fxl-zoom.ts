import { useMemo, useRef, type RefObject } from "react";
import { IDENTITY, MAX_SCALE, clampPan, clampScale, zoomAtPoint, type ZoomState } from "@/lib/reader/zoom";

/** Scale a double-click/tap zooms to (and back to 1 when already zoomed). */
const DBLCLICK_SCALE = 2.5;
/** Wheel-zoom sensitivity: e^(-deltaY·k) per notch, so zoom is multiplicative. */
const WHEEL_ZOOM_K = 0.002;

export interface FxlZoomHandle {
  /** Point the zoom at the current spread element (resets to fit). Pass null when
   *  leaving paginated mode so the handlers go inert. */
  setTarget: (el: HTMLElement | null) => void;
  /** Whether the content is currently magnified (pan/consume-wheel active). */
  isZoomed: () => boolean;
  /** Wheel: Ctrl/⌘ (or trackpad pinch) zooms at the cursor; a plain wheel pans when
   *  zoomed. Returns true if it consumed the event — the caller flips pages only on
   *  false. */
  handleWheel: (e: WheelEvent) => boolean;
  /** Double-click toggles between fit and DBLCLICK_SCALE, centred on the cursor. */
  handleDoubleClick: (e: React.MouseEvent) => void;
  /** Begin a drag-to-pan (no-op unless zoomed); tracks the pointer on window. */
  handlePointerDown: (e: React.PointerEvent) => void;
}

/**
 * Zoom & pan for the fixed-layout paginated viewer. Holds the transform state in
 * refs and writes it straight to the target element (no React re-render), so
 * dragging stays at native speed. Gestures: Ctrl/⌘+wheel and trackpad pinch (which
 * Chromium delivers as Ctrl+wheel) zoom at the cursor; double-click toggles; drag
 * pans while zoomed. The maths lives in `lib/reader/zoom` (unit-tested); this hook
 * only bridges it to the DOM. Zoom resets whenever `setTarget` is called — the
 * viewer rebuilds the spread on every flip/resize, so a page turn returns to fit.
 */
export function useFxlZoom(stageRef: RefObject<Element | null>): FxlZoomHandle {
  const targetRef = useRef<HTMLElement | null>(null);
  const stateRef = useRef<ZoomState>(IDENTITY);
  const baseRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 }); // unscaled content size, for pan bounds

  return useMemo<FxlZoomHandle>(() => {
    // Push the current transform onto the target (and reflect it in the cursor).
    const apply = () => {
      const el = targetRef.current;
      if (!el) return;
      const { scale, tx, ty } = stateRef.current;
      if (scale === 1) {
        el.style.transform = "";
        el.style.cursor = "";
        el.style.willChange = "";
      } else {
        el.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
        el.style.cursor = "grab";
        el.style.willChange = "transform";
      }
    };

    const set = (next: ZoomState) => {
      stateRef.current = next;
      apply();
    };

    // Cursor position relative to the content centre (≈ stage centre, where the
    // spread is centred), used as the zoom anchor.
    const pointFromCenter = (clientX: number, clientY: number) => {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return { px: 0, py: 0, w: baseRef.current.w, h: baseRef.current.h };
      return { px: clientX - (rect.left + rect.width / 2), py: clientY - (rect.top + rect.height / 2), w: baseRef.current.w, h: baseRef.current.h };
    };

    return {
      setTarget: (el) => {
        targetRef.current = el;
        stateRef.current = IDENTITY;
        if (el) {
          baseRef.current = { w: el.offsetWidth, h: el.offsetHeight };
          el.style.transform = "";
          el.style.cursor = "";
          el.style.willChange = "";
        }
      },

      isZoomed: () => stateRef.current.scale > 1,

      handleWheel: (e) => {
        if (!targetRef.current) return false;
        if (e.ctrlKey || e.metaKey) {
          const { px, py, w, h } = pointFromCenter(e.clientX, e.clientY);
          const next = stateRef.current.scale * Math.exp(-e.deltaY * WHEEL_ZOOM_K);
          set(zoomAtPoint(stateRef.current, next, px, py, w, h));
          return true;
        }
        if (stateRef.current.scale > 1) {
          const { w, h } = baseRef.current;
          set(clampPan({ scale: stateRef.current.scale, tx: stateRef.current.tx - e.deltaX, ty: stateRef.current.ty - e.deltaY }, w, h));
          return true;
        }
        return false; // at fit → let the caller flip pages
      },

      handleDoubleClick: (e) => {
        if (!targetRef.current) return;
        if (stateRef.current.scale > 1) {
          set(IDENTITY);
          return;
        }
        const { px, py, w, h } = pointFromCenter(e.clientX, e.clientY);
        set(zoomAtPoint(stateRef.current, clampScale(DBLCLICK_SCALE, 1, MAX_SCALE), px, py, w, h));
      },

      handlePointerDown: (e) => {
        if (!targetRef.current || stateRef.current.scale <= 1) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const base = { tx: stateRef.current.tx, ty: stateRef.current.ty };
        const el = targetRef.current;
        el.style.cursor = "grabbing";
        const move = (ev: PointerEvent) => {
          const { w, h } = baseRef.current;
          set(clampPan({ scale: stateRef.current.scale, tx: base.tx + (ev.clientX - startX), ty: base.ty + (ev.clientY - startY) }, w, h));
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          if (targetRef.current) targetRef.current.style.cursor = stateRef.current.scale > 1 ? "grab" : "";
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      },
    };
  }, [stageRef]);
}
