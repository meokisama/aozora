import { extractEpub } from "./extract";
import { generateHtml, PREPEND, type Section } from "./generate-html";
import { generateStyleSheet } from "./generate-stylesheet";
import { getBookViewport, getPageProgressionDirection, getRenditionLayout, getSpinePageSpreads, isFixedLayout, type PageSpread } from "./opf";
import { buildSpreads } from "@/lib/reader/spreads";

export interface FixedLayoutPage {
  idref: string;
  wrapperId: string;
  pageSpread: PageSpread | null;
  ordinal: number;
}

export interface ParsedBook {
  elementHtml: string;
  styleSheet: string;
  blobs: Record<string, Blob>;
  sections: Section[];
  characters: number;
  vertical: boolean;
  fixedLayout: boolean;
  ppd: string;
  pages: FixedLayoutPage[] | null;
  bookViewport: { width: number; height: number } | null;
  spreadPairs: string[][] | null;
}

/**
 * Parses an EPUB blob into the reader payload: one flattened HTML string, the
 * book's combined stylesheet, the image blobs (keyed by path), the chapter
 * sections, and the total character count. This is the expensive step; results
 * are cached in IndexedDB by the caller.
 *
 * For fixed-layout books (manga / comics — `rendition:layout=pre-paginated`) the
 * same flattened HTML is produced (each spine page becomes an `aoz-<idref>`
 * wrapper holding the page's SVG/image), and extra fields describe how to render
 * those wrappers as spreads: the page order + `page-spread` sides (`pages`), the
 * progression direction (`ppd`), and the base viewport to scale against.
 */
export async function parseBook(blob: Blob): Promise<ParsedBook> {
  const { contents, contentsDirectory, result } = await extractEpub(blob);
  const { element, characters, sections } = generateHtml(result, contents, contentsDirectory);
  const styleSheet = generateStyleSheet(result, contents);

  const blobs: Record<string, Blob> = {};
  for (const [key, value] of Object.entries(result)) {
    if (value instanceof Blob) blobs[key] = value;
  }

  const elementHtml = element.innerHTML;
  const ppd = getPageProgressionDirection(contents);
  const vertical = ppd === "rtl" || /\bvrtl\b/.test(elementHtml);

  const fixedLayout = isFixedLayout(contents);
  const effectivePpd = ppd || (fixedLayout ? "rtl" : "ltr");
  const spine = getSpinePageSpreads(contents).filter((p) => p.linear);

  let pages: FixedLayoutPage[] | null = null;
  let bookViewport: { width: number; height: number } | null = null;
  let spreadPairs: string[][] | null = null;
  if (fixedLayout) {
    // Wholly fixed-layout (manga) → the dedicated FixedLayoutView renders it.
    bookViewport = getBookViewport(contents);
    let ordinal = 0;
    pages = spine.map((p) => ({
      idref: p.idref,
      wrapperId: `${PREPEND}${p.idref}`,
      pageSpread: p.pageSpread,
      ordinal: ordinal++,
    }));
  } else {
    // Reflowable book that may embed fixed-layout image pages (a light novel
    // with manga-style colour spreads). Pre-compute which spine wrappers pair
    // so the paginated reader can merge them into a two-page spread; text pages
    // (reflowable) never pair.
    const packageLayout = getRenditionLayout(contents);
    const flow = spine.map((p) => ({
      idref: p.idref,
      pageSpread: p.pageSpread,
      prePaginated: (p.layout || packageLayout) === "pre-paginated",
    }));
    if (flow.some((p) => p.prePaginated)) {
      spreadPairs = buildSpreads(flow, effectivePpd as "rtl" | "ltr")
        .filter((s) => s.items.length === 2)
        .map((s) => s.items.map((it) => `${PREPEND}${it.idref}`));
      if (!spreadPairs.length) spreadPairs = null;
    }
  }

  return {
    elementHtml,
    styleSheet,
    blobs,
    sections,
    characters,
    vertical,
    fixedLayout,
    ppd: effectivePpd,
    pages,
    bookViewport,
    spreadPairs,
  };
}
