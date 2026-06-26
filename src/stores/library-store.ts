import { create } from "zustand";
import { extractEpubMetadata } from "@/lib/epub/metadata";
import { deleteCachedBook } from "@/lib/reader-cache";
import type { Book, PickedFile, ProgressUpdate, UpdateBookPayload } from "@/lib/types";

const api = () => window.electronAPI.library;

interface ImportProgress {
  current: number;
  total: number;
}

interface ImportSummary {
  added: number;
  failed: string[];
}

interface LibraryState {
  books: Book[];
  loading: boolean;
  importing: boolean;
  importProgress: ImportProgress | null;
  loadBooks: () => Promise<void>;
  importBooks: () => Promise<ImportSummary>;
  importDroppedFiles: (fileList: FileList) => Promise<ImportSummary>;
  toggleFavorite: (id: string) => Promise<void>;
  removeBook: (id: string) => Promise<void>;
  updateBook: (id: string, patch: Omit<UpdateBookPayload, "id">) => Promise<Book | null>;
  setFinished: (id: string, finished: boolean) => Promise<void>;
  applyProgress: (id: string, fields: ProgressUpdate) => void;
}

type LibrarySet = (partial: Partial<LibraryState>) => void;

/**
 * Extracts metadata per file and persists each via IPC, then refreshes the list.
 * Shared by the native picker and drag-and-drop paths; toggles the `importing` flag.
 */
async function importPaths(files: PickedFile[], set: LibrarySet): Promise<ImportSummary> {
  set({ importing: true, importProgress: { current: 0, total: files.length } });
  const failed: string[] = [];
  let added = 0;
  try {
    let done = 0;
    for (const file of files) {
      set({ importProgress: { current: done + 1, total: files.length } });
      try {
        const bytes = await api().readFile(file.path);
        const blob = new Blob([bytes as BlobPart]);
        const meta = await extractEpubMetadata(blob);
        await api().addBook({
          sourcePath: file.path,
          title: meta.title,
          author: meta.author,
          language: meta.language,
          coverBytes: meta.coverBytes ?? undefined,
          coverMime: meta.coverMime ?? undefined,
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
 * Mirrors the main-process library (source of truth). EPUB metadata is parsed
 * here in the renderer; the record is persisted via IPC. Cover thumbnailing is
 * done in the main process (src/main/library.js).
 */
export const useLibraryStore = create<LibraryState>((set, get) => ({
  books: [],
  loading: true,
  importing: false,
  importProgress: null,

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

  /** Opens the native picker and imports the chosen files; returns a summary for the caller. */
  importBooks: async () => {
    const files = await api().pickFiles();
    if (!files.length) return { added: 0, failed: [] };
    return importPaths(files, set);
  },

  /** Imports dropped files, keeping only .epub entries. */
  importDroppedFiles: async (fileList) => {
    const files = Array.from(fileList)
      .filter((f) => f.name.toLowerCase().endsWith(".epub"))
      .map((f) => ({ path: api().getPathForFile(f), name: f.name, size: f.size }));
    if (!files.length) return { added: 0, failed: [] };
    return importPaths(files, set);
  },

  /** Toggles a book's favorite flag optimistically; reverts on IPC failure. */
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

  /** Updates editable metadata (title/author/cover) via IPC; merges the returned record back in. */
  updateBook: async (id, patch) => {
    const updated = await api().updateBook({ id, ...patch });
    if (updated) {
      set({ books: get().books.map((b) => (b.id === id ? { ...b, ...updated } : b)) });
    }
    return updated;
  },

  /**
   * Marks a book finished/unread. Status is derived from `progress`, so this
   * just writes progress (1 = finished, 0 = unread) plus the matching char
   * offset through the normal save-progress path — no extra schema or IPC.
   */
  setFinished: async (id, finished) => {
    const book = get().books.find((b) => b.id === id);
    if (!book) return;
    const charCount = book.charCount || 0;
    const fields: ProgressUpdate = finished
      ? { progress: 1, exploredCharCount: charCount, charCount }
      : { progress: 0, exploredCharCount: 0 };
    get().applyProgress(id, fields);
    await api().saveProgress(id, fields).catch(() => {});
  },

  /**
   * Merges progress fields into the in-memory record so the library grid
   * reflects the latest position without a reload; the reader persists the
   * same fields to the main process via IPC.
   */
  applyProgress: (id, fields) => {
    set({
      books: get().books.map((b) =>
        b.id === id ? { ...b, ...fields } : b
      ),
    });
  },
}));
