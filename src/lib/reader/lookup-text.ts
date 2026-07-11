/**
 * Text-under-cursor extraction for the hover dictionary.
 *
 * Given a viewport point, resolves the text node under it and reads the run that
 * *starts* there — forward only, furigana excluded, bounded to the cursor's block
 * — for the main process to scan for the longest dictionary match. The result can
 * rebuild a live Range over the matched prefix for highlighting.
 *
 * Adapted from Yomitan's `dom-text-scanner.js` / `text-source-generator.js`
 * (GPL-3.0-or-later — see `yomitan/` and NOTICE.md). Our content is flattened
 * EPUB markup in one shadow root, so we reuse the search index's
 * furigana-skipping walk (`getParagraphNodes` + `blockAncestor`) and keep the
 * scan small rather than handling arbitrary layouts / user-select:all.
 */

import { getParagraphNodes } from "@/lib/epub/dom-utils";
import { blockAncestor } from "@/lib/reader/search";

/** The main-process lookup caps the scan at 24 code units; match it here. */
export const MAX_SCAN_LENGTH = 24;

// Invisible characters that some EPUBs embed for line-break control. They render
// as nothing, so a term looks normal but the scanned run would carry a character
// no dictionary entry has → a silent lookup miss. Dropped from the scanned text
// (matching Yomitan's dom-text-scanner): U+00AD soft hyphen, U+200B/C zero-width
// space/non-joiner, U+FEFF byte-order mark.
const ZERO_WIDTH = new Set([0x00ad, 0x200b, 0x200c, 0xfeff]);
const isZeroWidth = (ch: string): boolean => ZERO_WIDTH.has(ch.charCodeAt(0));

/** One contiguous slice of a live text node contributing to the scanned run. */
interface Segment {
  node: Text;
  /** Offset in `node` where this segment begins. */
  start: number;
  /** Number of code units taken from `node` starting at `start`. */
  length: number;
}

/** The text run under the cursor, with a way to map a match length back to a Range. */
export interface CursorText {
  /** The scanned text, starting at the cursor, furigana excluded, ≤ maxLength code units. */
  text: string;
  /**
   * Builds a live DOM Range over the first `length` code units of `text` (the
   * portion the dictionary matched), for highlighting. Returns null if `length`
   * is non-positive or the segments are gone.
   */
  rangeForLength(length: number): Range | null;
}

/** Builds a Range over the first `length` code units spanned by `segments`. */
function buildRange(segments: Segment[], length: number): Range | null {
  if (!segments.length || length <= 0) return null;
  const range = document.createRange();
  range.setStart(segments[0].node, segments[0].start);
  let remaining = length;
  for (const seg of segments) {
    if (remaining <= seg.length) {
      range.setEnd(seg.node, seg.start + remaining);
      return range;
    }
    remaining -= seg.length;
  }
  // Asked for more than we collected: clamp to the end of the last segment.
  const last = segments[segments.length - 1];
  range.setEnd(last.node, last.start + last.length);
  return range;
}

/**
 * Reads the text run beginning at (`startNode`, `startOffset`), walking forward
 * through the block's text nodes (furigana and hidden nodes already excluded by
 * `getParagraphNodes`) until `maxLength` code units are collected or the block
 * ends. Zero-width / invisible characters are dropped from the run. A gaiji image
 * ends the run — a dictionary term can't span an image.
 * Returns null when the start node isn't part of the readable text (e.g. the
 * cursor is over furigana or whitespace).
 *
 * Exported for unit testing: it needs no layout, unlike `cursorTextFromPoint`.
 */
