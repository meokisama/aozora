import { ipcRenderer } from "electron";

/**
 * App-level maintenance API exposed as `window.electronAPI.system`.
 */
export const systemApi = {
  /**
   * Wipes every persisted store and relaunches the app. The main process exits
   * mid-call, so this never resolves — callers should not await its result.
   */
  clearAllData: () => ipcRenderer.invoke("system:clear-all-data"),
};
