import { app, BrowserWindow, Menu } from "electron";
import path from "node:path";
import started from "electron-squirrel-startup";
import { updateElectronApp } from "update-electron-app";
import { registerWindowIpc } from "./main/window.js";
import { registerLibraryIpc } from "./main/library.js";
import { registerStatsIpc } from "./main/stats.js";
import { registerDictionaryIpc } from "./main/dictionary.js";
import { registerSystemIpc } from "./main/system.js";
import { registerDiscordIpc } from "./main/discord.js";
import { registerAnkiIpc } from "./main/anki.js";

// Quit early during Squirrel.Windows install/uninstall (shortcut creation/removal).
if (started) {
  app.quit();
}
updateElectronApp();

Menu.setApplicationMenu(null);

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Keep the custom title bar's maximize/restore icon in sync.
  mainWindow.on("maximize", () => {
    mainWindow.webContents.send("window:maximized-changed", true);
  });
  mainWindow.on("unmaximize", () => {
    mainWindow.webContents.send("window:maximized-changed", false);
  });

  // Keep the renderer's fullscreen state (title-bar visibility, reader toggle) in sync.
  mainWindow.on("enter-full-screen", () => {
    mainWindow.webContents.send("window:fullscreen-changed", true);
  });
  mainWindow.on("leave-full-screen", () => {
    mainWindow.webContents.send("window:fullscreen-changed", false);
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
};

// Register IPC handlers before the first window can invoke them.
app.whenReady().then(() => {
  registerWindowIpc();
  registerLibraryIpc();
  registerStatsIpc();
  registerDictionaryIpc();
  registerSystemIpc();
  registerDiscordIpc();
  registerAnkiIpc();
  createWindow();

  // macOS: re-create a window when the dock icon is clicked with none open.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
