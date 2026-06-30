import { ipcMain, dialog, BrowserWindow, nativeImage } from "electron";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { libraryStore } from "./services/library-store.js";
import type { Book, AddBookPayload, UpdateBookPayload, ProgressUpdate, AddBookmarkPayload } from "@/lib/types";

const COVER_MAX_WIDTH = 300;
const COVER_JPEG_QUALITY = 90;

/**
 * Downscales a cover to COVER_MAX_WIDTH (aspect preserved) as a JPEG. Returns
 * null when already small enough or undecodable (SVG, corrupt) — caller keeps
 * the original bytes.
 */
function downscaleCover(buf: Buffer): Buffer | null {
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

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/**
 * Reads a cover file as a data URL so the renderer needs no custom protocol or
 * file:// access. Covers are stored pre-downscaled, so the URL stays small.
 */
function readCoverDataUrl(coverPath: string | null): string | null {
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

/** Attaches a coverDataUrl to a book record for the renderer. */
function withCover(book: Book | null): Book | null {
  if (!book) return null;
  return { ...book, coverDataUrl: readCoverDataUrl(book.coverPath) };
}

export const registerLibraryIpc = (): void => {
  ipcMain.handle("library:pick-files", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win!, {
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

  // Raw bytes of an arbitrary path; renderer reads metadata before add-book.
  ipcMain.handle("library:read-file", (_event, filePath: string) => {
    return fs.readFileSync(filePath);
  });

  // Copies the original .epub into the managed library, persists metadata + cover.
  ipcMain.handle("library:add-book", (_event, payload: AddBookPayload) => {
    const { sourcePath, title, author, language, coverBytes, coverMime, fileSize } = payload;
    const id = randomUUID();
    const dir = path.join(libraryStore.getBooksDir(), id);
    fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, "book.epub");
    fs.copyFileSync(sourcePath, filePath);

    let coverPath: string | null = null;
    if (coverBytes) {
      const original = Buffer.from(coverBytes);
      const thumb = downscaleCover(original);
      const ext = thumb ? "jpg" : MIME_TO_EXT[coverMime!] || "jpg";
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

  // A new cover is downscaled and written the same way as at import.
  ipcMain.handle("library:update-book", (_event, payload: UpdateBookPayload) => {
    const { id, title, author, coverBytes, coverMime } = payload;
    const existing = libraryStore.getBook(id);
    if (!existing) throw new Error(`book ${id} not found`);

    const fields: { title?: string; author?: string | null; coverPath?: string } = {};
    if (title !== undefined) fields.title = title?.trim() || existing.title;
    if (author !== undefined) fields.author = author?.trim() || null;

    if (coverBytes) {
      const dir = path.dirname(existing.filePath);
      const original = Buffer.from(coverBytes);
      const thumb = downscaleCover(original);
      const ext = thumb ? "jpg" : MIME_TO_EXT[coverMime!] || "jpg";
      // Drop the previous cover file first in case the extension changes.
      if (existing.coverPath && fs.existsSync(existing.coverPath)) {
        try {
          fs.rmSync(existing.coverPath);
        } catch {
          /* ignore */
        }
      }
      const coverPath = path.join(dir, `cover.${ext}`);
      fs.writeFileSync(coverPath, thumb || original);
      fields.coverPath = coverPath;
    }

    return withCover(libraryStore.updateBook(id, fields));
  });

  ipcMain.handle("library:remove", (_event, id: string) => {
    const book = libraryStore.getBook(id);
    if (book) {
      const dir = path.dirname(book.filePath);
      fs.rmSync(dir, { recursive: true, force: true });
      libraryStore.removeBook(id);
    }
    return true;
  });

  // Raw bytes of an imported book; the reader parses its content.
  ipcMain.handle("library:read-book", (_event, id: string) => {
    const book = libraryStore.getBook(id);
    if (!book) throw new Error(`book ${id} not found`);
    return fs.readFileSync(book.filePath);
  });

  ipcMain.handle("library:save-progress", (_event, id: string, progress: ProgressUpdate) => withCover(libraryStore.updateProgress(id, progress)));

  ipcMain.handle("library:set-favorite", (_event, id: string, favorite: boolean) => withCover(libraryStore.setFavorite(id, favorite)));

  // --- Bookmarks ---
  ipcMain.handle("library:list-bookmarks", (_event, bookId: string) => libraryStore.listBookmarks(bookId));

  ipcMain.handle("library:add-bookmark", (_event, payload: AddBookmarkPayload) => {
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

  ipcMain.handle("library:remove-bookmark", (_event, id: string) => {
    libraryStore.removeBookmark(id);
    return true;
  });
};
