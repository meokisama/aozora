/**
 * Helpers for the fixed-layout (manga) continuous "long-strip" reader: pages are
 * stacked in one line (a vertical column or a horizontal filmstrip) and sized up
 * front from their known viewports, so their positions form a static layout the
 * viewer maps scroll offset onto. Coordinates are along the active scroll axis
 * (top for vertical, left for horizontal), so the same math serves both.
 */

/** A page's box in the strip's own (content-relative) coordinate space, measured
 *  along the scroll axis: `start` is its leading edge, `size` its extent. */
export interface StripBox {
  ordinal: number;
  start: number;
  size: number;
}

/**
 * The ordinal of the page at a `center` offset along the scroll axis (scroll
 * position + half the viewport). Boxes are contiguous in visual order, so this is
 * the last box that starts at or before the centre — the page currently under it
 * (a centre landing in an inter-page gap resolves to the page just before, which
 * is fine). Boxes must be sorted by `start` ascending.
 */
export function ordinalAtCenter(boxes: StripBox[], center: number): number {
  if (!boxes.length) return 0;
  let ordinal = boxes[0].ordinal;
  for (const b of boxes) {
    if (center >= b.start) ordinal = b.ordinal;
    else break;
  }
  return ordinal;
}

/**
 * The inclusive index span `[first, last]` of boxes intersecting the axis window
 * `[start, end]`, or null when none do. Drives strip virtualization: only pages in
 * (a padded) window are kept in the DOM. Boxes must be sorted by `start` ascending;
 * the scan is linear — fine for the few-hundred pages a book holds.
 */
export function visibleRange(boxes: StripBox[], start: number, end: number): [number, number] | null {
  let first = -1;
  let last = -1;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.start + b.size >= start && b.start <= end) {
      if (first === -1) first = i;
      last = i;
    }
  }
  return first === -1 ? null : [first, last];
}
