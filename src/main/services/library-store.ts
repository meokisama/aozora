import { app } from "electron";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import type { Book, Bookmark, Annotation, ProgressUpdate, StatsOverview, DailyActivity, HourlyActivity, PerBookStats } from "@/lib/types";

/**
 * SQLite-backed library store: source of truth for book metadata and reading
 * progress. Parsed EPUB content is NOT stored here — it lives in the renderer's
 * IndexedDB cache, re-derivable from the original file.
 *
 * On-disk layout (under Electron userData):
 *   userData/aozora.db                  the SQLite database
 *   userData/books/<id>/book.epub       the imported original file
 *   userData/books/<id>/cover.<ext>     extracted cover image (optional)
 */

let db: Database.Database | undefined;

// Prepared-statement cache keyed by SQL text. better-sqlite3 recompiles on every
// .prepare(), so hot handlers (save-progress fires on scroll/page-flip) would pay
// that cost repeatedly. Reset whenever the DB handle is (re)created.
let stmtCache = new Map<string, Database.Statement>();

function getBooksDir(): string {
  return path.join(app.getPath("userData"), "books");
}

function stmt(sql: string): Database.Statement {
  const cached = stmtCache.get(sql);
  if (cached) return cached;
  const prepared = getDb().prepare(sql);
  stmtCache.set(sql, prepared);
  return prepared;
}

/**
 * Runs a dynamic UPDATE writing only the defined columns (undefined ⇒ untouched).
 * Each entry is [column, value]; the column doubles as its @named parameter. A
 * no-op when nothing is provided. Callers re-read the row for the return value.
 */
function runUpdate(table: string, id: string, columns: Array<[string, string | number | null | undefined]>): void {
  const sets: string[] = [];
  const params: SqlParams = { id };
  for (const [column, value] of columns) {
    if (value === undefined) continue;
    sets.push(`${column} = @${column}`);
    params[column] = value;
  }
  if (!sets.length) return;
  stmt(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = @id`).run(params);
}

function getDb(): Database.Database {
  if (db) return db;

  const dbPath = path.join(app.getPath("userData"), "aozora.db");
  fs.mkdirSync(getBooksDir(), { recursive: true });

  stmtCache = new Map(); // statements are bound to a handle; drop stale ones
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON"); // so bookmarks cascade-delete with their book
  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id                  TEXT PRIMARY KEY,
      title               TEXT NOT NULL,
      author              TEXT,
      language            TEXT,
      file_path           TEXT NOT NULL,
      cover_path          TEXT,
      file_size           INTEGER,
      added_at            INTEGER NOT NULL,
      last_opened_at      INTEGER,
      progress            REAL    NOT NULL DEFAULT 0,
      explored_char_count INTEGER NOT NULL DEFAULT 0,
      char_count          INTEGER NOT NULL DEFAULT 0,
      favorite            INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      id          TEXT PRIMARY KEY,
      book_id     TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      char_offset INTEGER NOT NULL,
      progress    REAL    NOT NULL DEFAULT 0,
      snippet     TEXT,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks(book_id);

    -- Highlighted / annotated spans, anchored by character offset (like
    -- bookmarks) so they survive re-flow. Cascade-deleted with their book.
    CREATE TABLE IF NOT EXISTS annotations (
      id          TEXT PRIMARY KEY,
      book_id     TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      start_char  INTEGER NOT NULL,
      end_char    INTEGER NOT NULL,
      color       TEXT    NOT NULL DEFAULT 'yellow',
      note        TEXT,
      snippet     TEXT,
      progress    REAL    NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_annotations_book ON annotations(book_id);

    -- One row per reading session; the time-series behind the stats page (books
    -- keeps only the latest position). book_id is SET NULL (not cascade) on book
    -- removal so totals/streaks survive a deleted book.
    CREATE TABLE IF NOT EXISTS reading_sessions (
      id          TEXT PRIMARY KEY,
      book_id     TEXT REFERENCES books(id) ON DELETE SET NULL,
      started_at  INTEGER NOT NULL,  -- epoch ms
      ended_at    INTEGER NOT NULL,  -- epoch ms
      duration_ms INTEGER NOT NULL DEFAULT 0,  -- active time, idle gaps excluded
      chars_read  INTEGER NOT NULL DEFAULT 0   -- 0 for fixed-layout (manga) sessions
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_started ON reading_sessions(started_at);
  `);

  return db;
}

