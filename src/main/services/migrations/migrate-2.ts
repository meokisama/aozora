import type Database from "better-sqlite3";
import type { Migration } from "./runner.js";

/**
 * Track which recommended-catalog entry a dictionary was installed from, so the
 * "Install / Installed" state on the recommended list is exact (a stored id)
 * rather than fuzzy title matching. NULL for dictionaries imported manually or
 * before this change.
 *
 * The add is guarded so this is a no-op on a fresh DB (whose schema already
 * declares the column) yet still upgrades an existing user's DB.
 */
export const migrate2: Migration = {
  version: 2,
  name: "dictionary-source-id",
  up(db: Database.Database): void {
    const existing = new Set((db.prepare("PRAGMA table_info(dictionaries)").all() as { name: string }[]).map((c) => c.name));
    if (!existing.has("source_id")) db.exec(`ALTER TABLE dictionaries ADD COLUMN source_id TEXT`);
  },
};
