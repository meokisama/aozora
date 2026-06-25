import { ipcMain, dialog, BrowserWindow } from "electron";
import fs from "node:fs";
import { dictionaryStore } from "./services/dictionary-store.js";
import type { DictionaryImportProgress } from "@/lib/types";

/**
 * Dictionary IPC. The renderer manages imported Yomitan dictionaries and asks
 * the main process to look up the text run under the cursor. All parsing,
 * storage and the deinflection/lookup engine live in the main process (see
 * services/dictionary-store.js); the renderer only renders the popup.
 */
export const registerDictionaryIpc = (): void => {
  ipcMain.handle("dictionary:list", () => dictionaryStore.listDicts());

  // Opens a picker for a Yomitan dictionary ZIP and imports it. Import progress
  // is streamed back to the requesting window so the UI can show a toast.
  ipcMain.handle("dictionary:pick-and-import", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win!, {
      title: "Import dictionary",
      properties: ["openFile"],
      filters: [{ name: "Yomitan dictionary", extensions: ["zip"] }],
    });
    if (result.canceled || !result.filePaths.length) return null;

    const onProgress = (p: DictionaryImportProgress) => event.sender.send("dictionary:import-progress", p);
    try {
      const bytes = fs.readFileSync(result.filePaths[0]);
      return await dictionaryStore.importDict(new Uint8Array(bytes), onProgress);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onProgress({ phase: "error", message });
      throw new Error(message, { cause: err });
    }
  });

  ipcMain.handle("dictionary:remove", (_event, id: string) => {
    dictionaryStore.removeDict(id);
    return true;
  });

  ipcMain.handle("dictionary:set-enabled", (_event, id: string, enabled: boolean) =>
    dictionaryStore.setEnabled(id, enabled),
  );

  ipcMain.handle("dictionary:set-priority", (_event, id: string, priority: number) =>
    dictionaryStore.setPriority(id, priority),
  );

  // The hot path: called as the user hovers text. `text` is the run starting at
  // the cursor; the store returns matches for the longest matching prefix.
  ipcMain.handle("dictionary:lookup", (_event, text: string) => dictionaryStore.lookup(text));
};
