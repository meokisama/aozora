import {
  BlobReader,
  BlobWriter,
  TextWriter,
  ZipReader,
  configure,
} from "@zip.js/zip.js";
import path from "path-browserify";
import {
  xmlParser,
  getManifestItems,
  getMetadata,
  getMetaKey,
  asArray,
  firstText,
} from "./opf";

// Disable web workers: simpler/more robust under the Electron renderer + Vite
// bundler. Metadata reads only touch a few small entries, so it's plenty fast.
configure({ useWebWorkers: false });

function resolveCoverHref(manifestItems, metadata, metaKey) {
  // EPUB3: a manifest item flagged properties="cover-image".
  const byProperty = manifestItems.find(
    (item) => item["@_properties"] === "cover-image"
  );
  if (byProperty) return byProperty["@_href"];

  // EPUB2: <meta name="cover" content="<itemId>"> → manifest item href.
  const coverMeta = asArray(metadata?.[metaKey]).find(
    (m) => m && m["@_name"] === "cover"
  );
  const coverId = coverMeta?.["@_content"];
  if (!coverId) return null;

  const item = manifestItems.find((it) => it["@_id"] === coverId);
  return item?.["@_href"] ?? null;
}

/**
 * Extracts display metadata + cover image from an EPUB blob, reading only the
 * few entries needed (container.xml, the OPF, and the cover image).
 *
 * @param {Blob} blob  the .epub file
 * @returns {Promise<{
 *   title: string, author: string, language: string,
 *   coverBytes: ArrayBuffer | null, coverMime: string | null
 * }>}
 */
export async function extractEpubMetadata(blob) {
  const reader = new ZipReader(new BlobReader(blob));
  try {
    const entries = await reader.getEntries();
    const fileMap = new Map(entries.map((e) => [e.filename, e]));

    const containerEntry = fileMap.get("META-INF/container.xml");
    if (!containerEntry) throw new Error("Invalid EPUB: missing container.xml");

    const containerXml = await containerEntry.getData(new TextWriter());
    const container = xmlParser.parse(containerXml);
    const rootFiles = container.container.rootfiles.rootfile;
    const rootFile = Array.isArray(rootFiles) ? rootFiles[0] : rootFiles;
    const opfPath = rootFile["@_full-path"];

    const opfEntry = fileMap.get(opfPath);
    if (!opfEntry) throw new Error(`Invalid EPUB: missing OPF at ${opfPath}`);

    const contents = xmlParser.parse(await opfEntry.getData(new TextWriter()));
    const manifestItems = getManifestItems(contents);
    const metadata = getMetadata(contents);
    const metaKey = getMetaKey(contents);

    const title = firstText(metadata?.["dc:title"]) || "";
    const author = firstText(metadata?.["dc:creator"]);
    const language = firstText(metadata?.["dc:language"]) || "ja";

    let coverBytes = null;
    let coverMime = null;
    const coverHref = resolveCoverHref(manifestItems, metadata, metaKey);
    if (coverHref) {
      const opfDir = path.dirname(opfPath);
      const coverPath = path.join(opfDir, coverHref);
      const coverEntry = fileMap.get(coverPath) || fileMap.get(coverHref);
      const coverItem = manifestItems.find((it) => it["@_href"] === coverHref);
      coverMime = coverItem?.["@_media-type"] || "image/jpeg";
      if (coverEntry) {
        const coverBlob = await coverEntry.getData(new BlobWriter(coverMime));
        coverBytes = await coverBlob.arrayBuffer();
      }
    }

    return { title, author, language, coverBytes, coverMime };
  } finally {
    await reader.close();
  }
}
