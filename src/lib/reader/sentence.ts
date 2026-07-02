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
 * Given the full text of a block and a character offset that falls inside the
 * matched run, returns the sentence spanning that offset (terminator included,
 * trimmed). Exported for unit testing.
 */
export function sentenceFromBlockText(text: string, offset: number): string {
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
