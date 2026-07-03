import type Database from "better-sqlite3";

/**
 * Minimal SQLite migration runner keyed on `PRAGMA user_version`. Each database
 * carries its schema version in user_version; a migration whose `version` is
 * greater than the current value runs in a transaction, then bumps user_version
 * to that number. Migrations run in ascending order and each `up` must be safe
 * to apply on top of any earlier version (guard column adds, etc.).
 *
 * Now that Aozora ships to users we can no longer wipe userData on a schema
 * change — migrations upgrade an existing on-disk DB in place instead. Baseline
 * tables are still created by each DB's own `CREATE TABLE IF NOT EXISTS` schema;
 * migrations only carry it forward from there.
 */
export interface Migration {
  /** Target user_version once this migration has applied (ascending, gap-free from 1). */
  version: number;
  /** Human label, for logs. */
  name: string;
  /** Applies the change. Runs inside a transaction; throwing rolls it back. */
  up(db: Database.Database): void;
}

/** Applies every migration whose version exceeds the DB's current user_version. */
export function runMigrations(db: Database.Database, migrations: Migration[]): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (const m of migrations) {
    if (m.version <= current) continue;
    const apply = db.transaction(() => {
      m.up(db);
      db.pragma(`user_version = ${m.version}`); // integer we own; safe to interpolate
    });
    apply();
  }
}
