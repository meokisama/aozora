import { create } from "zustand";
import { extractEpubMetadata } from "@/lib/epub/metadata";
import { deleteCachedBook } from "@/lib/reader-cache";

const api = () => window.electronAPI.library;

/**
 * Mirrors the main-process library (source of truth). Parsing of EPUB metadata
 * happens here in the renderer; the resulting record is persisted via IPC.
 */
export const useLibraryStore = create((set, get) => ({
  books: [],
  loading: true,
  importing: false,

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

    set({ importing: true });
    const failed = [];
    let added = 0;
    try {
      for (const file of files) {
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
        }
      }
      const books = await api().list();
      set({ books });
    } finally {
      set({ importing: false });
    }
    return { added, failed };
  },

  /** Removes a book and its files, then refreshes the list. */
  removeBook: async (id) => {
    await api().remove(id);
    await deleteCachedBook(id).catch(() => {});
    set({ books: get().books.filter((b) => b.id !== id) });
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
