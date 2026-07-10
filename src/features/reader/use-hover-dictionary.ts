import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { AnkiScreenshotRequest, Book, DictionaryEntry, KanjiEntry, LookupResult } from "@/lib/types";
import { setLookupHighlight } from "@/lib/reader/highlight";
import { cursorTextFromPoint } from "@/lib/reader/lookup-text";
import { sentenceClozeAround, type SentenceCloze } from "@/lib/reader/sentence";
import { blockAncestor } from "@/lib/reader/search";
import { useAnkiStore } from "@/stores/anki-store";
import { modifierHeld, type LookupModifier } from "@/stores/dictionary-store";
import { cardDataFromEntry, cardDataFromKanji, buildNote, buildKanjiNote, type MineStatus } from "@/lib/dictionary/anki-note";

type ReaderMode = "continuous" | "paginated" | "fixed";

interface Options {
  hostRef: React.RefObject<HTMLDivElement | null>;
  modeRef: React.RefObject<ReaderMode>;
  book: Book | null;
  enabled: boolean;
  modifier: LookupModifier;
  fixedLayout: boolean;
}

/**
 * Hover-dictionary behaviour for the reader: resolves the text under the cursor
 * (gated on a held modifier), queries the main-process engine, highlights the
 * matched run, and drives the popup. Owns the "frozen zone" / grace-timer logic
 * that keeps the popup alive while the cursor travels from word to popup, and
 * mines the shown entry to Anki. Position bookkeeping stays in the reader; this
 * hook only reads `hostRef`/`modeRef`.
 */
