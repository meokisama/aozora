import { useCallback, useEffect, useRef } from "react";
import {
  type SessionAccumulator,
  type PaginatedAccumulator,
  createAccumulator,
  createPaginatedAccumulator,
  advance,
  advancePaginated,
} from "@/lib/stats/session-tracker";

/**
 * The reader's three layout modes feed position differently, so character
 * accounting branches on this: `continuous` is sampled per tick by `advance`,
 * `paginated` is credited per flip by `advancePaginated`, and `fixed` (manga)
 * records time only (positions are page ordinals, not characters).
 */
export type SessionMode = "continuous" | "paginated" | "fixed";

/**
 * Tracks reading sessions for the stats page. The position/character accounting
 * is SAMPLED on a fixed 1-second tick (rather than accumulated on every scroll/
 * flip event) and fed to the reading-vs-scrolling state machine in
 * lib/stats/session-tracker — see that file for the character-crediting rules
 * (READ_CAP, scroll detection, dwell-to-resume). This hook owns the parts that
 * need the DOM/timers:
 *
 *   - time: each tick adds the elapsed second, but only while the reader is
 *     active — the window is visible and there has been input within IDLE_MS.
 *     Idle / hidden time is not counted (and the char accumulator is not
 *     advanced on those ticks either, so its baseline resumes cleanly).
 *   - characters: how they're credited depends on the mode (see SessionMode) —
 *     `continuous` hands the latest position to `advance()` each active tick;
 *     `paginated` credits a finished page's span on the flip via
 *     `advancePaginated()`, gated on having dwelled on it long enough; `fixed`
 *     records no characters at all.
 *
 * The reader feeds the latest position via `mark(pos, mode)`; the tick does the
 * time accounting (and, for continuous, the character sampling).
 */

interface Session {
  active: boolean;
  bookId: string | null;
  mode: SessionMode;
  startedAt: number;
  lastTickAt: number;
  lastActivityAt: number;
  activeMs: number;
  currentPos: number;
  acc: SessionAccumulator;
  /** paginated only: span accounting credited on each flip */
  pacc: PaginatedAccumulator;
  /** paginated only: `activeMs` snapshot when the current page was entered, so a
   *  flip's dwell = activeMs − pageEnteredActiveMs (idle/hidden already excluded) */
  pageEnteredActiveMs: number;
}

const IDLE_SESSION: Session = {
  active: false,
  bookId: null,
  mode: "continuous",
  startedAt: 0,
  lastTickAt: 0,
  lastActivityAt: 0,
  activeMs: 0,
  currentPos: 0,
  acc: createAccumulator(0),
  pacc: createPaginatedAccumulator(0),
  pageEnteredActiveMs: 0,
};

const TICK_MS = 1000;
const IDLE_MS = 180_000; // no input for this long ⇒ stop counting time (AFK)
const MAX_TICK_MS = 5 * TICK_MS; // cap a single tick's time (guards against timer stalls)

export function useReadingSession(bookId?: string | null) {
  const ref = useRef<Session>({ ...IDLE_SESSION });

  const begin = (pos: number, mode: SessionMode, now: number) => {
    ref.current = {
      active: true,
      bookId: bookId ?? null,
      mode,
      startedAt: now,
      lastTickAt: now,
      lastActivityAt: now,
      activeMs: 0,
      currentPos: pos,
      acc: createAccumulator(pos),
      pacc: createPaginatedAccumulator(pos),
      pageEnteredActiveMs: 0,
    };
  };

  // Characters read come from whichever accumulator the mode uses.
  const charsReadOf = (s: Session) =>
    s.mode === "paginated" ? s.pacc.charsAccum : s.mode === "continuous" ? s.acc.charsAccum : 0;

  const flush = useCallback(() => {
    const s = ref.current;
    if (!s.active) return;
    s.active = false;
    const charsRead = charsReadOf(s);
    if (s.activeMs < 1000 && charsRead <= 0) return;
    window.electronAPI.stats
      .recordSession({
        bookId: s.bookId ?? null,
        startedAt: s.startedAt,
        endedAt: s.lastActivityAt,
        durationMs: s.activeMs,
        charsRead,
      })
      .catch(() => {});
  }, []);

  // Position/activity feed from the reader. Records the latest position and marks
  // activity. For paginated, a position change is a page flip, so the finished
  // page's span is credited here (event-driven); continuous defers to the tick.
  const mark = useCallback(
    (pos: number, mode: SessionMode = "continuous") => {
      if (!bookId) return;
      const s = ref.current;
      const now = Date.now();
      if (!s.active) {
        begin(pos, mode, now);
        return;
      }
      if (s.mode === "paginated" && pos !== s.currentPos) {
        // Flip: credit the page just left, gated on how long it was dwelled on
        // (active time only — idle/hidden never reached activeMs).
        s.pacc = advancePaginated(s.pacc, pos, s.activeMs - s.pageEnteredActiveMs);
        s.pageEnteredActiveMs = s.activeMs;
      }
      s.currentPos = pos;
      s.lastActivityAt = now;
    },
    [bookId],
  );

  // 1-second sampler: the single place time and characters are accrued.
  const tick = useCallback(() => {
    const s = ref.current;
    if (!s.active) return;
    const now = Date.now();
    const elapsed = now - s.lastTickAt;
    s.lastTickAt = now;

    // Don't count time while the window is hidden or the reader is idle. Leave
    // the position baseline untouched so reading resumes cleanly.
    if (document.hidden || now - s.lastActivityAt > IDLE_MS) return;

    s.activeMs += Math.min(elapsed, MAX_TICK_MS);

    // Continuous scrolling is sampled here (the state machine decides reading vs
    // scrolling). Paginated is credited per flip in `mark`; fixed counts no chars.
    if (s.mode === "continuous") s.acc = advance(s.acc, s.currentPos);
  }, []);

  useEffect(() => {
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [tick]);

  // Treat mouse / keyboard / wheel as activity too, so reading a single
  // paginated page (where the position is static until you flip) keeps the
  // session alive instead of tripping the idle cutoff.
  useEffect(() => {
    const onActivity = () => {
      if (ref.current.active) ref.current.lastActivityAt = Date.now();
    };
    window.addEventListener("pointermove", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    window.addEventListener("wheel", onActivity, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("wheel", onActivity);
    };
  }, []);

  // Flush when the book changes or the reader unmounts (the closing session
  // belongs to the previous book — its id is captured in the ref at begin).
  useEffect(() => flush, [bookId, flush]);

  // Flush on window close so app exit doesn't lose the open session.
  useEffect(() => {
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [flush]);

  return { mark, flush };
}