/** Raw DB rows (snake_case columns) as returned by better-sqlite3. */
interface BookRow {
  id: string;
  title: string;
  author: string | null;
  language: string | null;
  file_path: string;
  cover_path: string | null;
  file_size: number | null;
  added_at: number;
  last_opened_at: number | null;
  progress: number;
  explored_char_count: number;
  char_count: number;
  favorite: number;
}

interface BookmarkRow {
  id: string;
  book_id: string;
  char_offset: number;
  progress: number;
  snippet: string | null;
  created_at: number;
}

interface AnnotationRow {
  id: string;
  book_id: string;
  start_char: number;
  end_char: number;
  color: string;
  note: string | null;
  snippet: string | null;
  progress: number;
  created_at: number;
}

/** Named-parameter bag for prepared statements. */
type SqlParams = Record<string, string | number | null>;

/** Maps a DB row (snake_case) to the camelCase shape the renderer consumes. */
function rowToBook(row: BookRow | undefined): Book | null {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    author: row.author ?? null,
    language: row.language ?? null,
    filePath: row.file_path,
    coverPath: row.cover_path ?? null,
    fileSize: row.file_size ?? null,
    addedAt: row.added_at,
    lastOpenedAt: row.last_opened_at ?? null,
    progress: row.progress,
    exploredCharCount: row.explored_char_count,
    charCount: row.char_count,
    favorite: row.favorite === 1,
  };
}

/** Maps a bookmark DB row to the camelCase shape the renderer consumes. */
function rowToBookmark(row: BookmarkRow | undefined): Bookmark | null {
  if (!row) return null;
  return {
    id: row.id,
    bookId: row.book_id,
    charOffset: row.char_offset,
    progress: row.progress,
    snippet: row.snippet ?? null,
    createdAt: row.created_at,
  };
}

/** Maps an annotation DB row to the camelCase shape the renderer consumes. */
function rowToAnnotation(row: AnnotationRow | undefined): Annotation | null {
  if (!row) return null;
  return {
    id: row.id,
    bookId: row.book_id,
    startChar: row.start_char,
    endChar: row.end_char,
    color: row.color,
    note: row.note ?? null,
    snippet: row.snippet ?? null,
    progress: row.progress,
    createdAt: row.created_at,
  };
}

interface InsertBookInput {
  id: string;
  title: string;
  author?: string | null;
  language?: string | null;
  filePath: string;
  coverPath?: string | null;
  fileSize?: number | null;
  addedAt: number;
}

interface AddBookmarkInput {
  id: string;
  bookId: string;
  charOffset?: number;
  progress?: number;
  snippet?: string | null;
  createdAt: number;
}

interface AddAnnotationInput {
  id: string;
  bookId: string;
  startChar: number;
  endChar: number;
  color: string;
  note?: string | null;
  snippet?: string | null;
  progress?: number;
  createdAt: number;
}

interface RecordSessionInput {
  id: string;
  bookId: string | null;
  startedAt: number;
  endedAt: number;
  durationMs?: number;
  charsRead?: number;
}

