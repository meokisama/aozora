import { app } from "electron";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { Uint8ArrayReader, Uint8ArrayWriter, TextWriter, ZipReader, configure, type Entry } from "@zip.js/zip.js";
import { deinflect, conditionFlagsForPartsOfSpeech, conditionsMatch, type Deinflection } from "@/lib/dictionary/deinflect";
import type {
  DictionaryInfo,
  DictionaryEntry,
  DictionaryGloss,
  DictionaryFrequency,
  DictionaryPitch,
  DictionaryTag,
  KanjiEntry,
  GlossContent,
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

// --- Yomitan dictionary parsing --------------------------------------------

/**
 * Whether a Yomitan glossary item carries any renderable text. Used only to drop
 * empty items at import time — unlike the old flatten step, the item itself is
 * stored verbatim (structure intact) so the popup can render it like Yomitan.
 * Image-only nodes count as empty for now (archive media is not yet extracted).
 */
function glossHasText(node: unknown): boolean {
  if (typeof node === "string") return node.trim().length > 0;
  if (typeof node === "number") return true;
  if (Array.isArray(node)) return node.some(glossHasText);
  if (node != null && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (obj.tag === "img" || obj.type === "image") return false;
    if (typeof obj.text === "string") return obj.text.trim().length > 0;
    if ("content" in obj) return glossHasText(obj.content);
    return true;
  }
  return false;
}

/** Reads a ZIP entry's contents as text (entries from getEntries always have getData). */
function entryText(entry: Entry | undefined): Promise<string> {
  if (!entry || !("getData" in entry) || !entry.getData) throw new Error("Corrupt ZIP entry.");
  return entry.getData(new TextWriter());
}

/** Image extensions Yomitan glossaries can reference, mapped to their MIME type. */
const IMAGE_EXT_MIME: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  gif: "image/gif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  bmp: "image/bmp",
  apng: "image/apng",
  avif: "image/avif",
};

/** MIME for a media filename by extension, or null if it isn't a renderable image. */
function mediaMime(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  return IMAGE_EXT_MIME[name.slice(dot + 1).toLowerCase()] ?? null;
}

/** Normalises an archive media path so import and lookup agree (drops leading ./ and /). */
function normalizeMediaPath(p: string): string {
  let s = p;
  while (s.startsWith("./")) s = s.slice(2);
  while (s.startsWith("/")) s = s.slice(1);
  return s;
}

/** A Yomitan v3 term-bank row: [expr, reading, defTags, rules, score, glossary, seq, termTags]. */
type TermBankRow = [string, string, string | null, string, number, unknown[], number, string];

/** A Yomitan v3 term-meta-bank row: [expression, mode, data]. We consume mode "freq". */
type TermMetaRow = [string, string, unknown];

/** A Yomitan v3 kanji-bank row: [character, onyomi, kunyomi, tags, meanings, stats]. */
type KanjiBankRow = [string, string, string, string, string[], Record<string, string | number>];

/** One kanji entry, ready to insert into the kanji table. */
interface ParsedKanji {
  character: string;
  onyomi: string; // space-separated
  kunyomi: string; // space-separated
  tags: string; // space-separated
  meanings: string[];
  stats: Record<string, string | number>;
}

/** A Yomitan v3 kanji-meta-bank row: [character, mode, data]. We consume mode "freq". */
type KanjiMetaRow = [string, string, unknown];

/** One kanji frequency rating, ready to insert into kanji_meta. */
interface ParsedKanjiFreq {
  character: string;
  value: number;
  display: string | null;
  sortValue: number;
}

/** Parses a kanji-meta "freq" row's data into a frequency record (no reading form for kanji). */
function parseKanjiFreq(character: string, data: unknown, occurrence: boolean): ParsedKanjiFreq | null {
  if (!character) return null;
  const { value, display } = freqInfo(data);
  return { character, value, display, sortValue: occurrence ? -value : value };
}

/** A Yomitan v3 tag-bank row: [name, category, order, notes, score]. */
type TagBankRow = [string, string, number, string, number];

