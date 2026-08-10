import { ipcRenderer } from "electron";
import type { BackupPrefs } from "@/lib/types";

/**
 * App-level maintenance API exposed as `window.electronAPI.system`.
 */
export const systemApi = {
  /**
   * Wipes every persisted store and relaunches the app. The main process exits
   * mid-call, so this never resolves — callers should not await its result.
   */
  clearAllData: () => ipcRenderer.invoke("system:clear-all-data"),

  /** Writes a backup to a user-picked path; prefs are passed in as only the renderer reads localStorage. */
  exportBackup: (includeBooks: boolean, prefs: BackupPrefs) => ipcRenderer.invoke("system:export-backup", includeBooks, prefs),

  /**
   * Restores a user-picked archive: replaces the library DB, merges in its book
   * files, and returns the prefs for the caller to write back before relaunching.
   */
  importBackup: () => ipcRenderer.invoke("system:import-backup"),

  /** Restarts the app. Like clearAllData, this never resolves. */
  relaunch: () => ipcRenderer.invoke("system:relaunch"),
};
