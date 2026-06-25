import { app } from "electron";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { Uint8ArrayReader, TextWriter, ZipReader, configure, type Entry } from "@zip.js/zip.js";
import { deinflect, conditionFlagsForPartsOfSpeech, conditionsMatch, type Deinflection } from "@/lib/dictionary/deinflect";
import type {
  DictionaryInfo,
  DictionaryEntry,
  DictionaryGloss,
  LookupResult,
  DictionaryImportProgress,
} from "@/lib/types";

configure({ useWebWorkers: false });

/**
 * SQLite-backed store for imported Yomitan dictionaries and the lookup engine.
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

function getDb(): Database.Database {
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
  `);
  return db;
}

// --- Yomitan dictionary parsing --------------------------------------------

/**
 * Flattens one Yomitan glossary item to plain text. Items are either bare
 * strings or "structured content" objects (a small subset of HTML as a JSON
 * tree); we walk the tree and concatenate its text, dropping images/markup.
 */
function flattenGloss(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenGloss).join("");
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (obj.type === "structured-content") return flattenGloss(obj.content);
    if (obj.type === "text" && typeof obj.text === "string") return obj.text;
    if ("content" in obj) return flattenGloss(obj.content);
  }
  return "";
}

/** Reads a ZIP entry's contents as text (entries from getEntries always have getData). */
function entryText(entry: Entry | undefined): Promise<string> {
  if (!entry || !("getData" in entry) || !entry.getData) throw new Error("Corrupt ZIP entry.");
  return entry.getData(new TextWriter());
}

/** A Yomitan v3 term-bank row: [expr, reading, defTags, rules, score, glossary, seq, termTags]. */
type TermBankRow = [string, string, string | null, string, number, unknown[], number, string];

interface ParsedDict {
  title: string;
  revision: string | null;
  rows: {
    expression: string;
    reading: string;
    tags: string | null;
    rules: string;
    definitions: string[];
    score: number;
    sequence: number;
  }[];
}

/** Reads a Yomitan dictionary ZIP (format/version 3) into memory. */
async function parseYomitanZip(bytes: Uint8Array): Promise<ParsedDict> {
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  try {
    const entries = await reader.getEntries();
    const byName = new Map(entries.map((e) => [e.filename, e]));

    const indexEntry = byName.get("index.json");
    if (!indexEntry) throw new Error("Not a Yomitan dictionary: index.json is missing.");
    const index = JSON.parse(await entryText(indexEntry)) as {
      title?: string;
      revision?: string;
      format?: number;
      version?: number;
    };
    const format = index.format ?? index.version;
    if (format !== 3) {
      throw new Error(`Unsupported dictionary format (v${format ?? "?"}). Only Yomitan format 3 is supported.`);
    }

    const rows: ParsedDict["rows"] = [];
    const bankNames = entries
      .map((e) => e.filename)
      .filter((n) => /^term_bank_\d+\.json$/.test(n))
      .sort();
    for (const name of bankNames) {
      const bank = JSON.parse(await entryText(byName.get(name))) as TermBankRow[];
      for (const row of bank) {
        const [expression, reading, defTags, rules, score, glossary, sequence] = row;
        if (!expression) continue;
        const definitions = (Array.isArray(glossary) ? glossary : [])
          .map(flattenGloss)
          .map((s) => s.trim())
          .filter(Boolean);
        if (!definitions.length) continue;
        rows.push({
          expression,
          reading: reading || "",
          tags: defTags || null,
          rules: rules || "",
          definitions,
          score: typeof score === "number" ? score : 0,
          sequence: typeof sequence === "number" ? sequence : 0,
        });
      }
    }

    return { title: index.title || "Untitled dictionary", revision: index.revision ?? null, rows };
  } finally {
    await reader.close();
  }
}

// --- Row mapping ------------------------------------------------------------

interface DictRow {
  id: string;
  title: string;
  revision: string | null;
  imported_at: number;
  enabled: number;
  priority: number;
  term_count?: number;
}

