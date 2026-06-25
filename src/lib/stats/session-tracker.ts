/**
 * Reading-vs-scrolling accounting for the stats page — the layout-independent
 * core of the 1-second sampler in features/reader/use-reading-session.ts, split
 * out so it can be unit-tested (see test/lib/stats/session-tracker.test.js).
 *
 * The naive "sum every forward delta" approach counts fast scrolling as reading.
 * A pure per-tick speed cap is better but still credits sustained slow-ish
 * scrolling forever. The robust distinction is behavioural: real reading has a
 * dwell structure (pause — advance — pause), whereas scrolling is sustained
 * motion. So this is a two-state machine with hysteresis, sampled once per
 * active second (`advance` is called only on ticks the reader is visible + not
 * idle — idle/hidden time never reaches here):
 *
 *   READING   — position advances within human reading speed. Credit the net
 *               forward move, capped at READ_CAP chars/tick so a fast flick
 *               inside the reading band can't inflate the count. Small backward
 *               moves subtract (telescoping), so re-reading a passage doesn't
 *               double-count and scroll-forward-then-back cancels.
 *   SCROLLING — entered the instant a tick's speed exceeds SCROLL_ENTER (or on a
 *               JUMP, a TOC/search teleport). Credits NOTHING, for as long as it
 *               lasts — this is what stops "scroll continuously" from counting.
 *               The position baseline is resynced every tick, so the scrolled
 *               distance is never credited retroactively. Returns to READING
 *               only after the speed settles below SETTLE for SETTLE_TICKS
 *               consecutive seconds — i.e. the reader actually paused to read.
 *
 * Fixed-layout (manga) positions are page ordinals, not characters, so those
 * sessions don't use this at all (charsRead stays 0); see the hook.
 */

export type ReadState = "reading" | "scrolling";

export interface SessionAccumulator {
  state: ReadState;
  charsAccum: number;
  lastPos: number;
  /** consecutive settled (slow) ticks while SCROLLING, toward resuming READING */
  settleStreak: number;
}

export interface TrackerConfig {
  /** per-tick |Δ| ≥ this ⇒ navigation teleport (TOC/search/fast multi-flip) */
  jumpThreshold: number;
  /** in READING, speed > this ⇒ this is scrolling, switch state, credit 0 */
  scrollEnter: number;
  /** in SCROLLING, speed ≤ this counts as a settled (paused-to-read) tick */
  settleSpeed: number;
  /** consecutive settled ticks required to resume READING (dwell-to-resume) */
  settleTicks: number;
  /** max chars credited in a single READING tick (human reading-speed ceiling) */
  readCap: number;
}

/**
 * Tuned for Japanese prose (chars ≈ position units). Fast JP reading is ~10–12
 * chars/s; READ_CAP = 50 leaves generous headroom so genuine fast reading is
 * never clipped, while SCROLL_ENTER = 150 (9000/min — unreadable) reliably flags
 * scrolling. SETTLE = 60 ≥ READ_CAP so normal reading counts as "settled" and
 * can resume crediting after a scroll.
 */
export const DEFAULT_TRACKER_CONFIG: TrackerConfig = {
  jumpThreshold: 2700,
  scrollEnter: 150,
  settleSpeed: 60,
  settleTicks: 2,
  readCap: 50,
};

/** Fresh accumulator anchored at the position where the session began. */
export function createAccumulator(pos: number): SessionAccumulator {
  return { state: "reading", charsAccum: 0, lastPos: pos, settleStreak: 0 };
}

/**
 * Advances the accumulator by one active sampling tick to the absolute position
 * `pos`. Pure: returns a new accumulator, never mutates the input. Call once per
 * active second (the caller gates out idle/hidden time before calling).
 */
export function advance(
  acc: SessionAccumulator,
  pos: number,
  config: TrackerConfig = DEFAULT_TRACKER_CONFIG,
): SessionAccumulator {
  const delta = pos - acc.lastPos;
  const speed = Math.abs(delta);
  let state = acc.state;
  let settleStreak = acc.settleStreak;
  let credited = 0;

  if (speed >= config.jumpThreshold) {
    // Teleport (TOC/search/bookmark) — never reading. Force scrolling so the
    // reader must settle before crediting resumes; nothing credited.
    state = "scrolling";
    settleStreak = 0;
  } else if (state === "scrolling") {
    // Mid-scroll: credit nothing. Only resume reading once the motion has been
    // slow for SETTLE_TICKS consecutive seconds (the reader paused to read).
    if (speed <= config.settleSpeed) {
      settleStreak += 1;
      if (settleStreak >= config.settleTicks) {
        state = "reading";
        settleStreak = 0;
      }
    } else {
      settleStreak = 0;
    }
  } else {
    // READING.
    if (speed > config.scrollEnter) {
      state = "scrolling"; // a fast flick — switch and credit nothing this tick
      settleStreak = 0;
    } else {
      // Within the reading band: telescope (backward subtracts so re-reads don't
      // double-count) but cap forward progress so a quick flick can't inflate.
      credited = delta > 0 ? Math.min(delta, config.readCap) : delta;
    }
  }

  return {
    state,
    charsAccum: Math.max(0, acc.charsAccum + credited),
    lastPos: pos, // always resync ⇒ scrolled distance is never credited later
    settleStreak,
  };
}