/** One tag definition, ready to insert into the tags table. */
interface ParsedTag {
  name: string;
  category: string;
  order: number;
  notes: string;
}

/** Parses one tag-bank row, or null if it has no name. */
function parseTag(row: TagBankRow): ParsedTag | null {
  const [name, category, order, notes] = row;
  if (!name) return null;
  return {
    name,
    category: typeof category === "string" ? category : "",
    order: typeof order === "number" ? order : 0,
    notes: typeof notes === "string" ? notes : "",
  };
}

/** Parses one kanji-bank row, or null if it has no character. */
function parseKanji(row: KanjiBankRow): ParsedKanji | null {
  const [character, onyomi, kunyomi, tags, meanings, stats] = row;
  if (!character) return null;
  return {
    character,
    onyomi: typeof onyomi === "string" ? onyomi : "",
    kunyomi: typeof kunyomi === "string" ? kunyomi : "",
    tags: typeof tags === "string" ? tags : "",
    meanings: Array.isArray(meanings) ? meanings.filter((m): m is string => typeof m === "string") : [],
    stats: stats !== null && typeof stats === "object" ? stats : {},
  };
}

/** One normalised frequency rating, ready to insert into term_meta. */
interface ParsedFreq {
  expression: string;
  reading: string | null;
  value: number; // the number to display
  display: string | null; // pre-formatted display string, when the bank gave one
  sortValue: number; // normalised so lower = more common (occurrence dicts negated)
}

const FREQ_NUMBER_RE = /-?[0-9]+(\.[0-9]+)?/;

