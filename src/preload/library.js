import { ipcRenderer } from "electron";

/**
 * Library API exposed to the renderer as `window.electronAPI.library`.
 * The main process owns book metadata + reading progress (source of truth);
 * the renderer mirrors it via these calls.
 */
export const libraryApi = {
  /** Opens the native picker. Resolves to [{ path, name, size }]. */
  pickFiles: () => ipcRenderer.invoke("library:pick-files"),

  /** Raw bytes (Uint8Array) of a file path — for metadata extraction. */
  readFile: (filePath) => ipcRenderer.invoke("library:read-file", filePath),

  /**
   * Copies an .epub into the library and persists metadata + cover.
   * @param {{ sourcePath: string, title?: string, author?: string,
   *   language?: string, coverBytes?: ArrayBuffer, coverMime?: string,
   *   fileSize?: number }} payload
   */
  addBook: (payload) => ipcRenderer.invoke("library:add-book", payload),

  /** All books, newest first, each with a coverDataUrl. */
  list: () => ipcRenderer.invoke("library:list"),

  /** Removes a book and its files. */
  remove: (id) => ipcRenderer.invoke("library:remove", id),

  /** Raw bytes (Uint8Array) of an imported book — for the reader. */
  readBook: (id) => ipcRenderer.invoke("library:read-book", id),

  /** Persists reading progress fields for a book. */
  saveProgress: (id, progress) =>
    ipcRenderer.invoke("library:save-progress", id, progress),
};
