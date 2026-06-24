/**
 * Small presentation helpers shared by the library views.
 */

export type ReadingStatus = "unread" | "reading" | "finished";

/**
 * Derives a reading status from a book's progress. There is no separate status
 * column — `progress` (0..1) is the single source of truth: 0 = untouched,
 * (near-)1 = read through, anything between = in progress.
 */
export function readingStatus(book: { progress?: number } | null | undefined): ReadingStatus {
  const p = book?.progress ?? 0;
  if (p <= 0) return "unread";
  if (p >= 0.99) return "finished";
  return "reading";
}

export const STATUS_LABELS: Record<ReadingStatus, string> = {
  unread: "Unread",
  reading: "Reading",
  finished: "Finished",
};

/** A compact, human relative time ("just now", "3d ago"). Null for falsy ts. */
export function relativeTime(ts: number | null | undefined): string | null {
  if (!ts) return null;
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.round(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(day / 365)}y ago`;
}
