import type {
  AddBookmarkPayload,
  AddBookPayload,
  Book,
  Bookmark,
  PickedFile,
  ProgressUpdate,
  ReadingSession,
  Stats,
  UpdateBookPayload,
} from "@/lib/types";

/**
 * The curated API the preload layer exposes on `window.electronAPI`
 * (see `src/preload.js` and `src/preload/*.js`). Keep this in lockstep with
 * those modules — it is the renderer's only contract with the main process.
 */
export interface WindowApi {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  isMaximized(): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  /** Subscribe to maximize-state changes; returns an unsubscribe function. */
  onMaximizedChanged(callback: (maximized: boolean) => void): () => void;
}

export interface LibraryApi {
  pickFiles(): Promise<PickedFile[]>;
  getPathForFile(file: File): string;
  readFile(filePath: string): Promise<Uint8Array>;
  addBook(payload: AddBookPayload): Promise<Book | null>;
  list(): Promise<Book[]>;
  updateBook(payload: UpdateBookPayload): Promise<Book | null>;
  remove(id: string): Promise<boolean>;
  readBook(id: string): Promise<Uint8Array>;
  saveProgress(id: string, progress: ProgressUpdate): Promise<Book | null>;
  setFavorite(id: string, favorite: boolean): Promise<Book | null>;
  listBookmarks(bookId: string): Promise<Bookmark[]>;
  addBookmark(payload: AddBookmarkPayload): Promise<Bookmark | null>;
  removeBookmark(id: string): Promise<boolean>;
}

export interface StatsApi {
  recordSession(session: ReadingSession): Promise<boolean>;
  get(): Promise<Stats>;
}

export interface ElectronAPI {
  window: WindowApi;
  library: LibraryApi;
  stats: StatsApi;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
