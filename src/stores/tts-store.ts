import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Read-aloud (TTS) config, persisted in the renderer like other reader prefs.
 * Backed solely by a local VOICEVOX engine (high-quality JP voices). VOICEVOX
 * is a stateless HTTP client, so callers read these fields off the store and
 * pass them to speakVoicevox().
 */

export const DEFAULT_VOICEVOX_SERVER = "http://127.0.0.1:50021";

export interface TtsConfig {
  enabled: boolean;
  /** Playback speed (VOICEVOX speedScale; 1 = normal). */
  rate: number;
  /** VOICEVOX engine URL. */
  voicevoxServer: string;
  /** VOICEVOX voice (speaker × style) id. */
  voicevoxSpeaker: number;
}

const DEFAULTS: TtsConfig = {
  enabled: true,
  rate: 1,
  voicevoxServer: DEFAULT_VOICEVOX_SERVER,
  voicevoxSpeaker: 3, // ずんだもん（ノーマル） — present in stock VOICEVOX
};

interface TtsState extends TtsConfig {
  setEnabled: (enabled: boolean) => void;
  setRate: (rate: number) => void;
  setVoicevoxServer: (voicevoxServer: string) => void;
  setVoicevoxSpeaker: (voicevoxSpeaker: number) => void;
}

export const useTtsStore = create<TtsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setEnabled: (enabled) => set({ enabled }),
      setRate: (rate) => set({ rate }),
      setVoicevoxServer: (voicevoxServer) => set({ voicevoxServer }),
      setVoicevoxSpeaker: (voicevoxSpeaker) => set({ voicevoxSpeaker }),
    }),
    {
      name: "aozora-tts",
    },
  ),
);
