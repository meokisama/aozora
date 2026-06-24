import { useCallback, useEffect, useRef } from "react";

/**
 * Tracks reading sessions for the stats page, mirroring how ッツ (ttu) Reader
 * does it (see ttsu/.../book-reading-tracker.svelte). The key idea — and the fix
 * for the naive "sum every forward delta" approach — is to SAMPLE the reading
 * position on a fixed 1-second tick rather than accumulate on every scroll/flip
 * event:
 *
 *   - characters: each tick counts the NET position change since the last tick
 *     (current − last). Because it's based on absolute position, scrolling
 *     forward then back within a tick cancels out, and re-reading a passage
 *     doesn't double-count (the signed sum telescopes to end − start). Backward
 *     movement counts negative (clamped so a session never goes below 0).
 *   - skip threshold: if a single tick's net move is ≥ SKIP_THRESHOLD it's a
 *     navigation jump (TOC, search, fast multi-page flipping) — ignored, not
 *     counted, and the baseline resyncs. This is what stops "flip pages quickly"
 *     from inflating the character count.
 *   - time: each tick adds the elapsed second, but only while the reader is
 *     active — the window is visible and there has been input within IDLE_MS.
 *     Idle / hidden time is not counted.
 *
 * The reader feeds the latest position via `mark(pos, isFixed)`; the tick does
 * the accounting. Fixed-layout (manga) positions are page ordinals, not
 * characters, so those sessions record time only (charsRead stays 0).
 */

const TICK_MS = 1000;
const IDLE_MS = 180_000; // no input for this long ⇒ stop counting time (AFK)
const SKIP_THRESHOLD = 2700; // per-tick net move ≥ this ⇒ navigation, not reading (ttu default)
const MAX_TICK_MS = 5 * TICK_MS; // cap a single tick's time (guards against timer stalls)

export function useReadingSession(bookId) {
  const ref = useRef({ active: false });

  const begin = (pos, isFixed, now) => {
    ref.current = {
      active: true,
      bookId,
      isFixed,
      startedAt: now,
      lastTickAt: now,
      lastActivityAt: now,
      activeMs: 0,
      charsAccum: 0,
      currentPos: pos,
      lastPos: pos,
    };
  };

  const flush = useCallback(() => {
    const s = ref.current;
    if (!s.active) return;
    s.active = false;
    if (s.activeMs < 1000 && s.charsAccum <= 0) return;
    window.electronAPI.stats
      .recordSession({
        bookId: s.bookId ?? null,
        startedAt: s.startedAt,
        endedAt: s.lastActivityAt,
        durationMs: s.activeMs,
        charsRead: s.charsAccum,
      })
      .catch(() => {});
  }, []);

  // Position/activity feed from the reader. Only records the latest position and
  // marks activity; the tick (below) turns it into time + characters.
  const mark = useCallback(
    (pos, isFixed = false) => {
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

    if (!s.isFixed) {
      const diff = s.currentPos - s.lastPos;
      if (Math.abs(diff) >= SKIP_THRESHOLD) {
        s.lastPos = s.currentPos; // navigation jump — resync, don't count
      } else {
        s.charsAccum = Math.max(0, s.charsAccum + diff);
        s.lastPos = s.currentPos;
      }
    }
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
