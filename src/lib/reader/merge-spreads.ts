/**
 * Merges paired fixed-layout image wrappers into a single `.aoz-spread` section
 * in place, for the paginated reader. Mixed books (reflowable text + manga-style
 * colour pages) carry the two pages of a spread as adjacent spine wrappers;
 * grouping them into one text-free section makes the controller render them on
 * one page (it lays text-free sections out as a single centred page). CSS in
 * `reader-styles` places the halves side by side (right-to-left for RTL books).
 *
 * @param container    holds the spine wrappers as direct children
 * @param spreadPairs  `[[openerId, closerId], …]` (wrapper ids, opener first)
 */
export function mergeSpreadSections(container: HTMLElement, spreadPairs: string[][] | null, ppd: string): void {
  if (!spreadPairs || !spreadPairs.length) return;
  const byId = new Map<string, Element>();
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