function rowToInfo(row: DictRow): DictionaryInfo {
  return {
    id: row.id,
    title: row.title,
    revision: row.revision ?? null,
    importedAt: row.imported_at,
    enabled: row.enabled === 1,
    priority: row.priority,
    termCount: row.term_count ?? 0,
  };
}

export const dictionaryStore = {
  listDicts(): DictionaryInfo[] {
    const rows = getDb()
      .prepare(
        `SELECT d.*, (SELECT COUNT(*) FROM terms t WHERE t.dict_id = d.id) AS term_count
           FROM dictionaries d
          ORDER BY d.priority ASC, d.imported_at ASC`,
      )
      .all() as DictRow[];
    return rows.map(rowToInfo);
  },

  getDict(id: string): DictionaryInfo | null {
    const row = getDb()
      .prepare(
        `SELECT d.*, (SELECT COUNT(*) FROM terms t WHERE t.dict_id = d.id) AS term_count
           FROM dictionaries d WHERE d.id = ?`,
      )
      .get(id) as DictRow | undefined;
    return row ? rowToInfo(row) : null;
  },

  /**
   * Imports a Yomitan dictionary from raw ZIP bytes. `onProgress` is called as
   * the parse and insert proceed. Replaces any existing dictionary with the same
   * title (re-import = upgrade) to keep things idempotent.
   */
  async importDict(bytes: Uint8Array, onProgress?: (p: DictionaryImportProgress) => void): Promise<DictionaryInfo> {
    const database = getDb();
    onProgress?.({ phase: "reading" });
    const parsed = await parseYomitanZip(bytes);
    onProgress?.({ phase: "inserting", title: parsed.title, termsInserted: 0 });

    // Re-import of the same title replaces the old copy (and its terms cascade).
    const existing = database.prepare("SELECT id, priority FROM dictionaries WHERE title = ?").get(parsed.title) as
      | { id: string; priority: number }
      | undefined;
    const id = existing?.id ?? randomUUID();
    const nextPriority =
      existing?.priority ??
      ((database.prepare("SELECT COALESCE(MAX(priority), -1) + 1 AS p FROM dictionaries").get() as { p: number }).p);

    const insertDict = database.prepare(
      `INSERT INTO dictionaries (id, title, revision, imported_at, enabled, priority)
         VALUES (@id, @title, @revision, @importedAt, 1, @priority)`,
    );
    const insertTerm = database.prepare(
      `INSERT INTO terms (dict_id, expression, reading, tags, rules, definitions, score, sequence)
         VALUES (@dictId, @expression, @reading, @tags, @rules, @definitions, @score, @sequence)`,
    );

    const importAll = database.transaction((rows: ParsedDict["rows"]) => {
      if (existing) database.prepare("DELETE FROM dictionaries WHERE id = ?").run(existing.id);
      insertDict.run({ id, title: parsed.title, revision: parsed.revision, importedAt: Date.now(), priority: nextPriority });
      for (const r of rows) {
        insertTerm.run({
          dictId: id,
          expression: r.expression,
          reading: r.reading,
          tags: r.tags,
          rules: r.rules,
          definitions: JSON.stringify(r.definitions),
          score: r.score,
          sequence: r.sequence,
        });
      }
    });
    importAll(parsed.rows);

    onProgress?.({ phase: "done", title: parsed.title, termsInserted: parsed.rows.length });
    return this.getDict(id)!;
  },

  removeDict(id: string): void {
    getDb().prepare("DELETE FROM dictionaries WHERE id = ?").run(id);
  },

  setEnabled(id: string, enabled: boolean): DictionaryInfo | null {
    getDb().prepare("UPDATE dictionaries SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
    return this.getDict(id);
  },

  /** Sets the consult order; lower priority is consulted first. */
  setPriority(id: string, priority: number): DictionaryInfo | null {
    getDb().prepare("UPDATE dictionaries SET priority = ? WHERE id = ?").run(priority, id);
    return this.getDict(id);
  },

  /**
   * Looks up the dictionary form(s) at the start of `text`. Scans prefixes from
   * longest to shortest; for each it deinflects to candidate base forms and
   * queries the enabled dictionaries. A candidate only counts when its
   * grammatical conditions are compatible with the entry's part of speech (so
   * e.g. a noun never matches a verb deinflection). Returns the matches for the
   * *longest* prefix that hits anything, plus how many characters it consumed
   * (so the reader can highlight exactly that run).
   */
  lookup(text: string): LookupResult {
    const empty: LookupResult = { matchedLength: 0, entries: [] };
    if (!text) return empty;
    const database = getDb();

    const enabledCount = (database.prepare("SELECT COUNT(*) AS c FROM dictionaries WHERE enabled = 1").get() as { c: number }).c;
    if (!enabledCount) return empty;

    const maxLen = Math.min(text.length, 24);
    for (let len = maxLen; len >= 1; len--) {
      const prefix = text.slice(0, len);
      const candidates = deinflect(prefix);

      // term -> candidates that deinflect to it (each carries its POS conditions).
      const candsByTerm = new Map<string, Deinflection[]>();
      for (const c of candidates) {
        const list = candsByTerm.get(c.term);
        if (list) list.push(c);
        else candsByTerm.set(c.term, [c]);
      }
      const terms = [...candsByTerm.keys()];

      const placeholders = terms.map(() => "?").join(",");
      const rows = database
        .prepare(
          `SELECT t.expression, t.reading, t.tags, t.rules, t.definitions, t.score, t.dict_id AS dictId,
                  d.title AS dictTitle, d.priority AS priority
             FROM terms t
             JOIN dictionaries d ON d.id = t.dict_id
            WHERE d.enabled = 1
              AND (t.expression IN (${placeholders}) OR t.reading IN (${placeholders}))`,
        )
        .all(...terms, ...terms) as {
        expression: string;
        reading: string | null;
        tags: string | null;
        rules: string | null;
        definitions: string;
        score: number;
        dictId: string;
        dictTitle: string;
        priority: number;
      }[];

      if (!rows.length) continue;

      // Group by headword (expression + reading), then by source dictionary.
      const groups = new Map<string, DictionaryEntry & { _priority: number; _score: number }>();
      for (const r of rows) {
        // Part-of-speech gate: keep candidate(s) whose conditions are compatible
        // with this entry's declared rules; prefer the most direct (fewest
        // reasons) for the displayed inflection note.
        const definitionConditions = conditionFlagsForPartsOfSpeech((r.rules ?? "").split(" ").filter(Boolean));
        const matching = [
          ...(candsByTerm.get(r.expression) ?? []),
          ...(r.reading ? (candsByTerm.get(r.reading) ?? []) : []),
        ]
          .filter((c) => conditionsMatch(c.conditions, definitionConditions))
          .sort((a, b) => a.reasons.length - b.reasons.length);
        if (!matching.length) continue;
        const reasons = matching[0].reasons;

        const key = `${r.expression} ${r.reading ?? ""}`;
        let entry = groups.get(key);
        if (!entry) {
          entry = {
            expression: r.expression,
            reading: r.reading || null,
            reasons,
            byDict: [],
            _priority: r.priority,
            _score: r.score,
          };
          groups.set(key, entry);
        } else if (reasons.length < entry.reasons.length) {
          entry.reasons = reasons;
        }
        entry._priority = Math.min(entry._priority, r.priority);
        entry._score = Math.max(entry._score, r.score);
        let dictGroup = entry.byDict.find((g) => g.dictId === r.dictId);
        if (!dictGroup) {
          dictGroup = { dictId: r.dictId, dictTitle: r.dictTitle, tags: r.tags, glosses: [] } as DictionaryGloss;
          entry.byDict.push(dictGroup);
        }
        try {
          for (const g of JSON.parse(r.definitions) as string[]) dictGroup.glosses.push(g);
        } catch {
          /* skip malformed */
        }
      }

      if (!groups.size) continue;

      const entries: DictionaryEntry[] = [...groups.values()]
        .sort((a, b) => a.reasons.length - b.reasons.length || a._priority - b._priority || b._score - a._score)
        .slice(0, 32)
        .map((e) => ({ expression: e.expression, reading: e.reading, reasons: e.reasons, byDict: e.byDict }));

      return { matchedLength: len, entries };
    }

    return empty;
  },
};
