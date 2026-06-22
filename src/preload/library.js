import { ipcRenderer, webUtils } from "electron";

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
  getPathForFile: (file) => webUtils.getPathForFile(file),

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
  saveProgress: (id, progress) => ipcRenderer.invoke("library:save-progress", id, progress),

  /** All bookmarks for a book, ordered by reading position. */
  listBookmarks: (bookId) => ipcRenderer.invoke("library:list-bookmarks", bookId),

  /**
   * Adds a bookmark at a reading position.
   * @param {{ bookId: string, charOffset: number, progress: number, snippet?: string }} payload
   */
  addBookmark: (payload) => ipcRenderer.invoke("library:add-bookmark", payload),

  /** Removes a bookmark by id. */
  removeBookmark: (id) => ipcRenderer.invoke("library:remove-bookmark", id),
};
