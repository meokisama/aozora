import { describe, it, expect } from "vitest";
import {
  createAccumulator,
  advance,
  DEFAULT_TRACKER_CONFIG,
  type SessionAccumulator,
} from "@/lib/stats/session-tracker";

// Feed a sequence of absolute positions (one per active tick) through advance(),
// starting from a fresh accumulator anchored at `start`.
function run(positions: number[], start = 0): SessionAccumulator {
  return positions.reduce((acc, pos) => advance(acc, pos), createAccumulator(start));
}

describe("session-tracker: reading", () => {
  it("credits a steady, human-paced advance fully", () => {
    // 10 chars/tick — well within the reading band.
    const acc = run([10, 20, 30, 40, 50]);
    expect(acc.charsAccum).toBe(50);
    expect(acc.state).toBe("reading");
  });

  it("caps a single tick at READ_CAP so a quick flick can't inflate", () => {
    // 100 chars/tick is within the reading band (< scrollEnter) but above the
    // human reading ceiling, so each tick is clipped to READ_CAP (50).
    const acc = run([100, 200]);
    expect(acc.charsAccum).toBe(2 * DEFAULT_TRACKER_CONFIG.readCap);
    expect(acc.state).toBe("reading");
  });

  it("does not advance when the position is static", () => {
    const acc = run([0, 0, 0]);
    expect(acc.charsAccum).toBe(0);
  });
});

describe("session-tracker: scrolling", () => {
  it("credits nothing for continuous fast scrolling, however long", () => {
    // The core complaint: scroll non-stop and it should NOT count as reading.
    const acc = run([500, 1000, 1500, 2000, 2500]);
    expect(acc.charsAccum).toBe(0);
    expect(acc.state).toBe("scrolling");
  });

  it("treats a teleport (TOC/search jump) as navigation, not reading", () => {
    // Read a little, then jump past the jumpThreshold.
    const acc = run([20, 20 + DEFAULT_TRACKER_CONFIG.jumpThreshold]);
    expect(acc.charsAccum).toBe(20);
    expect(acc.state).toBe("scrolling");
  });

  it("treats a fast backward jump as scrolling, not negative reading", () => {
    const acc = run([200], 1000); // delta -800: |Δ| > scrollEnter
    expect(acc.charsAccum).toBe(0);
    expect(acc.state).toBe("scrolling");
  });
});

describe("session-tracker: hysteresis (dwell-to-resume)", () => {
  it("does not credit the scrolled distance, only reading after settling", () => {
    // Scroll fast (0→600), then slow down for settleTicks, then read.
    const acc = run([
      300, // → scrolling
      600, // scrolling
      610, // settled tick 1 (speed 10)
      620, // settled tick 2 → back to reading (this tick credits 0)
      630, // reading +10
      640, // reading +10
    ]);
    expect(acc.state).toBe("reading");
    expect(acc.charsAccum).toBe(20); // only the post-settle reading, not 0→600
  });

  it("requires a sustained pause: a single slow tick mid-scroll does not resume", () => {
    const acc = run([
      300, // scrolling
      305, // settled tick 1
      900, // fast again → streak resets, still scrolling
      905, // settled tick 1 again
    ]);
    expect(acc.state).toBe("scrolling");
    expect(acc.charsAccum).toBe(0);
  });
});

describe("session-tracker: telescoping (re-reads / jitter)", () => {
  it("cancels a forward-then-back move within the reading band", () => {
    const acc = run([40, 0]); // +40 then -40
    expect(acc.charsAccum).toBe(0);
  });

  it("never goes negative", () => {
    const acc = run([50], 100); // delta -50 within band
    expect(acc.charsAccum).toBe(0);
  });

  it("does not double-count a re-read passage", () => {
    // Read 0→50, scroll back to 0, read 0→50 again: the 50-char passage counts once.
    const acc = run([50, 0, 50]);
    expect(acc.charsAccum).toBe(50);
  });
});

describe("session-tracker: purity", () => {
  it("does not mutate the input accumulator", () => {
    const acc = createAccumulator(0);
    const next = advance(acc, 30);
    expect(acc.charsAccum).toBe(0);
    expect(acc.lastPos).toBe(0);
    expect(next).not.toBe(acc);
    expect(next.charsAccum).toBe(30);
  });
});
