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
 * Parses an EPUB blob into the reader payload: flattened HTML, combined
 * stylesheet, image blobs (keyed by path), chapter sections, char count.
 * Reports progress via onProgress (0-100).
 */
export async function parseBook(blob: Blob, onProgress?: (pct: number) => void): Promise<ParsedBook> {
  const { contents, contentsDirectory, result } = await extractEpub(blob, (pct) => onProgress?.(Math.round(pct * 0.4)));
  onProgress?.(40);
  await new Promise((r) => setTimeout(r, 0));
  const { element, characters, sections } = generateHtml(result, contents, contentsDirectory, (pct) => onProgress?.(40 + Math.round(pct * 0.4)));
  onProgress?.(80);
  await new Promise((r) => setTimeout(r, 0));
  const styleSheet = generateStyleSheet(result, contents);
  onProgress?.(85);

  const blobs: Record<string, Blob> = {};
  for (const [key, value] of Object.entries(result)) {
    if (value instanceof Blob) blobs[key] = value;
  }

  const elementHtml = element.innerHTML;
  const ppd = getPageProgressionDirection(contents);
  const cssDeclaresVertical = /(?:-webkit-|-epub-)?writing-mode\s*:\s*(?:vertical-[rl]l|tb-[rl]l)/i.test(styleSheet);
  const vertical = ppd === "rtl" || /\bvrtl\b/.test(elementHtml) || (ppd !== "ltr" && cssDeclaresVertical);

  const fixedLayout = isFixedLayout(contents);
  const effectivePpd = ppd || (fixedLayout ? "rtl" : "ltr");
  const spine = getSpinePageSpreads(contents).filter((p) => p.linear);

  let pages: FixedLayoutPage[] | null = null;
  let bookViewport: { width: number; height: number } | null = null;
  let spreadPairs: string[][] | null = null;
  if (fixedLayout) {
    bookViewport = getBookViewport(contents);
    let ordinal = 0;
    pages = spine.map((p) => ({
      idref: p.idref,
      wrapperId: `${PREPEND}${p.idref}`,
      pageSpread: p.pageSpread,
      ordinal: ordinal++,
    }));
  } else {
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

  onProgress?.(90);
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
