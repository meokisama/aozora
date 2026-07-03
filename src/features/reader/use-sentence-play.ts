import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { setKaraokeHighlight } from "@/lib/reader/highlight";
import { caretRangeFromPoint } from "@/lib/reader/lookup-text";
import { sentenceContextAround, type SentenceContext } from "@/lib/reader/sentence";
import { speakVoicevox, stopVoicevox } from "@/lib/reader/voicevox";
import { ttsParams, useTtsStore, type SentenceHotkey } from "@/stores/tts-store";
import { modifierHeld } from "@/stores/dictionary-store";

type ReaderMode = "continuous" | "paginated" | "fixed";

interface Options {
  hostRef: React.RefObject<HTMLDivElement | null>;
  modeRef: React.RefObject<ReaderMode>;
  enabled: boolean;
  hotkey: SentenceHotkey;
  fixedLayout: boolean;
  voicevoxServer: string;
  voicevoxSpeaker: number;
}

/**
 * Read-aloud (VOICEVOX) behaviour for the reader: reveals a "read this sentence"
 * button over the hovered sentence while the TTS hotkey is held, plays it with a
 * karaoke highlight that grows in sync with the audio, and exposes a plain
 * word-level speak for the dictionary popup. Owns the grace-timer / sticky-box
 * logic so the cursor can travel to the button without it vanishing, warms up the
 * selected voice, and silences playback on unmount.
 */
