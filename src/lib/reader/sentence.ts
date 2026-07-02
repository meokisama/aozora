/**
 * Extracts the sentence containing a matched run, for Anki's {sentence} field.
 *
 * Reuses the dictionary/search DOM walk (`blockAncestor` + `getParagraphNodes`)
 * so furigana readings and hidden nodes are excluded, matching what the reader
 * treats as text. From the match's position in the block it grows out to the
 * nearest sentence terminators on each side. Layout-independent (no geometry),
 * so it can be unit-tested; only the live-DOM `sentenceAround` needs a browser.
 */

import { getParagraphNodes } from "@/lib/epub/dom-utils";
import { blockAncestor } from "@/lib/reader/search";

// Japanese + ASCII sentence terminators. A sentence extends up to and including
// the next terminator, and starts just after the previous one.
const TERMINATORS = "。．！？!?…\n";

/**
 * Half-open block-text range [start, end) of the sentence containing `offset`,
 * terminator included (not yet trimmed). Shared by the string and live-DOM paths.
 */
function sentenceBounds(text: string, offset: number): [number, number] {
  // Clamp into a real character index: an offset at text.length would otherwise
  // sit just past the final terminator and yield an empty slice.
  const clamped = text.length === 0 ? 0 : Math.max(0, Math.min(offset, text.length - 1));

  let start = 0;
  for (let i = clamped - 1; i >= 0; i--) {
    if (TERMINATORS.includes(text[i])) {
      start = i + 1;
      break;
    }
  }

  let end = text.length;
  for (let i = clamped; i < text.length; i++) {
    if (TERMINATORS.includes(text[i])) {
      end = i + 1; // include the terminator
      break;
    }
  }

  return [start, end];
}

/**
 * Given the full text of a block and a character offset that falls inside the
 * matched run, returns the sentence spanning that offset (terminator included,
 * trimmed). Exported for unit testing.
 */
export function sentenceFromBlockText(text: string, offset: number): string {
  const [start, end] = sentenceBounds(text, offset);
  return text.slice(start, end).trim();
}

/**
 * Resolves the sentence around a matched DOM Range within the reader's content.
 * Falls back to the whole block's text when the match node can't be located.
 */
export function sentenceAround(range: Range, contentRoot: Element): string {
  const startNode = range.startContainer;
  const block = blockAncestor(startNode, contentRoot);
  const nodes = getParagraphNodes(block);

  let text = "";
  let offset = -1;
  for (const node of nodes) {
    if (node.nodeType !== Node.TEXT_NODE) {
      text += " "; // gaiji image — a single placeholder so offsets stay sane
      continue;
    }
    if (node === startNode) offset = text.length + range.startOffset;
    text += (node as Text).data;
  }

  if (offset < 0) return text.trim(); // match node not in this block: whole block
  return sentenceFromBlockText(text, offset);
}

/** A text node's contribution to the assembled block text, keyed by char offset. */
interface Piece {
  node: Node;
  isText: boolean;
  /** Char position where this piece begins in the assembled block text. */
  start: number;
  len: number;
}

/**
 * Maps a block-text char offset to a live (text node, offset) boundary, clamped
 * into the nearest text node. A boundary landing on a gaiji placeholder snaps to
 * an adjacent text node — the highlight only paints text, so this is invisible.
 */
function locate(pieces: Piece[], offset: number): { node: Text; offset: number } | null {
  let fallback: { node: Text; offset: number } | null = null;
  for (const p of pieces) {
    if (!p.isText) continue;
    const node = p.node as Text;
    if (offset < p.start + p.len) return { node, offset: Math.max(0, offset - p.start) };
    fallback = { node, offset: p.len }; // past this node; remember its end
  }
  return fallback;
}

/** The sentence around a match, plus a way to build Ranges over sub-slices of it. */
export interface SentenceContext {
  /** The sentence (terminator included, trimmed). */
  text: string;
  /** Builds a DOM Range over sentence-relative code units [from, to), clamped. */
  rangeForSlice(from: number, to: number): Range | null;
}

/**
 * Like `sentenceAround`, but also returns a `rangeForSlice` so callers can paint
 * a growing highlight over the sentence (karaoke read-aloud). Returns null when
 * the match node can't be located in its block — the caller falls back to plain
 * playback without highlighting.
 */
export function sentenceContextAround(range: Range, contentRoot: Element): SentenceContext | null {
  const startNode = range.startContainer;
  const block = blockAncestor(startNode, contentRoot);
  const nodes = getParagraphNodes(block);

  const pieces: Piece[] = [];
  let blockText = "";
  let matchOffset = -1;
  for (const node of nodes) {
    if (node.nodeType !== Node.TEXT_NODE) {
      pieces.push({ node, isText: false, start: blockText.length, len: 1 });
      blockText += " "; // gaiji image — a single placeholder so offsets stay sane
      continue;
    }
    if (node === startNode) matchOffset = blockText.length + range.startOffset;
    const data = (node as Text).data;
    pieces.push({ node, isText: true, start: blockText.length, len: data.length });
    blockText += data;
  }

  if (matchOffset < 0) return null;

  const [start, end] = sentenceBounds(blockText, matchOffset);
  const raw = blockText.slice(start, end);
  const lead = raw.length - raw.replace(/^\s+/, "").length; // whitespace trim() drops from the front
  const text = raw.trim();
  const base = start + lead; // block offset of the sentence's first char

  return {
    text,
    rangeForSlice(from, to) {
      if (!text) return null;
      const a = base + Math.max(0, Math.min(from, text.length));
      const b = base + Math.max(0, Math.min(to, text.length));
      if (b <= a) return null;
      const s = locate(pieces, a);
      const e = locate(pieces, b);
      if (!s || !e) return null;
      try {
        const r = document.createRange();
        r.setStart(s.node, s.offset);
        r.setEnd(e.node, e.offset);
        return r;
      } catch {
        return null;
      }
    },
  };
}
