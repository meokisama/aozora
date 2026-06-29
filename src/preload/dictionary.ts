import { ipcRenderer } from "electron";
import type { DictionaryImportProgress } from "@/lib/types";

/**
 * Dictionary API exposed as `window.electronAPI.dictionary`. The main process
 * owns the dictionary database and the lookup engine; the renderer manages the
 * imported dictionaries and queries the word under the cursor.
 */
export const dictionaryApi = {
  /** All imported dictionaries, ordered by consult priority. */
  list: () => ipcRenderer.invoke("dictionary:list"),

  /** Opens a picker and imports a Yomitan dictionary ZIP. Resolves to its info (or null if cancelled). */
  pickAndImport: () => ipcRenderer.invoke("dictionary:pick-and-import"),

  /** Removes an imported dictionary and its terms. */
  remove: (id: string) => ipcRenderer.invoke("dictionary:remove", id),

  /** Enables/disables a dictionary for lookups. */
  setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke("dictionary:set-enabled", id, enabled),

  /** Sets consult order (lower = first). */
  setPriority: (id: string, priority: number) => ipcRenderer.invoke("dictionary:set-priority", id, priority),

  /** Looks up the dictionary form(s) at the start of `text`. */
  lookup: (text: string) => ipcRenderer.invoke("dictionary:lookup", text),

  /** Resolves a glossary image (by dict id + archive path) to a data URL, or null. */
  getMedia: (dictId: string, path: string) => ipcRenderer.invoke("dictionary:get-media", dictId, path),

  /** Per-dictionary custom CSS (styles.css) for dictionaries that ship one. */
  getStyles: () => ipcRenderer.invoke("dictionary:get-styles"),

  /** Subscribes to import-progress events. Returns an unsubscribe function. */
  onImportProgress: (cb: (p: DictionaryImportProgress) => void) => {
    const listener = (_event: unknown, p: DictionaryImportProgress) => cb(p);
    ipcRenderer.on("dictionary:import-progress", listener);
    return () => ipcRenderer.off("dictionary:import-progress", listener);
  },
};
