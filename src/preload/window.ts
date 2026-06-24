import { ipcRenderer, type IpcRendererEvent } from "electron";

/**
 * Window control API exposed to the renderer for the custom title bar.
 */
export const windowApi = {
  minimize: () => ipcRenderer.send("window:minimize"),
  toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
  close: () => ipcRenderer.send("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:is-maximized"),

  /** Open an http(s) URL in the user's default browser. */
  openExternal: (url: string) => ipcRenderer.invoke("window:open-external", url),

  /**
   * Subscribe to maximize-state changes.
   * @returns unsubscribe function
   */
  onMaximizedChanged: (callback: (maximized: boolean) => void) => {
    const listener = (_event: IpcRendererEvent, maximized: boolean) => callback(maximized);
    ipcRenderer.on("window:maximized-changed", listener);
    return () => ipcRenderer.removeListener("window:maximized-changed", listener);
  },
};