export function extractRunAt(startNode: Text, startOffset: number, contentRoot: Element, maxLength = MAX_SCAN_LENGTH): CursorText | null {
  const block = blockAncestor(startNode, contentRoot);
  const nodes = getParagraphNodes(block);
  const startIdx = nodes.indexOf(startNode);
  if (startIdx < 0) return null;

  const segments: Segment[] = [];
  let text = "";
  for (let i = startIdx; i < nodes.length && text.length < maxLength; i++) {
    const node = nodes[i];
    if (node.nodeType !== Node.TEXT_NODE) break; // gaiji image — terms don't cross it
    const data = (node as Text).data;
    const from = i === startIdx ? startOffset : 0;
    if (from >= data.length) continue;

    // Walk char by char so zero-width chars drop from the scanned text while their
    // DOM position is tracked: each run of kept chars is one segment, split at each
    // skipped char, so `buildRange` still maps a match length back to a live Range
    // (a skipped char inside the range is painted too — it's invisible anyway).
    let segStart = -1; // source offset where the current kept run began
    let pos = from;
    for (; pos < data.length && text.length < maxLength; pos++) {
      if (isZeroWidth(data[pos])) {
        if (segStart >= 0) {
          segments.push({ node: node as Text, start: segStart, length: pos - segStart });
          segStart = -1;
        }
        continue;
      }
      if (segStart < 0) segStart = pos;
      text += data[pos];
    }
    if (segStart >= 0) segments.push({ node: node as Text, start: segStart, length: pos - segStart });
  }

  if (!text) return null;
  return { text, rangeForLength: (length) => buildRange(segments, length) };
}

/**
 * Resolves the caret (text node + offset) under a viewport point, piercing the
 * reader's shadow root. Prefers the standard `caretPositionFromPoint` (Firefox +
 * Chromium 128+, which takes a `shadowRoots` option to descend into shadow DOM)
 * and falls back to WebKit's `caretRangeFromPoint`.
 */
function caretFromPoint(x: number, y: number, shadowRoot: ShadowRoot | null): { node: Node; offset: number } | null {
  if (typeof document.caretPositionFromPoint === "function") {
    const pos = shadowRoot ? document.caretPositionFromPoint(x, y, { shadowRoots: [shadowRoot] }) : document.caretPositionFromPoint(x, y);
    if (pos && pos.offsetNode) return { node: pos.offsetNode, offset: pos.offset };
  }
  if (typeof document.caretRangeFromPoint === "function") {
    const range = document.caretRangeFromPoint(x, y);
    if (range) return { node: range.startContainer, offset: range.startOffset };
  }
  return null;
}

/**
 * Extracts the text run under a viewport point for dictionary lookup.
 * `contentRoot` is the reader's content element (`.aozora-content` in continuous
 * mode, `.aoz-page-content` in paginated mode) — it both bounds the scan to one
 * block and locates the shadow root to descend into. Returns null when the point
 * isn't over readable text (furigana, whitespace, images, or outside the root).
 */
export function cursorTextFromPoint(x: number, y: number, contentRoot: Element, maxLength = MAX_SCAN_LENGTH): CursorText | null {
  const rootNode = contentRoot.getRootNode();
  const shadowRoot = rootNode instanceof ShadowRoot ? rootNode : null;
  const caret = caretFromPoint(x, y, shadowRoot);
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return null;
  if (!contentRoot.contains(caret.node)) return null;
  return extractRunAt(caret.node as Text, caret.offset, contentRoot, maxLength);
}

/**
 * Resolves a collapsed Range at the caret under a viewport point (piercing the
 * reader's shadow root), for callers that need the DOM position rather than the
 * forward text run — e.g. finding the sentence under the cursor. Returns null
 * when the point isn't over readable text within `contentRoot`.
 */
export function caretRangeFromPoint(x: number, y: number, contentRoot: Element): Range | null {
  const rootNode = contentRoot.getRootNode();
  const shadowRoot = rootNode instanceof ShadowRoot ? rootNode : null;
  const caret = caretFromPoint(x, y, shadowRoot);
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return null;
  if (!contentRoot.contains(caret.node)) return null;
  const range = document.createRange();
  range.setStart(caret.node, caret.offset);
  range.collapse(true);
  return range;
}
