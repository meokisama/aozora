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

// --- Dictionary (Yomitan-format term dictionaries). -------------------------
//
// The hover dictionary stores imported Yomitan dictionaries in their own SQLite
// database (userData/dictionary.db), separate from the library. Lookups run in
// the main process: the renderer hands over the text run starting at the cursor
// and gets back the matched headwords with their glosses.

/** An imported dictionary, as listed in the management UI. */
export interface DictionaryInfo {
  id: string;
  title: string;
  revision: string | null;
  importedAt: number;
  enabled: boolean;
  priority: number; // lower = consulted first
  termCount: number;
}

/**
 * Inline-style subset a Yomitan structured-content node can carry. Mirrors
 * `StructuredContentStyle` in references/yomitan (structured-content.d.ts); the
 * popup maps these onto React `CSSProperties` when rendering a gloss.
 */
export interface GlossStyle {
  fontStyle?: string;
  fontWeight?: string;
  fontSize?: string;
  color?: string;
  background?: string;
  backgroundColor?: string;
  textDecorationLine?: string | string[];
  textDecorationStyle?: string;
  textDecorationColor?: string;
  borderColor?: string;
  borderStyle?: string;
  borderRadius?: string;
  borderWidth?: string;
  verticalAlign?: string;
  textAlign?: string;
  textEmphasis?: string;
  textShadow?: string;
  margin?: string;
  marginTop?: number | string;
  marginLeft?: number | string;
  marginRight?: number | string;
  marginBottom?: number | string;
  padding?: string;
  paddingTop?: string;
  paddingLeft?: string;
  paddingRight?: string;
  paddingBottom?: string;
  wordBreak?: string;
  whiteSpace?: string;
  listStyleType?: string;
}

/**
 * One structured-content element node (a small subset of HTML expressed as JSON).
 * Mirrors Yomitan's `structured-content.Element` plus the `{type:"text"|
 * "structured-content"|"image"}` glossary wrappers — see references/yomitan.
 */
export interface GlossElement {
  /** HTML-ish tag for a structured-content element (div, span, ul, li, ruby, …). */
  tag?: string;
  /** Wrapper discriminator on a top-level glossary item. */
  type?: "text" | "image" | "structured-content";
  /** Text payload for a `{type:"text"}` wrapper. */
  text?: string;
  content?: GlossContent;
  style?: GlossStyle;
  data?: Record<string, string>;
  lang?: string;
  href?: string;
  title?: string;
  open?: boolean;
  colSpan?: number;
  rowSpan?: number;
  /** Image path inside the archive (media extraction not yet implemented). */
  path?: string;
  alt?: string;
}

/**
 * One Yomitan glossary item, stored verbatim from the term bank: a plain string,
 * a structured-content tree, or an array of either. Kept structured (not
 * flattened to text) so the popup can render lists, tables, ruby and line breaks
 * the way Yomitan does.
 */
export type GlossContent = string | GlossElement | GlossContent[];

/** The glosses one source dictionary contributes for a matched headword. */
export interface DictionaryGloss {
  dictId: string;
  dictTitle: string;
  /** Part-of-speech / definition tags from the dictionary (e.g. "v5u, vt"). */
  tags: string | null;
  glosses: GlossContent[];
}

/** A single matched headword (expression + reading) with its glosses. */
export interface DictionaryEntry {
  expression: string;
  reading: string | null;
  /**
   * Human-readable deinflection chain that got from the surface form to this
   * dictionary form, outermost first (e.g. ["polite", "past"]). Empty when the
   * surface form already was the dictionary form.
   */
  reasons: string[];
  byDict: DictionaryGloss[];
}

/** Result of looking up the text run that starts at the cursor. */
export interface LookupResult {
  /** How many source characters the longest match consumed (for highlighting). */
  matchedLength: number;
  entries: DictionaryEntry[];
}

/** Progress event emitted by the main process while importing a dictionary. */
export interface DictionaryImportProgress {
  phase: "reading" | "inserting" | "done" | "error";
  title?: string;
  termsInserted?: number;
  message?: string;
}
