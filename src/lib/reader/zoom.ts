/**
 * Pure zoom/pan math for the fixed-layout (manga) paginated viewer. The DOM side
 * lives in `use-fxl-zoom`; here we only compute the transform state so it can be
 * unit-tested. Coordinates are relative to the content's centre (transform-origin
 * is centre centre), and translation is applied before scale:
 * `translate(tx, ty) scale(scale)`.
 */

export interface ZoomState {
  scale: number;
  tx: number;
  ty: number;
}

export const IDENTITY: ZoomState = { scale: 1, tx: 0, ty: 0 };

export const MIN_SCALE = 1;
export const MAX_SCALE = 4;

const clamp = (v: number, lo: number, hi: number) => {
  const r = Math.min(hi, Math.max(lo, v));
  return r === 0 ? 0 : r; // normalise -0 → 0 (cleaner state; avoids "-0px" transforms)
};

export function clampScale(scale: number, min = MIN_SCALE, max = MAX_SCALE): number {
  return clamp(scale, min, max);
}

/**
 * Clamps the pan so the scaled content can't be dragged past its own edges: with a
 * centred origin the content overflows the `w×h` box by `(scale-1)` on each axis,
 * half of that in each direction. At scale 1 the only valid offset is 0.
 */
export function clampPan(state: ZoomState, w: number, h: number): ZoomState {
  const maxX = Math.max(0, ((state.scale - 1) * w) / 2);
  const maxY = Math.max(0, ((state.scale - 1) * h) / 2);
  return { scale: state.scale, tx: clamp(state.tx, -maxX, maxX), ty: clamp(state.ty, -maxY, maxY) };
}

/**
 * Zooms to `nextScale` while keeping the point `(px, py)` — measured from the
 * content centre — pinned under the cursor. Derived from `px = t + s·c` (screen
 * offset of a content point) solved so the same `c` maps to the same `px` after the
 * scale change. Result is scale-clamped, then pan-clamped to `w×h`.
 */
export function zoomAtPoint(state: ZoomState, nextScale: number, px: number, py: number, w: number, h: number): ZoomState {
  const scale = clampScale(nextScale);
  const k = scale / state.scale;
  const tx = px * (1 - k) + state.tx * k;
  const ty = py * (1 - k) + state.ty * k;
  return clampPan({ scale, tx, ty }, w, h);
}
