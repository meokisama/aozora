/**
 * In-book full-text search.
 *
 * No separate text store: the flattened book HTML (cached in IndexedDB) is the
 * only text source. We walk it like the reading-position model
 * (`getParagraphNodes` + `getCharacterCount`), grouping into block units and
 * recording each block's cumulative char offset — the same `exploredCharCount`
 * the reader navigates by, so a hit's `charOffset` feeds `jumpToChar` /
 * `restoreToChar` directly in either mode.
 *
 * Matching normalization is length-preserving (every transform is 1:1), so a
 * normalized-string index is also a valid raw-text index — keeping snippets and
 * highlight ranges aligned. `<rt>` readings are excluded by `getParagraphNodes`,
 * so queries match base text across furigana.
 */

import { getParagraphNodes, getCharacterCount, isNodeGaiji, countJapanese } from "@/lib/epub/dom-utils";

/** Cap on returned (not counted) matches, so a very common query can't build a
 *  huge result list. The true total is reported separately. */
export const MAX_RESULTS = 500;

export interface Block {
  el?: Element;
  charBefore: number;
  text: string;
  nodes: { node: Node; isGaiji: boolean }[];
}

export interface SearchIndexEntry {
  charBefore: number;
  text: string;
  normalized: string;
}

export interface SearchResult {
  charOffset: number;
  pre: string;
  hit: string;
  post: string;
}

// Inline tags that don't break a paragraph: text on either side belongs to the
// same searchable block (so a query spanning e.g. a ruby base still matches).
const INLINE_TAGS = new Set([
  "RUBY",
  "RT",
  "RP",
  "RB",
  "SPAN",
  "A",
  "EM",
  "STRONG",
  "B",
  "I",
  "U",
  "S",
  "SUP",
  "SUB",
  "SMALL",
  "MARK",
  "CODE",
  "WBR",
  "BR",
  "FONT",
  "Q",
  "CITE",
  "ABBR",
  "BDI",
  "BDO",
  "TIME",
  "VAR",
  "KBD",
  "SAMP",
]);

/** The nearest non-inline ancestor of a node (its "paragraph"), bounded by root. */
export function blockAncestor(node: Node, root: Element): Element {
  let el: Element | null = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  while (el && el !== root && el.parentElement && INLINE_TAGS.has(el.tagName)) {
    el = el.parentElement;
  }
  return el || root;
}

/**
 * Length-preserving normalization for matching: fold full-width ASCII to
 * half-width, the ideographic space to a regular one, any whitespace to a single
 * space, then lower-case. Every replacement is one code point for one, so the
 * result is the same length as the input and indices stay aligned.
 */
export function normalize(str: string | null | undefined): string {
  if (!str) return "";
  let out = "";
  for (const ch of str) {
    const code = ch.codePointAt(0)!;
    if (code >= 0xff01 && code <= 0xff5e) out += String.fromCodePoint(code - 0xfee0);
    else if (code === 0x3000 || /\s/.test(ch)) out += " ";
    else out += ch;
  }
  return out.toLowerCase();
}

/**
 * Walks the rendered (or detached) content into block-level text units. Each
 * block carries its cumulative character offset, its raw text, and the live text
 * nodes it spans (used to build highlight ranges). Image-only blocks (no text)
 * are dropped — there is nothing to search or highlight in them.
 */
export function collectBlocks(rootEl: Element): Block[] {
  const nodes = getParagraphNodes(rootEl);
  const blocks: Block[] = [];
  let cumulative = 0;
  let cur: Block | null = null;

  for (const node of nodes) {
    const gaiji = isNodeGaiji(node);
    const blk = blockAncestor(node, rootEl);
    if (!cur || blk !== cur.el) {
      cur = { el: blk, charBefore: cumulative, text: "", nodes: [] };
      blocks.push(cur);
    }
    if (!gaiji) cur.text += node.textContent;
    cur.nodes.push({ node, isGaiji: gaiji });
    cumulative += getCharacterCount(node);
  }

  return blocks.filter((b) => b.text.trim().length > 0);
}

/**
 * Builds the searchable index from the flattened book HTML. Pre-normalizes each
 * block once so repeated queries (per keystroke) don't re-scan the raw text.
 */
export function buildSearchIndex(elementHtml: string): SearchIndexEntry[] {
  const div = document.createElement("div");
  div.innerHTML = elementHtml;
  return collectBlocks(div).map((b) => ({
    charBefore: b.charBefore,
    text: b.text,
    normalized: normalize(b.text),
  }));
}

function makeSnippet(text: string, idx: number, len: number, ctx = 24): { pre: string; hit: string; post: string } {
  const start = Math.max(0, idx - ctx);
  const end = Math.min(text.length, idx + len + ctx * 2);
  return {
    pre: (start > 0 ? "…" : "") + text.slice(start, idx),
    hit: text.slice(idx, idx + len),
    post: text.slice(idx + len, end) + (end < text.length ? "…" : ""),
  };
}

/**
 * Searches the index for every occurrence of `query`. Each result's `charOffset`
 * feeds jumpToChar.
 */
export function searchIndex(
  index: SearchIndexEntry[],
  query: string,
  max = MAX_RESULTS,
): { results: SearchResult[]; total: number; capped: boolean } {
  const q = normalize(query ?? "");
  if (!q.trim()) return { results: [], total: 0, capped: false };

  const results: SearchResult[] = [];
  let total = 0;
  for (const blk of index) {
    let from = 0;
    let idx: number;
    // Accumulate the Japanese-char count as matches advance instead of
    // re-counting the prefix from 0 each hit (was O(matches × blockLen)). Match
    // boundaries fall on codepoint boundaries, so this is exactly additive.
    let prevIdx = 0;
    let jpAcc = 0;
    while ((idx = blk.normalized.indexOf(q, from)) !== -1) {
      total += 1;
      if (results.length < max) {
        jpAcc += countJapanese(blk.text.slice(prevIdx, idx));
        prevIdx = idx;
        results.push({
          charOffset: blk.charBefore + jpAcc,
          ...makeSnippet(blk.text, idx, q.length),
        });
      }
      from = idx + q.length;
    }
  }
  return { results, total, capped: total > results.length };
}
