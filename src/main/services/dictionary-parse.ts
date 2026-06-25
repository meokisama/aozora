import { Uint8ArrayReader, Uint8ArrayWriter, TextWriter, ZipReader, configure, type Entry } from "@zip.js/zip.js";
import type { GlossContent } from "@/lib/types";

configure({ useWebWorkers: false });

/**
 * Pure parsing layer for Yomitan dictionary archives (format/version 3).
 *
 * Turns raw ZIP bytes into a `ParsedDict` — term/meta/kanji/tag/media records
 * ready to insert. Nothing here touches the database or Electron, so it can be
 * unit-tested under plain Node; the store (dictionary-store.ts) owns persistence.
 */

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
export function normalizeMediaPath(p: string): string {
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

export interface ParsedDict {
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
export async function parseYomitanZip(bytes: Uint8Array): Promise<ParsedDict> {
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