export function useHoverDictionary({ hostRef, modeRef, book, enabled, modifier, fixedLayout }: Options) {
  // Last cursor position (so a modifier keydown can look up without moving the
  // mouse), a sequence guard against stale async results, a rAF gate to coalesce
  // mousemoves, and the last queried run text (skip re-query).
  const lastMouseRef = useRef<{ x: number; y: number } | null>(null);
  const lookupSeqRef = useRef(0);
  const lookupRafRef = useRef(0);
  const lastQueryRef = useRef("");
  // Dismissal is deferred via a timer so the cursor can travel from the matched
  // word into the popup (to scroll it) without it vanishing mid-travel.
  const clearTimerRef = useRef(0);
  const popupHoveredRef = useRef(false);
  // Sticky-zone: while a popup is open, re-scanning is frozen inside the corridor
  // joining word and popup (matched-run rect ∪ popup rect, padded), so crossing
  // words while reaching for the popup don't re-trigger a lookup.
  const lookupAnchorRef = useRef<DOMRect | null>(null); // matched-run box of the open popup
  // Live match range + its content root, kept so Anki mining can pull the enclosing
  // sentence and a screenshot rect for the word currently in the popup.
  const mineCtxRef = useRef<{ range: Range; contentRoot: Element } | null>(null);
  const popupRectRef = useRef<{ left: number; top: number; right: number; bottom: number } | null>(null);
  const enabledRef = useRef(enabled);
  const modifierRef = useRef(modifier);
  enabledRef.current = enabled;
  modifierRef.current = modifier;

  const [lookup, setLookup] = useState<{ result: LookupResult; anchor: DOMRect | null } | null>(null);
  // Hides the popup for one repaint while a mining screenshot is captured.
  const [capturing, setCapturing] = useState(false);

  /** Dismisses the dictionary popup and clears the matched-run highlight. */
  const clearLookup = useCallback(() => {
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = 0;
    }
    popupHoveredRef.current = false;
    lookupAnchorRef.current = null;
    popupRectRef.current = null;
    lastQueryRef.current = "";
    setLookupHighlight(null);
    setLookup(null);
  }, []);

  // The popup reports its placed box here so the frozen zone can span the gap to
  // the matched word.
  const handlePopupLayout = useCallback((rect: { left: number; top: number; right: number; bottom: number }) => {
    popupRectRef.current = rect;
  }, []);

  // Is the cursor inside the open popup's frozen zone (padded box spanning word,
  // popup, and the gap)? While inside, scanning is suppressed.
  const inFrozenZone = useCallback((x: number, y: number) => {
    const a = lookupAnchorRef.current;
    if (!a) return false; // no popup open
    const p = popupRectRef.current;
    const PAD = 12;
    const left = Math.min(a.left, p?.left ?? a.left) - PAD;
    const right = Math.max(a.right, p?.right ?? a.right) + PAD;
    const top = Math.min(a.top, p?.top ?? a.top) - PAD;
    const bottom = Math.max(a.bottom, p?.bottom ?? a.bottom) + PAD;
    return x >= left && x <= right && y >= top && y <= bottom;
  }, []);

  // Dismiss after a short grace window so the cursor can cross from word to popup
  // without it vanishing. Cancelled when the cursor reaches the popup or a fresh
  // lookup runs.
  const scheduleClear = useCallback(() => {
    if (clearTimerRef.current) return;
    clearTimerRef.current = window.setTimeout(() => {
      clearTimerRef.current = 0;
      if (popupHoveredRef.current) return; // cursor settled in the popup — keep it
      clearLookup();
    }, 220);
  }, [clearLookup]);

  // Dictionary lookup for the text under a viewport point: resolves the run at
  // the cursor (furigana excluded), queries for the longest match, highlights it
  // and anchors the popup. A sequence guard drops stale async results; identical
  // runs are skipped so jiggling over one word doesn't re-query.
  const runLookupAt = useCallback(
    (x: number, y: number) => {
      const shadow = hostRef.current?.shadowRoot;
      if (!shadow || modeRef.current === "fixed") return;
      const sel = modeRef.current === "paginated" ? ".aoz-page-content" : ".aozora-content";
      const contentRoot = shadow.querySelector(sel);
      if (!contentRoot) return;

      const source = cursorTextFromPoint(x, y, contentRoot);
      if (!source) {
        // No text under the cursor (e.g. the gap between word and popup): dismiss
        // through the grace window so reaching for the popup doesn't kill it.
        scheduleClear();
        return;
      }
      if (source.text === lastQueryRef.current) {
        // Back on the run we already resolved — cancel any pending dismissal.
        if (clearTimerRef.current) {
          clearTimeout(clearTimerRef.current);
          clearTimerRef.current = 0;
        }
        return;
      }
      lastQueryRef.current = source.text;

      const seq = ++lookupSeqRef.current;
      window.electronAPI.dictionary
        .lookup(source.text)
        .then((result) => {
          if (seq !== lookupSeqRef.current) return; // superseded by a newer lookup
          if (!result || !result.matchedLength || (!result.entries.length && !result.kanji.length)) {
            setLookupHighlight(null);
            setLookup(null); // keep lastQueryRef so the same no-match run isn't re-queried
            return;
          }
          if (clearTimerRef.current) {
            clearTimeout(clearTimerRef.current); // a fresh hit supersedes a pending dismissal
            clearTimerRef.current = 0;
          }
          const range = source.rangeForLength(result.matchedLength);
          const anchor = range?.getBoundingClientRect() ?? null;
          setLookupHighlight(range);
          mineCtxRef.current = range ? { range, contentRoot } : null; // context for Anki mining
          lookupAnchorRef.current = anchor; // pin point for the frozen zone
          popupRectRef.current = null; // re-measured by the popup's onLayout
          setLookup({ result, anchor });
        })
        .catch(() => {});
    },
    [hostRef, modeRef, scheduleClear],
  );

  // Pulls the shared card context (cloze/sentence) from the live match and, when a
  // screenshot is wanted, hides the popup a frame and builds the crop rect. The
  // caller re-shows the popup (setCapturing(false)) once the add completes.
  const buildContextAndShot = useCallback(
    async (
      wantShot: boolean,
      quality: number,
    ): Promise<{ cloze: SentenceCloze | null; sentence: string; screenshot: AnkiScreenshotRequest | null; useShot: boolean }> => {
      const ctx = mineCtxRef.current;
      const cloze = ctx ? sentenceClozeAround(ctx.range, ctx.contentRoot) : null;
      const useShot = wantShot && ctx != null;
      let screenshot: AnkiScreenshotRequest | null = null;
      if (useShot && ctx) {
        // Hide the popup and wait one painted frame so it doesn't occlude the
        // sentence in the capture the main process is about to take.
        setCapturing(true);
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        // Crop to the paragraph containing the word, clamped to the viewport.
        const block = blockAncestor(ctx.range.startContainer, ctx.contentRoot);
        const r = block.getBoundingClientRect();
        const x = Math.max(0, r.left);
        const y = Math.max(0, r.top);
        const width = Math.min(r.right, window.innerWidth) - x;
        const height = Math.min(r.bottom, window.innerHeight) - y;
        const rect = width > 0 && height > 0 ? { x, y, width, height } : null;
        screenshot = { rect, format: quality >= 100 ? "png" : "jpg", quality };
      }
      return { cloze, sentence: cloze?.sentence ?? "", screenshot, useShot };
    },
    [],
  );

  // Mines the popup's term entry to Anki: pulls the enclosing sentence + a
  // screenshot rect from the live match, builds the note from the configured
  // templates, and asks the main process to add it (screenshot captured its side).
  const mineEntry = useCallback(
    async (entry: DictionaryEntry): Promise<MineStatus> => {
      if (!book) return "error";
      const cfg = useAnkiStore.getState();
      if (!cfg.enabled || !cfg.deck || !cfg.model || Object.keys(cfg.fields).length === 0) {
        toast.error("Set up Anki in Settings first.");
        return "error";
      }

      const { cloze, sentence, screenshot, useShot } = await buildContextAndShot(cfg.screenshot, cfg.screenshotQuality);
      const data = cardDataFromEntry(entry, {
        sentence,
        cloze: cloze ?? undefined,
        documentTitle: book.title,
        documentAuthor: book.author ?? "",
        hasScreenshot: useShot,
      });
      const note = buildNote(cfg, data);

      try {
        const res = await window.electronAPI.anki.addNote({ server: cfg.server, apiKey: cfg.apiKey }, note, screenshot);
        if (res.ok) {
          toast.success(`Added “${entry.expression}” to Anki.`);
          return "added";
        }
        if (/duplicate/i.test(res.error)) {
          toast.info(`“${entry.expression}” is already in Anki.`);
          return "duplicate";
        }
        toast.error(res.error);
        return "error";
      } finally {
        if (useShot) setCapturing(false);
      }
    },
    [book, buildContextAndShot],
  );

  // Mines a kanji from the popup's kanji card to its own note type (Yomitan keeps
  // term and kanji notes separate). Shares the sentence/screenshot context.
  const mineKanji = useCallback(
    async (kanji: KanjiEntry): Promise<MineStatus> => {
      if (!book) return "error";
      const cfg = useAnkiStore.getState();
      if (!cfg.enabled || !cfg.kanjiDeck || !cfg.kanjiModel || Object.keys(cfg.kanjiFields).length === 0) {
        toast.error("Set up a kanji note type in Anki settings first.");
        return "error";
      }

      const { cloze, sentence, screenshot, useShot } = await buildContextAndShot(cfg.screenshot, cfg.screenshotQuality);
      const data = cardDataFromKanji(kanji, {
        sentence,
        cloze: cloze ?? undefined,
        documentTitle: book.title,
        documentAuthor: book.author ?? "",
        hasScreenshot: useShot,
      });
      const note = buildKanjiNote(cfg, data);

      try {
        const res = await window.electronAPI.anki.addNote({ server: cfg.server, apiKey: cfg.apiKey }, note, screenshot);
        if (res.ok) {
          toast.success(`Added “${kanji.character}” to Anki.`);
          return "added";
        }
        if (/duplicate/i.test(res.error)) {
          toast.info(`“${kanji.character}” is already in Anki.`);
          return "duplicate";
        }
        toast.error(res.error);
        return "error";
      } finally {
        if (useShot) setCapturing(false);
      }
    },
    [book, buildContextAndShot],
  );

  // Coalesce rapid mousemoves into one lookup per frame.
  const scheduleLookup = useCallback(() => {
    if (lookupRafRef.current) return;
    lookupRafRef.current = requestAnimationFrame(() => {
      lookupRafRef.current = 0;
      const m = lastMouseRef.current;
      if (m) runLookupAt(m.x, m.y);
    });
  }, [runLookupAt]);

  // Dictionary half of the reader's mousemove: records the cursor, then scans (or
  // dismisses) depending on the held modifier and the frozen zone.
  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      if (!enabledRef.current || modeRef.current === "fixed") return;
      if (!modifierHeld(modifierRef.current, e)) {
        clearLookup();
        return;
      }
      // Cursor still in the word→popup corridor: keep the popup pinned, don't
      // re-scan, and cancel any pending dismissal.
      if (inFrozenZone(e.clientX, e.clientY)) {
        if (clearTimerRef.current) {
          clearTimeout(clearTimerRef.current);
          clearTimerRef.current = 0;
        }
        return;
      }
      scheduleLookup();
    },
    [modeRef, clearLookup, inFrozenZone, scheduleLookup],
  );

  // Cursor entered / left the popup: pin it while hovered, dismiss (with grace) on leave.
  const onPopupEnter = useCallback(() => {
    popupHoveredRef.current = true;
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = 0;
    }
  }, []);
  const onPopupLeave = useCallback(() => {
    popupHoveredRef.current = false;
    scheduleClear();
  }, [scheduleClear]);

  // Pressing/releasing the lookup modifier triggers (or dismisses) a lookup at
  // the last cursor position, so holding the modifier over a resting pointer works
  // without a wiggle. Inactive for "hover only" (no modifier) or fixed-layout.
  useEffect(() => {
    if (!enabled || modifier === "none" || fixedLayout) return;
    const keyName = modifier === "shift" ? "Shift" : modifier === "alt" ? "Alt" : "Control";
    const onDown = (e: KeyboardEvent) => {
      if (e.key !== keyName || e.repeat) return;
      const m = lastMouseRef.current;
      if (m) runLookupAt(m.x, m.y);
    };
    const onUp = (e: KeyboardEvent) => {
      // Grace window: releasing the modifier to reach for the popup shouldn't
      // dismiss it if the cursor lands inside in time.
      if (e.key === keyName) scheduleClear();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [enabled, modifier, fixedLayout, runLookupAt, scheduleClear]);

  return {
    lookup,
    capturing,
    clearLookup,
    mineEntry,
    mineKanji,
    onMouseMove,
    onMouseLeave: scheduleClear,
    onPopupLayout: handlePopupLayout,
    onPopupEnter,
    onPopupLeave,
  };
}
