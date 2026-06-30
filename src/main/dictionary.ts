import { ipcMain, dialog, BrowserWindow } from "electron";
import { dictionaryStore } from "./services/dictionary-store.js";
import type { DictionaryImportProgress } from "@/lib/types";

/**
 * Dictionary IPC. Parsing, storage and the deinflection/lookup engine all live
 * in the main process (services/dictionary-store.js); the renderer only renders
 * the popup.
 */
export const registerDictionaryIpc = (): void => {
  ipcMain.handle("dictionary:list", () => dictionaryStore.listDicts());

  // Import progress is streamed back to the requesting window for a toast.
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
      return await dictionaryStore.importDict(result.filePaths[0], onProgress);
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

  ipcMain.handle("dictionary:set-enabled", (_event, id: string, enabled: boolean) => dictionaryStore.setEnabled(id, enabled));

  ipcMain.handle("dictionary:set-priority", (_event, id: string, priority: number) => dictionaryStore.setPriority(id, priority));

  // Hot path (called on hover): `text` is the run at the cursor; the store
  // returns matches for the longest matching prefix.
  ipcMain.handle("dictionary:lookup", (_event, text: string) => dictionaryStore.lookup(text));

  // Lazily resolves a structured-content image to a data URL as the popup renders.
  ipcMain.handle("dictionary:get-media", (_event, dictId: string, path: string) => dictionaryStore.getMedia(dictId, path));

  // Per-dictionary custom CSS (styles.css); injected once by the renderer, scoped to each dict.
  ipcMain.handle("dictionary:get-styles", () => dictionaryStore.getStyles());
};
