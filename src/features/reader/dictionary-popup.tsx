import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Check, Loader2, Plus, Volume2 } from "lucide-react";
import type { DictionaryEntry, LookupResult } from "@/lib/types";
import type { MineStatus } from "@/lib/dictionary/anki-note";
import { useAnchoredPosition } from "./use-anchored-position";
import { downstepNumber } from "@/lib/dictionary/pitch";
import { distributeFurigana } from "@/lib/dictionary/furigana";
import { DICT_SCOPE_ATTR } from "@/lib/dictionary/dict-styles";
import { StructuredGloss } from "./structured-gloss";
import { PitchAccent } from "./pitch-accent";
import { KanjiCard } from "./kanji-card";
import { TagBadges } from "./dictionary-tags";

// Child selectors giving structured-content glosses sensible defaults (list
// markers, table borders) outside the reader's shadow root; the dictionary's
// own inline styles still apply on top.
const GLOSS_CLASS =
  "text-xs leading-snug [&_ul]:ml-4 [&_ul]:list-disc [&_ol]:ml-4 [&_ol]:list-decimal " +
  "[&_li]:my-0.5 [&_table]:my-1 [&_table]:border-collapse [&_td]:border [&_td]:border-border " +
  "[&_td]:px-1 [&_th]:border [&_th]:border-border [&_th]:px-1 [&_rt]:text-[0.6em] " +
  "marker:text-muted-foreground/60";

// A dictionary's own styles.css references these vars (with hard-coded fallbacks)
// for colours sized to the reading theme; bind them to the popup's text colour so
// themed boxes (xref, example sentences) adapt to light/dark instead of using #333.
const GLOSS_VARS = { "--text-color": "currentColor" } as CSSProperties;

/**
 * Floating Yomitan-style dictionary popup, anchored below the matched run's box
 * (flipping above / clamping to the viewport on overflow). Renders null with no
 * result, so the reader can keep it mounted and just feed it state.
 */

interface Props {
  result: LookupResult | null;
  /** Bounding box of the matched run, in viewport coordinates. */
  anchor: DOMRect | null;
  /** Cursor entered the popup (the reader keeps it alive so its content can be scrolled). */
  onMouseEnter?: () => void;
  /** Cursor left the popup (the reader schedules its dismissal). */
  onMouseLeave?: () => void;
  /** Reports the popup's final viewport box after each placement (for the sticky zone). */
  onLayout?: (rect: { left: number; top: number; right: number; bottom: number }) => void;
  /** Mines an entry to Anki. Absent (or returning) hides the per-entry Anki button. */
  onMine?: (entry: DictionaryEntry) => Promise<MineStatus>;
  /** Reads a headword aloud (its reading). Absent hides the per-entry speaker button. */
  onSpeak?: (text: string) => void;
  /** Kept mounted but visually hidden while a mining screenshot is captured, so
   *  the popup doesn't occlude the sentence in the image. */
  hiddenForCapture?: boolean;
}

/** Per-entry "Add to Anki" button, reflecting the mining outcome. */
function MineButton({ status, onClick }: { status?: MineStatus | "loading"; onClick: () => void }) {
  const done = status === "added" || status === "duplicate";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={status === "loading" || done}
      title={done ? (status === "duplicate" ? "Already in Anki" : "Added to Anki") : "Add to Anki"}
      className="inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-60"
    >
      {status === "loading" ? <Loader2 className="size-3 animate-spin" /> : done ? <Check className="size-3" /> : <Plus className="size-3" />}
      Anki
    </button>
  );
}

/** Compact speaker button that reads a piece of text aloud. */
function SpeakButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="inline-flex shrink-0 items-center rounded-sm border p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
    >
      <Volume2 className="size-3" />
    </button>
  );
}

/**
 * Headword with its reading as furigana, distributed per-segment so only kanji
 * runs carry furigana; kana/okurigana (and kana-only headwords) stay bare.
 */
function Furigana({ expression, reading }: { expression: string; reading: string }) {
  const segments = useMemo(() => distributeFurigana(expression, reading || expression), [expression, reading]);
  return (
    <span className="text-base leading-tight font-medium">
      {segments.map((seg, i) =>
        seg.reading ? (
          <ruby key={i}>
            {seg.text}
            <rt className="text-[0.62em] font-normal text-foreground/75">{seg.reading}</rt>
          </ruby>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </span>
  );
}

export function DictionaryPopup({ result, anchor, onMouseEnter, onMouseLeave, onLayout, onMine, onSpeak, hiddenForCapture }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = useAnchoredPosition(ref, anchor, result, onLayout);
  // Per-entry mining status, reset whenever the looked-up word changes.
  const [mined, setMined] = useState<Record<number, MineStatus | "loading">>({});
  useEffect(() => setMined({}), [result]);

  if (!result || (!result.entries.length && !result.kanji.length) || !anchor) return null;

  const mine = (entry: DictionaryEntry, i: number) => {
    if (!onMine) return;
    setMined((m) => ({ ...m, [i]: "loading" }));
    void onMine(entry).then((status) => setMined((m) => ({ ...m, [i]: status })));
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Dictionary"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: "fixed",
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: pos && !hiddenForCapture ? "visible" : "hidden",
      }}
      className="z-50 max-h-80 w-80 overflow-y-auto border bg-popover text-popover-foreground shadow-md"
    >
      <ul className="divide-y">
        {result.entries.map((entry, i) => (
          <li key={`${entry.expression}-${entry.reading ?? ""}-${i}`} className="p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <Furigana expression={entry.expression} reading={entry.reading ?? ""} />
                {entry.reasons.length > 0 && <span className="text-[10px] text-muted-foreground">{entry.reasons.join(" › ")}</span>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {onSpeak && <SpeakButton onClick={() => onSpeak(entry.reading || entry.expression)} title="Read word aloud" />}
                {onMine && <MineButton status={mined[i]} onClick={() => mine(entry, i)} />}
              </div>
            </div>

            {entry.frequencies.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {entry.frequencies.map((f) => (
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

            {entry.pitches.length > 0 && (
              <div className="mt-1.5 space-y-0.5">
                {entry.pitches.map((p, pi) => (
                  <div key={`${p.dictId}-${pi}`} className="flex items-center gap-2">
                    <PitchAccent reading={p.reading} position={p.position} />
                    <span className="text-[10px] text-muted-foreground tabular-nums">[{downstepNumber(p.position)}]</span>
                    <span className="max-w-24 truncate text-[10px] text-muted-foreground/60" title={p.dictTitle}>
                      {p.dictTitle}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {entry.byDict.map((group) => (
              <div key={group.dictId} className="mt-2 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{group.dictTitle}</span>
                  <TagBadges tags={group.tags} />
                </div>
                <div className={GLOSS_CLASS} {...{ [DICT_SCOPE_ATTR]: group.dictId }} style={GLOSS_VARS}>
                  {group.glosses.length === 1 ? (
                    <StructuredGloss content={group.glosses[0]} dictId={group.dictId} />
                  ) : (
                    <ol className="ml-4 list-decimal space-y-0.5">
                      {group.glosses.map((g, gi) => (
                        <li key={gi}>
                          <StructuredGloss content={g} dictId={group.dictId} />
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            ))}
          </li>
        ))}
      </ul>

      {result.kanji.length > 0 && (
        <div className="space-y-3 border-t bg-muted/30 p-3">
          {result.kanji.map((k, i) => (
            <KanjiCard key={`${k.dictId}-${k.character}-${i}`} kanji={k} />
          ))}
        </div>
      )}
    </div>
  );
}
