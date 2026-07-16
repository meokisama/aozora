import { BlobReader, BlobWriter, TextWriter, ZipReader, configure } from "@zip.js/zip.js";
import path from "path-browserify";
import { getManifestItems, type OpfContents } from "./opf";
import { locateOpf } from "./locate-opf";

configure({ useWebWorkers: false });

export interface ExtractedEpub {
  contents: OpfContents;
  contentsDirectory: string;
  result: Record<string, string | Blob>;
}

/**
 * Fully unzips an EPUB: reads container.xml → the OPF, then every manifest item.
 * Image items are returned as Blobs, text items (XHTML/CSS/NCX) as strings.
 */
export async function extractEpub(blob: Blob): Promise<ExtractedEpub> {
  const reader = new ZipReader(new BlobReader(blob));
  try {
    const entries = await reader.getEntries();
    if (!entries.length) throw new Error("Invalid EPUB: empty archive");

    const fileMap = new Map(entries.map((e) => [e.filename, e]));

    const { contents, opfPath, opfXml } = await locateOpf(fileMap);

    const contentsDirectory = path.dirname(opfPath);
    const result: Record<string, string | Blob> = { [opfPath]: opfXml };

    await Promise.all(
      getManifestItems(contents).map(async (item) => {
        const href = item["@_href"];
        const entry = fileMap.get(path.join(contentsDirectory, href)) || fileMap.get(href);
        if (!entry || entry.directory) return;

        const mediaType = item["@_media-type"] || "";
        result[href] = mediaType.startsWith("image/") ? await entry.getData<Blob>(new BlobWriter(mediaType)) : await entry.getData(new TextWriter());
      }),
    );

    return { contents, contentsDirectory, result };
  } finally {
    await reader.close();
  }
}
