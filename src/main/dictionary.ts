import { ipcMain, dialog, BrowserWindow, app } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { dictionaryStore } from "./services/dictionary-store.js";
import type { DictionaryImportProgress } from "@/lib/types";

// Only emit a download-progress event every ~512 KB so a large ZIP doesn't flood IPC.
const DOWNLOAD_PROGRESS_STEP = 512 * 1024;

/**
 * Streams a remote ZIP to a temp file, reporting bytes via `onProgress`. Returns
 * the temp path; the caller imports from it and deletes it. Kept as a file (not
 * an in-memory buffer) so the existing path-based import worker is reused as-is.
 */
async function downloadToTemp(url: string, onProgress?: (p: DictionaryImportProgress) => void): Promise<string> {
  onProgress?.({ phase: "downloading", received: 0, total: 0 });
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`);

  const total = Number(res.headers.get("content-length")) || 0;
  const dest = path.join(app.getPath("temp"), `aozora-dict-${randomUUID()}.zip`);
  const fh = await fs.open(dest, "w");
  try {
    const reader = res.body.getReader();
    let received = 0;
    let lastEmitted = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await fh.write(value);
      received += value.length;
      if (received - lastEmitted >= DOWNLOAD_PROGRESS_STEP) {
        lastEmitted = received;
        onProgress?.({ phase: "downloading", received, total });
      }
    }
    onProgress?.({ phase: "downloading", received, total });
  } finally {
    await fh.close();
  }
  return dest;
}

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

  // Downloads a recommended dictionary and imports it. Reuses the same progress
  // channel and import pipeline as pick-and-import; only the download step is new.
  ipcMain.handle("dictionary:install-recommended", async (event, url: string, sourceId: string) => {
    const onProgress = (p: DictionaryImportProgress) => event.sender.send("dictionary:import-progress", p);
    let tempPath: string | null = null;
    try {
      tempPath = await downloadToTemp(url, onProgress);
      const info = await dictionaryStore.importDict(tempPath, onProgress);
      dictionaryStore.setSource(info.id, sourceId); // stamp so the recommended list shows "Installed" exactly
      return { ...info, sourceId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onProgress({ phase: "error", message });
      throw new Error(message, { cause: err });
    } finally {
      if (tempPath) await fs.rm(tempPath, { force: true }).catch(() => {});
    }
  });

  ipcMain.handle("dictionary:remove", async (_event, id: string) => {
    await dictionaryStore.removeDict(id);
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
