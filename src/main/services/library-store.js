import { app } from "electron";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

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

let db;

function getBooksDir() {
  return path.join(app.getPath("userData"), "books");
}

function getDb() {
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
  `);

  return db;
}

/** Maps a DB row (snake_case) to the camelCase shape the renderer consumes. */
function rowToBook(row) {
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
function rowToBookmark(row) {
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

export const libraryStore = {
  getBooksDir,

  listBooks() {
    const rows = getDb().prepare("SELECT * FROM books ORDER BY added_at DESC").all();
    return rows.map(rowToBook);
  },

  getBook(id) {
    const row = getDb().prepare("SELECT * FROM books WHERE id = ?").get(id);
    return rowToBook(row);
  },

  insertBook(book) {
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

  removeBook(id) {
    getDb().prepare("DELETE FROM books WHERE id = ?").run(id);
  },

  /** Updates editable book metadata; only the provided fields are written. */
  updateBook(id, { title, author, coverPath }) {
    const sets = [];
    const params = { id };
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
  updateProgress(id, { progress, exploredCharCount, charCount, lastOpenedAt }) {
    const sets = [];
    const params = { id };
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
  setFavorite(id, favorite) {
    getDb()
      .prepare("UPDATE books SET favorite = @favorite WHERE id = @id")
      .run({ id, favorite: favorite ? 1 : 0 });
    return this.getBook(id);
  },

  // --- Bookmarks (per book, ordered by reading position). ------------------

  listBookmarks(bookId) {
    const rows = getDb()
      .prepare("SELECT * FROM bookmarks WHERE book_id = ? ORDER BY char_offset ASC, created_at ASC")
      .all(bookId);
    return rows.map(rowToBookmark);
  },

  getBookmark(id) {
    return rowToBookmark(getDb().prepare("SELECT * FROM bookmarks WHERE id = ?").get(id));
  },

  addBookmark({ id, bookId, charOffset, progress, snippet, createdAt }) {
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

  removeBookmark(id) {
    getDb().prepare("DELETE FROM bookmarks WHERE id = ?").run(id);
  },
};
