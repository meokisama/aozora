import { describe, it, expect } from "vitest";
import { toDayKey, shiftDay, computeStreaks, buildHeatmapWeeks, intensityLevel, tierStatus, formatDuration, formatCompact } from "@/lib/stats/aggregate";

describe("toDayKey / shiftDay", () => {
  it("formats a local date as YYYY-MM-DD", () => {
    expect(toDayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toDayKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("shifts across month and year boundaries", () => {
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDay("2026-02-28", 1)).toBe("2026-03-01"); // 2026 is not a leap year
    expect(shiftDay("2024-02-28", 1)).toBe("2024-02-29"); // 2024 is
    expect(shiftDay("2026-06-15", 0)).toBe("2026-06-15");
  });
});

describe("computeStreaks", () => {
  it("returns zeros for no activity", () => {
    expect(computeStreaks([], "2026-06-24")).toEqual({ current: 0, longest: 0 });
  });

  it("counts a current streak ending today", () => {
    const days = ["2026-06-22", "2026-06-23", "2026-06-24"];
    expect(computeStreaks(days, "2026-06-24")).toEqual({ current: 3, longest: 3 });
  });

  it("keeps the current streak alive when today is idle but yesterday was active", () => {
    const days = ["2026-06-22", "2026-06-23"];
    expect(computeStreaks(days, "2026-06-24").current).toBe(2);
  });

  it("breaks the current streak after a full missed day", () => {
    const days = ["2026-06-20", "2026-06-21"];
    expect(computeStreaks(days, "2026-06-24").current).toBe(0);
  });

  it("finds the longest run even when it is not the current one", () => {
    const days = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-06-24"];
    expect(computeStreaks(days, "2026-06-24")).toEqual({ current: 1, longest: 4 });
  });

  it("ignores duplicate / unordered input", () => {
    const days = ["2026-06-24", "2026-06-22", "2026-06-23", "2026-06-24"];
    expect(computeStreaks(days, "2026-06-24")).toEqual({ current: 3, longest: 3 });
  });
});

describe("buildHeatmapWeeks", () => {
  it("covers every day of the year with correct weekday rows", () => {
    const weeks = buildHeatmapWeeks(2026, new Map());
    const cells = weeks.flat().filter(Boolean);
    // 2026 is a common year.
    expect(cells).toHaveLength(365);
    expect(cells[0]!.day).toBe("2026-01-01");
    expect(cells[cells.length - 1]!.day).toBe("2026-12-31");
  });

  it("pads days before Jan 1 with null and aligns weekday index", () => {
    const weeks = buildHeatmapWeeks(2026, new Map());
    // Jan 1 2026 is a Thursday (weekday index 4), so rows 0–3 of week 0 are pad.
    expect(weeks[0].slice(0, 4)).toEqual([null, null, null, null]);
    expect(weeks[0][4]!.day).toBe("2026-01-01");
  });

  it("merges per-day values into the matching cell", () => {
    const values = new Map([["2026-01-01", { chars: 5000, ms: 600000, sessions: 2, books: 1 }]]);
    const weeks = buildHeatmapWeeks(2026, values);
    expect(weeks[0][4]).toMatchObject({ day: "2026-01-01", chars: 5000, sessions: 2 });
  });
});

describe("intensityLevel", () => {
  it("returns 0 for no value or no max", () => {
    expect(intensityLevel(0, 100)).toBe(0);
    expect(intensityLevel(50, 0)).toBe(0);
  });

  it("buckets into 1–4 by ratio to max", () => {
    expect(intensityLevel(5, 100)).toBe(1); // <=10%
    expect(intensityLevel(20, 100)).toBe(2); // 10–33%
    expect(intensityLevel(50, 100)).toBe(3); // 33–66%
    expect(intensityLevel(90, 100)).toBe(4); // >66%
  });
});

describe("tierStatus", () => {
  const tiers = [10, 50, 100, 500];

  it("marks reached thresholds and finds the next unmet one", () => {
    const s = tierStatus(120, tiers);
    expect(s.achievedCount).toBe(3);
    expect(s.next).toBe(500);
    expect(s.tiers.map((t) => t.achieved)).toEqual([true, true, true, false]);
  });

  it("returns next = first threshold when nothing is reached", () => {
    expect(tierStatus(0, tiers)).toMatchObject({ achievedCount: 0, next: 10 });
  });

  it("returns next = null when everything is reached", () => {
    expect(tierStatus(1000, tiers)).toMatchObject({ achievedCount: 4, next: null });
  });
});

describe("formatDuration", () => {
  it("formats h/m/s compactly", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(12 * 60_000)).toBe("12m");
    expect(formatDuration((3 * 3600 + 24 * 60) * 1000)).toBe("3h 24m");
  });
});

describe("formatCompact", () => {
  it("abbreviates thousands and millions", () => {
    expect(formatCompact(942)).toBe("942");
    expect(formatCompact(12_300)).toBe("12.3k");
    expect(formatCompact(1_000)).toBe("1k");
    expect(formatCompact(1_200_000)).toBe("1.2M");
  });
});
