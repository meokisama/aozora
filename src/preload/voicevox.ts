import { ipcRenderer } from "electron";
import type { VoicevoxSpeaker, VoicevoxTestResult, VoicevoxSynthesisResult } from "@/lib/types";

/**
 * VOICEVOX API exposed as `window.electronAPI.voicevox`. The renderer owns the
 * config; the main process is a stateless HTTP client (see src/main/voicevox.ts),
 * so the server URL travels with every call.
 */
export const voicevoxApi = {
  /** Probes the engine via its `/version` endpoint. */
  test: (server: string): Promise<VoicevoxTestResult> => ipcRenderer.invoke("voicevox:test", server),

  /** Available voices (speaker × style), for the settings dropdown. */
  speakers: (server: string): Promise<VoicevoxSpeaker[]> => ipcRenderer.invoke("voicevox:speakers", server),

  /** Synthesises text to WAV bytes with the given voice and speed. */
  synthesize: (server: string, text: string, styleId: number, rate: number): Promise<VoicevoxSynthesisResult> =>
    ipcRenderer.invoke("voicevox:synthesize", server, text, styleId, rate),
};
