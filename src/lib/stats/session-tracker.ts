/**
 * Reading-vs-scrolling accounting — layout-independent core of the 1s sampler in
 * features/reader/use-reading-session.ts. Reading has a dwell structure
 * (pause-advance-pause); scrolling is sustained motion. So: a two-state machine
 * with hysteresis, sampled once per active second (idle/hidden ticks never reach
 * `advance`):
 *
 *   READING   — credit the net forward move, capped at READ_CAP/tick so a fast
 *               flick can't inflate. Backward moves subtract (telescoping), so
 *               re-reads don't double-count and scroll-forward-then-back cancels.
 *   SCROLLING — entered when a tick exceeds SCROLL_ENTER (or on a JUMP teleport).
 *               Credits nothing while it lasts; baseline resyncs every tick so
 *               scrolled distance is never credited retroactively. Resumes
 *               READING only after speed stays below SETTLE for SETTLE_TICKS
 *               consecutive seconds (the reader actually paused to read).
 *
 * Fixed-layout (manga) positions are page ordinals, not chars, so those sessions
 * don't use this (charsRead stays 0); see the hook.
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
 * Tuned for Japanese prose (chars ≈ position units). Fast JP reading ~10–12
 * chars/s, so READ_CAP=50 never clips genuine reading while SCROLL_ENTER=150
 * (9000/min — unreadable) reliably flags scrolling. SETTLE=60 ≥ READ_CAP so
 * normal reading counts as settled and can resume crediting after a scroll.
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
export function advance(acc: SessionAccumulator, pos: number, config: TrackerConfig = DEFAULT_TRACKER_CONFIG): SessionAccumulator {
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

/**
 * Paginated-mode accounting. EVENT-driven (not sampled per second like
 * `advance`): position is static on a page then jumps a whole page span on flip,
 * which the per-tick sampler can't credit (every flip looks like scrolling,
 * every dwell tick has delta 0) — that's why charsRead was always 0 here.
 *
 * Instead, credit on the flip: the span of the page just finished, only when
 * dwelled on long enough (gates skim-flipping) and the move isn't a teleport or
 * backward re-read. `dwellMs` is ACTIVE time on the page just left (caller
 * excludes idle/hidden).
 */
export interface PaginatedAccumulator {
  charsAccum: number;
  lastPos: number;
}

export interface PaginatedConfig {
  /** |Δ| ≥ this ⇒ navigation teleport (TOC/search/bookmark) — resync, credit 0 */
  jumpThreshold: number;
  /** must dwell at least this many active ms on a page before its span counts */
  minDwellMs: number;
}

/** Shares `jumpThreshold` with the continuous tracker; ~3s dwell gates skimming. */
export const DEFAULT_PAGINATED_CONFIG: PaginatedConfig = {
  jumpThreshold: DEFAULT_TRACKER_CONFIG.jumpThreshold,
  minDwellMs: 3000,
};

/** Fresh paginated accumulator anchored at the page the session began on. */
export function createPaginatedAccumulator(pos: number): PaginatedAccumulator {
  return { charsAccum: 0, lastPos: pos };
}

/**
 * Advances the paginated accumulator on a page-flip to absolute char offset
 * `pos` (the cumulative offset at the start of the newly-shown page). Pure:
 * returns a new accumulator, never mutates the input. Call once per flip event.
 */
export function advancePaginated(
  acc: PaginatedAccumulator,
  pos: number,
  dwellMs: number,
  config: PaginatedConfig = DEFAULT_PAGINATED_CONFIG,
): PaginatedAccumulator {
  const delta = pos - acc.lastPos;
  // Credit the finished page's span only for a forward flip that isn't a
  // teleport and was dwelled on long enough. Teleports, backward re-reads, and
  // skim-flips credit nothing but still resync, so skipped spans are never
  // credited retroactively on a later flip.
  const credited = delta > 0 && delta < config.jumpThreshold && dwellMs >= config.minDwellMs ? delta : 0;
  return {
    charsAccum: acc.charsAccum + credited,
    lastPos: pos,
  };
}
