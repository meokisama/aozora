import { BlobReader, BlobWriter, ZipReader, type FileEntry } from "@zip.js/zip.js";
import { PREPEND } from "@/lib/epub/generate-html";
import { buildDummyImage } from "@/lib/epub/dummy-image";
import type { ParsedBook, FixedLayoutPage } from "@/lib/epub/parse-book";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".avif"]);

function isImage(name: string): boolean {
  const ext = name.toLowerCase().split(".").pop();
  return ext ? IMAGE_EXTS.has(`.${ext}`) : false;
}

function naturalSort(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g;
  const aParts = a.match(re) || [];
  const bParts = b.match(re) || [];
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const ap = aParts[i] || "";
    const bp = bParts[i] || "";
    const an = parseInt(ap, 10);
    const bn = parseInt(bp, 10);
    if (!isNaN(an) && !isNaN(bn)) {
      if (an !== bn) return an - bn;
    } else {
      const cmp = ap.localeCompare(bp);
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

export async function parseCbz(data: Blob, onProgress?: (pct: number) => void): Promise<ParsedBook> {
  onProgress?.(5);
  const reader = new ZipReader(new BlobReader(data));
  try {
    const entries = await reader.getEntries();
    onProgress?.(10);
    const imageEntries = entries
      .filter((e) => !e.directory && isImage(e.filename))
      .map((e) => e.filename);
    imageEntries.sort(naturalSort);

    if (!imageEntries.length) {
      throw new Error("No images found in CBZ archive");
    }

    const blobs: Record<string, Blob> = {};
    const wrappers: string[] = [];
    const fileMap = new Map(entries.map((e) => [e.filename, e as FileEntry]));
    const total = imageEntries.length;

    for (let i = 0; i < total; i++) {
      const name = imageEntries[i];
      const entry = fileMap.get(name);
      if (!entry || entry.directory) continue;
      const blob = await entry.getData(new BlobWriter());
      blobs[name] = blob;
      const idref = `page-${i}`;
      const imgHtml = `<img class="aoz-spine-item-image" alt="" src="${buildDummyImage(name)}" />`;
      wrappers.push(
        `<div id="${PREPEND}${idref}"><div class="aoz-book-html-wrapper"><div class="aoz-book-body-wrapper aoz-no-text">${imgHtml}</div></div></div>`,
      );
      onProgress?.(10 + Math.round(((i + 1) / total) * 90));
    }

    const elementHtml = wrappers.join("");
    const styleSheet = "";
    const sections = imageEntries.map((_, i) => ({
      reference: `${PREPEND}page-${i}`,
      charactersWeight: 0,
      startCharacter: i,
      characters: 0,
    }));

    const pages: FixedLayoutPage[] = imageEntries.map((_, i) => ({
      idref: `page-${i}`,
      wrapperId: `${PREPEND}page-${i}`,
      pageSpread: null as never,
      ordinal: i,
    }));

    return {
      elementHtml,
      styleSheet,
      blobs,
      sections,
      characters: 0,
      vertical: false,
      fixedLayout: true,
      ppd: "rtl",
      pages,
      bookViewport: null,
      spreadPairs: null,
    };
  } finally {
    await reader.close();
  }
}
