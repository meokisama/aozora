import { BlobReader, BlobWriter, TextWriter, ZipReader, configure } from "@zip.js/zip.js";
import path from "path-browserify";
import { xmlParser, getManifestItems, type OpfContents } from "./opf";

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

    const containerEntry = fileMap.get("META-INF/container.xml");
    if (!containerEntry) throw new Error("Invalid EPUB: missing container.xml");
    const container = xmlParser.parse(await (containerEntry as any).getData(new TextWriter()));
    const rootFiles = container.container.rootfiles.rootfile;
    const rootFile = Array.isArray(rootFiles) ? rootFiles[0] : rootFiles;
    const opfPath = rootFile["@_full-path"];

    const opfEntry = fileMap.get(opfPath);
    if (!opfEntry) throw new Error(`Invalid EPUB: missing OPF at ${opfPath}`);
    const opfXml = await (opfEntry as any).getData(new TextWriter());
    const contents = xmlParser.parse(opfXml);

    const contentsDirectory = path.dirname(opfPath);
    const result: Record<string, string | Blob> = { [opfPath]: opfXml };

    await Promise.all(
      getManifestItems(contents).map(async (item) => {
        const href = item["@_href"];
        const entry = fileMap.get(path.join(contentsDirectory, href)) || fileMap.get(href);
        if (!entry || entry.directory || !(entry as any).getData) return;

        const mediaType = item["@_media-type"] || "";
        const getData = (entry as any).getData.bind(entry);
        result[href] = mediaType.startsWith("image/") ? await getData(new BlobWriter(mediaType)) : await getData(new TextWriter());
      }),
    );

    return { contents, contentsDirectory, result };
  } finally {
    await reader.close();
  }
}
