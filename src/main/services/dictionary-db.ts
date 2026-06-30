import { app } from "electron";
import path from "node:path";
import Database from "better-sqlite3";
import { applyDictionarySchema } from "./dictionary-schema.js";

/**
 * SQLite schema + connection for imported Yomitan dictionaries. Kept in its own
 * file (userData/dictionary.db), separate from the library, so a corrupt or
 * oversized import can be dropped without touching reading progress.
 */

let db: Database.Database | undefined;

/** Absolute path of the dictionary database file (shared with the import worker). */
export function dictionaryDbPath(): string {
  return path.join(app.getPath("userData"), "dictionary.db");
}

export function getDb(): Database.Database {
  if (db) return db;
  db = new Database(dictionaryDbPath());
  applyDictionarySchema(db);
  return db;
}

/** Closes the DB handle so its file can be deleted (see system:clear-all-data). */
export function closeDb(): void {
  if (db) {
    db.close();
    db = undefined;
  }
}