export const libraryStore = {
  getBooksDir,

  /** Closes the DB handle so its file can be deleted (see system:clear-all-data). */
  close(): void {
    if (db) {
      db.close();
      db = undefined;
      stmtCache = new Map(); // cached statements belong to the closed handle
    }
  },

  listBooks(): Book[] {
    const rows = stmt("SELECT * FROM books ORDER BY added_at DESC").all() as BookRow[];
    return rows.map(rowToBook) as Book[];
  },

  getBook(id: string): Book | null {
    const row = stmt("SELECT * FROM books WHERE id = ?").get(id) as BookRow | undefined;
    return rowToBook(row);
  },

  insertBook(book: InsertBookInput): Book | null {
    stmt(
      `INSERT INTO books
           (id, title, author, language, file_path, cover_path, file_size, added_at)
         VALUES
           (@id, @title, @author, @language, @filePath, @coverPath, @fileSize, @addedAt)`,
    ).run({
      id: book.id,
      title: book.title,
      author: book.author ?? null,
      language: book.language ?? null,
      filePath: book.filePath,
      coverPath: book.coverPath ?? null,
      fileSize: book.fileSize ?? null,
      addedAt: book.addedAt,
    });
    return this.getBook(book.id);
  },

  removeBook(id: string): void {
    stmt("DELETE FROM books WHERE id = ?").run(id);
  },

  /** Updates editable book metadata; only the provided fields are written. */
  updateBook(id: string, { title, author, coverPath }: { title?: string; author?: string | null; coverPath?: string }): Book | null {
    runUpdate("books", id, [
      ["title", title],
      ["author", author],
      ["cover_path", coverPath],
    ]);
    return this.getBook(id);
  },

  /** Updates reading progress; only the provided fields are written. */
  updateProgress(id: string, { progress, exploredCharCount, charCount, lastOpenedAt }: ProgressUpdate): Book | null {
    runUpdate("books", id, [
      ["progress", progress],
      ["explored_char_count", exploredCharCount],
      ["char_count", charCount],
      ["last_opened_at", lastOpenedAt],
    ]);
    return this.getBook(id);
  },

  /** Marks a book as favorite (true) or not (false). */
  setFavorite(id: string, favorite: boolean): Book | null {
    stmt("UPDATE books SET favorite = @favorite WHERE id = @id").run({ id, favorite: favorite ? 1 : 0 });
    return this.getBook(id);
  },

  // --- Bookmarks (per book, ordered by reading position). ------------------

  listBookmarks(bookId: string): Bookmark[] {
    const rows = stmt("SELECT * FROM bookmarks WHERE book_id = ? ORDER BY char_offset ASC, created_at ASC").all(bookId) as BookmarkRow[];
    return rows.map(rowToBookmark) as Bookmark[];
  },

  getBookmark(id: string): Bookmark | null {
    return rowToBookmark(stmt("SELECT * FROM bookmarks WHERE id = ?").get(id) as BookmarkRow | undefined);
  },

  addBookmark({ id, bookId, charOffset, progress, snippet, createdAt }: AddBookmarkInput): Bookmark | null {
    stmt(
      `INSERT INTO bookmarks (id, book_id, char_offset, progress, snippet, created_at)
         VALUES (@id, @bookId, @charOffset, @progress, @snippet, @createdAt)`,
    ).run({
      id,
      bookId,
      charOffset: charOffset ?? 0,
      progress: progress ?? 0,
      snippet: snippet ?? null,
      createdAt,
    });
    return this.getBookmark(id);
  },

  removeBookmark(id: string): void {
    stmt("DELETE FROM bookmarks WHERE id = ?").run(id);
  },

  // --- Annotations (highlights + notes, per book, in reading order). --------

  listAnnotations(bookId: string): Annotation[] {
    const rows = stmt("SELECT * FROM annotations WHERE book_id = ? ORDER BY start_char ASC, created_at ASC").all(bookId) as AnnotationRow[];
    return rows.map(rowToAnnotation) as Annotation[];
  },

  getAnnotation(id: string): Annotation | null {
    return rowToAnnotation(stmt("SELECT * FROM annotations WHERE id = ?").get(id) as AnnotationRow | undefined);
  },

  addAnnotation({ id, bookId, startChar, endChar, color, note, snippet, progress, createdAt }: AddAnnotationInput): Annotation | null {
    stmt(
      `INSERT INTO annotations (id, book_id, start_char, end_char, color, note, snippet, progress, created_at)
         VALUES (@id, @bookId, @startChar, @endChar, @color, @note, @snippet, @progress, @createdAt)`,
    ).run({
      id,
      bookId,
      startChar,
      endChar,
      color,
      note: note ?? null,
      snippet: snippet ?? null,
      progress: progress ?? 0,
      createdAt,
    });
    return this.getAnnotation(id);
  },

  /** Updates an annotation's colour and/or note; only provided fields are written. */
  updateAnnotation(id: string, { color, note }: { color?: string; note?: string | null }): Annotation | null {
    runUpdate("annotations", id, [
      ["color", color],
      ["note", note],
    ]);
    return this.getAnnotation(id);
  },

  removeAnnotation(id: string): void {
    stmt("DELETE FROM annotations WHERE id = ?").run(id);
  },

  // --- Reading sessions (time-series for the stats page). -------------------

  /** Inserts one completed reading session. */
  recordSession({ id, bookId, startedAt, endedAt, durationMs, charsRead }: RecordSessionInput): void {
    stmt(
      `INSERT INTO reading_sessions (id, book_id, started_at, ended_at, duration_ms, chars_read)
         VALUES (@id, @bookId, @startedAt, @endedAt, @durationMs, @charsRead)`,
    ).run({
      id,
      bookId: bookId ?? null,
      startedAt,
      endedAt,
      durationMs: Math.max(0, Math.round(durationMs ?? 0)),
      charsRead: Math.max(0, Math.round(charsRead ?? 0)),
    });
  },

  /** All-time totals across every session (single row). */
  getStatsOverview(): StatsOverview {
    return stmt(
      `SELECT
           COALESCE(SUM(chars_read), 0)  AS totalChars,
           COALESCE(SUM(duration_ms), 0) AS totalMs,
           COUNT(*)                      AS sessionCount,
           COUNT(DISTINCT date(started_at / 1000, 'unixepoch', 'localtime')) AS activeDays,
           MIN(started_at)               AS firstAt
         FROM reading_sessions`,
    ).get() as StatsOverview;
  },

  /**
   * Per-day activity, bucketed by LOCAL calendar day ('YYYY-MM-DD'). Feeds the
   * heatmap, streak calc and daily trend chart. Ordered oldest-first.
   */
  getDailyActivity(): DailyActivity[] {
    return stmt(
      `SELECT date(started_at / 1000, 'unixepoch', 'localtime') AS day,
                SUM(chars_read)            AS chars,
                SUM(duration_ms)           AS ms,
                COUNT(*)                   AS sessions,
                COUNT(DISTINCT book_id)    AS books
           FROM reading_sessions
          GROUP BY day
          ORDER BY day ASC`,
    ).all() as DailyActivity[];
  },

  /** Activity grouped by local hour-of-day (0–23). Drives the rhythm chart. */
  getHourlyActivity(): HourlyActivity[] {
    return stmt(
      `SELECT CAST(strftime('%H', started_at / 1000, 'unixepoch', 'localtime') AS INTEGER) AS hour,
                SUM(chars_read)  AS chars,
                SUM(duration_ms) AS ms
           FROM reading_sessions
          GROUP BY hour
          ORDER BY hour ASC`,
    ).all() as HourlyActivity[];
  },

  /** Per-book totals (joined to current title/author; deleted books drop out). */
  getPerBookStats(): PerBookStats[] {
    return stmt(
      `SELECT s.book_id            AS bookId,
                b.title              AS title,
                b.author             AS author,
                SUM(s.chars_read)    AS chars,
                SUM(s.duration_ms)   AS ms,
                COUNT(*)             AS sessions,
                MAX(s.ended_at)      AS lastAt
           FROM reading_sessions s
           LEFT JOIN books b ON b.id = s.book_id
          WHERE s.book_id IS NOT NULL
          GROUP BY s.book_id
          ORDER BY ms DESC`,
    ).all() as PerBookStats[];
  },
};
