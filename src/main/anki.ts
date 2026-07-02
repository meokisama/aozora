import { ipcMain, BrowserWindow } from "electron";
import type { AnkiEndpoint, AnkiNote, AnkiScreenshotRequest, AnkiTestResult, AnkiAddResult } from "@/lib/types";
import { SCREENSHOT_SENTINEL } from "@/lib/dictionary/anki-note";

/**
 * AnkiConnect IPC. The renderer owns the mining config and builds a note's
 * fields from its templates; the main process is a stateless HTTP client that
 * talks to the AnkiConnect add-on (default http://127.0.0.1:8765).
 *
 * Doing the HTTP from the main process (Node fetch, no browser Origin) sidesteps
 * AnkiConnect's CORS/origin whitelist that a browser extension has to configure.
 *
 * Protocol (see references/yomitan/ext/js/comm/anki-connect.js): POST a single
 * JSON `{action, version, params}`; the reply is `{result, error}` and any
 * non-null `error` is a failure. We target API version 6 (current AnkiConnect).
 */

const API_VERSION = 6;

interface AnkiResponse<T> {
  result: T;
  error: string | null;
}

/** POSTs one AnkiConnect action and unwraps `{result, error}`; throws on any error. */
async function invoke<T>(endpoint: AnkiEndpoint, action: string, params: Record<string, unknown> = {}): Promise<T> {
  const body: Record<string, unknown> = { action, version: API_VERSION, params };
  if (endpoint.apiKey) body.key = endpoint.apiKey;

  const send = (): Promise<Response> =>
    fetch(endpoint.server, {
      method: "POST",
      // `connection: close` asks undici not to pool the socket; AnkiConnect's
      // HTTP server closes idle connections, so a reused keep-alive socket would
      // otherwise throw "other side closed" on the next request.
      headers: { "Content-Type": "application/json", connection: "close" },
      body: JSON.stringify(body),
    });

  let res: Response;
  try {
    res = await send();
  } catch {
    // A pooled socket may have died between calls; one retry opens a fresh one.
    try {
      res = await send();
    } catch {
      // AnkiConnect unreachable — Anki not running, add-on missing, or wrong URL.
      throw new Error("Could not reach Anki. Make sure Anki is running with the AnkiConnect add-on installed.");
    }
  }
  if (!res.ok) throw new Error(`AnkiConnect returned HTTP ${res.status}`);

  const data = (await res.json()) as AnkiResponse<T>;
  if (data.error) throw new Error(data.error);
  return data.result;
}

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Captures the sender window (optionally cropped to `rect`), stores it in Anki's
 * media collection via `storeMediaFile`, and returns the stored filename (Anki
 * may rename on collision, so we use what it returns). Null if capture fails.
 */
async function captureAndStore(
  endpoint: AnkiEndpoint,
  win: BrowserWindow,
  shot: AnkiScreenshotRequest,
): Promise<string | null> {
  const rect = shot.rect
    ? {
        x: Math.round(shot.rect.x),
        y: Math.round(shot.rect.y),
        width: Math.max(1, Math.round(shot.rect.width)),
        height: Math.max(1, Math.round(shot.rect.height)),
      }
    : undefined;

  const image = rect ? await win.webContents.capturePage(rect) : await win.webContents.capturePage();
  if (image.isEmpty()) return null;

  const isJpg = shot.format === "jpg";
  const buffer = isJpg ? image.toJPEG(Math.max(1, Math.min(100, shot.quality))) : image.toPNG();
  const filename = `aozora_screenshot_${Date.now()}.${isJpg ? "jpg" : "png"}`;
  // storeMediaFile wants raw base64 (no `data:` prefix); returns the actual name.
  return invoke<string>(endpoint, "storeMediaFile", { filename, data: buffer.toString("base64") });
}

export const registerAnkiIpc = (): void => {
  // Connection test: the `version` handshake doubles as a reachability probe.
  ipcMain.handle("anki:test", async (_event, endpoint: AnkiEndpoint): Promise<AnkiTestResult> => {
    try {
      const version = await invoke<number>(endpoint, "version");
      return { ok: true, version };
    } catch (err) {
      return { ok: false, error: errMsg(err) };
    }
  });

  // Dropdown data for the settings UI.
  ipcMain.handle("anki:decks", (_event, endpoint: AnkiEndpoint) => invoke<string[]>(endpoint, "deckNames"));
  ipcMain.handle("anki:models", (_event, endpoint: AnkiEndpoint) => invoke<string[]>(endpoint, "modelNames"));
  ipcMain.handle("anki:fields", (_event, endpoint: AnkiEndpoint, model: string) =>
    invoke<string[]>(endpoint, "modelFieldNames", { modelName: model }),
  );

  // Duplicate check for the popup's button state. `canAddNotes` returns false for
  // a note whose first field already exists (or that is otherwise invalid), which
  // is exactly the "already added" signal we want to show.
  ipcMain.handle("anki:can-add", async (_event, endpoint: AnkiEndpoint, note: AnkiNote): Promise<boolean> => {
    try {
      const [canAdd] = await invoke<boolean[]>(endpoint, "canAddNotes", { notes: [note] });
      return canAdd ?? false;
    } catch {
      return false;
    }
  });

  // Add one note. If a screenshot is requested, capture + store it first and
  // splice the returned filename into whichever field carries the sentinel.
  ipcMain.handle(
    "anki:add-note",
    async (event, endpoint: AnkiEndpoint, note: AnkiNote, screenshot: AnkiScreenshotRequest | null): Promise<AnkiAddResult> => {
      try {
        const fields = { ...note.fields };
        if (screenshot) {
          const win = BrowserWindow.fromWebContents(event.sender);
          const filename = win ? await captureAndStore(endpoint, win, screenshot) : null;
          const replacement = filename ? `<img src="${filename}">` : "";
          for (const key of Object.keys(fields)) {
            if (fields[key].includes(SCREENSHOT_SENTINEL)) fields[key] = fields[key].split(SCREENSHOT_SENTINEL).join(replacement);
          }
        }
        const noteId = await invoke<number>(endpoint, "addNote", { note: { ...note, fields } });
        return { ok: true, noteId };
      } catch (err) {
        return { ok: false, error: errMsg(err) };
      }
    },
  );
};
