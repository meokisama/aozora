import { BlobReader, BlobWriter, ZipReader, configure } from "@zip.js/zip.js";
import path from "path-browserify";
import {
  getManifestItems,
  getSpineItemRefs,
  getMetadata,
  getMetaKey,
  asArray,
  firstText,
  type XmlNode,
} from "./opf";
import { locateOpf } from "./locate-opf";

// No web workers: simpler/more robust under the Electron renderer + Vite, and
// metadata reads only touch a few small entries.
configure({ useWebWorkers: false });

export function resolveCoverHref(
  manifestItems: XmlNode[],
  metadata: XmlNode | undefined,
  metaKey: string,
  spineRefs: XmlNode[],
): string | null {
  // EPUB3: a manifest item flagged properties="cover-image".
  const byProperty = manifestItems.find((item) => item["@_properties"] === "cover-image");
  if (byProperty) return byProperty["@_href"];

  // EPUB2: <meta name="cover" content="<itemId>"> → manifest item href.
  const coverMeta = asArray(metadata?.[metaKey]).find((m) => m && m["@_name"] === "cover");
  const coverId = coverMeta?.["@_content"];
  if (coverId) {
    const item = manifestItems.find((it) => it["@_id"] === coverId);
    if (item?.["@_href"]) return item["@_href"];
  }

  // Fallback for fixed-layout/manga (e.g. OMF) with no cover metadata: the first
  // spine item is the cover, when it's an image.
  const firstIdref = spineRefs[0]?.["@_idref"];
  if (firstIdref) {
    const item = manifestItems.find((it) => it["@_id"] === firstIdref);
    if (item && (item["@_media-type"] || "").startsWith("image/")) return item["@_href"] ?? null;
  }

  return null;
}

export interface EpubMetadata {
  title: string;
  author: string;
  language: string;
  coverBytes: ArrayBuffer | null;
  coverMime: string | null;
}

/** Extracts display metadata + cover from an EPUB blob, reading only the entries
 *  needed (container.xml, the OPF, and the cover image). */
export async function extractEpubMetadata(blob: Blob): Promise<EpubMetadata> {
  const reader = new ZipReader(new BlobReader(blob));
  try {
    const entries = await reader.getEntries();
    const fileMap = new Map(entries.map((e) => [e.filename, e]));

    const { contents, opfPath } = await locateOpf(fileMap);
    const manifestItems = getManifestItems(contents);
    const spineRefs = getSpineItemRefs(contents);
    const metadata = getMetadata(contents);
    const metaKey = getMetaKey(contents);

    const title = firstText(metadata?.["dc:title"]) || "";
    const author = firstText(metadata?.["dc:creator"]);
    const language = firstText(metadata?.["dc:language"]) || "ja";

    let coverBytes: ArrayBuffer | null = null;
    let coverMime: string | null = null;
    const coverHref = resolveCoverHref(manifestItems, metadata, metaKey, spineRefs);
    if (coverHref) {
      const opfDir = path.dirname(opfPath);
      const coverPath = path.join(opfDir, coverHref);
      const coverEntry = fileMap.get(coverPath) || fileMap.get(coverHref);
      const coverItem = manifestItems.find((it) => it["@_href"] === coverHref);
      coverMime = coverItem?.["@_media-type"] || "image/jpeg";
      if (coverEntry && !coverEntry.directory) {
        const coverBlob = await coverEntry.getData<Blob>(new BlobWriter(coverMime ?? undefined));
        coverBytes = await coverBlob.arrayBuffer();
      }
    }

    return { title, author, language, coverBytes, coverMime };
  } finally {
    await reader.close();
  }
}
