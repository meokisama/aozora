import type { KanjiEntry } from "@/lib/types";
import { TagBadges } from "./dictionary-tags";

/**
 * One kanji's breakdown in the popup: the character, its on'yomi / kun'yomi
 * readings, English meanings, and a few high-signal stats (stroke count, grade,
 * JLPT level, frequency) pulled from the kanji_bank `stats` object. The many
 * dictionary index codes in `stats` are intentionally not shown.
 */

// Stat keys worth surfacing, in display order, with their labels.
const SHOWN_STATS: [key: string, label: string][] = [
  ["strokes", "Strokes"],
  ["grade", "Grade"],
  ["jlpt", "JLPT"],
  ["freq", "Freq"],
];

export function KanjiCard({ kanji }: { kanji: KanjiEntry }) {
  const stats = SHOWN_STATS.map(([key, label]) => ({ label, value: kanji.stats[key] })).filter(
    (s) => s.value !== undefined && s.value !== null && s.value !== "",
  );

  return (
    <div className="flex gap-3">
      <div className="text-3xl leading-none font-medium">{kanji.character}</div>
      <div className="min-w-0 flex-1 space-y-1">
        {(kanji.onyomi.length > 0 || kanji.kunyomi.length > 0) && (
          <div className="space-y-0.5 text-xs">
            {kanji.onyomi.length > 0 && (
              <div>
                <span className="text-muted-foreground/60">On </span>
                {kanji.onyomi.join("、")}
              </div>
            )}
            {kanji.kunyomi.length > 0 && (
              <div>
                <span className="text-muted-foreground/60">Kun </span>
                {kanji.kunyomi.join("、")}
              </div>
            )}
          </div>
        )}

        {kanji.meanings.length > 0 && <div className="text-xs text-muted-foreground">{kanji.meanings.join(", ")}</div>}

        {(stats.length > 0 || kanji.tags.length > 0) && (
          <div className="flex flex-wrap items-center gap-1">
            {stats.map((s) => (
              <span key={s.label} className="rounded-sm border border-border/60 px-1 py-px text-[10px] text-muted-foreground">
                {s.label} {String(s.value)}
              </span>
            ))}
            <TagBadges tags={kanji.tags} />
          </div>
        )}

        {kanji.frequencies.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {kanji.frequencies.map((f) => (
              <span
                key={f.dictId}
                title={f.dictTitle}
                className="inline-flex items-center gap-1 rounded-sm border border-border/60 px-1 py-px text-[10px] text-muted-foreground"
              >
                <span className="max-w-24 truncate opacity-70">{f.dictTitle}</span>
                <span className="tabular-nums">{f.displayValue ?? String(f.value)}</span>
              </span>
            ))}
          </div>
        )}

        <div className="text-[10px] uppercase tracking-wide text-muted-foreground/50">{kanji.dictTitle}</div>
      </div>
    </div>
  );
}
