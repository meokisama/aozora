import { ipcMain } from "electron";
import type { VoicevoxSpeaker, VoicevoxTestResult, VoicevoxSynthesisResult } from "@/lib/types";

/**
 * VOICEVOX Engine IPC. Like the AnkiConnect client (src/main/anki.ts), the
 * renderer owns the config and the main process is a stateless HTTP client —
 * Node fetch has no browser Origin, so it sidesteps the CORS the engine would
 * otherwise enforce on a page request.
 *
 * The engine (default http://127.0.0.1:50021) synthesises in two POSTs:
 *   1. /audio_query?text=…&speaker=<styleId>  → an AudioQuery JSON
 *   2. /synthesis?speaker=<styleId>  (body = that query)  → WAV bytes
 * We mutate `speedScale` on the query between the two so the reader's speed
 * setting takes effect.
 */

/** Trims a trailing slash so `${base}/path` never doubles up. */
const trimSlash = (url: string): string => url.replace(/\/+$/, "");

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Wraps a fetch so an unreachable engine reports a friendly, actionable error. */
async function request(url: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    // `connection: close` mirrors the Anki client: don't pool a socket the
    // engine's HTTP server may drop between calls.
    res = await fetch(url, { ...init, headers: { connection: "close", ...init?.headers } });
  } catch {
    throw new Error("Could not reach VOICEVOX. Make sure the VOICEVOX app (or engine) is running.");
  }
  if (!res.ok) throw new Error(`VOICEVOX returned HTTP ${res.status}`);
  return res;
}

export const registerVoicevoxIpc = (): void => {
  // Connection probe: `/version` doubles as a reachability check.
  ipcMain.handle("voicevox:test", async (_event, server: string): Promise<VoicevoxTestResult> => {
    try {
      const res = await request(`${trimSlash(server)}/version`);
      const version = await res.json(); // a bare JSON string, e.g. "0.14.4"
      return { ok: true, version: String(version) };
    } catch (err) {
      return { ok: false, error: errMsg(err) };
    }
  });

  // Flatten every speaker's styles into one list for the settings dropdown.
  ipcMain.handle("voicevox:speakers", async (_event, server: string): Promise<VoicevoxSpeaker[]> => {
    const res = await request(`${trimSlash(server)}/speakers`);
    const data = (await res.json()) as Array<{ name: string; styles: Array<{ name: string; id: number }> }>;
    return data.flatMap((sp) => sp.styles.map((st) => ({ name: `${sp.name}（${st.name}）`, styleId: st.id })));
  });

  // Synthesise text to WAV via the audio_query → synthesis pair.
  ipcMain.handle(
    "voicevox:synthesize",
    async (_event, server: string, text: string, styleId: number, rate: number): Promise<VoicevoxSynthesisResult> => {
      try {
        const base = trimSlash(server);
        const q = await request(`${base}/audio_query?text=${encodeURIComponent(text)}&speaker=${styleId}`, { method: "POST" });
        const query = (await q.json()) as Record<string, unknown>;
        if (rate) query.speedScale = rate;
        const s = await request(`${base}/synthesis?speaker=${styleId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(query),
        });
        return { ok: true, audio: new Uint8Array(await s.arrayBuffer()) };
      } catch (err) {
        return { ok: false, error: errMsg(err) };
      }
    },
  );
};
