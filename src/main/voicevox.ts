import { ipcMain } from "electron";
import type {
  VoicevoxSpeaker,
  VoicevoxSpeakerDetail,
  VoicevoxStyleInfo,
  VoicevoxTestResult,
  VoicevoxSynthesisResult,
  VoicevoxTimings,
  VoicevoxParams,
} from "@/lib/types";

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

/** One mora's phoneme lengths (seconds, at speed 1) from the AudioQuery. */
interface Mora {
  consonant_length?: number | null;
  vowel_length?: number | null;
}
interface AccentPhrase {
  moras?: Mora[];
  pause_mora?: Mora | null;
}

/**
 * Turns an AudioQuery into a mora timeline on the synthesized WAV's clock. The
 * engine divides every phoneme length (including the pre/post silence and the
 * inter-phrase pauses) by `speedScale`, so we mirror that here. Pauses are first
 * stretched by `pauseLengthScale`, then sped up like everything else; they
 * advance the clock but add no mora — the highlight naturally holds over a comma.
 */
function buildTimings(query: Record<string, unknown>, speed: number, pauseScale: number): VoicevoxTimings {
  const s = speed || 1;
  const p = pauseScale || 1;
  const phrases = (query.accent_phrases as AccentPhrase[] | undefined) ?? [];
  const moras: number[] = [];
  let t = Number(query.prePhonemeLength ?? 0) / s;
  for (const phrase of phrases) {
    for (const m of phrase.moras ?? []) {
      t += ((m.consonant_length ?? 0) + (m.vowel_length ?? 0)) / s;
      moras.push(t);
    }
    if (phrase.pause_mora) t += ((phrase.pause_mora.vowel_length ?? 0) * p) / s;
  }
  return { total: t + Number(query.postPhonemeLength ?? 0) / s, moras };
}

/**
 * Applies the reader's tuning to a fresh AudioQuery. `pauseLengthScale` is only
 * set when the engine's query already exposes it — older engines reject unknown
 * fields on /synthesis, and the field's presence signals support.
 */
function applyParams(query: Record<string, unknown>, params: VoicevoxParams): void {
  if (params.rate) query.speedScale = params.rate; // 0 would be invalid; slider can't reach it
  query.pitchScale = params.pitch;
  query.intonationScale = params.intonation;
  query.volumeScale = params.volume;
  if ("pauseLengthScale" in query) query.pauseLengthScale = params.pauseLength;
}

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

  // Rich voice catalogue for the picker: each speaker with its styles' icons and
  // preview clips (as data URIs) pulled from /speaker_info. Fetched per speaker in
  // parallel; a speaker whose info can't be loaded still lists its bare styles.
  ipcMain.handle("voicevox:voices", async (_event, server: string): Promise<VoicevoxSpeakerDetail[]> => {
    const base = trimSlash(server);
    const speakers = (await (await request(`${base}/speakers`)).json()) as Array<{
      name: string;
      speaker_uuid: string;
      styles: Array<{ name: string; id: number }>;
    }>;
    return Promise.all(
      speakers.map(async (sp): Promise<VoicevoxSpeakerDetail> => {
        const styleName = new Map(sp.styles.map((st) => [st.id, st.name]));
        let styles: VoicevoxStyleInfo[] = sp.styles.map((st) => ({ styleId: st.id, styleName: st.name, icon: "", samples: [] }));
        try {
          const info = (await (await request(`${base}/speaker_info?speaker_uuid=${sp.speaker_uuid}`)).json()) as {
            style_infos: Array<{ id: number; icon?: string; voice_samples?: string[] }>;
          };
          styles = info.style_infos.map((si) => ({
            styleId: si.id,
            styleName: styleName.get(si.id) ?? String(si.id),
            icon: si.icon ? `data:image/png;base64,${si.icon}` : "",
            samples: (si.voice_samples ?? []).map((s) => `data:audio/wav;base64,${s}`),
          }));
        } catch {
          // /speaker_info failed — keep the bare styles from /speakers.
        }
        return { speakerUuid: sp.speaker_uuid, name: sp.name, styles };
      }),
    );
  });

  // Pre-load a voice so the first synthesis after selecting it isn't slow. Best
  // effort: reachability/unsupported errors are swallowed (feature still works).
  ipcMain.handle("voicevox:initialize", async (_event, server: string, styleId: number): Promise<void> => {
    try {
      await request(`${trimSlash(server)}/initialize_speaker?speaker=${styleId}&skip_reinitialize=true`, { method: "POST" });
    } catch {
      // ignore — synthesis will just pay the load cost on first use
    }
  });

  // Synthesise text to WAV via the audio_query → synthesis pair.
  ipcMain.handle(
    "voicevox:synthesize",
    async (_event, server: string, text: string, styleId: number, params: VoicevoxParams): Promise<VoicevoxSynthesisResult> => {
      try {
        const base = trimSlash(server);
        const q = await request(`${base}/audio_query?text=${encodeURIComponent(text)}&speaker=${styleId}`, { method: "POST" });
        const query = (await q.json()) as Record<string, unknown>;
        applyParams(query, params);
        const s = await request(`${base}/synthesis?speaker=${styleId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(query),
        });
        return { ok: true, audio: new Uint8Array(await s.arrayBuffer()), timings: buildTimings(query, params.rate, params.pauseLength) };
      } catch (err) {
        return { ok: false, error: errMsg(err) };
      }
    },
  );
};
