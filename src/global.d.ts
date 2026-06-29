import type {
  AddBookmarkPayload,
  AddBookPayload,
  Book,
  Bookmark,
  DictionaryImportProgress,
  DictionaryInfo,
  LookupResult,
  PickedFile,
  ProgressUpdate,
  ReadingSession,
  Stats,
  UpdateBookPayload,
} from "@/lib/types";

/**
 * The `window.electronAPI` surface exposed by the preload layer and the
 * renderer's only contract with the main process. Keep in lockstep with
 * `src/preload/*`.
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

export interface DictionaryApi {
  list(): Promise<DictionaryInfo[]>;
  pickAndImport(): Promise<DictionaryInfo | null>;
  remove(id: string): Promise<boolean>;
  setEnabled(id: string, enabled: boolean): Promise<DictionaryInfo | null>;
  setPriority(id: string, priority: number): Promise<DictionaryInfo | null>;
  lookup(text: string): Promise<LookupResult>;
  getMedia(dictId: string, path: string): Promise<string | null>;
  getStyles(): Promise<{ dictId: string; css: string }[]>;
  onImportProgress(callback: (progress: DictionaryImportProgress) => void): () => void;
}

export interface SystemApi {
  /** Wipes all persisted data and relaunches the app. Never resolves. */
  clearAllData(): Promise<void>;
}

export interface ElectronAPI {
  window: WindowApi;
  library: LibraryApi;
  stats: StatsApi;
  dictionary: DictionaryApi;
  system: SystemApi;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
