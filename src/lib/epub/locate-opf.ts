import { TextWriter, type Entry } from "@zip.js/zip.js";
import { xmlParser, type OpfContents } from "./opf";

/**
 * Resolves an EPUB's OPF package document from a map of ZIP entries: reads
 * META-INF/container.xml, follows its first rootfile to the OPF, and parses it.
 * Shared by the full extractor and the metadata-only reader.
 */
export async function locateOpf(fileMap: Map<string, Entry>): Promise<{ contents: OpfContents; opfPath: string; opfXml: string }> {
  const containerEntry = fileMap.get("META-INF/container.xml");
  if (!containerEntry || containerEntry.directory || !containerEntry.getData) throw new Error("Invalid EPUB: missing container.xml");
  const container = xmlParser.parse(await containerEntry.getData(new TextWriter()));
  const rootFiles = container.container.rootfiles.rootfile;
  const rootFile = Array.isArray(rootFiles) ? rootFiles[0] : rootFiles;
  const opfPath = rootFile["@_full-path"];

  const opfEntry = fileMap.get(opfPath);
  if (!opfEntry || opfEntry.directory || !opfEntry.getData) throw new Error(`Invalid EPUB: missing OPF at ${opfPath}`);
  const opfXml = await opfEntry.getData(new TextWriter());
  return { contents: xmlParser.parse(opfXml), opfPath, opfXml };
}
