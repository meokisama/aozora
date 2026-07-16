import { ipcRenderer } from "electron";
import type { VoicevoxSpeakerDetail, VoicevoxTestResult, VoicevoxSynthesisResult, VoicevoxParams } from "@/lib/types";

/**
 * VOICEVOX API exposed as `window.electronAPI.voicevox`. The renderer owns the
 * config; the main process is a stateless HTTP client (see src/main/voicevox.ts),
 * so the server URL travels with every call.
 */
export const voicevoxApi = {
  /** Probes the engine via its `/version` endpoint. */
  test: (server: string): Promise<VoicevoxTestResult> => ipcRenderer.invoke("voicevox:test", server),

  /** Rich voice catalogue (icons + preview clips) for the voice picker. */
  voices: (server: string): Promise<VoicevoxSpeakerDetail[]> => ipcRenderer.invoke("voicevox:voices", server),

  /** Pre-loads a voice so its first synthesis isn't slow. Best effort. */
  initialize: (server: string, styleId: number): Promise<void> => ipcRenderer.invoke("voicevox:initialize", server, styleId),

  /** Synthesises text to WAV bytes with the given voice and tuning. */
  synthesize: (server: string, text: string, styleId: number, params: VoicevoxParams): Promise<VoicevoxSynthesisResult> =>
    ipcRenderer.invoke("voicevox:synthesize", server, text, styleId, params),
};
