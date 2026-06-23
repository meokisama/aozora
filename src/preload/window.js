import { ipcRenderer } from "electron";

/**
 * Window control API exposed to the renderer for the custom title bar.
 */
export const windowApi = {
  minimize: () => ipcRenderer.send("window:minimize"),
  toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
  close: () => ipcRenderer.send("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:is-maximized"),

  /** Open an http(s) URL in the user's default browser. */
  openExternal: (url) => ipcRenderer.invoke("window:open-external", url),

  /**
   * Subscribe to maximize-state changes.
   * @param {(maximized: boolean) => void} callback
   * @returns {() => void} unsubscribe function
   */
  onMaximizedChanged: (callback) => {
    const listener = (_event, maximized) => callback(maximized);
    ipcRenderer.on("window:maximized-changed", listener);
    return () => ipcRenderer.removeListener("window:maximized-changed", listener);
  },
};
