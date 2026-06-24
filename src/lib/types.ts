/**
 * Shared data shapes that cross the main ↔ preload ↔ renderer boundary.
 *
 * These mirror the camelCase records the main process hands back (see
 * `src/main/services/library-store.js` rowToBook / rowToBookmark and the stats
 * aggregate queries). The main process is the source of truth; the renderer and
 * Zustand stores consume exactly these shapes.
 */

/** A library book as returned to the renderer (camelCase, cover inlined). */
export interface Book {
  id: string;
  title: string;
  author: string | null;
  language: string | null;
  filePath: string;
  coverPath: string | null;
  fileSize: number | null;
  addedAt: number;
  lastOpenedAt: number | null;
  progress: number;
  exploredCharCount: number;
  charCount: number;
  favorite: boolean;
  /** Inlined cover as a data: URL, attached by the main process for the grid. */
  coverDataUrl?: string | null;
}

export interface Bookmark {
  id: string;
  bookId: string;
  charOffset: number;
  progress: number;
  snippet: string | null;
  createdAt: number;
}

/** A file chosen via the native picker. */
export interface PickedFile {
  path: string;
  name: string;
  size: number;
}

// --- IPC payloads. ----------------------------------------------------------

export interface AddBookPayload {
  sourcePath: string;
  title?: string;
  author?: string;
  language?: string;
  coverBytes?: ArrayBuffer;
  coverMime?: string;
  fileSize?: number;
}

export interface UpdateBookPayload {
  id: string;
  title?: string;
  author?: string;
  coverBytes?: ArrayBuffer;
  coverMime?: string;
}

/** Partial reading-progress update; only provided fields are persisted. */
export interface ProgressUpdate {
  progress?: number;
  exploredCharCount?: number;
  charCount?: number;
  lastOpenedAt?: number;
}

export interface AddBookmarkPayload {
  bookId: string;
  charOffset: number;
  progress: number;
  snippet?: string;
}

// --- Reading stats. ---------------------------------------------------------

/** One completed reading session, recorded by the reader. */
export interface ReadingSession {
  bookId: string | null;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  charsRead: number;
}

export interface StatsOverview {
  totalChars: number;
  totalMs: number;
  sessionCount: number;
  activeDays: number;
  firstAt: number | null;
}

export interface DailyActivity {
  day: string; // 'YYYY-MM-DD', local calendar day
  chars: number;
  ms: number;
  sessions: number;
  books: number;
}

export interface HourlyActivity {
  hour: number; // 0–23, local hour-of-day
  chars: number;
  ms: number;
}

export interface PerBookStats {
  bookId: string;
  title: string | null;
  author: string | null;
  chars: number;
  ms: number;
  sessions: number;
  lastAt: number;
}

export interface Stats {
  overview: StatsOverview;
  daily: DailyActivity[];
  hourly: HourlyActivity[];
  perBook: PerBookStats[];
}
