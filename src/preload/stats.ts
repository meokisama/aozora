import { ipcRenderer } from "electron";
import type { ReadingSession } from "@/lib/types";

/**
 * Reading-stats API exposed as `window.electronAPI.stats`. The reader records
 * sessions; the stats page fetches the aggregates.
 */
export const statsApi = {
  /**
   * Records one completed reading session. No-op sessions are dropped by the
   * main process.
   */
  recordSession: (session: ReadingSession) => ipcRenderer.invoke("stats:record-session", session),

  /** Aggregated stats: { overview, daily[], hourly[], perBook[] }. */
  get: () => ipcRenderer.invoke("stats:get"),
};
