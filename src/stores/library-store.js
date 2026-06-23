import { create } from "zustand";
import { extractEpubMetadata } from "@/lib/epub/metadata";
import { deleteCachedBook } from "@/lib/reader-cache";

const api = () => window.electronAPI.library;

/**
 * Imports a list of { path, name, size } files: extracts metadata per file and
 * persists each via IPC. Shared by the native picker and drag-and-drop paths.
 * Toggles the `importing` flag and refreshes the book list when done.
 */
async function importPaths(files, set) {
  set({ importing: true, importProgress: { current: 0, total: files.length } });
  const failed = [];
  let added = 0;
  try {
    let done = 0;
    for (const file of files) {
      set({ importProgress: { current: done + 1, total: files.length } });
      try {
        const bytes = await api().readFile(file.path);
        const blob = new Blob([bytes]);
        const meta = await extractEpubMetadata(blob);
        await api().addBook({
          sourcePath: file.path,
          title: meta.title,
          author: meta.author,
          language: meta.language,
          coverBytes: meta.coverBytes,
          coverMime: meta.coverMime,
          fileSize: file.size,
        });
        added += 1;
      } catch (err) {
        console.error(`Failed to import ${file.name}`, err);
        failed.push(file.name);
      } finally {
        done += 1;
      }
    }
    const books = await api().list();
    set({ books });
  } finally {
    set({ importing: false, importProgress: null });
  }
  return { added, failed };
}

/**
 * Mirrors the main-process library (source of truth). Parsing of EPUB metadata
 * happens here in the renderer; the resulting record is persisted via IPC.
 * Cover thumbnailing (and the one-off shrink of older oversized covers) is done
 * in the main process; see src/main/library.js.
 */
export const useLibraryStore = create((set, get) => ({
  books: [],
  loading: true,
  importing: false,
  importProgress: null, // { current, total } while importing, else null

  /** Loads the full library from the main process. */
  loadBooks: async () => {
    set({ loading: true });
    try {
      const books = await api().list();
      set({ books, loading: false });
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  /**
   * Opens the native picker, extracts metadata for each chosen file, and
   * persists it. Returns a summary for the caller to surface to the user.
   */
  importBooks: async () => {
    const files = await api().pickFiles();
    if (!files.length) return { added: 0, failed: [] };
    return importPaths(files, set);
  },

  /**
   * Imports books dropped onto the library. Takes a drop event's FileList,
   * keeps only .epub files, and resolves each to a { path, name, size } record
   * before importing. Returns the same summary shape as importBooks.
   */
  importDroppedFiles: async (fileList) => {
    const files = Array.from(fileList)
      .filter((f) => f.name.toLowerCase().endsWith(".epub"))
      .map((f) => ({ path: api().getPathForFile(f), name: f.name, size: f.size }));
    if (!files.length) return { added: 0, failed: [] };
    return importPaths(files, set);
  },

  /**
   * Toggles a book's favorite flag. Updates the in-memory list optimistically
   * and persists through IPC; reverts on failure.
   */
  toggleFavorite: async (id) => {
    const book = get().books.find((b) => b.id === id);
    if (!book) return;
    const next = !book.favorite;
    set({ books: get().books.map((b) => (b.id === id ? { ...b, favorite: next } : b)) });
    try {
      await api().setFavorite(id, next);
    } catch (err) {
      set({ books: get().books.map((b) => (b.id === id ? { ...b, favorite: !next } : b)) });
      throw err;
    }
  },

  /** Removes a book and its files, then refreshes the list. */
  removeBook: async (id) => {
    await api().remove(id);
    await deleteCachedBook(id).catch(() => {});
    set({ books: get().books.filter((b) => b.id !== id) });
  },

  /**
   * Updates a book's editable metadata (title/author/cover) via IPC and merges
   * the returned record (with a fresh coverDataUrl) into the in-memory list.
   * @param {string} id
   * @param {{ title?: string, author?: string, coverBytes?: ArrayBuffer, coverMime?: string }} patch
   */
  updateBook: async (id, patch) => {
    const updated = await api().updateBook({ id, ...patch });
    if (updated) {
      set({ books: get().books.map((b) => (b.id === id ? { ...b, ...updated } : b)) });
    }
    return updated;
  },

  /**
   * Manually marks a book finished or unread. Reading status is derived from
   * `progress`, so this just writes progress (and the matching char offset)
   * through the existing save-progress path — no extra schema or IPC. Marking
   * finished sets progress to 1; unread resets it to 0.
   */
  setFinished: async (id, finished) => {
    const book = get().books.find((b) => b.id === id);
    if (!book) return;
    const charCount = book.charCount || 0;
    const fields = finished
      ? { progress: 1, exploredCharCount: charCount, charCount }
      : { progress: 0, exploredCharCount: 0 };
    get().applyProgress(id, fields);
    await api().saveProgress(id, fields).catch(() => {});
  },

  /**
   * Merges reading-progress fields into the in-memory record so the library
   * grid (progress bar) reflects the latest position without a full reload.
   * The reader persists the same fields to the main process via IPC.
   */
  applyProgress: (id, fields) => {
    set({
      books: get().books.map((b) =>
        b.id === id ? { ...b, ...fields } : b
      ),
    });
  },
}));
