/**
 * Groups fixed-layout pages into spreads (one or two pages shown together),
 * honouring each page's `page-spread` side and the book's page-progression
 * direction. Ported from bibi's spine-walking logic (bibi.heart.js).
 *
 * Page-progression direction decides which side opens a pair:
 *   - rtl (Japanese manga): a `right` page opens, the following `left` page
 *     closes the pair → they share one spread (read right-to-left).
 *   - ltr: a `left` page opens, the following `right` page closes it.
 *
 * Two adjacent pages pair only when both are fixed-layout (pre-paginated), the
 * first is the "opening" side and is still alone in its spread; everything else
 * (cover, `center`, lone openers/closers, odd pages, reflowable text pages in a
 * mixed book) stays a single-page spread. The single-page `pageSpread` is kept
 * so the viewer can align it (a lone `left` sits where the left half would be).
 */

export interface SpreadPage {
  pageSpread: string | null;
  prePaginated?: boolean;
  linear?: boolean;
  idref?: string;
  // Loose index signature so callers can pass their own page shapes
  // (FixedLayoutPage, SpinePageSpread) without restructuring; `any` (not
  // `unknown`) is required here — an `unknown` index makes the type a strict
  // supertype that those interfaces no longer structurally satisfy.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface Spread {
  index: number;
  items: SpreadPage[];
  single: boolean;
  pageSpread: string | null;
}

export function buildSpreads(pages: SpreadPage[], ppd: "ltr" | "rtl"): Spread[] {
  const before = ppd === "rtl" ? "right" : "left"; // opens a pair
  const after = ppd === "rtl" ? "left" : "right"; // closes a pair
  const fixed = (p: SpreadPage | null | undefined) => p && p.prePaginated !== false; // default true (wholly-fixed manga)

  const spreads: Spread[] = [];
  const flow = pages.filter((p) => p.linear !== false);

  flow.forEach((page, i) => {
    const last = spreads[spreads.length - 1];
    const prev = i > 0 ? flow[i - 1] : null;

    // Close a pair: this page is the "after" side and the previous page is an
    // "before" side still sitting alone in the most recent spread. Both pages
    // must be fixed-layout — a reflowable text page never pairs.
    if (
      fixed(page) &&
      fixed(prev) &&
      page.pageSpread === after &&
      prev &&
      prev.pageSpread === before &&
      last &&
      last.items.length === 1 &&
      last.items[0] === prev
    ) {
      last.items.push(page);
      last.single = false;
      return;
    }

    spreads.push({
      index: spreads.length,
      items: [page],
      single: true,
      pageSpread: page.pageSpread || null,
    });
  });

  return spreads;
}
