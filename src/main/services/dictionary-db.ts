import { app } from "electron";
import path from "node:path";
import Database from "better-sqlite3";

/**
 * SQLite database for imported Yomitan dictionaries (schema + connection).
 *
 * This lives in its own database (userData/dictionary.db), separate from the
 * library: dictionaries are bulky, user-replaceable reference data, not user
 * content. Keeping them apart means a corrupt/oversized dictionary import can be
 * dropped (or the whole file deleted) without touching reading progress.
 *
 * On-disk layout (under Electron userData):
 *   userData/dictionary.db   the dictionary database
 */

let db: Database.Database | undefined;

export function getDb(): Database.Database {
  if (db) return db;
  const dbPath = path.join(app.getPath("userData"), "dictionary.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS dictionaries (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      revision    TEXT,
      imported_at INTEGER NOT NULL,
      enabled     INTEGER NOT NULL DEFAULT 1,
      priority    INTEGER NOT NULL DEFAULT 0   -- lower = consulted first
    );

    CREATE TABLE IF NOT EXISTS terms (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      dict_id     TEXT NOT NULL REFERENCES dictionaries(id) ON DELETE CASCADE,
      expression  TEXT NOT NULL,
      reading     TEXT,
      tags        TEXT,
      rules       TEXT,           -- space-separated POS rules (v1/v5/adj-i…) for deinflection filtering
      definitions TEXT NOT NULL,  -- JSON array of gloss strings
      score       INTEGER NOT NULL DEFAULT 0,
      sequence    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_terms_expression ON terms(expression);
    CREATE INDEX IF NOT EXISTS idx_terms_reading    ON terms(reading);
    CREATE INDEX IF NOT EXISTS idx_terms_dict       ON terms(dict_id);

    -- Frequency ratings from term-meta banks (Yomitan "freq" mode). Pitch/IPA
    -- modes are skipped for now. The value column is the number to display;
    -- sort_value is normalised so ascending always means "more common"
    -- (occurrence-based dictionaries are negated at import), keeping the lookup
    -- sort mode-agnostic.
    CREATE TABLE IF NOT EXISTS term_meta (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      dict_id    TEXT NOT NULL REFERENCES dictionaries(id) ON DELETE CASCADE,
      expression TEXT NOT NULL,
      reading    TEXT,            -- reading-specific frequency, else NULL (applies to all readings)
      value      REAL NOT NULL DEFAULT 0,  -- the number to display
      display    TEXT,            -- pre-formatted display string, else NULL
      sort_value REAL NOT NULL DEFAULT 0   -- normalised: lower = more common
    );
    CREATE INDEX IF NOT EXISTS idx_term_meta_expr ON term_meta(expression);
    CREATE INDEX IF NOT EXISTS idx_term_meta_dict ON term_meta(dict_id);

    -- Pitch-accent patterns from term-meta banks (Yomitan "pitch" mode). One row
    -- per expression+reading; pitches holds the JSON array of accent patterns
    -- (downstep position + optional nasal/devoice mora positions).
    CREATE TABLE IF NOT EXISTS term_pitch (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      dict_id    TEXT NOT NULL REFERENCES dictionaries(id) ON DELETE CASCADE,
      expression TEXT NOT NULL,
      reading    TEXT NOT NULL,
      pitches    TEXT NOT NULL  -- JSON: [{position, nasal[], devoice[]}, …]
    );
    CREATE INDEX IF NOT EXISTS idx_term_pitch_expr ON term_pitch(expression);
    CREATE INDEX IF NOT EXISTS idx_term_pitch_dict ON term_pitch(dict_id);

    -- Kanji entries (Yomitan kanji_bank). onyomi/kunyomi/tags are space-separated
    -- strings; meanings is a JSON array; stats is a JSON object (strokes, grade,
    -- jlpt, freq, plus dictionary index codes). kanji_meta banks are not parsed
    -- yet — frequency is read from stats.freq when present.
    CREATE TABLE IF NOT EXISTS kanji (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      dict_id   TEXT NOT NULL REFERENCES dictionaries(id) ON DELETE CASCADE,
      character TEXT NOT NULL,
      onyomi    TEXT,
      kunyomi   TEXT,
      tags      TEXT,
      meanings  TEXT NOT NULL,  -- JSON array of strings
      stats     TEXT NOT NULL   -- JSON object
    );
    CREATE INDEX IF NOT EXISTS idx_kanji_char ON kanji(character);
    CREATE INDEX IF NOT EXISTS idx_kanji_dict ON kanji(dict_id);

    -- Kanji frequency ratings (kanji_meta_bank, "freq" mode). Same value/sort_value
    -- convention as term_meta (occurrence-based dicts negated at import).
    CREATE TABLE IF NOT EXISTS kanji_meta (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      dict_id    TEXT NOT NULL REFERENCES dictionaries(id) ON DELETE CASCADE,
      character  TEXT NOT NULL,
      value      REAL NOT NULL DEFAULT 0,
      display    TEXT,
      sort_value REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_kanji_meta_char ON kanji_meta(character);
    CREATE INDEX IF NOT EXISTS idx_kanji_meta_dict ON kanji_meta(dict_id);

    -- Tag definitions (Yomitan tag_bank): maps a tag token (e.g. "v5u", "jouyou")
    -- to a human note + category, used to render term/kanji tags with a tooltip
    -- and a category colour instead of the raw token.
    CREATE TABLE IF NOT EXISTS tags (
      dict_id    TEXT NOT NULL REFERENCES dictionaries(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      category   TEXT,
      notes      TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (dict_id, name)
    );

    -- Image media referenced by structured-content glossaries (img.path), stored
    -- as blobs and served to the popup as data URLs (see getMedia).
    CREATE TABLE IF NOT EXISTS media (
      dict_id TEXT NOT NULL REFERENCES dictionaries(id) ON DELETE CASCADE,
      path    TEXT NOT NULL,
      mime    TEXT NOT NULL,
      data    BLOB NOT NULL,
      PRIMARY KEY (dict_id, path)
    );
  `);
  return db;
}
