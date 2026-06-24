import { ipcMain, BrowserWindow, shell } from "electron";

/**
 * IPC handlers for the custom title bar's window controls.
 * The window is resolved from the sender so it always targets the right one.
 */
export const registerWindowIpc = (): void => {
  ipcMain.on("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.on("window:toggle-maximize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  ipcMain.on("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle("window:is-maximized", (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });

  // Open a URL in the user's default browser. Restricted to http(s) so a
  // renderer can never coax the main process into launching other protocols.
  ipcMain.handle("window:open-external", (_event, url) => {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      return shell.openExternal(url);
    }
  });
};
