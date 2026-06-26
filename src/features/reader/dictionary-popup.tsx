import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LookupResult } from "@/lib/types";
import { downstepNumber } from "@/lib/dictionary/pitch";
import { distributeFurigana } from "@/lib/dictionary/furigana";
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

/**
 * Floating Yomitan-style dictionary popup, anchored below the matched run's box
 * (flipping above / clamping to the viewport on overflow). Renders null with no
 * result, so the reader can keep it mounted and just feed it state.
 */

const GAP = 6; // px between the matched word and the popup
const MARGIN = 8; // min gap from the viewport edge

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

export function DictionaryPopup({ result, anchor, onMouseEnter, onMouseLeave, onLayout }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Measure the popup after it renders and place it against the anchor box,
  // flipping above the word when there isn't room below, then clamping to the
  // viewport on both axes.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) {
      setPos(null);
      return;
    }
    const { offsetWidth: w, offsetHeight: h } = el;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = anchor.bottom + GAP;
    if (top + h > vh - MARGIN && anchor.top - GAP - h >= MARGIN) {
      top = anchor.top - GAP - h; // flip above
    }
    top = Math.max(MARGIN, Math.min(top, vh - h - MARGIN));

    let left = anchor.left;
    left = Math.max(MARGIN, Math.min(left, vw - w - MARGIN));

    setPos({ left, top });
    onLayout?.({ left, top, right: left + w, bottom: top + h });
  }, [result, anchor, onLayout]);

  if (!result || (!result.entries.length && !result.kanji.length) || !anchor) return null;

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
        visibility: pos ? "visible" : "hidden",
      }}
      className="z-50 max-h-80 w-80 overflow-y-auto border bg-popover text-popover-foreground shadow-md"
    >
      <ul className="divide-y">
        {result.entries.map((entry, i) => (
          <li key={`${entry.expression}-${entry.reading ?? ""}-${i}`} className="p-3">
            <div className="flex items-baseline gap-2">
              <Furigana expression={entry.expression} reading={entry.reading ?? ""} />
              {entry.reasons.length > 0 && <span className="text-[10px] text-muted-foreground">{entry.reasons.join(" › ")}</span>}
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
                <div className={GLOSS_CLASS}>
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
