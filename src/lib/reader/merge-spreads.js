/**
 * Merges paired fixed-layout image wrappers into a single `.aoz-spread` section,
 * in place, for the paginated reader. Used by mixed books (a reflowable light
 * novel with embedded manga-style colour pages): the two pages of a spread are
 * adjacent spine wrappers, and grouping them into one text-free section makes
 * the paginated controller render them together on one page (it already lays a
 * text-free section out as a single centred page). The CSS in `reader-styles`
 * places the two halves side by side (right-to-left for RTL books).
 *
 * @param {HTMLElement} container  holds the spine wrappers as direct children
 * @param {string[][]|null} spreadPairs  `[[openerId, closerId], …]` (wrapper ids, opener first)
 * @param {"ltr"|"rtl"} ppd
 */
export function mergeSpreadSections(container, spreadPairs, ppd) {
  if (!spreadPairs || !spreadPairs.length) return;
  const byId = new Map();
  for (const child of Array.from(container.children)) {
    if (child.id) byId.set(child.id, child);
  }
  for (const [openerId, closerId] of spreadPairs) {
    const opener = byId.get(openerId);
    const closer = byId.get(closerId);
    if (!opener || !closer || opener.parentNode !== container || closer.parentNode !== container) continue;

    const spread = container.ownerDocument.createElement("div");
    spread.className = "aoz-spread aoz-no-text";
    spread.id = `aoz-spread-${openerId.replace(/^aoz-/, "")}`;
    spread.dataset.ppd = ppd;
    container.insertBefore(spread, opener);
    // Opener first; CSS flex-direction (row-reverse for rtl) puts it on the
    // correct side. The original wrappers keep their ids so TOC/href jumps and
    // character bookkeeping still resolve them.
    spread.appendChild(opener);
    spread.appendChild(closer);
  }
}
