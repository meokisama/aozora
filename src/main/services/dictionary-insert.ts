import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { DictionaryImportProgress } from "@/lib/types";
import type { ParsedDict } from "./dictionary-parse.js";

/**
 * Persists a parsed Yomitan dictionary into the database in a single
 * transaction. Pure better-sqlite3 + Node (no Electron), so it runs in the
 * import utility process against its own connection. Re-import of the same
 * title replaces the old copy (its rows cascade away). Returns the dictionary id.
 */
export function insertParsedDict(
  database: Database.Database,
  parsed: ParsedDict,
  onProgress?: (p: DictionaryImportProgress) => void,
): { id: string } {
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

  const total =
    parsed.rows.length +
    parsed.freqs.length +
    parsed.pitches.length +
    parsed.kanji.length +
    parsed.kanjiFreqs.length +
    parsed.tags.length +
    parsed.media.length;
  // Throttle progress to every ~20k rows so the bar moves without flooding IPC.
  let inserted = 0;
  let nextReport = 20000;
  const tick = () => {
    inserted++;
    if (inserted >= nextReport) {
      nextReport += 20000;
      onProgress?.({ phase: "inserting", title: parsed.title, inserted, total, termsInserted: Math.min(inserted, parsed.rows.length) });
    }
  };

  const importAll = database.transaction(() => {
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
      tick();
    }
    for (const f of parsed.freqs) {
      insertFreq.run({ dictId: id, expression: f.expression, reading: f.reading, value: f.value, display: f.display, sortValue: f.sortValue });
      tick();
    }
    for (const p of parsed.pitches) {
      insertPitch.run({ dictId: id, expression: p.expression, reading: p.reading, pitches: JSON.stringify(p.patterns) });
      tick();
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
      tick();
    }
    for (const kf of parsed.kanjiFreqs) {
      insertKanjiFreq.run({ dictId: id, character: kf.character, value: kf.value, display: kf.display, sortValue: kf.sortValue });
      tick();
    }
    for (const t of parsed.tags) {
      insertTag.run({ dictId: id, name: t.name, category: t.category, notes: t.notes, order: t.order });
      tick();
    }
    for (const m of parsed.media) {
      insertMedia.run({ dictId: id, path: m.path, mime: m.mime, data: Buffer.from(m.data) });
      tick();
    }
  });
  importAll();

  onProgress?.({ phase: "inserting", title: parsed.title, inserted: total, total, termsInserted: parsed.rows.length });
  return { id };
}
