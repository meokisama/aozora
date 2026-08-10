import type {
  AddAnnotationPayload,
  AddBookmarkPayload,
  AddBookPayload,
  Annotation,
  AnkiAddResult,
  AnkiEndpoint,
  AnkiNote,
  AnkiScreenshotRequest,
  AnkiTestResult,
  BackupPrefs,
  BackupResult,
  Book,
  Bookmark,
  DictionaryImportProgress,
  DictionaryInfo,
  LookupResult,
  PickedFile,
  ProgressUpdate,
  ReadingSession,
  RestoreResult,
  Stats,
  UpdateAnnotationPayload,
  UpdateBookPayload,
  VoicevoxSpeakerDetail,
  VoicevoxSynthesisResult,
  VoicevoxTestResult,
  VoicevoxParams,
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
  toggleFullscreen(): void;
  isFullscreen(): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  /** Subscribe to maximize-state changes; returns an unsubscribe function. */
  onMaximizedChanged(callback: (maximized: boolean) => void): () => void;
  /** Subscribe to fullscreen-state changes; returns an unsubscribe function. */
  onFullscreenChanged(callback: (fullscreen: boolean) => void): () => void;
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
  listAnnotations(bookId: string): Promise<Annotation[]>;
  addAnnotation(payload: AddAnnotationPayload): Promise<Annotation | null>;
  updateAnnotation(payload: UpdateAnnotationPayload): Promise<Annotation | null>;
  removeAnnotation(id: string): Promise<boolean>;
}

export interface StatsApi {
  recordSession(session: ReadingSession): Promise<boolean>;
  get(): Promise<Stats>;
}

export interface DictionaryApi {
  list(): Promise<DictionaryInfo[]>;
  pickAndImport(): Promise<DictionaryInfo | null>;
  installRecommended(url: string, sourceId: string): Promise<DictionaryInfo | null>;
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
  /** Writes a backup archive to a user-picked path. */
  exportBackup(includeBooks: boolean, prefs: BackupPrefs): Promise<BackupResult>;
  /** Restores a user-picked archive; the caller writes the returned prefs back. */
  importBackup(): Promise<RestoreResult>;
  /** Restarts the app. Never resolves. */
  relaunch(): Promise<void>;
}

export interface DiscordApi {
  /** Turn Discord Rich Presence on/off. */
  setEnabled(enabled: boolean): void;
  /** Report the currently-open book so Discord shows it. */
  update(presence: {
    bookTitle: string;
    author?: string | null;
    chapterName?: string | null;
    chapterIndex?: number;
    chapterTotal?: number;
    progress?: number;
    coverBookId?: string | null;
  }): void;
  /** Clear the presence (no book open) while staying connected. */
  clear(): void;
}

export interface AnkiApi {
  test(endpoint: AnkiEndpoint): Promise<AnkiTestResult>;
  decks(endpoint: AnkiEndpoint): Promise<string[]>;
  models(endpoint: AnkiEndpoint): Promise<string[]>;
  fields(endpoint: AnkiEndpoint, model: string): Promise<string[]>;
  addNote(endpoint: AnkiEndpoint, note: AnkiNote, screenshot: AnkiScreenshotRequest | null): Promise<AnkiAddResult>;
}

export interface VoicevoxApi {
  test(server: string): Promise<VoicevoxTestResult>;
  voices(server: string): Promise<VoicevoxSpeakerDetail[]>;
  initialize(server: string, styleId: number): Promise<void>;
  synthesize(server: string, text: string, styleId: number, params: VoicevoxParams): Promise<VoicevoxSynthesisResult>;
}

export interface ElectronAPI {
  window: WindowApi;
  library: LibraryApi;
  stats: StatsApi;
  dictionary: DictionaryApi;
  system: SystemApi;
  discord: DiscordApi;
  anki: AnkiApi;
  voicevox: VoicevoxApi;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
