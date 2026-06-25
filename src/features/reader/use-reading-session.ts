import { useCallback, useEffect, useRef } from "react";
import { type SessionAccumulator, createAccumulator, advance } from "@/lib/stats/session-tracker";

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
 *   - characters: on each active tick the latest position is handed to
 *     `advance()`, which decides how much (if any) to credit.
 *
 * The reader feeds the latest position via `mark(pos, isFixed)`; the tick does
 * the accounting. Fixed-layout (manga) positions are page ordinals, not
 * characters, so those sessions record time only (charsRead stays 0).
 */

interface Session {
  active: boolean;
  bookId: string | null;
  isFixed: boolean;
  startedAt: number;
  lastTickAt: number;
  lastActivityAt: number;
  activeMs: number;
  currentPos: number;
  acc: SessionAccumulator;
}

const IDLE_SESSION: Session = {
  active: false,
  bookId: null,
  isFixed: false,
  startedAt: 0,
  lastTickAt: 0,
  lastActivityAt: 0,
  activeMs: 0,
  currentPos: 0,
  acc: createAccumulator(0),
};

const TICK_MS = 1000;
const IDLE_MS = 180_000; // no input for this long ⇒ stop counting time (AFK)
const MAX_TICK_MS = 5 * TICK_MS; // cap a single tick's time (guards against timer stalls)

export function useReadingSession(bookId?: string | null) {
  const ref = useRef<Session>({ ...IDLE_SESSION });

  const begin = (pos: number, isFixed: boolean, now: number) => {
    ref.current = {
      active: true,
      bookId: bookId ?? null,
      isFixed,
      startedAt: now,
      lastTickAt: now,
      lastActivityAt: now,
      activeMs: 0,
      currentPos: pos,
      acc: createAccumulator(pos),
    };
  };

  const flush = useCallback(() => {
    const s = ref.current;
    if (!s.active) return;
    s.active = false;
    if (s.activeMs < 1000 && s.acc.charsAccum <= 0) return;
    window.electronAPI.stats
      .recordSession({
        bookId: s.bookId ?? null,
        startedAt: s.startedAt,
        endedAt: s.lastActivityAt,
        durationMs: s.activeMs,
        charsRead: s.acc.charsAccum,
      })
      .catch(() => {});
  }, []);

  // Position/activity feed from the reader. Only records the latest position and
  // marks activity; the tick (below) turns it into time + characters.
  const mark = useCallback(
    (pos: number, isFixed = false) => {
      if (!bookId) return;
      const s = ref.current;
      const now = Date.now();
      if (!s.active) {
        begin(pos, isFixed, now);
        return;
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

    // Character accounting (text layout only — manga positions are page ordinals).
    // The state machine decides reading vs scrolling and how much to credit.
    if (!s.isFixed) s.acc = advance(s.acc, s.currentPos);
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
