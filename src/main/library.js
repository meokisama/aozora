import { ipcMain, dialog, BrowserWindow } from "electron";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { libraryStore } from "./services/library-store.js";

const MIME_TO_EXT = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

const EXT_TO_MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/**
 * Reads a cover file and returns it as a data URL so the renderer can show it
 * without a custom protocol or file:// access. Covers are small; a richer
 * thumbnail strategy can replace this later.
 */
function readCoverDataUrl(coverPath) {
  if (!coverPath) return null;
  try {
    const ext = path.extname(coverPath).slice(1).toLowerCase();
    const mime = EXT_TO_MIME[ext] || "image/jpeg";
    const base64 = fs.readFileSync(coverPath).toString("base64");
    return `data:${mime};base64,${base64}`;
  } catch {
    return null;
  }
}

/** Attaches a renderer-friendly coverDataUrl to a book record. */
function withCover(book) {
  if (!book) return null;
  return { ...book, coverDataUrl: readCoverDataUrl(book.coverPath) };
}

export const registerLibraryIpc = () => {
  // Native file picker → list of selected .epub paths.
  ipcMain.handle("library:pick-files", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: "Import EPUB",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "EPUB", extensions: ["epub"] }],
    });
    if (result.canceled) return [];
    return result.filePaths.map((p) => ({
      path: p,
      name: path.basename(p),
      size: fs.statSync(p).size,
    }));
  });

  // Raw bytes of an arbitrary file path (used by the renderer to extract
  // metadata before the book is added to the library).
  ipcMain.handle("library:read-file", (_event, filePath) => {
    return fs.readFileSync(filePath);
  });

  // Copy the original .epub into the managed library, persist metadata + cover.
  ipcMain.handle("library:add-book", (_event, payload) => {
    const { sourcePath, title, author, language, coverBytes, coverMime, fileSize } = payload;
    const id = randomUUID();
    const dir = path.join(libraryStore.getBooksDir(), id);
    fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, "book.epub");
    fs.copyFileSync(sourcePath, filePath);

    let coverPath = null;
    if (coverBytes) {
      const ext = MIME_TO_EXT[coverMime] || "jpg";
      coverPath = path.join(dir, `cover.${ext}`);
      fs.writeFileSync(coverPath, Buffer.from(coverBytes));
    }

    const book = libraryStore.insertBook({
      id,
      title: title || path.basename(sourcePath, ".epub"),
      author: author || null,
      language: language || null,
      filePath,
      coverPath,
      fileSize: fileSize ?? fs.statSync(filePath).size,
      addedAt: Date.now(),
    });
    return withCover(book);
  });

  ipcMain.handle("library:list", () => libraryStore.listBooks().map(withCover));

  ipcMain.handle("library:remove", (_event, id) => {
    const book = libraryStore.getBook(id);
    if (book) {
      const dir = path.dirname(book.filePath);
      fs.rmSync(dir, { recursive: true, force: true });
      libraryStore.removeBook(id);
    }
    return true;
  });

  // Raw bytes of an imported book (used by the reader to parse content).
  ipcMain.handle("library:read-book", (_event, id) => {
    const book = libraryStore.getBook(id);
    if (!book) throw new Error(`book ${id} not found`);
    return fs.readFileSync(book.filePath);
  });

  ipcMain.handle("library:save-progress", (_event, id, progress) =>
    withCover(libraryStore.updateProgress(id, progress))
  );
};
