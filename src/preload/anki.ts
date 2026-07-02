import { ipcRenderer } from "electron";
import type { AnkiEndpoint, AnkiNote, AnkiScreenshotRequest, AnkiTestResult, AnkiAddResult } from "@/lib/types";

/**
 * Anki mining API exposed as `window.electronAPI.anki`. The renderer owns the
 * config and builds the note; the main process is a stateless AnkiConnect client
 * (see src/main/anki.ts), so the endpoint travels with every call.
 */
export const ankiApi = {
  /** Probes the connection via AnkiConnect's `version` handshake. */
  test: (endpoint: AnkiEndpoint): Promise<AnkiTestResult> => ipcRenderer.invoke("anki:test", endpoint),

  /** Deck names, for the settings dropdown. */
  decks: (endpoint: AnkiEndpoint): Promise<string[]> => ipcRenderer.invoke("anki:decks", endpoint),

  /** Note-type (model) names, for the settings dropdown. */
  models: (endpoint: AnkiEndpoint): Promise<string[]> => ipcRenderer.invoke("anki:models", endpoint),

  /** Field names of a model, for the field-mapping table. */
  fields: (endpoint: AnkiEndpoint, model: string): Promise<string[]> => ipcRenderer.invoke("anki:fields", endpoint, model),

  /** Whether the note can be added (false ⇒ already exists / duplicate). */
  canAdd: (endpoint: AnkiEndpoint, note: AnkiNote): Promise<boolean> => ipcRenderer.invoke("anki:can-add", endpoint, note),

  /** Adds a note, optionally capturing + attaching a screenshot of the reader. */
  addNote: (endpoint: AnkiEndpoint, note: AnkiNote, screenshot: AnkiScreenshotRequest | null): Promise<AnkiAddResult> =>
    ipcRenderer.invoke("anki:add-note", endpoint, note, screenshot),
};
