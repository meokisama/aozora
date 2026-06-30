import fs from "node:fs";
import Database from "better-sqlite3";
import type { DictionaryImportProgress } from "@/lib/types";
import { parseYomitanZip } from "./dictionary-parse.js";
import { applyDictionarySchema } from "./dictionary-schema.js";
import { insertParsedDict } from "./dictionary-insert.js";

/**
 * Import utility process: parses a Yomitan ZIP and writes it to the dictionary
 * database off the main process, so a heavy import never blocks the UI. Forked
 * by dictionary-store.ts with [dbPath, filePath] in argv; opens its own
 * connection to the same WAL file (concurrent reads from the main connection
 * stay live). Streams progress and the result back over `process.parentPort`.
 */

type WorkerMessage =
  | { type: "progress"; payload: DictionaryImportProgress }
  | { type: "done"; id: string; title: string; termsInserted: number }
  | { type: "error"; message: string };

const parentPort = process.parentPort;

function post(msg: WorkerMessage): void {
  parentPort.postMessage(msg);
}

async function run(): Promise<void> {
  const dbPath = process.argv[2];
  const filePath = process.argv[3];
  let database: Database.Database | undefined;
  try {
    post({ type: "progress", payload: { phase: "reading" } });
    const bytes = new Uint8Array(fs.readFileSync(filePath));
    const parsed = await parseYomitanZip(bytes);

    post({ type: "progress", payload: { phase: "inserting", title: parsed.title, termsInserted: 0 } });
    database = new Database(dbPath);
    applyDictionarySchema(database);
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
  // The process stays alive (parentPort keeps the loop open) until the parent
  // kills it on done/error — guaranteeing the final message flushes first.
}

void run();
