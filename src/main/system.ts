import { ipcMain, app, session } from "electron";
import path from "node:path";
import fs from "node:fs";
import { libraryStore } from "./services/library-store.js";
import { closeDb as closeDictionaryDb } from "./services/dictionary-db.js";

/**
 * App-level maintenance IPC. `clear-all-data` is the in-app counterpart to a
 * clean uninstall: Squirrel.Windows leaves userData behind on removal, so this
 * wipes every persisted store — library DB + imported originals/covers, the
 * dictionary DB, and the renderer's IndexedDB caches (parsed EPUBs, imported
 * fonts) + localStorage (settings/library prefs) — then relaunches into a
 * first-run state. Every store re-creates its file lazily on next boot.
 */
export const registerSystemIpc = (): void => {
  ipcMain.handle("system:clear-all-data", async () => {
    const userData = app.getPath("userData");

    // Renderer storage: IndexedDB (reader cache + fonts) and localStorage (prefs).
    await session.defaultSession.clearStorageData();

    // Release the SQLite files before unlinking them.
    libraryStore.close();
    closeDictionaryDb();

    for (const name of ["aozora.db", "aozora.db-wal", "aozora.db-shm", "dictionary.db", "dictionary.db-wal", "dictionary.db-shm"]) {
      fs.rmSync(path.join(userData, name), { force: true });
    }
    fs.rmSync(path.join(userData, "books"), { recursive: true, force: true });

    app.relaunch();
    app.exit(0);
  });
};
