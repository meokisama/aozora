import { ipcMain, dialog, BrowserWindow, nativeImage } from "electron";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { libraryStore } from "./services/library-store.js";

// EPUB covers are full-page scans but the library grid only ever shows small
// thumbnails (cards render ~140–230 CSS px). The aliasing ("vỡ") came not from
// the covers being huge in absolute terms but from the *ratio*: handing the
// <img> a 600px bitmap to paint at ~150px is a ~4x single-pass downscale, which
// Chromium does badly. So resample once with Skia ("best") down to near the
// rendered size, leaving the browser an almost 1:1 image. Quality is high since
// a 300px JPEG is tiny anyway.
const COVER_MAX_WIDTH = 300;
const COVER_JPEG_QUALITY = 90;

/**
 * Downscales a cover image buffer to COVER_MAX_WIDTH, preserving aspect ratio.
 * Returns a JPEG Buffer, or null when the image is already small enough or can't
 * be decoded (SVG, corrupt data) — the caller then keeps the original bytes.
 */
function downscaleCover(buf) {
  try {
    const img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) return null;
    const { width, height } = img.getSize();
    if (!width || !height || width <= COVER_MAX_WIDTH) return null;
    const resized = img.resize({
      width: COVER_MAX_WIDTH,
      height: Math.round((height / width) * COVER_MAX_WIDTH),
      quality: "best",
    });
    return resized.toJPEG(COVER_JPEG_QUALITY);
  } catch {
    return null;
  }
}

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
 * without a custom protocol or file:// access. Covers are stored pre-downscaled
 * (see downscaleCover), so the data URL stays small.
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
      const original = Buffer.from(coverBytes);
      const thumb = downscaleCover(original);
      const ext = thumb ? "jpg" : MIME_TO_EXT[coverMime] || "jpg";
      coverPath = path.join(dir, `cover.${ext}`);
      fs.writeFileSync(coverPath, thumb || original);
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

  ipcMain.handle("library:save-progress", (_event, id, progress) => withCover(libraryStore.updateProgress(id, progress)));

  // --- Bookmarks. -----------------------------------------------------------
  ipcMain.handle("library:list-bookmarks", (_event, bookId) => libraryStore.listBookmarks(bookId));

  ipcMain.handle("library:add-bookmark", (_event, payload) => {
    const { bookId, charOffset, progress, snippet } = payload;
    return libraryStore.addBookmark({
      id: randomUUID(),
      bookId,
      charOffset,
      progress,
      snippet,
      createdAt: Date.now(),
    });
  });

  ipcMain.handle("library:remove-bookmark", (_event, id) => {
    libraryStore.removeBookmark(id);
    return true;
  });
};
