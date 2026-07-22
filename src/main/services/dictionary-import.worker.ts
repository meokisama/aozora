import fs from "node:fs";
import Database from "better-sqlite3";
import type { DictionaryImportProgress } from "@/lib/types";
import { parseYomitanZip } from "./dictionary-parse.js";
import { applyDictionarySchema } from "./dictionary-schema.js";
import { runMigrations, dictionaryMigrations } from "./migrations/index.js";
import { insertParsedDict } from "./dictionary-insert.js";

/**
 * Dictionary write utility process: runs the heavy, blocking dictionary writes
 * (import and remove) off the main process, so they never freeze the UI. Forked
 * by dictionary-store.ts with [dbPath, command, arg] in argv — command is
 * "import" (arg = ZIP path) or "remove" (arg = dictionary id). Opens its own
 * connection to the same WAL file (concurrent reads from the main connection
 * stay live). Streams progress and the result back over `process.parentPort`.
 */

type WorkerMessage =
  | { type: "progress"; payload: DictionaryImportProgress }
  | { type: "done"; id: string; title: string; termsInserted: number }
  | { type: "removed" }
  | { type: "error"; message: string };

const parentPort = process.parentPort;

function post(msg: WorkerMessage): void {
  parentPort.postMessage(msg);
}

/** Opens the DB and ensures its schema/version is current before a write. */
function openDb(dbPath: string): Database.Database {
  const database = new Database(dbPath);
  applyDictionarySchema(database);
  runMigrations(database, dictionaryMigrations); // no-op once the main process has migrated; guards a cold start
  return database;
}

async function runImport(dbPath: string, filePath: string): Promise<void> {
  let database: Database.Database | undefined;
  try {
    post({ type: "progress", payload: { phase: "reading" } });
    const bytes = new Uint8Array(fs.readFileSync(filePath));
    const parsed = await parseYomitanZip(bytes);

    post({ type: "progress", payload: { phase: "inserting", title: parsed.title, termsInserted: 0 } });
    database = openDb(dbPath);
    const { id } = insertParsedDict(database, parsed, (p) => post({ type: "progress", payload: p }));
    database.close();
    database = undefined;

    post({ type: "done", id, title: parsed.title, termsInserted: parsed.rows.length });
  } catch (err) {
    try {
      database?.close();
    } catch {
      /* ignore close failure on the error path */
    }
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
}

// Removing a dictionary cascades a DELETE across every entry table (millions of
// indexed rows for a big dict) — done here so the synchronous delete never
// blocks the main-process event loop.
function runRemove(dbPath: string, dictId: string): void {
  let database: Database.Database | undefined;
  try {
    database = openDb(dbPath);
    database.prepare("DELETE FROM dictionaries WHERE id = ?").run(dictId); // FK ON ⇒ child rows cascade
    database.close();
    database = undefined;
    post({ type: "removed" });
  } catch (err) {
    try {
      database?.close();
    } catch {
      /* ignore close failure on the error path */
    }
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
}

async function run(): Promise<void> {
  const dbPath = process.argv[2];
  const command = process.argv[3];
  const arg = process.argv[4];
  if (command === "remove") runRemove(dbPath, arg);
  else await runImport(dbPath, arg);
  // The process stays alive (parentPort keeps the loop open) until the parent
  // kills it on done/removed/error — guaranteeing the final message flushes first.
}

void run();