export function useSentencePlay({ hostRef, modeRef, enabled, hotkey, fixedLayout, voicevoxServer, voicevoxSpeaker }: Options) {
  // The read button's placement + the sentence to speak, a grace timer so the
  // cursor can travel from the sentence to the button, and a guard against
  // re-setting state for the sentence already shown.
  const [sentencePlay, setSentencePlay] = useState<{ left: number; top: number; sctx: SentenceContext } | null>(null);
  const sentenceTimerRef = useRef(0);
  const sentenceBtnHoveredRef = useRef(false);
  const sentencePlayKeyRef = useRef(""); // sentence currently shown (skip re-place)
  // Padded box spanning the button and the cursor that summoned it; while the
  // cursor stays inside, we don't retarget — so reaching the button doesn't jump
  // the selection to an adjacent sentence.
  const sentenceBtnBoxRef = useRef<{ left: number; right: number; top: number; bottom: number } | null>(null);
  const lastMouseRef = useRef<{ x: number; y: number } | null>(null);
  const enabledRef = useRef(enabled);
  const hotkeyRef = useRef(hotkey);
  enabledRef.current = enabled;
  hotkeyRef.current = hotkey;

  // Read text aloud through VOICEVOX (no karaoke — used for the popup's single word).
  const speakText = useCallback((text: string) => {
    setKaraokeHighlight(null);
    const s = useTtsStore.getState();
    void speakVoicevox(text, { server: s.voicevoxServer, styleId: s.voicevoxSpeaker, params: ttsParams(s) }).then((err) => {
      if (err) toast.error(err);
    });
  }, []);

  const clearSentencePlay = useCallback(() => {
    if (sentenceTimerRef.current) {
      clearTimeout(sentenceTimerRef.current);
      sentenceTimerRef.current = 0;
    }
    sentencePlayKeyRef.current = "";
    sentenceBtnBoxRef.current = null;
    setSentencePlay(null);
  }, []);

  // Dismiss the read-sentence button after a grace window (releasing the hotkey,
  // or leaving the button) so the cursor can travel to it without it vanishing.
  const scheduleSentencePlayClear = useCallback(() => {
    if (sentenceTimerRef.current) return;
    sentenceTimerRef.current = window.setTimeout(() => {
      sentenceTimerRef.current = 0;
      if (sentenceBtnHoveredRef.current) return; // settled on the button — keep it
      clearSentencePlay();
    }, 500);
  }, [clearSentencePlay]);

  // Reads the given sentence with a karaoke highlight that grows over it in sync
  // with the VOICEVOX audio. Progress arrives as characters spoken of the
  // synthesized text; with furigana readings on that's the reading-substituted
  // string, so it's projected back onto the displayed sentence before painting.
  const playSentence = useCallback(
    (sctx: SentenceContext) => {
      clearSentencePlay();
      const s = useTtsStore.getState();
      const useReadings = s.furiganaReadings;
      setKaraokeHighlight(null);
      void speakVoicevox(useReadings ? sctx.spoken : sctx.text, {
        server: s.voicevoxServer,
        styleId: s.voicevoxSpeaker,
        params: ttsParams(s),
        onProgress: (spoken, total) => {
          const chars = useReadings ? sctx.displayedFromSpoken(spoken) : spoken;
          setKaraokeHighlight(spoken < total && chars > 0 ? sctx.rangeForSlice(0, chars) : null);
        },
      }).then((err) => {
        setKaraokeHighlight(null);
        if (err) toast.error(err);
      });
    },
    [clearSentencePlay],
  );

  // Resolves the sentence under a viewport point and shows the read button right
  // next to the cursor. Callers gate on the hotkey being held.
  const showSentencePlayAt = useCallback(
    (x: number, y: number) => {
      if (!enabledRef.current || modeRef.current === "fixed") return;

      // Cursor still inside the current button's frozen box (button ∪ summon point):
      // keep it pinned and cancel any pending dismissal — don't retarget en route.
      const box = sentenceBtnBoxRef.current;
      if (box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
        if (sentenceTimerRef.current) {
          clearTimeout(sentenceTimerRef.current);
          sentenceTimerRef.current = 0;
        }
        return;
      }

      const shadow = hostRef.current?.shadowRoot;
      if (!shadow) return;
      const sel = modeRef.current === "paginated" ? ".aoz-page-content" : ".aozora-content";
      const contentRoot = shadow.querySelector(sel);
      if (!contentRoot) return;

      const caret = caretRangeFromPoint(x, y, contentRoot);
      if (!caret) return;
      const sctx = sentenceContextAround(caret, contentRoot);
      if (!sctx?.text) return;

      if (sentenceTimerRef.current) {
        clearTimeout(sentenceTimerRef.current);
        sentenceTimerRef.current = 0;
      }
      // Still within the same sentence (but outside the box) — keep the button
      // where it first appeared instead of chasing the cursor.
      if (sctx.text === sentencePlayKeyRef.current) return;
      sentencePlayKeyRef.current = sctx.text;

      // Anchor just above-right of the cursor (below it if there's no room), so the
      // button is a short reach away rather than at the sentence's far edge.
      const BTN_W = 122;
      const BTN_H = 26;
      const PAD = 16;
      const left = Math.max(4, Math.min(x + 8, window.innerWidth - BTN_W - 4));
      let top = y - BTN_H - 6;
      if (top < 4) top = Math.min(y + 14, window.innerHeight - BTN_H - 4);
      sentenceBtnBoxRef.current = {
        left: left - PAD,
        right: left + BTN_W + PAD,
        top: Math.min(top, y) - PAD,
        bottom: Math.max(top + BTN_H, y) + PAD,
      };
      setSentencePlay({ left, top, sctx });
    },
    [hostRef, modeRef],
  );

  // Read-sentence half of the reader's mousemove: while the TTS hotkey is held,
  // reveal a play button over the hovered sentence. Independent of the dictionary
  // modifier so the two gestures don't collide.
  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      if (enabledRef.current && modeRef.current !== "fixed" && modifierHeld(hotkeyRef.current, e)) {
        showSentencePlayAt(e.clientX, e.clientY);
      }
    },
    [modeRef, showSentencePlayAt],
  );

  // Cursor entered / left the button: pin it while hovered, dismiss (with grace) on leave.
  const onButtonEnter = useCallback(() => {
    sentenceBtnHoveredRef.current = true;
    if (sentenceTimerRef.current) {
      clearTimeout(sentenceTimerRef.current);
      sentenceTimerRef.current = 0;
    }
  }, []);
  const onButtonLeave = useCallback(() => {
    sentenceBtnHoveredRef.current = false;
    scheduleSentencePlayClear();
  }, [scheduleSentencePlayClear]);

  // Read-sentence hotkey: pressing it reveals the button under a resting cursor
  // (no wiggle needed); releasing it dismisses the button through a grace window.
  useEffect(() => {
    if (!enabled || fixedLayout) return;
    const keyName = hotkey === "shift" ? "Shift" : hotkey === "ctrl" ? "Control" : "Alt";
    const onDown = (e: KeyboardEvent) => {
      if (e.key !== keyName || e.repeat) return;
      const m = lastMouseRef.current;
      if (m) showSentencePlayAt(m.x, m.y);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === keyName) scheduleSentencePlayClear();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [enabled, hotkey, fixedLayout, showSentencePlayAt, scheduleSentencePlayClear]);

  // Warm up the selected VOICEVOX voice so the first read-aloud isn't slow (the
  // engine loads the model lazily). Best effort; re-runs when the voice changes.
  useEffect(() => {
    if (enabled && voicevoxServer) void window.electronAPI.voicevox.initialize(voicevoxServer, voicevoxSpeaker);
  }, [enabled, voicevoxServer, voicevoxSpeaker]);

  // Silence any in-flight read-aloud (and clear its karaoke highlight / button)
  // on leave, and immediately when read-aloud is switched off in Settings.
  useEffect(() => {
    if (!enabled) {
      stopVoicevox();
      setKaraokeHighlight(null);
      clearSentencePlay();
    }
  }, [enabled, clearSentencePlay]);
  useEffect(
    () => () => {
      stopVoicevox();
      setKaraokeHighlight(null);
      clearSentencePlay();
    },
    [clearSentencePlay],
  );

  return { sentencePlay, speakText, playSentence, clearSentencePlay, onMouseMove, onButtonEnter, onButtonLeave };
}
