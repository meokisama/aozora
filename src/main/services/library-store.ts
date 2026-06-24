import { app } from "electron";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import type {
  Book,
  Bookmark,
  ProgressUpdate,
  StatsOverview,
  DailyActivity,
  HourlyActivity,
  PerBookStats,
} from "@/lib/types";

/**
 * SQLite-backed library store. Source of truth for book metadata and reading
 * progress. The parsed EPUB content itself is NOT stored here — that lives in
 * the renderer's IndexedDB cache and is re-derivable from the original file.
 *
 * On-disk layout (under Electron userData):
 *   userData/aozora.db                  the SQLite database
 *   userData/books/<id>/book.epub       the imported original file
 *   userData/books/<id>/cover.<ext>     extracted cover image (optional)
 */

let db: Database.Database | undefined;

function getBooksDir(): string {
  return path.join(app.getPath("userData"), "books");
}

function getDb(): Database.Database {
  if (db) return db;

  const dbPath = path.join(app.getPath("userData"), "aozora.db");
  fs.mkdirSync(getBooksDir(), { recursive: true });

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

    -- One row per reading session (a continuous stretch of active reading).
    -- This is the time-series backing the reading-stats page; the books table
    -- only keeps the latest position, not history. book_id is SET NULL (not
    -- cascade) on book removal so totals/streaks survive a deleted book.
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

/** Maps a DB row (snake_case) to the camelCase shape the renderer consumes. */
function rowToBook(row: any): Book | null {
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
function rowToBookmark(row: any): Bookmark | null {
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

  listBooks(): Book[] {
    const rows = getDb().prepare("SELECT * FROM books ORDER BY added_at DESC").all();
    return rows.map(rowToBook) as Book[];
  },

  getBook(id: string): Book | null {
    const row = getDb().prepare("SELECT * FROM books WHERE id = ?").get(id);
    return rowToBook(row);
  },

  insertBook(book: InsertBookInput): Book | null {
    getDb()
      .prepare(
        `INSERT INTO books
           (id, title, author, language, file_path, cover_path, file_size, added_at)
         VALUES
           (@id, @title, @author, @language, @filePath, @coverPath, @fileSize, @addedAt)`,
      )
      .run({
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
    getDb().prepare("DELETE FROM books WHERE id = ?").run(id);
  },

  /** Updates editable book metadata; only the provided fields are written. */
  updateBook(id: string, { title, author, coverPath }: { title?: string; author?: string | null; coverPath?: string }): Book | null {
    const sets: string[] = [];
    const params: Record<string, any> = { id };
    if (title !== undefined) {
      sets.push("title = @title");
      params.title = title;
    }
    if (author !== undefined) {
      sets.push("author = @author");
      params.author = author;
    }
    if (coverPath !== undefined) {
      sets.push("cover_path = @coverPath");
      params.coverPath = coverPath;
    }
    if (!sets.length) return this.getBook(id);
    getDb()
      .prepare(`UPDATE books SET ${sets.join(", ")} WHERE id = @id`)
      .run(params);
    return this.getBook(id);
  },

  /** Updates reading progress; only the provided fields are written. */
  updateProgress(id: string, { progress, exploredCharCount, charCount, lastOpenedAt }: ProgressUpdate): Book | null {
    const sets: string[] = [];
    const params: Record<string, any> = { id };
    if (progress !== undefined) {
      sets.push("progress = @progress");
      params.progress = progress;
    }
    if (exploredCharCount !== undefined) {
      sets.push("explored_char_count = @exploredCharCount");
      params.exploredCharCount = exploredCharCount;
    }
    if (charCount !== undefined) {
      sets.push("char_count = @charCount");
      params.charCount = charCount;
    }
    if (lastOpenedAt !== undefined) {
      sets.push("last_opened_at = @lastOpenedAt");
      params.lastOpenedAt = lastOpenedAt;
    }
    if (!sets.length) return this.getBook(id);
    getDb()
      .prepare(`UPDATE books SET ${sets.join(", ")} WHERE id = @id`)
      .run(params);
    return this.getBook(id);
  },

  /** Marks a book as favorite (true) or not (false). */
  setFavorite(id: string, favorite: boolean): Book | null {
    getDb()
      .prepare("UPDATE books SET favorite = @favorite WHERE id = @id")
      .run({ id, favorite: favorite ? 1 : 0 });
    return this.getBook(id);
  },

  // --- Bookmarks (per book, ordered by reading position). ------------------

  listBookmarks(bookId: string): Bookmark[] {
    const rows = getDb()
      .prepare("SELECT * FROM bookmarks WHERE book_id = ? ORDER BY char_offset ASC, created_at ASC")
      .all(bookId);
    return rows.map(rowToBookmark) as Bookmark[];
  },

  getBookmark(id: string): Bookmark | null {
    return rowToBookmark(getDb().prepare("SELECT * FROM bookmarks WHERE id = ?").get(id));
  },

  addBookmark({ id, bookId, charOffset, progress, snippet, createdAt }: AddBookmarkInput): Bookmark | null {
    getDb()
      .prepare(
        `INSERT INTO bookmarks (id, book_id, char_offset, progress, snippet, created_at)
         VALUES (@id, @bookId, @charOffset, @progress, @snippet, @createdAt)`,
      )
      .run({
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
    getDb().prepare("DELETE FROM bookmarks WHERE id = ?").run(id);
  },

  // --- Reading sessions (time-series for the stats page). -------------------

  /** Inserts one completed reading session. */
  recordSession({ id, bookId, startedAt, endedAt, durationMs, charsRead }: RecordSessionInput): void {
    getDb()
      .prepare(
        `INSERT INTO reading_sessions (id, book_id, started_at, ended_at, duration_ms, chars_read)
         VALUES (@id, @bookId, @startedAt, @endedAt, @durationMs, @charsRead)`,
      )
      .run({
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
    return getDb()
      .prepare(
        `SELECT
           COALESCE(SUM(chars_read), 0)  AS totalChars,
           COALESCE(SUM(duration_ms), 0) AS totalMs,
           COUNT(*)                      AS sessionCount,
           COUNT(DISTINCT date(started_at / 1000, 'unixepoch', 'localtime')) AS activeDays,
           MIN(started_at)               AS firstAt
         FROM reading_sessions`,
      )
      .get() as StatsOverview;
  },

  /**
   * Per-day activity, bucketed by LOCAL calendar day ('YYYY-MM-DD'). Feeds the
   * heatmap, streak calc and daily trend chart. Ordered oldest-first.
   */
  getDailyActivity(): DailyActivity[] {
    return getDb()
      .prepare(
        `SELECT date(started_at / 1000, 'unixepoch', 'localtime') AS day,
                SUM(chars_read)            AS chars,
                SUM(duration_ms)           AS ms,
                COUNT(*)                   AS sessions,
                COUNT(DISTINCT book_id)    AS books
           FROM reading_sessions
          GROUP BY day
          ORDER BY day ASC`,
      )
      .all() as DailyActivity[];
  },

  /** Activity grouped by local hour-of-day (0–23). Drives the rhythm chart. */
  getHourlyActivity(): HourlyActivity[] {
    return getDb()
      .prepare(
        `SELECT CAST(strftime('%H', started_at / 1000, 'unixepoch', 'localtime') AS INTEGER) AS hour,
                SUM(chars_read)  AS chars,
                SUM(duration_ms) AS ms
           FROM reading_sessions
          GROUP BY hour
          ORDER BY hour ASC`,
      )
      .all() as HourlyActivity[];
  },

  /** Per-book totals (joined to current title/author; deleted books drop out). */
  getPerBookStats(): PerBookStats[] {
    return getDb()
      .prepare(
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
      )
      .all() as PerBookStats[];
  },
};
