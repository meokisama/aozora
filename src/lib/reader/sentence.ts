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

/** The block-text walk shared by all three sentence extractors. */
interface BlockAssembly {
  /** The block ancestor of the match. */
  block: Element;
  /** Per-node contributions (gaiji → a 1-char placeholder), for range building. */
  pieces: Piece[];
  /** Assembled block text (gaiji collapsed to a single space). */
  text: string;
  /** Char offset of the match within `text`, or -1 if the start node isn't in the block. */
  offset: number;
}

/**
 * Walks a match's block once, assembling its text (furigana/hidden nodes already
 * excluded by `getParagraphNodes`, gaiji collapsed to one space so offsets stay
 * sane) and locating the match within it. The single source the sentence
 * extractors below build on.
 */
function assembleBlock(range: Range, contentRoot: Element): BlockAssembly {
  const startNode = range.startContainer;
  const block = blockAncestor(startNode, contentRoot);
  const nodes = getParagraphNodes(block);

  const pieces: Piece[] = [];
  let text = "";
  let offset = -1;
  for (const node of nodes) {
    if (node.nodeType !== Node.TEXT_NODE) {
      pieces.push({ node, isText: false, start: text.length, len: 1 });
      text += " ";
      continue;
    }
    if (node === startNode) offset = text.length + range.startOffset;
    const data = (node as Text).data;
    pieces.push({ node, isText: true, start: text.length, len: data.length });
    text += data;
  }
  return { block, pieces, text, offset };
}

/**
 * Resolves the sentence around a matched DOM Range within the reader's content.
 * Falls back to the whole block's text when the match node can't be located.
 */
export function sentenceAround(range: Range, contentRoot: Element): string {
  const { text, offset } = assembleBlock(range, contentRoot);
  if (offset < 0) return text.trim(); // match node not in this block: whole block
  return sentenceFromBlockText(text, offset);
}

/** The sentence around a match, split around the matched run for Anki cloze fields. */
export interface SentenceCloze {
  /** The whole sentence (terminator included, trimmed). */
  sentence: string;
  /** Sentence text before the matched run. */
  prefix: string;
  /** The matched run itself (the surface form under the cursor). */
  body: string;
  /** Sentence text after the matched run. */
  suffix: string;
}

/**
 * Like `sentenceAround`, but also splits the sentence around the matched run so
 * callers can build Anki cloze fields ({cloze-prefix}{cloze-body}{cloze-suffix}).
 * `body` is the live match text; `prefix`/`suffix` are the surrounding sentence.
 */
export function sentenceClozeAround(range: Range, contentRoot: Element): SentenceCloze {
  const body = range.toString();
  const { text, offset } = assembleBlock(range, contentRoot);

  // Match node not in this block: fall back to the whole block as the sentence.
  if (offset < 0) {
    const sentence = text.trim();
    return { sentence, prefix: "", body, suffix: sentence.startsWith(body) ? sentence.slice(body.length) : "" };
  }

  const [start, end] = sentenceBounds(text, offset);
  const bodyEnd = Math.min(offset + body.length, end);
  // Leading/trailing whitespace of the sentence belongs to no cloze part, so it
  // is trimmed off the ends (matching sentenceFromBlockText's trim()).
  const prefix = text.slice(start, offset).replace(/^\s+/, "");
  const suffix = text.slice(bodyEnd, end).replace(/\s+$/, "");
  return { sentence: prefix + body + suffix, prefix, body, suffix };
}

/** A <ruby>'s furigana reading: its <rt> contents joined (<rp> parens dropped). */
function rubyReading(ruby: Element): string {
  let reading = "";
  for (const rt of Array.from(ruby.querySelectorAll("rt"))) reading += rt.textContent ?? "";
  return reading;
}

/** A displayed↔spoken correspondence: block-text range [d0,d1) ↔ spoken range [s0,s1). */
interface Seg {
  d0: number;
  d1: number;
  s0: number;
  s1: number;
}

/**
 * Projects an offset across the displayed↔spoken correspondence. Outside ruby
 * the two texts are identical, so the mapping is exact; inside a ruby the base
 * maps onto its reading proportionally (the karaoke highlight sweeps a kanji
 * word as its reading is voiced).
 */
function project(segs: Seg[], x: number, fromSpoken: boolean): number {
  for (const g of segs) {
    const [a0, a1, b0, b1] = fromSpoken ? [g.s0, g.s1, g.d0, g.d1] : [g.d0, g.d1, g.s0, g.s1];
    if (x <= a0) return b0;
    if (x < a1) {
      if (a1 - a0 === b1 - b0) return b0 + (x - a0);
      return b0 + Math.round(((x - a0) / (a1 - a0)) * (b1 - b0));
    }
  }
  const last = segs[segs.length - 1];
  return last ? (fromSpoken ? last.d1 : last.s1) : 0;
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
  /** The sentence as displayed (terminator included, trimmed) — for highlighting. */
  text: string;
  /**
   * The same sentence with ruby bases replaced by their furigana readings — what
   * to synthesize when reading aloud. Equals `text` when the sentence has no ruby.
   */
  spoken: string;
  /**
   * Maps a `spoken`-relative offset (0..spoken.length) to the corresponding
   * `text`-relative offset — exact outside ruby, proportional within a reading.
   * For the karaoke highlight: characters-spoken → characters-to-paint.
   */
  displayedFromSpoken(offset: number): number;
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
  const { block, pieces, text: blockText, offset: matchOffset } = assembleBlock(range, contentRoot);

  if (matchOffset < 0) return null;

  const [start, end] = sentenceBounds(blockText, matchOffset);
  const raw = blockText.slice(start, end);
  const lead = raw.length - raw.replace(/^\s+/, "").length; // whitespace trim() drops from the front
  const text = raw.trim();
  const base = start + lead; // block offset of the sentence's first char

  // The reading-substituted counterpart, built from the same pieces as
  // blockText so displayed↔spoken offsets correspond by construction: pieces
  // under a <ruby> collapse into one segment carrying the furigana reading
  // (no <rt> → keep the base); everything else maps one-to-one. This is what
  // the synthesizer voices, so proper nouns and rare readings follow the book
  // (e.g. 主人公 → しゅじんこう, 夜神月 → やがみライト).
  const rubyOf = (n: Node): Element | null => {
    const r = n.parentElement?.closest("ruby") ?? null;
    return r && block.contains(r) ? r : null;
  };
  const segs: Seg[] = [];
  let spokenBlock = "";
  for (let i = 0; i < pieces.length; ) {
    const ruby = rubyOf(pieces[i].node);
    let j = i + 1;
    if (ruby) while (j < pieces.length && rubyOf(pieces[j].node) === ruby) j++;
    const d0 = pieces[i].start;
    const d1 = pieces[j - 1].start + pieces[j - 1].len;
    const reading = (ruby && rubyReading(ruby)) || blockText.slice(d0, d1);
    segs.push({ d0, d1, s0: spokenBlock.length, s1: spokenBlock.length + reading.length });
    spokenBlock += reading;
    i = j;
  }

  // Sentence boundaries live outside ruby, so these project exactly.
  const sA = project(segs, base, false);
  const sB = project(segs, base + text.length, false);
  const spoken = spokenBlock.slice(sA, sB) || text;

  return {
    text,
    spoken,
    displayedFromSpoken(offset) {
      const at = sA + Math.max(0, Math.min(offset, sB - sA));
      return Math.max(0, Math.min(project(segs, at, true) - base, text.length));
    },
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