/** Parses a frequency display string into a sortable number (Yomitan `_convertStringToNumber`). */
function freqStringToNumber(s: string): number {
  const m = FREQ_NUMBER_RE.exec(s);
  if (!m) return 0;
  const n = Number.parseFloat(m[0]);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Normalises a Yomitan freq value (`number | string | {value, displayValue}`)
 * into a display number + optional display string (mirrors `_getFrequencyInfo`).
 */
function freqInfo(data: unknown): { value: number; display: string | null } {
  if (data !== null && typeof data === "object") {
    const o = data as { value?: unknown; displayValue?: unknown };
    return {
      value: typeof o.value === "number" ? o.value : 0,
      display: typeof o.displayValue === "string" ? o.displayValue : null,
    };
  }
  if (typeof data === "number") return { value: data, display: null };
  if (typeof data === "string") return { value: freqStringToNumber(data), display: data };
  return { value: 0, display: null };
}

/**
 * Parses one term-meta freq row's `data` into a frequency record. Handles the
 * reading-specific form `{reading, frequency}` and the generic forms; `occurrence`
 * negates the sort value so ascending order is always "more common".
 */
function parseFreq(expression: string, data: unknown, occurrence: boolean): ParsedFreq | null {
  if (!expression) return null;
  let reading: string | null = null;
  let freqData = data;
  if (data !== null && typeof data === "object" && typeof (data as { reading?: unknown }).reading === "string") {
    reading = (data as { reading: string }).reading;
    freqData = (data as { frequency: unknown }).frequency;
  }
  const { value, display } = freqInfo(freqData);
  return { expression, reading, value, display, sortValue: occurrence ? -value : value };
}

/** One pitch-accent pattern: a downstep position plus optional nasal/devoice morae. */
interface ParsedPitchPattern {
  position: number | string;
  nasal: number[];
  devoice: number[];
}

/** Pitch-accent entries for one expression+reading, ready to insert into term_pitch. */
interface ParsedPitch {
  expression: string;
  reading: string;
  patterns: ParsedPitchPattern[];
}

/** Coerces Yomitan's `nasal`/`devoice` (int | int[] | undefined) into a number array. */
function toPositionArray(v: unknown): number[] {
  if (typeof v === "number") return [v];
  if (Array.isArray(v)) return v.filter((n): n is number => typeof n === "number");
  return [];
}

/**
 * Parses a term-meta "pitch" row's data (`{reading, pitches: [{position, …}]}`)
 * into a normalised pitch record, or null if it carries no usable pattern.
 */
function parsePitch(expression: string, data: unknown): ParsedPitch | null {
  if (!expression || data === null || typeof data !== "object") return null;
  const o = data as { reading?: unknown; pitches?: unknown };
  if (typeof o.reading !== "string" || !Array.isArray(o.pitches)) return null;
  const patterns: ParsedPitchPattern[] = [];
  for (const p of o.pitches) {
    if (p === null || typeof p !== "object") continue;
    const pos = (p as { position?: unknown }).position;
    if (typeof pos !== "number" && typeof pos !== "string") continue;
    patterns.push({
      position: pos,
      nasal: toPositionArray((p as { nasal?: unknown }).nasal),
      devoice: toPositionArray((p as { devoice?: unknown }).devoice),
    });
  }
  if (!patterns.length) return null;
  return { expression, reading: o.reading, patterns };
}

interface ParsedDict {
  title: string;
  revision: string | null;
  rows: {
    expression: string;
    reading: string;
    tags: string | null;
    rules: string;
    definitions: GlossContent[];
    score: number;
    sequence: number;
  }[];
  freqs: ParsedFreq[];
  pitches: ParsedPitch[];
  kanji: ParsedKanji[];
  kanjiFreqs: ParsedKanjiFreq[];
  tags: ParsedTag[];
  media: { path: string; mime: string; data: Uint8Array }[];
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
      frequencyMode?: string;
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
        const [expression, reading, defTags, rules, score, glossary, sequence, termTags] = row;
        if (!expression) continue;
        // Keep each glossary item verbatim (string or structured-content tree),
        // dropping only the empty/image-only ones. The renderer handles structure.
        const definitions = (Array.isArray(glossary) ? glossary : []).filter(glossHasText) as GlossContent[];
        if (!definitions.length) continue;
        // Store definition tags (POS) and term tags (commonness markers like
        // "news1k"/"ichi") together; they render as one badge row, deduped.
        const tags = [defTags, termTags].filter((t): t is string => typeof t === "string" && t.length > 0).join(" ");
        rows.push({
          expression,
          reading: reading || "",
          tags: tags || null,
          rules: rules || "",
          definitions,
          score: typeof score === "number" ? score : 0,
          sequence: typeof sequence === "number" ? sequence : 0,
        });
      }
    }

    // Frequency ratings (term-meta banks, "freq" mode). Other modes (pitch/ipa)
    // are skipped for now. occurrence-based dictionaries count up (higher = more
    // common), so their sort value is negated to keep lookups mode-agnostic.
    const occurrence = index.frequencyMode === "occurrence-based";
    const freqs: ParsedFreq[] = [];
    const pitches: ParsedPitch[] = [];
    const metaNames = entries
      .map((e) => e.filename)
      .filter((n) => /^term_meta_bank_\d+\.json$/.test(n))
      .sort();
    for (const name of metaNames) {
      const bank = JSON.parse(await entryText(byName.get(name))) as TermMetaRow[];
      for (const row of bank) {
        const [expression, mode, data] = row;
        if (mode === "freq") {
          const f = parseFreq(expression, data, occurrence);
          if (f) freqs.push(f);
        } else if (mode === "pitch") {
          const p = parsePitch(expression, data);
          if (p) pitches.push(p);
        }
        // "ipa" and any other modes are skipped for now.
      }
    }

    // Kanji entries (kanji_bank). kanji_meta banks aren't parsed yet (frequency
    // falls back to stats.freq at display time).
    const kanji: ParsedKanji[] = [];
    const kanjiNames = entries
      .map((e) => e.filename)
      .filter((n) => /^kanji_bank_\d+\.json$/.test(n))
      .sort();
    for (const name of kanjiNames) {
      const bank = JSON.parse(await entryText(byName.get(name))) as KanjiBankRow[];
      for (const row of bank) {
        const k = parseKanji(row);
        if (k) kanji.push(k);
      }
    }

    // Kanji frequency (kanji_meta_bank, "freq" mode).
    const kanjiFreqs: ParsedKanjiFreq[] = [];
    const kanjiMetaNames = entries
      .map((e) => e.filename)
      .filter((n) => /^kanji_meta_bank_\d+\.json$/.test(n))
      .sort();
    for (const name of kanjiMetaNames) {
      const bank = JSON.parse(await entryText(byName.get(name))) as KanjiMetaRow[];
      for (const row of bank) {
        const [character, mode, data] = row;
        if (mode !== "freq") continue;
        const kf = parseKanjiFreq(character, data, occurrence);
        if (kf) kanjiFreqs.push(kf);
      }
    }

    // Tag definitions (tag_bank): token -> note + category, for rendering tags.
    const tags: ParsedTag[] = [];
    const tagNames = entries
      .map((e) => e.filename)
      .filter((n) => /^tag_bank_\d+\.json$/.test(n))
      .sort();
    for (const name of tagNames) {
      const bank = JSON.parse(await entryText(byName.get(name))) as TagBankRow[];
      for (const row of bank) {
        const t = parseTag(row);
        if (t) tags.push(t);
      }
    }

    // Extract image media (pitch-accent diagrams, stroke order, …) referenced by
    // structured-content `img` nodes. Stored as blobs and later served as data URLs.
    const media: ParsedDict["media"] = [];
    for (const entry of entries) {
      if (entry.directory || !("getData" in entry) || !entry.getData) continue;
      const mime = mediaMime(entry.filename);
      if (!mime) continue;
      const data = await entry.getData(new Uint8ArrayWriter());
      media.push({ path: normalizeMediaPath(entry.filename), mime, data });
    }

    if (!rows.length && !freqs.length && !pitches.length && !kanji.length && !kanjiFreqs.length) {
      throw new Error("No importable entries found (expected term_bank, term_meta_bank or kanji_bank files).");
    }

    return { title: index.title || "Untitled dictionary", revision: index.revision ?? null, rows, freqs, pitches, kanji, kanjiFreqs, tags, media };
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
  freq_count?: number;
  pitch_count?: number;
  kanji_count?: number;
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
    freqCount: row.freq_count ?? 0,
    pitchCount: row.pitch_count ?? 0,
    kanjiCount: row.kanji_count ?? 0,
  };
}

