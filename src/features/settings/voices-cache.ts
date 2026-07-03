import type { VoicevoxSpeakerDetail } from "@/lib/types";

/**
 * Session cache for the VOICEVOX voice catalogue (icons + sample clips as data
 * URIs). Loading it hits /speaker_info for every speaker, so we keep the result
 * per server URL and reuse it across the settings card and the picker dialog —
 * a Refresh forces a re-fetch when the engine's voices change. Not persisted to
 * disk (the data URIs are large and cheap to re-fetch next session).
 */
const cache = new Map<string, VoicevoxSpeakerDetail[]>();

/** Cached catalogue for `server`, or null if not loaded yet (synchronous peek). */
export function peekVoices(server: string): VoicevoxSpeakerDetail[] | null {
  return cache.get(server) ?? null;
}

/** Cached catalogue, or fetches and caches it. `force` re-fetches past the cache. */
export async function getVoices(server: string, force = false): Promise<VoicevoxSpeakerDetail[]> {
  const hit = cache.get(server);
  if (hit && !force) return hit;
  const list = await window.electronAPI.voicevox.voices(server);
  cache.set(server, list);
  return list;
}

/** Display info for one style: its speaker + style names and icon (data URI). */
export interface VoiceLabel {
  speaker: string;
  style: string;
  icon: string;
}

/** Finds a style's display info in the catalogue by its id. */
export function findVoice(list: VoicevoxSpeakerDetail[] | null, styleId: number): VoiceLabel | null {
  if (!list) return null;
  for (const sp of list) {
    const st = sp.styles.find((s) => s.styleId === styleId);
    if (st) return { speaker: sp.name, style: st.styleName, icon: st.icon };
  }
  return null;
}
