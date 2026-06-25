import { useLayoutEffect, useRef, useState } from "react";
import type { LookupResult } from "@/lib/types";

/**
 * Floating dictionary popup, anchored to the matched run under the cursor
 * (Yomitan-style — not a click-triggered modal). The reader hands it the lookup
 * result and the matched run's bounding box; the popup positions itself just
 * below that box, flipping above and clamping to the viewport when it would
 * overflow. It is non-interactive for the page (pointer events only matter for
 * scrolling its own long content), so it never steals the reader's hover.
 *
 * Rendered nothing when there is no result, so the reader can keep it mounted
 * and just feed it state.
 */

const GAP = 6; // px between the matched word and the popup
const MARGIN = 8; // min gap from the viewport edge

interface Props {
  result: LookupResult | null;
  /** Bounding box of the matched run, in viewport coordinates. */
  anchor: DOMRect | null;
}

export function DictionaryPopup({ result, anchor }: Props) {
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
  }, [result, anchor]);

  if (!result || !result.entries.length || !anchor) return null;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Dictionary"
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
              <span className="text-base leading-none font-medium">{entry.expression}</span>
              {entry.reading && entry.reading !== entry.expression && (
                <span className="text-xs text-muted-foreground">【{entry.reading}】</span>
              )}
              {entry.reasons.length > 0 && (
                <span className="text-[10px] text-muted-foreground">{entry.reasons.join(" › ")}</span>
              )}
            </div>

            {entry.byDict.map((group) => (
              <div key={group.dictId} className="mt-2 space-y-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{group.dictTitle}</span>
                  {group.tags && <span className="text-[10px] text-muted-foreground/70">{group.tags}</span>}
                </div>
                {group.glosses.length === 1 ? (
                  <p className="text-xs leading-snug">{group.glosses[0]}</p>
                ) : (
                  <ol className="ml-4 list-decimal space-y-0.5 text-xs leading-snug marker:text-muted-foreground/60">
                    {group.glosses.map((g, gi) => (
                      <li key={gi}>{g}</li>
                    ))}
                  </ol>
                )}
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