/** Splits a space-separated dictionary field (onyomi/kunyomi/tags) into a list. */
function splitSpace(s: string | null): string[] {
  return s ? s.split(" ").filter(Boolean) : [];
}

/** Splits a definition-tag field (space- or comma-separated) into tag tokens. */
function splitTagNames(s: string | null): string[] {
  return s ? s.split(/[\s,]+/).filter(Boolean) : [];
}

/** Per-dictionary tag bank: dictId -> (tag name -> definition). */
type TagMaps = Map<string, Map<string, DictionaryTag>>;

/** Loads the tag banks of all enabled dictionaries (small; one query per lookup). */
function loadTagMaps(database: Database.Database): TagMaps {
  const maps: TagMaps = new Map();
  const rows = database
    .prepare(
      `SELECT t.dict_id AS dictId, t.name, t.category, t.notes, t.sort_order AS sortOrder
         FROM tags t JOIN dictionaries d ON d.id = t.dict_id
        WHERE d.enabled = 1`,
    )
    .all() as { dictId: string; name: string; category: string | null; notes: string | null; sortOrder: number }[];
  for (const r of rows) {
    let m = maps.get(r.dictId);
    if (!m) {
      m = new Map();
      maps.set(r.dictId, m);
    }
    m.set(r.name, { name: r.name, category: r.category ?? "", notes: r.notes ?? "", order: r.sortOrder });
  }
  return maps;
}

/** Resolves raw tag tokens against a dictionary's tag bank, deduped and sorted by order then name. */
function resolveTags(map: Map<string, DictionaryTag> | undefined, names: string[]): DictionaryTag[] {
  const seen = new Set<string>();
  const out: DictionaryTag[] = [];
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(map?.get(name) ?? { name, category: "", notes: "", order: 0 });
  }
  return out.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/** Distinct Han (kanji) characters in `text`, in first-seen order, capped. */
