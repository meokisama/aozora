/**
 * In-book full-text search.
 *
 * The reader has no separate text store: the flattened book HTML (produced once
 * by `parseBook`, cached in IndexedDB) is the only source of text. We walk it the
 * same way the reading-position model does (`getParagraphNodes` +
 * `getCharacterCount`), grouping text into block-level units ("paragraphs") and
 * recording the cumulative Japanese-character offset before each block. That
 * offset is the exact same `exploredCharCount` the reader navigates by, so a
 * search hit's `charOffset` can be handed straight to `jumpToChar` /
 * `restoreToChar` in either reading mode.
 *
 * Matching is normalized (full-width↔half-width folding, lower-casing,
 * whitespace unified) but length-preserving — every transform is 1:1 — so an
 * index into the normalized string is also a valid index into the raw text. That
 * keeps snippet extraction and highlight ranges aligned with the original
 * characters. Ruby readings (`<rt>`) are excluded by `getParagraphNodes`, so a
 * query matches the base text across furigana.
 */

import { getParagraphNodes, getCharacterCount, isNodeGaiji, countJapanese } from "@/lib/epub/dom-utils";

/** Cap on returned (not counted) matches, so a very common query can't build a
 *  huge result list. The true total is reported separately. */
export const MAX_RESULTS = 500;

// Inline tags that don't break a paragraph: text on either side belongs to the
// same searchable block (so a query spanning e.g. a ruby base still matches).
const INLINE_TAGS = new Set([
  "RUBY", "RT", "RP", "RB", "SPAN", "A", "EM", "STRONG", "B", "I", "U", "S",
  "SUP", "SUB", "SMALL", "MARK", "CODE", "WBR", "BR", "FONT", "Q", "CITE",
  "ABBR", "BDI", "BDO", "TIME", "VAR", "KBD", "SAMP",
]);

/** The nearest non-inline ancestor of a node (its "paragraph"), bounded by root. */
function blockAncestor(node, root) {
  let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
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
export function normalize(str) {
  if (!str) return "";
  let out = "";
  for (const ch of str) {
    const code = ch.codePointAt(0);
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
 *
 * @param {Element} rootEl
 * @returns {{ charBefore: number, text: string, nodes: { node: Node, isGaiji: boolean }[] }[]}
 */
export function collectBlocks(rootEl) {
  const nodes = getParagraphNodes(rootEl);
  const blocks = [];
  let cumulative = 0;
  let cur = null;

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
 *
 * @param {string} elementHtml  `parsed.elementHtml`
 * @returns {{ charBefore: number, text: string, normalized: string }[]}
 */
export function buildSearchIndex(elementHtml) {
  const div = document.createElement("div");
  div.innerHTML = elementHtml;
  return collectBlocks(div).map((b) => ({
    charBefore: b.charBefore,
    text: b.text,
    normalized: normalize(b.text),
  }));
}

function makeSnippet(text, idx, len, ctx = 24) {
  const start = Math.max(0, idx - ctx);
  const end = Math.min(text.length, idx + len + ctx * 2);
  return {
    pre: (start > 0 ? "…" : "") + text.slice(start, idx),
    hit: text.slice(idx, idx + len),
    post: text.slice(idx + len, end) + (end < text.length ? "…" : ""),
  };
}

/**
 * Searches the index for every occurrence of `query`.
 *
 * @param {{ charBefore: number, text: string, normalized: string }[]} index
 * @param {string} query
 * @param {number} [max]
 * @returns {{ results: object[], total: number, capped: boolean }}
 *   each result: { charOffset, pre, hit, post } — `charOffset` feeds jumpToChar.
 */
export function searchIndex(index, query, max = MAX_RESULTS) {
  const q = normalize(query ?? "");
  if (!q.trim()) return { results: [], total: 0, capped: false };

  const results = [];
  let total = 0;
  for (const blk of index) {
    let from = 0;
    let idx;
    while ((idx = blk.normalized.indexOf(q, from)) !== -1) {
      total += 1;
      if (results.length < max) {
        results.push({
          charOffset: blk.charBefore + countJapanese(blk.text.slice(0, idx)),
          ...makeSnippet(blk.text, idx, q.length),
        });
      }
      from = idx + q.length;
    }
  }
  return { results, total, capped: total > results.length };
}
