/**
 * Renderer-side VOICEVOX playback. The main process synthesises WAV bytes plus a
 * per-character timeline (src/lib/reader/voicevox-timings.ts); here we decode
 * and play them through a single shared AudioContext, so a new utterance always
 * replaces the last. While playing we drive an optional karaoke `onProgress`
 * callback: how many characters of the synthesized text have been spoken, for
 * the caller to map onto the on-screen text.
 *
 * Web Audio rather than an <audio> element because of clock skew: a media
 * element's `currentTime` runs as soon as samples are handed to the audio
 * pipeline, ahead of the sound actually leaving the speakers (device/Bluetooth
 * latency, easily 100–300 ms) — enough to light the first karaoke characters
 * before the voice is heard. The AudioContext clock plus its reported
 * `outputLatency` lets us track the sample currently reaching the listener.
 */

import type { VoicevoxParams, VoicevoxTimings } from "@/lib/types";

let ctx: AudioContext | null = null;
let source: AudioBufferSourceNode | null = null;
let rafId = 0;
// Bumped on every stop so a synthesis still in flight (its `await` not yet
// resolved) can tell it has been superseded and bow out instead of starting a
// second, overlapping playback.
let generation = 0;

/** Stops playback and halts the progress loop. */
export function stopVoicevox(): void {
  generation++;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  if (source) {
    source.onended = null;
    try {
      source.stop();
    } catch {
      // never started — nothing to stop
    }
    source = null;
  }
}

interface SpeakOptions {
  server: string;
  styleId: number;
  /** Synthesis tuning (speed, pitch, intonation, volume, pauses). */
  params: VoicevoxParams;
  /**
   * Karaoke progress: called each animation frame while playing with how many
   * characters of the synthesized (trimmed) text have been spoken, plus that
   * text's length; called once with (length, length) when playback ends.
   */
  onProgress?: (spoken: number, total: number) => void;
}

/** Characters of the synthesized text spoken by `t` (`chars` is non-decreasing). */
function charsSpoken(timings: VoicevoxTimings, t: number): number {
  const { chars } = timings;
  let n = 0;
  while (n < chars.length && chars[n] <= t) n++;
  return n;
}

/**
 * Synthesises and plays `text`. Resolves to null on success, or an error message
 * (engine unreachable, synthesis failed) the caller can surface.
 */
export async function speakVoicevox(text: string, { server, styleId, params, onProgress }: SpeakOptions): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!server) return "VOICEVOX server is not set.";

  stopVoicevox();
  const gen = generation;
  const res = await window.electronAPI.voicevox.synthesize(server, trimmed, styleId, params);
  // A newer utterance started (and called stopVoicevox) while we were awaiting
  // synthesis — abandon this one rather than play over it.
  if (gen !== generation) return null;
  if (!res.ok) return res.error;

  if (!ctx) ctx = new AudioContext();
  const ac = ctx;
  try {
    if (ac.state === "suspended") await ac.resume();
  } catch {
    // resume rejected — start() below still schedules; audio begins when it can
  }
  let buffer: AudioBuffer;
  try {
    // decodeAudioData detaches its input, so hand it a copy of the IPC bytes.
    buffer = await ac.decodeAudioData(res.audio.slice().buffer as ArrayBuffer);
  } catch {
    return "Could not decode VOICEVOX audio.";
  }
  if (gen !== generation) return null;

  const src = ac.createBufferSource();
  src.buffer = buffer;
  src.connect(ac.destination);
  source = src;
  const startAt = ac.currentTime;
  src.start(startAt);

  const { timings } = res;
  // Time of the sample the listener is hearing right now: the context clock
  // minus the device's output latency (read per frame — it can settle after the
  // stream opens). Negative while the first samples are still in transit, which
  // charsSpoken treats as "nothing spoken yet".
  const heard = () => ac.currentTime - startAt - (ac.outputLatency || ac.baseLatency || 0);

  const tick = () => {
    if (source !== src) return; // superseded by a newer utterance
    onProgress?.(charsSpoken(timings, heard()), timings.chars.length);
    rafId = requestAnimationFrame(tick);
  };

  src.onended = () => {
    if (source === src) {
      onProgress?.(timings.chars.length, timings.chars.length);
      source = null;
    }
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };

  if (onProgress) rafId = requestAnimationFrame(tick);
  return null;
}
