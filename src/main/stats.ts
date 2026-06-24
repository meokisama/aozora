import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { libraryStore } from "./services/library-store.js";
import type { ReadingSession } from "@/lib/types";

/**
 * Reading-stats IPC. The renderer's reader records sessions as the user reads;
 * the stats page reads the aggregates back. All heavy grouping happens in
 * SQLite (see library-store.js); the renderer only derives streaks/heatmap
 * geometry from the returned arrays.
 */
export const registerStatsIpc = (): void => {
  // Persist one completed reading session. Skips no-op sessions (a book opened
  // and closed immediately) so they don't pollute the heatmap / session count.
  ipcMain.handle("stats:record-session", (_event, session: ReadingSession) => {
    const durationMs = Math.round(session?.durationMs ?? 0);
    const charsRead = Math.round(session?.charsRead ?? 0);
    if (durationMs < 1000 && charsRead <= 0) return false;
    libraryStore.recordSession({
      id: randomUUID(),
      bookId: session.bookId ?? null,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      durationMs,
      charsRead,
    });
    return true;
  });

  // One round-trip returns everything the stats page needs.
  ipcMain.handle("stats:get", () => ({
    overview: libraryStore.getStatsOverview(),
    daily: libraryStore.getDailyActivity(),
    hourly: libraryStore.getHourlyActivity(),
    perBook: libraryStore.getPerBookStats(),
  }));
};
