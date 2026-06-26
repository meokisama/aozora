/**
 * Pure derivation over the main process's per-day/-hour/-book SQL sums:
 * streaks, the GitHub-style heatmap grid, intensity bucketing and formatting.
 * Day keys are local-calendar 'YYYY-MM-DD', matching SQLite date(…,'localtime').
 */

export interface DayValue {
  chars?: number;
  ms?: number;
  sessions?: number;
  books?: number;
}

export interface HeatmapCell {
  day: string;
  chars: number;
  ms: number;
  sessions: number;
  books: number;
}

/** Formats a Date as a local-calendar 'YYYY-MM-DD' key. */
export function toDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Returns the day key `delta` days away from `key` (handles month/year roll). */
export function shiftDay(key: string, delta: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return toDayKey(new Date(y, m - 1, d + delta));
}

/**
 * Current and longest run of consecutive active days.
 * - `longest`: the longest consecutive span anywhere in the history.
 * - `current`: the run ending today, or ending yesterday if today is idle
 *   (so the streak doesn't read as broken until a full day is missed).
 */
export function computeStreaks(activeDays: Iterable<string>, todayKey: string): { current: number; longest: number } {
  const set = activeDays instanceof Set ? (activeDays as Set<string>) : new Set(activeDays);
  if (set.size === 0) return { current: 0, longest: 0 };

  let longest = 0;
  for (const day of set) {
    if (set.has(shiftDay(day, -1))) continue; // not the start of a run
    let len = 1;
    let cursor = day;
    while (set.has(shiftDay(cursor, 1))) {
      len += 1;
      cursor = shiftDay(cursor, 1);
    }
    longest = Math.max(longest, len);
  }

  let cursor: string | null = set.has(todayKey) ? todayKey : set.has(shiftDay(todayKey, -1)) ? shiftDay(todayKey, -1) : null;
  let current = 0;
  while (cursor && set.has(cursor)) {
    current += 1;
    cursor = shiftDay(cursor, -1);
  }

  return { current, longest };
}

/**
 * GitHub-style calendar grid: week columns, each 7 cells indexed by weekday
 * (0 = Sunday … 6 = Saturday). Out-of-year pad cells are `null`; in-year cells
 * carry the day key merged with `valueByDay` (or zeros).
 */
export function buildHeatmapWeeks(year: number, valueByDay: Map<string, DayValue> | Record<string, DayValue>): (HeatmapCell | null)[][] {
  const map = valueByDay instanceof Map ? valueByDay : new Map(Object.entries(valueByDay || {}));
  const weeks: (HeatmapCell | null)[][] = [];
  // Back up to the Sunday on/before Jan 1 so column 0 starts on a Sunday.
  const firstDow = new Date(year, 0, 1).getDay();
  let cursor = new Date(year, 0, 1 - firstDow);
  const end = new Date(year, 11, 31);

  while (cursor <= end) {
    const week: (HeatmapCell | null)[] = [];
    for (let d = 0; d < 7; d += 1) {
      if (cursor.getFullYear() === year) {
        const key = toDayKey(cursor);
        const v = map.get(key);
        week.push({ day: key, chars: v?.chars || 0, ms: v?.ms || 0, sessions: v?.sessions || 0, books: v?.books || 0 });
      } else {
        week.push(null);
      }
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** Buckets a value into a 0–4 intensity level relative to `max` (heatmap shade). */
export function intensityLevel(value: number, max: number): number {
  if (!value || max <= 0) return 0;
  const r = value / max;
  if (r > 0.66) return 4;
  if (r > 0.33) return 3;
  if (r > 0.1) return 2;
  return 1;
}

/** "3h 24m" / "12m" / "45s" — compact human duration from milliseconds. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round((ms || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/**
 * Milestone progress for one metric: which thresholds are reached and the next
 * unmet one. `thresholds` must be ascending. Used for the achievement badges.
 */
export function tierStatus(
  value: number,
  thresholds: number[],
): { tiers: { threshold: number; achieved: boolean }[]; next: number | null; achievedCount: number } {
  const tiers = thresholds.map((threshold) => ({ threshold, achieved: value >= threshold }));
  const next = thresholds.find((t) => value < t) ?? null;
  return { tiers, next, achievedCount: tiers.filter((t) => t.achieved).length };
}

/** "1.2M" / "12.3k" / "942" — compact count formatting. */
export function formatCompact(n: number): string {
  const v = Math.round(n || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(v);
}
