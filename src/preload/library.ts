import { ipcRenderer, webUtils } from "electron";
import type { AddBookPayload, UpdateBookPayload, ProgressUpdate, AddBookmarkPayload } from "@/lib/types";

/**
 * Library API exposed to the renderer as `window.electronAPI.library`.
 * The main process owns book metadata + reading progress (source of truth);
 * the renderer mirrors it via these calls.
 */
export const libraryApi = {
  /** Opens the native picker. Resolves to [{ path, name, size }]. */
  pickFiles: () => ipcRenderer.invoke("library:pick-files"),

  /**
   * Resolves the absolute path of a dropped File. Electron 32+ removed
   * `File.path`; webUtils.getPathForFile is the supported replacement and must
   * run in the preload where the real File object is available.
   */
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  /** Raw bytes (Uint8Array) of a file path — for metadata extraction. */
  readFile: (filePath: string) => ipcRenderer.invoke("library:read-file", filePath),

  /** Copies an .epub into the library and persists metadata + cover. */
  addBook: (payload: AddBookPayload) => ipcRenderer.invoke("library:add-book", payload),

  /** All books, newest first, each with a coverDataUrl. */
  list: () => ipcRenderer.invoke("library:list"),

  /** Updates a book's editable metadata. */
  updateBook: (payload: UpdateBookPayload) => ipcRenderer.invoke("library:update-book", payload),

  /** Removes a book and its files. */
  remove: (id: string) => ipcRenderer.invoke("library:remove", id),

  /** Raw bytes (Uint8Array) of an imported book — for the reader. */
  readBook: (id: string) => ipcRenderer.invoke("library:read-book", id),

  /** Persists reading progress fields for a book. */
  saveProgress: (id: string, progress: ProgressUpdate) => ipcRenderer.invoke("library:save-progress", id, progress),

  /** Marks a book as favorite (true) or not (false). Returns the updated record. */
  setFavorite: (id: string, favorite: boolean) => ipcRenderer.invoke("library:set-favorite", id, favorite),

  /** All bookmarks for a book, ordered by reading position. */
  listBookmarks: (bookId: string) => ipcRenderer.invoke("library:list-bookmarks", bookId),

  /** Adds a bookmark at a reading position. */
  addBookmark: (payload: AddBookmarkPayload) => ipcRenderer.invoke("library:add-bookmark", payload),

  /** Removes a bookmark by id. */
  removeBookmark: (id: string) => ipcRenderer.invoke("library:remove-bookmark", id),
};
