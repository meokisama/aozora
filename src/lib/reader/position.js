/**
 * Reading-position helpers for the continuous reader.
 *
 * The position model is character-based (ttsu-style `exploredCharCount`): we
 * count the Japanese characters before the current reading point so progress
 * survives re-flow (font/size changes) and restores accurately regardless of
 * pixel layout. Anchors map cumulative character offsets to DOM elements; the
 * reading point is taken at the centre of the viewport, which behaves the same
 * for vertical-rl (horizontal scroll) and horizontal-tb (vertical scroll).
 */

import { getParagraphNodes, getCharacterCount } from "@/lib/epub/dom-utils";

/**
 * Walks the rendered content in document order and returns an ordered list of
 * `{ el, charBefore }` anchors plus the total character count. `charBefore` is
 * the cumulative character count before the anchor element, so the array is
 * non-decreasing in `charBefore` — both lookups below binary-search it.
 *
 * @param {Element} contentEl  the `.aozora-content` element inside the shadow root
 * @returns {{ anchors: { el: Element, charBefore: number }[], total: number }}
 */
export function collectAnchors(contentEl) {
  const nodes = getParagraphNodes(contentEl);
  const anchors = [];
  let cumulative = 0;
  let lastEl = null;

  for (const node of nodes) {
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (el && el !== lastEl) {
      anchors.push({ el, charBefore: cumulative });
      lastEl = el;
    }
    cumulative += getCharacterCount(node);
  }

  return { anchors, total: cumulative };
}

function viewportCentre(host) {
  const hr = host.getBoundingClientRect();
  return {
    hr,
    x: hr.left + host.clientWidth / 2,
    y: hr.top + host.clientHeight / 2,
  };
}

/**
 * The character offset at the viewport centre — i.e. the reader's current
 * `exploredCharCount`. Binary-searches anchors on the reading-direction axis
 * (right→left x for vertical, top→bottom y for horizontal).
 */
export function currentCharAtCenter(host, anchors, vertical) {
  if (!anchors.length) return 0;
  const { x, y } = viewportCentre(host);
  const target = vertical ? -x : y;

  let lo = 0;
  let hi = anchors.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = anchors[mid].el.getBoundingClientRect();
    // Reading-order coordinate, monotonically non-decreasing across anchors.
    const primary = vertical ? -r.right : r.top;
    if (primary <= target) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return anchors[best].charBefore;
}

function alignToCenter(host, el, vertical) {
  const { x, y } = viewportCentre(host);
  const r = el.getBoundingClientRect();
  if (vertical) {
    host.scrollLeft += r.left + r.width / 2 - x;
  } else {
    host.scrollTop += r.top + r.height / 2 - y;
  }
}

/**
 * Scrolls so the anchor containing `targetChar` sits at the viewport centre,
 * mirroring {@link currentCharAtCenter} so save→restore round-trips.
 */
export function scrollToChar(host, anchors, vertical, targetChar) {
  if (!anchors.length) return;
  let lo = 0;
  let hi = anchors.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (anchors[mid].charBefore <= targetChar) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  alignToCenter(host, anchors[best].el, vertical);
}

/**
 * Scrolls a TOC target into view, aligning the chapter's leading edge to the
 * viewport's leading edge (right edge for vertical-rl, top for horizontal-tb).
 * Returns whether the target element was found.
 */
export function scrollToElementId(host, root, id, vertical) {
  const el = root.getElementById ? root.getElementById(id) : null;
  if (!el) return false;
  const hr = host.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (vertical) {
    host.scrollLeft += r.right - hr.right;
  } else {
    host.scrollTop += r.top - hr.top;
  }
  return true;
}