function kanjiInText(text: string, cap = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of text) {
    if (!/\p{Script=Han}/u.test(c) || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
    if (out.length >= cap) break;
  }
  return out;
}

/** Looks up kanji entries (enabled dicts) for the given characters, ordered by text position then priority. */
function queryKanji(database: Database.Database, chars: string[], tagMaps: TagMaps): KanjiEntry[] {
  if (!chars.length) return [];
  const placeholders = chars.map(() => "?").join(",");
  const rows = database
    .prepare(
      `SELECT k.character, k.onyomi, k.kunyomi, k.tags, k.meanings, k.stats,
              k.dict_id AS dictId, d.title AS dictTitle, d.priority AS priority
         FROM kanji k
         JOIN dictionaries d ON d.id = k.dict_id
        WHERE d.enabled = 1 AND k.character IN (${placeholders})
        ORDER BY d.priority ASC`,
    )
    .all(...chars) as {
    character: string;
    onyomi: string | null;
    kunyomi: string | null;
    tags: string | null;
    meanings: string;
    stats: string;
    dictId: string;
    dictTitle: string;
    priority: number;
  }[];

  const order = new Map(chars.map((c, i) => [c, i]));
  rows.sort((a, b) => (order.get(a.character) ?? 0) - (order.get(b.character) ?? 0) || a.priority - b.priority);

  // Frequency ratings from kanji-meta dictionaries, best (lowest sort_value) per
  // dict, keyed by character so each kanji entry can carry them.
  const freqByChar = new Map<string, Map<string, { freq: DictionaryFrequency; sortValue: number }>>();
  const freqRows = database
    .prepare(
      `SELECT km.character, km.value, km.display, km.sort_value AS sortValue,
              km.dict_id AS dictId, d.title AS dictTitle
         FROM kanji_meta km
         JOIN dictionaries d ON d.id = km.dict_id
        WHERE d.enabled = 1 AND km.character IN (${placeholders})
        ORDER BY d.priority ASC`,
    )
    .all(...chars) as { character: string; value: number; display: string | null; sortValue: number; dictId: string; dictTitle: string }[];
  for (const fr of freqRows) {
    let m = freqByChar.get(fr.character);
    if (!m) {
      m = new Map();
      freqByChar.set(fr.character, m);
    }
    const cur = m.get(fr.dictId);
    if (!cur || fr.sortValue < cur.sortValue) {
      m.set(fr.dictId, { sortValue: fr.sortValue, freq: { dictId: fr.dictId, dictTitle: fr.dictTitle, value: fr.value, displayValue: fr.display } });
    }
  }

  return rows.map((r) => {
    let meanings: string[] = [];
    let stats: Record<string, string | number> = {};
    try {
      meanings = JSON.parse(r.meanings) as string[];
    } catch {
      /* skip malformed */
    }
    try {
      stats = JSON.parse(r.stats) as Record<string, string | number>;
    } catch {
      /* skip malformed */
    }
    return {
      dictId: r.dictId,
      dictTitle: r.dictTitle,
      character: r.character,
      onyomi: splitSpace(r.onyomi),
      kunyomi: splitSpace(r.kunyomi),
      tags: resolveTags(tagMaps.get(r.dictId), splitSpace(r.tags)),
      meanings,
      stats,
      frequencies: [...(freqByChar.get(r.character)?.values() ?? [])].map((v) => v.freq),
    };
  });
}

