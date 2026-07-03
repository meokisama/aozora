import type Database from "better-sqlite3";
import type { Migration } from "./runner.js";

/**
 * Cache each dictionary's entry counts on the `dictionaries` row. Before this,
 * listing dictionaries ran five correlated COUNT(*) scans per dict on every
 * load, which blocked the main process (better-sqlite3 is synchronous) long
 * enough to freeze the UI for large dictionaries. Counts are written at import
 * time going forward (dictionary-insert.ts); this backfills them once for
 * dictionaries imported before the change.
 *
 * The column adds are guarded so this is a no-op on a fresh DB (whose schema
 * already declares them) yet still upgrades an existing user's DB.
 */
export const migrate1: Migration = {
  version: 1,
  name: "dictionary-count-columns",
  up(db: Database.Database): void {
    const existing = new Set((db.prepare("PRAGMA table_info(dictionaries)").all() as { name: string }[]).map((c) => c.name));
    const addColumn = (name: string) => {
      if (!existing.has(name)) db.exec(`ALTER TABLE dictionaries ADD COLUMN ${name} INTEGER NOT NULL DEFAULT 0`);
    };
    addColumn("term_count");
    addColumn("freq_count");
    addColumn("pitch_count");
    addColumn("kanji_count");
    addColumn("kanji_freq_count");

    // One-time backfill from the per-entry tables (the very cost we're removing
    // from the per-load path). Empty on a fresh DB, so this is cheap there.
    db.exec(`
      UPDATE dictionaries SET
        term_count       = (SELECT COUNT(*) FROM terms      t  WHERE t.dict_id  = dictionaries.id),
        freq_count       = (SELECT COUNT(*) FROM term_meta  m  WHERE m.dict_id  = dictionaries.id),
        pitch_count      = (SELECT COUNT(*) FROM term_pitch p  WHERE p.dict_id  = dictionaries.id),
        kanji_count      = (SELECT COUNT(*) FROM kanji      k  WHERE k.dict_id  = dictionaries.id),
        kanji_freq_count = (SELECT COUNT(*) FROM kanji_meta km WHERE km.dict_id = dictionaries.id)
    `);
  },
};
