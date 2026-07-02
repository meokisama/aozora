/**
 * Renderer-side VOICEVOX playback. The main process synthesises WAV bytes
 * (src/main/voicevox.ts); here we wrap them in a Blob and play them through a
 * single reused <audio> element, so a new utterance always replaces the last.
 * Mirrors the tts.ts (Web Speech) interface — speak/stop — so the reader can
 * dispatch to either backend.
 */

let audio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;

/** Stops playback and releases the current object URL. */
export function stopVoicevox(): void {
  if (audio) {
    audio.pause();
    audio.src = "";
    audio = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

interface SpeakOptions {
  server: string;
  styleId: number;
  /** speedScale for the audio query (1 = normal). */
  rate: number;
}

/**
 * Synthesises and plays `text`. Resolves to null on success, or an error message
 * (engine unreachable, synthesis failed) the caller can surface.
 */
export async function speakVoicevox(text: string, { server, styleId, rate }: SpeakOptions): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!server) return "VOICEVOX server is not set.";

  stopVoicevox();
  const res = await window.electronAPI.voicevox.synthesize(server, trimmed, styleId, rate);
  if (!res.ok) return res.error;

  const url = URL.createObjectURL(new Blob([res.audio as BlobPart], { type: "audio/wav" }));
  currentUrl = url;
  const el = new Audio(url);
  audio = el;
  el.addEventListener("ended", () => {
    if (currentUrl === url) {
      URL.revokeObjectURL(url);
      currentUrl = null;
    }
    if (audio === el) audio = null;
  });
  try {
    await el.play();
  } catch {
    // Playback rejected (e.g. superseded before it started) — nothing to report.
  }
  return null;
}
