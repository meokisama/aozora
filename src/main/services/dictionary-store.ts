import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
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
import { getDb } from "./dictionary-db.js";
import { parseYomitanZip, normalizeMediaPath, type ParsedDict } from "./dictionary-parse.js";

/**
 * Store + lookup engine for imported Yomitan dictionaries — the public API the
 * IPC layer calls (import, list, lookup, media). Schema lives in
 * dictionary-db.ts, parsing in dictionary-parse.ts.
 */

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
  kanji_freq_count?: number;
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
    kanjiFreqCount: row.kanji_freq_count ?? 0,
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

  // Best (lowest sort_value) kanji-meta frequency per dict, keyed by character.
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
                (SELECT COUNT(*) FROM kanji k WHERE k.dict_id = d.id) AS kanji_count,
                (SELECT COUNT(*) FROM kanji_meta km WHERE km.dict_id = d.id) AS kanji_freq_count
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
                (SELECT COUNT(*) FROM kanji k WHERE k.dict_id = d.id) AS kanji_count,
                (SELECT COUNT(*) FROM kanji_meta km WHERE km.dict_id = d.id) AS kanji_freq_count
           FROM dictionaries d WHERE d.id = ?`,
      )
      .get(id) as DictRow | undefined;
    return row ? rowToInfo(row) : null;
  },

  /**
   * Imports a Yomitan dictionary from raw ZIP bytes, streaming `onProgress`.
   * Replaces any existing dictionary with the same title (re-import = upgrade).
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
      `INSERT INTO dictionaries (id, title, revision, imported_at, enabled, priority, styles)
         VALUES (@id, @title, @revision, @importedAt, 1, @priority, @styles)`,
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
      insertDict.run({ id, title: parsed.title, revision: parsed.revision, importedAt: Date.now(), priority: nextPriority, styles: parsed.styles });
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
   * Custom CSS (from each dictionary's `styles.css`) for the dictionaries that
   * ship one. The renderer injects these scoped to the dictionary so a dict's
   * structured-content styling applies in the popup without leaking app-wide.
   */
  getStyles(): { dictId: string; css: string }[] {
    const rows = getDb()
      .prepare("SELECT id AS dictId, styles AS css FROM dictionaries WHERE styles <> ''")
      .all() as { dictId: string; css: string }[];
    return rows;
  },

  /**
   * Returns a glossary image as a data URL, or null if absent. Called lazily by
   * the popup as it renders structured-content `img` nodes.
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
   * Looks up dictionary form(s) at the start of `text`. Scans prefixes longest
   * to shortest; each is deinflected to candidate base forms, gated so a
   * candidate's grammatical conditions must match the entry's POS (a noun never
   * matches a verb deinflection). Returns matches for the *longest* hitting
   * prefix plus how many chars it consumed, so the reader highlights that run.
   */
  lookup(text: string): LookupResult {
    const empty: LookupResult = { matchedLength: 0, entries: [], kanji: [] };
    if (!text) return empty;
    const database = getDb();

    const enabledCount = (database.prepare("SELECT COUNT(*) AS c FROM dictionaries WHERE enabled = 1").get() as { c: number }).c;
    if (!enabledCount) return empty;

    const tagMaps = loadTagMaps(database); // shared by term + kanji tag resolution

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
        // POS gate: keep candidate(s) whose conditions match this entry's rules;
        // prefer the most direct (fewest reasons) for the inflection note.
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

      // Attach frequency ratings to matched headwords. A reading-specific rating
      // applies only to its reading; a reading-less one to every reading. Per
      // dictionary, keep the most-common (lowest sort_value) match.
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

      // Attach pitch-accent patterns. A pitch entry always carries a reading and
      // applies to a headword with the same reading (or, for a kana headword with
      // no separate reading, the expression).
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

    // No term matched: fall back to a kanji-only lookup on the first char so
    // hovering a lone kanji still surfaces its reading/meaning.
    const firstKanji = kanjiInText(text.slice(0, 1), 1);
    if (firstKanji.length) {
      const kanji = queryKanji(database, firstKanji, tagMaps);
      if (kanji.length) return { matchedLength: 1, entries: [], kanji };
    }

    return empty;
  },
};
