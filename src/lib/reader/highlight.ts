/**
 * Search-hit highlighting via the CSS Custom Highlight API.
 *
 * Uses `CSS.highlights` + `::highlight(aoz-search-hit)` rather than wrapping in
 * <mark>: a <mark> can't span ruby boundaries and would mutate the book DOM. The
 * range points at live shadow-tree text nodes, so it clears itself when the
 * paginated reader swaps a section. Placement re-walks the live content with the
 * search block model (`collectBlocks`); `baseChar` is the rendered region's
 * global start offset (0 continuous, current section start paginated).
 */

import { countJapanese } from "@/lib/epub/dom-utils";
import { collectBlocks, normalize, type Block } from "@/lib/reader/search";

const HL_NAME = "aoz-search-hit";
const DICT_HL_NAME = "aoz-dict-hit";
const KARAOKE_HL_NAME = "aoz-tts-karaoke";

const supported = (): boolean => typeof CSS !== "undefined" && !!CSS.highlights && typeof Highlight !== "undefined";

export function clearSearchHighlight(): void {
  if (supported()) CSS.highlights.delete(HL_NAME);
}

/**
 * Paints (or clears) the run the hover dictionary matched. The caller already
 * holds the Range (from `lookup-text.ts`'s `rangeForLength`); pass null to clear.
 */
export function setLookupHighlight(range: Range | null): void {
  if (!supported()) return;
  if (range) CSS.highlights.set(DICT_HL_NAME, new Highlight(range));
  else CSS.highlights.delete(DICT_HL_NAME);
}

/**
 * Paints (or clears) the run currently being read aloud, growing over the
 * sentence in time with the VOICEVOX audio (karaoke). Pass null to clear.
 */
export function setKaraokeHighlight(range: Range | null): void {
  if (!supported()) return;
  if (range) CSS.highlights.set(KARAOKE_HL_NAME, new Highlight(range));
  else CSS.highlights.delete(KARAOKE_HL_NAME);
}

/** Builds a Range over [start, start+len) raw characters within a block. */
function rangeForBlock(block: Block, start: number, len: number): Range | null {
  const range = document.createRange();
  let raw = 0;
  let startSet = false;
  for (const n of block.nodes) {
    if (n.isGaiji) continue;
    const nodeLen = (n.node.textContent || "").length;
    if (!startSet && start < raw + nodeLen) {
      range.setStart(n.node, start - raw);
      startSet = true;
    }
    if (startSet && start + len <= raw + nodeLen) {
      range.setEnd(n.node, start + len - raw);
      return range;
    }
    raw += nodeLen;
  }
  return startSet ? range : null;
}

/**
 * Highlights the search hit at `charOffset` within `rootEl`. Returns whether a
 * highlight was set. `baseChar` is the global offset of the rendered region's
 * start.
 */
export function highlightSearchResult(rootEl: Element | null, charOffset: number, query: string, baseChar = 0): boolean {
  clearSearchHighlight();
  if (!rootEl || !supported()) return false;
  const q = normalize(query ?? "");
  if (!q) return false;

  const blocks = collectBlocks(rootEl);
  const targetLocal = charOffset - baseChar;
  let block: Block | null = null;
  for (const b of blocks) {
    if (b.charBefore <= targetLocal) block = b;
    else break;
  }
  if (!block) return false;

  // Pick the occurrence whose derived offset matches; fall back to the first.
  const hay = normalize(block.text);
  let from = 0;
  let idx: number;
  let matchIdx = -1;
  // Accumulate the Japanese-char count as occurrences advance (matches fall on
  // codepoint boundaries), rather than re-counting the prefix from 0 each hit.
  let prevIdx = 0;
  let jpAcc = 0;
  while ((idx = hay.indexOf(q, from)) !== -1) {
    jpAcc += countJapanese(block.text.slice(prevIdx, idx));
    prevIdx = idx;
    if (baseChar + block.charBefore + jpAcc === charOffset) {
      matchIdx = idx;
      break;
    }
    from = idx + q.length;
  }
  if (matchIdx < 0) matchIdx = hay.indexOf(q);
  if (matchIdx < 0) return false;

  const range = rangeForBlock(block, matchIdx, q.length);
  if (!range) return false;
  try {
    CSS.highlights.set(HL_NAME, new Highlight(range));
    return true;
  } catch {
    return false;
  }
}
