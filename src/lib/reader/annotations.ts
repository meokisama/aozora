/**
 * User highlights (and notes), painted via the CSS Custom Highlight API.
 *
 * Anchored by the reader's character-offset model — the same `getParagraphNodes` +
 * `getCharacterCount` walk as reading position, bookmarks and search — so a
 * `[startChar, endChar)` span survives re-flow, font changes and
 * continuous↔paginated switches. Nothing is stored as a DOM range; ranges are
 * rebuilt from the offsets against the live shadow tree on every re-render, then
 * registered with `CSS.highlights` under one name per colour (`aoz-hl-<key>`).
 *
 * Inverse of `highlight.ts`'s search placement: `rangeToCharSpan` reads a
 * selection into offsets, `paint` turns stored offsets back into ranges.
 */

import { getParagraphNodes, getCharacterCount, isNodeGaiji, countJapanese } from "@/lib/epub/dom-utils";
import type { Annotation } from "@/lib/types";

const HL_PREFIX = "aoz-hl-";

/** The highlight palette. `key` is stored on the annotation; `swatch` is the
 *  solid colour shown in the picker; `wash` is the translucent paint. */
export const ANNOTATION_COLORS = [
  { key: "yellow", label: "Yellow", swatch: "#facc15", wash: "rgba(250, 204, 21, 0.40)" },
  { key: "green", label: "Green", swatch: "#4ade80", wash: "rgba(74, 222, 128, 0.38)" },
  { key: "blue", label: "Blue", swatch: "#60a5fa", wash: "rgba(96, 165, 250, 0.38)" },
  { key: "pink", label: "Pink", swatch: "#f472b6", wash: "rgba(244, 114, 182, 0.38)" },
  { key: "orange", label: "Orange", swatch: "#fb923c", wash: "rgba(251, 146, 60, 0.42)" },
  { key: "purple", label: "Purple", swatch: "#c084fc", wash: "rgba(192, 132, 252, 0.42)" },
  { key: "red", label: "Red", swatch: "#f87171", wash: "rgba(248, 113, 113, 0.40)" },
  { key: "teal", label: "Teal", swatch: "#2dd4bf", wash: "rgba(45, 212, 191, 0.38)" },
] as const;

export type AnnotationColorKey = (typeof ANNOTATION_COLORS)[number]["key"];

export const DEFAULT_ANNOTATION_COLOR: AnnotationColorKey = "yellow";

/** The `::highlight()` names + washes, consumed by `reader-styles`. */
export const ANNOTATION_HL_CSS = ANNOTATION_COLORS.map((c) => ({ name: HL_PREFIX + c.key, wash: c.wash }));

/** Solid swatch colour for a stored colour key (falls back to the default). */
export function colorSwatch(key: string): string {
  return (ANNOTATION_COLORS.find((c) => c.key === key) ?? ANNOTATION_COLORS[0]).swatch;
}

const supported = (): boolean => typeof CSS !== "undefined" && !!CSS.highlights && typeof Highlight !== "undefined";

export interface CharSpan {
  startChar: number;
  endChar: number;
  text: string;
}

/**
 * Global character offset of a DOM boundary `(node, offset)` within `root`.
 * Walks readable nodes in document order (matching the char model): count before
 * the boundary's text node plus the Japanese-char count preceding `offset` inside
 * it. Element/whitespace boundaries snap to the next readable node's start.
 * `baseChar` is the rendered region's global start (0 continuous, section start
 * paginated).
 */
export function charOffsetAt(root: Element, node: Node, offset: number, baseChar: number): number {
  const nodes = getParagraphNodes(root);
  let cum = 0;
  for (const n of nodes) {
    // If the boundary point falls before this node begins, it sits in a gap
    // (element edge, skipped whitespace) — snap to this node's start.
    try {
      const at = document.createRange();
      at.setStart(n, 0);
      at.collapse(true);
      if (at.comparePoint(node, offset) <= 0) return baseChar + cum;
    } catch {
      /* comparePoint can throw for a detached/foreign node — fall through */
    }
    if (n === node && n.nodeType === Node.TEXT_NODE) {
      return baseChar + cum + countJapanese((n.textContent || "").slice(0, offset));
    }
    cum += getCharacterCount(n);
  }
  return baseChar + cum; // boundary at/after the end of the region
}

/**
 * Reads a live selection Range back into a character span. Returns null when the
 * range is collapsed or maps to an empty span (e.g. a pure-punctuation
 * selection, which carries no Japanese-char length).
 */
export function rangeToCharSpan(root: Element, range: Range, baseChar = 0): CharSpan | null {
  if (range.collapsed) return null;
  const startChar = charOffsetAt(root, range.startContainer, range.startOffset, baseChar);
  const endChar = charOffsetAt(root, range.endContainer, range.endOffset, baseChar);
  if (endChar <= startChar) return null;
  return { startChar, endChar, text: range.toString().trim() };
}

/**
 * The raw string index at which `text` has `need` Japanese chars before it
 * (surrogate-safe). Punctuation/ASCII carry zero weight, so several raw indices
 * map to the same char offset; `skipLeading` (used for a highlight's start)
 * advances over any zero-weight chars so the wash begins on a real glyph rather
 * than swallowing a preceding 。or 」.
 */
