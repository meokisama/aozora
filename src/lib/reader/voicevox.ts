/**
 * Renderer-side VOICEVOX playback. The main process synthesises WAV bytes plus a
 * mora timeline (src/main/voicevox.ts); here we wrap the bytes in a Blob and play
 * them through a single reused <audio> element, so a new utterance always replaces
 * the last. While playing we drive an optional karaoke `onProgress` callback off
 * the element's clock: the fraction of moras spoken so far, for the caller to map
 * onto the on-screen text.
 */

import type { VoicevoxTimings } from "@/lib/types";

let audio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
let rafId = 0;

/** Stops playback, halts the progress loop, and releases the current object URL. */
export function stopVoicevox(): void {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
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
  /**
   * Karaoke progress: called each animation frame while playing with the
   * fraction of moras spoken so far (0–1), and once with 1 when playback ends.
   */
  onProgress?: (fraction: number) => void;
}

/** Moras whose end time has passed `t`, divided by the total — playback progress. */
function moraFraction(timings: VoicevoxTimings, t: number): number {
  const { moras } = timings;
  if (moras.length === 0) return 0;
  let spoken = 0;
  while (spoken < moras.length && moras[spoken] <= t) spoken++;
  return spoken / moras.length;
}

/**
 * Synthesises and plays `text`. Resolves to null on success, or an error message
 * (engine unreachable, synthesis failed) the caller can surface.
 */
export async function speakVoicevox(text: string, { server, styleId, rate, onProgress }: SpeakOptions): Promise<string | null> {
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

  const { timings } = res;
  const tick = () => {
    if (audio !== el) return; // superseded by a newer utterance
    onProgress?.(moraFraction(timings, el.currentTime));
    if (!el.paused && !el.ended) rafId = requestAnimationFrame(tick);
  };

  el.addEventListener("ended", () => {
    if (audio === el) onProgress?.(1);
    if (currentUrl === url) {
      URL.revokeObjectURL(url);
      currentUrl = null;
    }
    if (audio === el) audio = null;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  });

  try {
    await el.play();
    if (onProgress && audio === el) rafId = requestAnimationFrame(tick);
  } catch {
    // Playback rejected (e.g. superseded before it started) — nothing to report.
  }
  return null;
}