export const dictionaryStore = {
  listDicts(): DictionaryInfo[] {
    const rows = getDb()
      .prepare(
        `SELECT d.*,
                (SELECT COUNT(*) FROM terms t WHERE t.dict_id = d.id) AS term_count,
                (SELECT COUNT(*) FROM term_meta m WHERE m.dict_id = d.id) AS freq_count,
                (SELECT COUNT(*) FROM term_pitch p WHERE p.dict_id = d.id) AS pitch_count,
                (SELECT COUNT(*) FROM kanji k WHERE k.dict_id = d.id) AS kanji_count
           FROM dictionaries d
          ORDER BY d.priority ASC, d.imported_at ASC`,
      )
      .all() as DictRow[];
    return rows.map(rowToInfo);
  },

  getDict(id: string): DictionaryInfo | null {
    const row = getDb()
      .prepare(
        `SELECT d.*,
                (SELECT COUNT(*) FROM terms t WHERE t.dict_id = d.id) AS term_count,
                (SELECT COUNT(*) FROM term_meta m WHERE m.dict_id = d.id) AS freq_count,
                (SELECT COUNT(*) FROM term_pitch p WHERE p.dict_id = d.id) AS pitch_count,
                (SELECT COUNT(*) FROM kanji k WHERE k.dict_id = d.id) AS kanji_count
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
      existing?.priority ?? (database.prepare("SELECT COALESCE(MAX(priority), -1) + 1 AS p FROM dictionaries").get() as { p: number }).p;

    const insertDict = database.prepare(
      `INSERT INTO dictionaries (id, title, revision, imported_at, enabled, priority)
         VALUES (@id, @title, @revision, @importedAt, 1, @priority)`,
    );
    const insertTerm = database.prepare(
      `INSERT INTO terms (dict_id, expression, reading, tags, rules, definitions, score, sequence)
         VALUES (@dictId, @expression, @reading, @tags, @rules, @definitions, @score, @sequence)`,
    );
    const insertFreq = database.prepare(
      `INSERT INTO term_meta (dict_id, expression, reading, value, display, sort_value)
         VALUES (@dictId, @expression, @reading, @value, @display, @sortValue)`,
    );
    const insertPitch = database.prepare(
      `INSERT INTO term_pitch (dict_id, expression, reading, pitches)
         VALUES (@dictId, @expression, @reading, @pitches)`,
    );
    const insertKanji = database.prepare(
      `INSERT INTO kanji (dict_id, character, onyomi, kunyomi, tags, meanings, stats)
         VALUES (@dictId, @character, @onyomi, @kunyomi, @tags, @meanings, @stats)`,
    );
    const insertKanjiFreq = database.prepare(
      `INSERT INTO kanji_meta (dict_id, character, value, display, sort_value)
         VALUES (@dictId, @character, @value, @display, @sortValue)`,
    );
    const insertTag = database.prepare(
      `INSERT OR REPLACE INTO tags (dict_id, name, category, notes, sort_order)
         VALUES (@dictId, @name, @category, @notes, @order)`,
    );
    const insertMedia = database.prepare(`INSERT OR REPLACE INTO media (dict_id, path, mime, data) VALUES (@dictId, @path, @mime, @data)`);

    const importAll = database.transaction((parsed: ParsedDict) => {
      if (existing) database.prepare("DELETE FROM dictionaries WHERE id = ?").run(existing.id);
      insertDict.run({ id, title: parsed.title, revision: parsed.revision, importedAt: Date.now(), priority: nextPriority });
      for (const r of parsed.rows) {
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
      for (const f of parsed.freqs) {
        insertFreq.run({
          dictId: id,
          expression: f.expression,
          reading: f.reading,
          value: f.value,
          display: f.display,
          sortValue: f.sortValue,
        });
      }
      for (const p of parsed.pitches) {
        insertPitch.run({ dictId: id, expression: p.expression, reading: p.reading, pitches: JSON.stringify(p.patterns) });
      }
      for (const k of parsed.kanji) {
        insertKanji.run({
          dictId: id,
          character: k.character,
          onyomi: k.onyomi,
          kunyomi: k.kunyomi,
          tags: k.tags,
          meanings: JSON.stringify(k.meanings),
          stats: JSON.stringify(k.stats),
        });
      }
      for (const kf of parsed.kanjiFreqs) {
        insertKanjiFreq.run({ dictId: id, character: kf.character, value: kf.value, display: kf.display, sortValue: kf.sortValue });
      }
      for (const t of parsed.tags) {
        insertTag.run({ dictId: id, name: t.name, category: t.category, notes: t.notes, order: t.order });
      }
      for (const m of parsed.media) {
        insertMedia.run({ dictId: id, path: m.path, mime: m.mime, data: Buffer.from(m.data) });
      }
    });
    importAll(parsed);

    onProgress?.({ phase: "done", title: parsed.title, termsInserted: parsed.rows.length });
    return this.getDict(id)!;
  },

  removeDict(id: string): void {
    getDb().prepare("DELETE FROM dictionaries WHERE id = ?").run(id);
  },

  /**
   * Returns a glossary image as a data URL (the convention used for book covers
   * too), or null if the dictionary has no such media. Called lazily by the popup
   * as it renders structured-content `img` nodes.
   */
  getMedia(dictId: string, mediaPath: string): string | null {
    const row = getDb().prepare("SELECT mime, data FROM media WHERE dict_id = ? AND path = ?").get(dictId, normalizeMediaPath(mediaPath)) as
      | { mime: string; data: Buffer }
      | undefined;
    if (!row) return null;
    return `data:${row.mime};base64,${row.data.toString("base64")}`;
  },

  setEnabled(id: string, enabled: boolean): DictionaryInfo | null {
    getDb()
      .prepare("UPDATE dictionaries SET enabled = ? WHERE id = ?")
      .run(enabled ? 1 : 0, id);
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
    const empty: LookupResult = { matchedLength: 0, entries: [], kanji: [] };
    if (!text) return empty;
    const database = getDb();

    const enabledCount = (database.prepare("SELECT COUNT(*) AS c FROM dictionaries WHERE enabled = 1").get() as { c: number }).c;
    if (!enabledCount) return empty;

    const tagMaps = loadTagMaps(database); // shared by term and kanji tag resolution

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
              AND (t.expression IN (${placeholders}) OR t.reading IN (${placeholders}))
            ORDER BY d.priority ASC, t.sequence ASC, t.id ASC`,
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
      const groups = new Map<string, DictionaryEntry & { _priority: number; _score: number; _freqRank: number }>();
      for (const r of rows) {
        // Part-of-speech gate: keep candidate(s) whose conditions are compatible
        // with this entry's declared rules; prefer the most direct (fewest
        // reasons) for the displayed inflection note.
        const definitionConditions = conditionFlagsForPartsOfSpeech((r.rules ?? "").split(" ").filter(Boolean));
        const matching = [...(candsByTerm.get(r.expression) ?? []), ...(r.reading ? (candsByTerm.get(r.reading) ?? []) : [])]
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
            frequencies: [],
            pitches: [],
            _priority: r.priority,
            _score: r.score,
            _freqRank: Infinity,
          };
          groups.set(key, entry);
        } else if (reasons.length < entry.reasons.length) {
          entry.reasons = reasons;
        }
        entry._priority = Math.min(entry._priority, r.priority);
        entry._score = Math.max(entry._score, r.score);
        let dictGroup = entry.byDict.find((g) => g.dictId === r.dictId) as (DictionaryGloss & { _rawTags?: string }) | undefined;
        if (!dictGroup) {
          dictGroup = { dictId: r.dictId, dictTitle: r.dictTitle, tags: [], glosses: [], _rawTags: r.tags ?? "" };
          entry.byDict.push(dictGroup);
        }
        try {
          for (const g of JSON.parse(r.definitions) as GlossContent[]) dictGroup.glosses.push(g);
        } catch {
          /* skip malformed */
        }
      }

      if (!groups.size) continue;

      // Attach frequency ratings (from any enabled frequency dictionaries) to the
      // matched headwords. A reading-specific rating only applies to its reading;
      // a reading-less rating applies to every reading of the expression. Per
      // dictionary we keep the most-common (lowest sort_value) matching rating.
      const groupVals = [...groups.values()];
      const exprs = [...new Set(groupVals.map((e) => e.expression))];
      const freqPlaceholders = exprs.map(() => "?").join(",");
      const freqRows = database
        .prepare(
          `SELECT m.expression, m.reading, m.value, m.display, m.sort_value AS sortValue,
                  m.dict_id AS dictId, d.title AS dictTitle, d.priority AS priority
             FROM term_meta m
             JOIN dictionaries d ON d.id = m.dict_id
            WHERE d.enabled = 1 AND m.expression IN (${freqPlaceholders})
            ORDER BY d.priority ASC`,
        )
        .all(...exprs) as {
        expression: string;
        reading: string | null;
        value: number;
        display: string | null;
        sortValue: number;
        dictId: string;
        dictTitle: string;
        priority: number;
      }[];

      if (freqRows.length) {
        for (const e of groupVals) {
          const best = new Map<string, { freq: DictionaryFrequency; sortValue: number }>();
          for (const fr of freqRows) {
            if (fr.expression !== e.expression) continue;
            if (fr.reading !== null && fr.reading !== e.reading) continue;
            const cur = best.get(fr.dictId);
            if (!cur || fr.sortValue < cur.sortValue) {
              best.set(fr.dictId, {
                sortValue: fr.sortValue,
                freq: { dictId: fr.dictId, dictTitle: fr.dictTitle, value: fr.value, displayValue: fr.display },
              });
            }
          }
          if (best.size) {
            e.frequencies = [...best.values()].map((b) => b.freq);
            e._freqRank = Math.min(...[...best.values()].map((b) => b.sortValue));
          }
        }
      }

      // Attach pitch-accent patterns from any enabled pitch dictionaries. A pitch
      // entry always carries a reading; it applies to a headword with the same
      // reading (or, for a kana headword with no separate reading, the expression).
      const pitchRows = database
        .prepare(
          `SELECT p.expression, p.reading, p.pitches, p.dict_id AS dictId, d.title AS dictTitle, d.priority AS priority
             FROM term_pitch p
             JOIN dictionaries d ON d.id = p.dict_id
            WHERE d.enabled = 1 AND p.expression IN (${freqPlaceholders})
            ORDER BY d.priority ASC`,
        )
        .all(...exprs) as {
        expression: string;
        reading: string;
        pitches: string;
        dictId: string;
        dictTitle: string;
        priority: number;
      }[];

      if (pitchRows.length) {
        for (const e of groupVals) {
          const headwordReading = e.reading ?? e.expression;
          const acc: DictionaryPitch[] = [];
          for (const pr of pitchRows) {
            if (pr.expression !== e.expression || pr.reading !== headwordReading) continue;
            try {
              const patterns = JSON.parse(pr.pitches) as { position: number | string; nasal: number[]; devoice: number[] }[];
              for (const pat of patterns) {
                acc.push({
                  dictId: pr.dictId,
                  dictTitle: pr.dictTitle,
                  reading: pr.reading,
                  position: pat.position,
                  nasal: pat.nasal ?? [],
                  devoice: pat.devoice ?? [],
                });
              }
            } catch {
              /* skip malformed */
            }
          }
          if (acc.length) e.pitches = acc;
        }
      }

      // Resolve each dictionary group's raw definition tags against its tag bank.
      for (const e of groupVals) {
        for (const g of e.byDict as (DictionaryGloss & { _rawTags?: string })[]) {
          g.tags = resolveTags(tagMaps.get(g.dictId), splitTagNames(g._rawTags ?? ""));
          delete g._rawTags;
        }
      }

      const entries: DictionaryEntry[] = groupVals
        .sort((a, b) => a.reasons.length - b.reasons.length || a._freqRank - b._freqRank || a._priority - b._priority || b._score - a._score)
        .slice(0, 32)
        .map((e) => ({
          expression: e.expression,
          reading: e.reading,
          reasons: e.reasons,
          byDict: e.byDict,
          frequencies: e.frequencies,
          pitches: e.pitches,
        }));

      // Also break down the kanji in the matched run (word + its component kanji).
      return { matchedLength: len, entries, kanji: queryKanji(database, kanjiInText(text.slice(0, len)), tagMaps) };
    }

    // No term matched at any prefix: fall back to a kanji-only lookup on the first
    // character so hovering a lone kanji still surfaces its reading/meaning.
    const firstKanji = kanjiInText(text.slice(0, 1), 1);
    if (firstKanji.length) {
      const kanji = queryKanji(database, firstKanji, tagMaps);
      if (kanji.length) return { matchedLength: 1, entries: [], kanji };
    }

    return empty;
  },
};