function rawIndexForJp(text: string, need: number, skipLeading: boolean): number {
  const chars = Array.from(text);
  let count = 0;
  let i = 0;
  let ci = 0;
  while (ci < chars.length && count < need) {
    count += countJapanese(chars[ci]); // 0 or 1
    i += chars[ci].length;
    ci++;
  }
  if (skipLeading) {
    while (ci < chars.length && countJapanese(chars[ci]) === 0) {
      i += chars[ci].length;
      ci++;
    }
  }
  return i;
}

/** Cumulative char count *before* each node (`cum[i]`), plus the region total.
 *  Computed once per walk so `getCharacterCount` (a regex count) runs a single
 *  time per node rather than once per node per annotation-boundary. */
function cumulativeCounts(nodes: Node[]): { cum: number[]; total: number } {
  const cum = new Array<number>(nodes.length);
  let acc = 0;
  for (let i = 0; i < nodes.length; i++) {
    cum[i] = acc;
    acc += getCharacterCount(nodes[i]);
  }
  return { cum, total: acc };
}

/** Resolves a global char offset to a DOM boundary within a precomputed node
 *  list, for building a paint range. `isStart` skips leading punctuation so the
 *  wash begins on a glyph. Clamps below the region to its start, beyond to end.
 *  `cum`/`total` come from `cumulativeCounts` so no per-node recount happens. */
function boundaryForOffset(
  nodes: Node[],
  cum: number[],
  total: number,
  target: number,
  baseChar: number,
  isStart: boolean,
): { node: Node; offset: number } | null {
  const local = target - baseChar;
  let lastText: Text | null = null;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const c = cum[i];
    const w = (i + 1 < cum.length ? cum[i + 1] : total) - c;
    if (n.nodeType === Node.TEXT_NODE) {
      if (local <= c + w) {
        return { node: n, offset: rawIndexForJp(n.textContent || "", local - c, isStart) };
      }
      lastText = n as Text;
    } else if (isNodeGaiji(n) && local <= c) {
      // A gaiji image counts as one char; place the boundary just before it.
      const parent = n.parentNode;
      if (parent) return { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, n) };
    }
  }
  if (lastText) return { node: lastText, offset: (lastText.textContent || "").length };
  return null;
}

/** Builds a live Range for `[startChar, endChar)` over precomputed nodes, or null
 *  if the span doesn't intersect the region (both ends clamp to the same point). */
function rangeForSpan(nodes: Node[], cum: number[], total: number, startChar: number, endChar: number, baseChar: number): Range | null {
  const s = boundaryForOffset(nodes, cum, total, startChar, baseChar, true);
  const e = boundaryForOffset(nodes, cum, total, endChar, baseChar, false);
  if (!s || !e) return null;
  const range = document.createRange();
  try {
    range.setStart(s.node, s.offset);
    range.setEnd(e.node, e.offset);
  } catch {
    return null;
  }
  return range.collapsed ? null : range;
}

/** Builds a live Range for `[startChar, endChar)` within `root` (walking it
 *  fresh). Exposed for reuse/testing; `paintAnnotations` walks once and shares
 *  the node list across all spans instead. */
export function charSpanToRange(root: Element, startChar: number, endChar: number, baseChar = 0): Range | null {
  const nodes = getParagraphNodes(root);
  const { cum, total } = cumulativeCounts(nodes);
  return rangeForSpan(nodes, cum, total, startChar, endChar, baseChar);
}

/**
 * (Re)paints all annotations onto `root`, one Highlight per colour. Registers a
 * `CSS.highlights` entry for colours that have visible ranges in the current
 * region and clears the rest, so a page swap that scrolls a highlight off-screen
 * removes its wash. Safe to call on every render.
 */
export function paintAnnotations(root: Element | null, annotations: Annotation[], baseChar = 0): void {
  if (!supported()) return;
  const byColor = new Map<string, Range[]>();
  if (root) {
    const nodes = getParagraphNodes(root); // walk once; reused for every span
    const { cum, total } = cumulativeCounts(nodes); // count each node once, not per span
    for (const a of annotations) {
      const range = rangeForSpan(nodes, cum, total, a.startChar, a.endChar, baseChar);
      if (!range) continue;
      const list = byColor.get(a.color);
      if (list) list.push(range);
      else byColor.set(a.color, [range]);
    }
  }
  for (const { key } of ANNOTATION_COLORS) {
    const ranges = byColor.get(key);
    if (ranges && ranges.length) CSS.highlights.set(HL_PREFIX + key, new Highlight(...ranges));
    else CSS.highlights.delete(HL_PREFIX + key);
  }
}

/** Removes every annotation highlight (e.g. on book change / unmount). */
export function clearAnnotationHighlights(): void {
  if (!supported()) return;
  for (const { key } of ANNOTATION_COLORS) CSS.highlights.delete(HL_PREFIX + key);
}

/**
 * The annotation covering the character offset at a viewport point, or null. Used
 * for click-to-edit: maps the caret under the cursor to a global offset and finds
 * the (last-created) annotation whose span contains it. `caretOffset` is supplied
 * by the caller (it already pierces the shadow root via `lib/reader/lookup-text`).
 */
export function annotationAtOffset(annotations: Annotation[], offset: number): Annotation | null {
  let hit: Annotation | null = null;
  for (const a of annotations) {
    if (a.startChar <= offset && offset < a.endChar) hit = a; // later wins → topmost
  }
  return hit;
}
