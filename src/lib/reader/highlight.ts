/**
 * Search-hit highlighting via the CSS Custom Highlight API.
 *
 * Rather than wrapping matched text in <mark> (which can't span element
 * boundaries like ruby, and would mutate the book DOM), we register a Range with
 * `CSS.highlights`; the paint comes from a `::highlight(aoz-search-hit)` rule in
 * the reader's base styles. The range points at live text nodes in the shadow
 * tree, so it disappears on its own when the paginated reader swaps a section.
 *
 * To place the range we re-walk the live content with the same block model as
 * search (`collectBlocks`), find the block containing the hit's character offset,
 * then disambiguate the exact occurrence by re-deriving each candidate's offset.
 * `baseChar` is the global character offset of the rendered region's start (0 in
 * continuous mode, the current section's start in paginated mode), since the
 * paginated reader only renders one section at a time.
 */

import { countJapanese } from "@/lib/epub/dom-utils";
import { collectBlocks, normalize, type Block } from "@/lib/reader/search";

const HL_NAME = "aoz-search-hit";

const supported = (): boolean =>
  typeof CSS !== "undefined" && !!CSS.highlights && typeof Highlight !== "undefined";

export function clearSearchHighlight(): void {
  if (supported()) CSS.highlights.delete(HL_NAME);
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
export function highlightSearchResult(
  rootEl: Element | null,
  charOffset: number,
  query: string,
  baseChar = 0,
): boolean {
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
  while ((idx = hay.indexOf(q, from)) !== -1) {
    if (baseChar + block.charBefore + countJapanese(block.text.slice(0, idx)) === charOffset) {
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
