import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bookmark, Images, List, Loader2, Maximize, Minimize, Search, Settings, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useReaderStore } from "@/stores/reader-store";
import { useLibraryStore } from "@/stores/library-store";
import { useSettingsStore, type WritingMode } from "@/stores/settings-store";
import { useFontsStore } from "@/stores/fonts-store";
import { useUiStore } from "@/stores/ui-store";
import { ReaderSettingsPanel } from "./settings-panel";
import { ReaderToc } from "./reader-toc";
import { ReaderBookmarks } from "./reader-bookmarks";
import { ReaderSearch } from "./reader-search";
import { ReaderGallery } from "./reader-gallery";
import { collectIllustrations, type Illustration } from "@/lib/reader/illustrations";
import { applyReaderVars, continuousStyles, paginatedStyles } from "./reader-styles";
import { parseBook, type ParsedBook, type FixedLayoutPage } from "@/lib/epub/parse-book";
import type { Section } from "@/lib/epub/generate-html";
import { toast } from "sonner";
import type { AnkiScreenshotRequest, Bookmark as BookmarkRecord, DictionaryEntry, LookupResult } from "@/lib/types";
import { buildReaderHtml } from "@/lib/epub/format-html";
import { getCachedBook, putCachedBook } from "@/lib/reader-cache";
import { collectAnchors, currentCharAtCenter, scrollToChar, scrollToElementId, type Anchor } from "@/lib/reader/position";
import { PaginatedController, type PaginatedState } from "@/lib/reader/paginated";
import { mergeSpreadSections } from "@/lib/reader/merge-spreads";
import { FixedLayoutView, type FixedLayoutHandle } from "./fixed-layout-view";
import { blockAncestor, buildSearchIndex, searchIndex, type SearchResult, type SearchIndexEntry } from "@/lib/reader/search";
import { clearSearchHighlight, highlightSearchResult, setKaraokeHighlight, setLookupHighlight } from "@/lib/reader/highlight";
import { cursorTextFromPoint, caretRangeFromPoint } from "@/lib/reader/lookup-text";
import { sentenceAround, sentenceContextAround, type SentenceContext } from "@/lib/reader/sentence";
import { speakVoicevox, stopVoicevox } from "@/lib/reader/voicevox";
import { useDictionaryStore, modifierHeld } from "@/stores/dictionary-store";
import { useAnkiStore } from "@/stores/anki-store";
import { useTtsStore } from "@/stores/tts-store";
import { cardDataFromEntry, buildNote, type MineStatus } from "@/lib/dictionary/anki-note";
import { DictionaryPopup } from "./dictionary-popup";
import { FootnotePopup } from "./footnote-popup";
import { collectFootnotes } from "@/lib/reader/footnotes";
import { useReadingSession } from "./use-reading-session";

const api = () => window.electronAPI.library;

const FURIGANA_CLASSES = ["aoz-furigana-hide", "aoz-furigana-partial", "aoz-furigana-toggle", "aoz-furigana-full"];

/** Effective writing direction: the user's override, or the book's own when "auto". */
function resolveVertical(mode: WritingMode, bookVertical: boolean): boolean {
  return mode === "auto" ? bookVertical : mode === "vertical";
}

/** Reflects the furigana mode as a class on the content root; "show" clears it
 *  so the book's own furigana styling applies untouched. */
function applyFuriganaClass(root: Element | null | undefined) {
  if (!root) return;
  root.classList.remove(...FURIGANA_CLASSES);
  const mode = useSettingsStore.getState().furiganaMode;
  if (mode && mode !== "show") root.classList.add(`aoz-furigana-${mode}`);
}

/** Click-to-reveal for the toggle/full/partial furigana modes. Delegated on the
 *  persistent content root so it survives paginated section swaps. */
function bindRubyReveal(root: Element | null | undefined) {
  if (!root) return;
  root.addEventListener("click", (e) => {
    const ruby = e.target instanceof Element ? e.target.closest("ruby") : null;
    if (!ruby) return;
    const mode = useSettingsStore.getState().furiganaMode;
    if (mode === "show" || mode === "hide") return;
    if (mode === "toggle") ruby.classList.toggle("reveal-rt");
    else ruby.classList.add("reveal-rt"); // partial, full: reveal and keep
  });
}

/**
 * Reader shell. The book is parsed once (or loaded from the IndexedDB cache) and
 * rendered inside a shadow root so the book's own CSS stays isolated. Continuous
 * and paginated layouts share that parsed content without re-parsing.
 *
 * Reading position is a character offset (exploredCharCount), so it survives
 * re-flow and mode switches; persisted (debounced) and restored on next open.
 */
export function ReaderView() {
  const book = useReaderStore((s) => s.currentBook);
  const close = useReaderStore((s) => s.close);
  const applyProgress = useLibraryStore((s) => s.applyProgress);
  const ankiEnabled = useAnkiStore((s) => s.enabled);
  const ttsEnabled = useTtsStore((s) => s.enabled);
  const sentenceHotkey = useTtsStore((s) => s.sentenceHotkey);

  // Records reading time / characters for the stats page.
  const { mark: markSession } = useReadingSession(book?.id);

  const fontSize = useSettingsStore((s) => s.fontSize);
  const lineHeight = useSettingsStore((s) => s.lineHeight);
  const fontFamily = useSettingsStore((s) => s.fontFamily);
  const theme = useSettingsStore((s) => s.theme);
  const readingMode = useSettingsStore((s) => s.readingMode);
  const writingMode = useSettingsStore((s) => s.writingMode);
  const furiganaMode = useSettingsStore((s) => s.furiganaMode);
  const pageColumns = useSettingsStore((s) => s.pageColumns);
  const sideMargin = useSettingsStore((s) => s.sideMargin);
  const discordRichPresence = useSettingsStore((s) => s.discordRichPresence);
  const discordCover = useSettingsStore((s) => s.discordCover);
  const customFonts = useFontsStore((s) => s.customFonts);
  const fullscreen = useUiStore((s) => s.fullscreen);

  const hostRef = useRef<HTMLDivElement>(null);
  const parsedRef = useRef<ParsedBook | null>(null);
  const htmlRef = useRef<string | null>(null);
  const objectUrlsRef = useRef<string[]>([]);
  const anchorsRef = useRef<{ anchors: Anchor[]; total: number }>({ anchors: [], total: 0 });
  const controllerRef = useRef<PaginatedController | null>(null);
  const fixedRef = useRef<FixedLayoutHandle | null>(null);
  const fixedDataRef = useRef<{ pages: FixedLayoutPage[]; ppd: string; bookViewport: { width: number; height: number } | null } | null>(null);
  const totalRef = useRef(0);
  const verticalRef = useRef(false);
  const modeRef = useRef<"continuous" | "paginated" | "fixed">(readingMode);
  const charRef = useRef(0);
  const rafRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wheelTsRef = useRef(0);
  const readyRef = useRef(false);
  const searchIndexRef = useRef<SearchIndexEntry[] | null>(null); // lazily built on first search
  const footnotesRef = useRef<Map<string, string>>(new Map()); // id → note inner HTML

  // Hover-dictionary state: last cursor position (so a modifier keydown can look
  // up without moving the mouse), a sequence guard against stale async results, a
  // rAF gate to coalesce mousemoves, and the last queried run text (skip re-query).
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
  const dictEnabled = useDictionaryStore((s) => s.enabled);
  const dictModifier = useDictionaryStore((s) => s.modifier);
  const dictEnabledRef = useRef(dictEnabled);
  const dictModifierRef = useRef(dictModifier);
  dictEnabledRef.current = dictEnabled;
  dictModifierRef.current = dictModifier;
  const ttsEnabledRef = useRef(ttsEnabled);
  const sentenceHotkeyRef = useRef(sentenceHotkey);
  ttsEnabledRef.current = ttsEnabled;
  sentenceHotkeyRef.current = sentenceHotkey;
  // Read-sentence hover button: its placement + the sentence to speak, a grace
  // timer so the cursor can travel from the sentence to the button, and a guard
  // against re-setting state for the sentence already shown.
  const [sentencePlay, setSentencePlay] = useState<{ left: number; top: number; sctx: SentenceContext } | null>(null);
  const sentenceTimerRef = useRef(0);
  const sentenceBtnHoveredRef = useRef(false);
  const sentencePlayKeyRef = useRef(""); // sentence currently shown (skip re-place)
  // Padded box spanning the button and the cursor that summoned it; while the
  // cursor stays inside, we don't retarget — so reaching the button doesn't jump
  // the selection to an adjacent sentence.
  const sentenceBtnBoxRef = useRef<{ left: number; right: number; top: number; bottom: number } | null>(null);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [parseToken, setParseToken] = useState(0); // bumped when parsed content is ready
  const [fixedLayout, setFixedLayout] = useState(false); // manga / fixed-layout book
  // Effective writing direction = the Writing Mode setting ("auto" follows the
  // EPUB's PPD/CSS; "horizontal"/"vertical" force it). Drives the host overflow axis.
  const [vertical, setVertical] = useState(true);
  const [sections, setSections] = useState<Section[]>([]);
  const [currentChar, setCurrentChar] = useState(0);
  const [pageInfo, setPageInfo] = useState<{ page: number; totalPages: number } | null>(null); // paginated mode
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<BookmarkRecord[]>([]);
  const [nameInput, setNameInput] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [illustrations, setIllustrations] = useState<Illustration[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ results: SearchResult[]; total: number; capped: boolean }>({
    results: [],
    total: 0,
    capped: false,
  });
  const [lookup, setLookup] = useState<{ result: LookupResult; anchor: DOMRect | null } | null>(null);
  // Hides the popup for one repaint while a mining screenshot is captured.
  const [capturing, setCapturing] = useState(false);
  const [footnote, setFootnote] = useState<{ html: string; anchor: DOMRect } | null>(null);

  // Mirrors whether any reader overlay (panel/gallery) is open, so the global
  // page-flip key handler can stand down instead of flipping pages behind it.
  const panelOpenRef = useRef(false);
  panelOpenRef.current = tocOpen || settingsOpen || bookmarksOpen || searchOpen || galleryOpen;

  const total = totalRef.current;
  // Fixed-layout position is a page ordinal, so the last page (total-1) is 100%;
  // reflowable position is a character offset out of the total.
  const progressPct = total ? Math.round((fixedLayout && total > 1 ? currentChar / (total - 1) : currentChar / total) * 100) : 0;

  // Chapters that carry a TOC label (sub-sections fold into their parent).
  const chapters = useMemo(() => sections.filter((s) => s.label), [sections]);
  const activeChapterId = useMemo(() => {
    let active = null;
    for (const ch of chapters) {
      if ((ch.startCharacter ?? 0) <= currentChar) active = ch.reference;
      else break;
    }
    return active;
  }, [chapters, currentChar]);

  // Discord Rich Presence: mirror the current book/chapter/progress while reading.
  // Enabling/disabling and the idle presence live in App (always mounted); the
  // main process throttles the actual sends.
  useEffect(() => {
    if (!discordRichPresence || !book) return;
    const idx = chapters.findIndex((c) => c.reference === activeChapterId);
    window.electronAPI.discord.update({
      bookTitle: book.title,
      author: book.author,
      chapterName: idx >= 0 ? chapters[idx].label : undefined,
      chapterIndex: idx >= 0 ? idx + 1 : undefined,
      chapterTotal: chapters.length || undefined,
      progress: progressPct,
      coverBookId: discordCover ? book.id : undefined, // opt-in: main uploads the cover for the large image
    });
  }, [discordRichPresence, discordCover, book, chapters, activeChapterId, progressPct]);

  /** Persists the current position to the main process and the in-memory store. */
  const persist = useCallback(() => {
    const totalChars = totalRef.current;
    if (!book || !totalChars) return;
    const exploredCharCount = charRef.current;
    const progress = Math.min(1, Math.max(0, exploredCharCount / totalChars));
    const fields = {
      exploredCharCount,
      charCount: totalChars,
      progress,
      lastOpenedAt: Date.now(),
    };
    applyProgress(book.id, fields);
    api()
      .saveProgress(book.id, fields)
      .catch(() => {});
  }, [book, applyProgress]);

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

  /** Scrolls the continuous reader to the tracked character (or the book start). */
  const restoreContinuous = useCallback((vert: boolean) => {
    const host = hostRef.current;
    if (!host) return;
    const { anchors, total: totalChars } = anchorsRef.current;
    const char = charRef.current;
    if (char > 0 && totalChars > 0) {
      scrollToChar(host, anchors, vert, char);
    } else if (vert) {
      host.scrollLeft = host.scrollWidth; // vertical-rl begins at the right edge
    } else {
      host.scrollTop = 0;
    }
  }, []);

  // Receives position updates from the paginated controller.
  const onPagedChange = useCallback(
    (state: PaginatedState) => {
      charRef.current = state.char;
      setCurrentChar(state.char);
      setPageInfo({ page: state.page, totalPages: state.totalPages });
      markSession(state.char, "paginated");
      clearLookup(); // the matched run scrolled off the page
      setFootnote(null);
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(persist, 800);
    },
    [persist, markSession, clearLookup],
  );

  // Position updates from the fixed-layout viewer. Position is a 0-based page
  // ordinal; progress reaches 1 on the last page so finished manga read complete.
  const onFixedChange = useCallback(
    (ordinal: number, totalPages: number) => {
      charRef.current = ordinal;
      totalRef.current = totalPages;
      setCurrentChar(ordinal);
      setPageInfo({ page: ordinal, totalPages });
      markSession(ordinal, "fixed");
      if (!book || !totalPages) return;
      const progress = totalPages > 1 ? Math.min(1, ordinal / (totalPages - 1)) : 1;
      const fields = { exploredCharCount: ordinal, charCount: totalPages, progress, lastOpenedAt: Date.now() };
      applyProgress(book.id, fields);
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        api()
          .saveProgress(book.id, fields)
          .catch(() => {});
      }, 800);
    },
    [book, applyProgress, markSession],
  );

  // Suggested bookmark name: current TOC chapter title + progress percentage
  // (editable before saving). Falls back to just the percentage with no chapter.
  const computeDefaultName = useCallback(() => {
    const totalChars = totalRef.current || 0;
    const char = charRef.current;
    const pct = totalChars ? Math.round((char / totalChars) * 100) : 0;
    let label = "";
    for (const ch of chapters) {
      if ((ch.startCharacter ?? 0) <= char) label = ch.label || label;
      else break;
    }
    return label ? `${label}  (${pct}%)` : `${pct}%`;
  }, [chapters]);

  // Jumps to a character offset, in whichever mode is active.
  const jumpToChar = useCallback(
    (char: number) => {
      setBookmarksOpen(false);
      charRef.current = char;
      if (modeRef.current === "fixed") {
        fixedRef.current?.jumpToOrdinal(char); // emits onChange → updates state + saves
        return;
      }
      if (modeRef.current === "paginated") {
        controllerRef.current?.restoreToChar(char); // emits onChange → updates state + saves
        return;
      }
      const host = hostRef.current;
      if (!host) return;
      scrollToChar(host, anchorsRef.current.anchors, verticalRef.current, char);
      requestAnimationFrame(() => {
        charRef.current = currentCharAtCenter(host, anchorsRef.current.anchors, verticalRef.current);
        setCurrentChar(charRef.current);
        persist();
      });
    },
    [persist],
  );

  // Adds a bookmark at the current position with the (user-editable) name.
  const handleAddBookmark = useCallback(async () => {
    if (!book) return;
    const charOffset = charRef.current;
    const totalChars = totalRef.current || 0;
    const progress = totalChars ? Math.min(1, Math.max(0, charOffset / totalChars)) : 0;
    const name = nameInput.trim() || computeDefaultName();
    try {
      const bm = await api().addBookmark({ bookId: book.id, charOffset, progress, snippet: name });
      if (bm) {
        setBookmarks((prev) => [...prev, bm].sort((a, b) => a.charOffset - b.charOffset));
        setNameInput(computeDefaultName()); // reset the field to a fresh default
      }
    } catch (err) {
      console.error("Failed to add bookmark", err);
    }
  }, [book, nameInput, computeDefaultName]);

  const handleRemoveBookmark = useCallback(async (id: string) => {
    try {
      await api().removeBookmark(id);
      setBookmarks((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      console.error("Failed to remove bookmark", err);
    }
  }, []);

  // Queries the in-book index, built lazily from the parsed HTML once and reused.
  const runSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults({ results: [], total: 0, capped: false });
      return;
    }
    if (!searchIndexRef.current && parsedRef.current) {
      searchIndexRef.current = buildSearchIndex(parsedRef.current.elementHtml);
    }
    setSearchResults(searchIndex(searchIndexRef.current || [], query));
  }, []);

  // Jumps to a search hit and highlights it. The highlight waits until the target
  // is on screen (the paginated controller renders its section asynchronously).
  const jumpToSearchResult = useCallback(
    async (result: SearchResult) => {
      setSearchOpen(false);
      clearSearchHighlight();
      const query = searchQuery;
      const root = () => hostRef.current?.shadowRoot;
      if (modeRef.current === "paginated") {
        const ctrl = controllerRef.current;
        if (!ctrl) return;
        charRef.current = result.charOffset;
        await ctrl.restoreToChar(result.charOffset); // emits onChange → state + save
        requestAnimationFrame(() => {
          highlightSearchResult(root()?.querySelector(".aoz-page-content") ?? null, result.charOffset, query, ctrl.sectionStart);
        });
        return;
      }
      jumpToChar(result.charOffset);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          highlightSearchResult(root()?.querySelector(".aozora-content") ?? null, result.charOffset, query, 0);
        }),
      );
    },
    [jumpToChar, searchQuery],
  );

  // Attach chapter label + progress to each hit for display (mirrors the
  // active-chapter / bookmark-name logic).
  const searchDisplay = useMemo(() => {
    return searchResults.results.map((r) => {
      let label = "";
      for (const ch of chapters) {
        if ((ch.startCharacter ?? 0) <= r.charOffset) label = ch.label || label;
        else break;
      }
      const progress = total ? Math.round((r.charOffset / total) * 100) : 0;
      return { ...r, label, progress };
    });
  }, [searchResults, chapters, total]);

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
    [scheduleClear],
  );

  // Mines the popup's entry to Anki: pulls the enclosing sentence + a screenshot
  // rect from the live match, builds the note from the configured templates, and
  // asks the main process to add it (capturing the screenshot on its side).
  const mineEntry = useCallback(
    async (entry: DictionaryEntry): Promise<MineStatus> => {
      if (!book) return "error";
      const cfg = useAnkiStore.getState();
      if (!cfg.enabled || !cfg.deck || !cfg.model || Object.keys(cfg.fields).length === 0) {
        toast.error("Set up Anki in Settings first.");
        return "error";
      }

      const ctx = mineCtxRef.current;
      const sentence = ctx ? sentenceAround(ctx.range, ctx.contentRoot) : "";
      const data = cardDataFromEntry(entry, {
        sentence,
        documentTitle: book.title,
        documentAuthor: book.author ?? "",
        hasScreenshot: cfg.screenshot,
      });
      const note = buildNote(cfg, data);

      let screenshot: AnkiScreenshotRequest | null = null;
      const useShot = cfg.screenshot && ctx != null;
      if (cfg.screenshot && ctx) {
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
        screenshot = { rect, format: cfg.screenshotQuality >= 100 ? "png" : "jpg", quality: cfg.screenshotQuality };
      }

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
    [book],
  );

  // Read text aloud through VOICEVOX (no karaoke — used for the popup's single word).
  const speakText = useCallback((text: string) => {
    setKaraokeHighlight(null);
    const s = useTtsStore.getState();
    void speakVoicevox(text, { server: s.voicevoxServer, styleId: s.voicevoxSpeaker, rate: s.rate }).then((err) => {
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
  // with the VOICEVOX audio (mora-fraction → character count).
  const playSentence = useCallback(
    (sctx: SentenceContext) => {
      clearSentencePlay();
      const s = useTtsStore.getState();
      const total = sctx.text.length;
      setKaraokeHighlight(null);
      void speakVoicevox(sctx.text, {
        server: s.voicevoxServer,
        styleId: s.voicevoxSpeaker,
        rate: s.rate,
        onProgress: (f) => {
          const chars = Math.round(f * total);
          setKaraokeHighlight(f < 1 && chars > 0 ? sctx.rangeForSlice(0, chars) : null);
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
  const showSentencePlayAt = useCallback((x: number, y: number) => {
    if (!ttsEnabledRef.current || modeRef.current === "fixed") return;

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
  }, []);

  // Coalesce rapid mousemoves into one lookup per frame.
  const scheduleLookup = useCallback(() => {
    if (lookupRafRef.current) return;
    lookupRafRef.current = requestAnimationFrame(() => {
      lookupRafRef.current = 0;
      const m = lastMouseRef.current;
      if (m) runLookupAt(m.x, m.y);
    });
  }, [runLookupAt]);

  const handleMouseMove = (e: React.MouseEvent) => {
    lastMouseRef.current = { x: e.clientX, y: e.clientY };

    // Read-sentence gesture, independent of the dictionary modifier: while the
    // TTS hotkey is held, reveal a play button over the hovered sentence.
    if (ttsEnabledRef.current && modeRef.current !== "fixed" && modifierHeld(sentenceHotkeyRef.current, e)) {
      showSentencePlayAt(e.clientX, e.clientY);
    }

    if (!dictEnabledRef.current || modeRef.current === "fixed") return;
    if (!modifierHeld(dictModifierRef.current, e)) {
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
  };

  // Pressing/releasing the lookup modifier triggers (or dismisses) a lookup at
  // the last cursor position, so holding the modifier over a resting pointer works
  // without a wiggle. Inactive for "hover only" (no modifier) or fixed-layout.
  useEffect(() => {
    if (!dictEnabled || dictModifier === "none" || fixedLayout) return;
    const keyName = dictModifier === "shift" ? "Shift" : dictModifier === "alt" ? "Alt" : "Control";
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
  }, [dictEnabled, dictModifier, fixedLayout, runLookupAt, scheduleClear]);

  // Read-sentence hotkey: pressing it reveals the button under a resting cursor
  // (no wiggle needed); releasing it dismisses the button through a grace window.
  useEffect(() => {
    if (!ttsEnabled || fixedLayout) return;
    const keyName = sentenceHotkey === "shift" ? "Shift" : sentenceHotkey === "ctrl" ? "Control" : "Alt";
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
  }, [ttsEnabled, sentenceHotkey, fixedLayout, showSentencePlayAt, scheduleSentencePlayClear]);

  // Expose the reader area's pixel size as inherited CSS vars so illustrations
  // can be capped against it, and re-paginate the page-flip reader on resize.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => {
      host.style.setProperty("--reader-h", `${host.clientHeight}px`);
      host.style.setProperty("--reader-w", `${host.clientWidth}px`);
      if (modeRef.current === "paginated" && readyRef.current) {
        controllerRef.current?.refresh();
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // --- Load: parse (or load cached) once per book, independent of mode. ------
  useEffect(() => {
    if (!book) return;
    let cancelled = false;

    readyRef.current = false;
    anchorsRef.current = { anchors: [], total: 0 };
    controllerRef.current?.destroy();
    controllerRef.current = null;
    fixedDataRef.current = null;
    htmlRef.current = null;
    parsedRef.current = null;
    totalRef.current = 0;
    charRef.current = 0;
    setCurrentChar(0);
    setPageInfo(null);
    setFixedLayout(false);
    setSections([]);
    searchIndexRef.current = null;
    clearSearchHighlight();
    setLookupHighlight(null);
    setLookup(null);
    lastQueryRef.current = "";
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults({ results: [], total: 0, capped: false });

    (async () => {
      setStatus("loading");
      try {
        let parsed = await getCachedBook(book.id);
        if (!parsed) {
          const bytes = await api().readBook(book.id);
          parsed = await parseBook(new Blob([bytes as BlobPart]));
          await putCachedBook(book.id, parsed);
        }
        if (cancelled) return;

        const { html, objectUrls, keyToUrl } = buildReaderHtml(parsed.elementHtml, parsed.blobs);
        objectUrlsRef.current = objectUrls;
        parsedRef.current = parsed;
        htmlRef.current = html;
        footnotesRef.current = parsed.fixedLayout ? new Map() : collectFootnotes(html);
        // Gallery images share the object URLs above, so their lifetime is tied
        // to this book load (revoked together on unmount/book change).
        setIllustrations(parsed.fixedLayout ? [] : collectIllustrations(parsed.elementHtml, keyToUrl));
        const initialVertical = resolveVertical(useSettingsStore.getState().writingMode, parsed.vertical);
        verticalRef.current = initialVertical;
        charRef.current = book.exploredCharCount || 0;
        if (parsed.fixedLayout) {
          fixedDataRef.current = { pages: parsed.pages || [], ppd: parsed.ppd, bookViewport: parsed.bookViewport };
        }
        setVertical(initialVertical);
        setFixedLayout(!!parsed.fixedLayout);
        setSections(parsed.sections || []);
        setParseToken((t) => t + 1); // hand off to the render effect
      } catch (err) {
        console.error("Failed to open book", err);
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current = [];
    };
  }, [book]);

  // Load this book's bookmarks (independent of the parse/render pipeline).
  useEffect(() => {
    if (!book) {
      setBookmarks([]);
      return;
    }
    let cancelled = false;
    api()
      .listBookmarks(book.id)
      .then((list) => {
        if (!cancelled) setBookmarks(list || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [book]);

  // --- Render: (re)build the shadow content for the current mode. ------------
  // Runs when parsed content becomes ready and whenever the reading mode toggles
  // — never re-parsing, only re-laying-out, carrying the character position.
  useEffect(() => {
    const parsed = parsedRef.current;
    if (!parsed) return;

    // Fixed-layout renders through <FixedLayoutView>, which owns its own shadow
    // DOM and navigation. Nothing to build here — just mark it ready.
    if (parsed.fixedLayout) {
      modeRef.current = "fixed";
      readyRef.current = true;
      setStatus("ready");
      return;
    }

    const host = hostRef.current;
    const html = htmlRef.current;
    if (!host || !html) return;

    let cancelled = false;
    const vert = resolveVertical(writingMode, parsed.vertical);
    verticalRef.current = vert;
    setVertical(vert);
    const mode = readingMode;
    modeRef.current = mode;
    readyRef.current = false;
    setStatus("loading");

    const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
    applyReaderVars(host, useSettingsStore.getState(), useFontsStore.getState().customFonts);

    if (mode === "paginated") {
      shadow.innerHTML = `<style data-aoz-base>${paginatedStyles(vert)}</style><style>${parsed.styleSheet}</style><div class="aozora-content"><div class="aoz-page-content"></div></div>`;
      const scrollEl = shadow.querySelector(".aozora-content") as HTMLElement;
      const contentEl = shadow.querySelector(".aoz-page-content") as HTMLElement;
      applyFuriganaClass(scrollEl);
      bindRubyReveal(scrollEl);

      const temp = document.createElement("div");
      temp.innerHTML = html;
      // Mixed books: merge paired fixed-layout image pages into one spread
      // section so the controller renders them side by side on a single page.
      mergeSpreadSections(temp, parsed.spreadPairs, parsed.ppd);
      const sectionEls = Array.from(temp.children);

      const controller = new PaginatedController({
        scrollEl,
        contentEl,
        sections: sectionEls,
        vertical: vert,
        columns: useSettingsStore.getState().pageColumns,
        onChange: onPagedChange,
      });
      controllerRef.current = controller;
      totalRef.current = controller.charCount;

      (async () => {
        await controller.restoreToChar(charRef.current || 0);
        if (cancelled) return;
        readyRef.current = true;
        setStatus("ready");
      })();
    } else {
      shadow.innerHTML = `<style data-aoz-base>${continuousStyles(vert)}</style><style>${parsed.styleSheet}</style><div class="aozora-content">${html}</div>`;
      const contentEl = shadow.querySelector(".aozora-content");
      applyFuriganaClass(contentEl);
      bindRubyReveal(contentEl);
      anchorsRef.current = collectAnchors(contentEl!);
      totalRef.current = anchorsRef.current.total;

      requestAnimationFrame(() => {
        if (cancelled) return;
        restoreContinuous(vert);
        charRef.current = currentCharAtCenter(host, anchorsRef.current.anchors, vert);
        setCurrentChar(charRef.current);
        readyRef.current = true;
        setStatus("ready");
      });
    }

    return () => {
      cancelled = true;
      clearTimeout(saveTimerRef.current);
      cancelAnimationFrame(rafRef.current);
      persist();
      readyRef.current = false;
      clearSearchHighlight();
      setLookupHighlight(null);
      setLookup(null);
      lastQueryRef.current = "";
      controllerRef.current?.destroy();
      controllerRef.current = null;
      if (shadow) shadow.innerHTML = "";
    };
    // Content arrives via parseToken + the refs above; the omitted callbacks are
    // stable, so re-running on them would only re-layout. writingMode is here so
    // toggling text direction rebuilds the shadow content (position is char-based,
    // so it's preserved across the rebuild via charRef).
  }, [parseToken, readingMode, writingMode]);

  // Apply font/theme settings live, and re-flow to keep the reading position.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    applyReaderVars(host, { fontSize, lineHeight, fontFamily, theme, sideMargin }, customFonts);
    applyFuriganaClass(host.shadowRoot?.querySelector(".aozora-content"));
    if (!readyRef.current) return;
    if (modeRef.current === "paginated") {
      // Column count change re-flows the multi-column layout; refresh re-measures
      // and lands back on the current character.
      if (controllerRef.current) controllerRef.current.columns = pageColumns;
      controllerRef.current?.refresh();
      return;
    }
    const id = requestAnimationFrame(() => restoreContinuous(verticalRef.current));
    return () => cancelAnimationFrame(id);
  }, [fontSize, lineHeight, fontFamily, theme, furiganaMode, pageColumns, sideMargin, customFonts, restoreContinuous]);

  // Page-flip helpers (forward = toward the end of the book, regardless of mode).
  // Flipping invalidates the hovered sentence's box, so dismiss its read button.
  const flipNext = useCallback(() => {
    clearSentencePlay();
    controllerRef.current?.flipPage(1);
  }, [clearSentencePlay]);
  const flipPrev = useCallback(() => {
    clearSentencePlay();
    controllerRef.current?.flipPage(-1);
  }, [clearSentencePlay]);

  // Keyboard navigation for the page-flip reader. The fixed-layout viewer owns
  // its own key handling, so the reflowable handler stands down for manga.
  useEffect(() => {
    if (fixedLayout || readingMode !== "paginated") return;
    const onKey = (e: KeyboardEvent) => {
      if (panelOpenRef.current) return; // a panel/gallery is open — don't flip pages behind it
      if (e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
      const vert = verticalRef.current;
      switch (e.code) {
        case "ArrowLeft":
        case "KeyA":
          if (vert) flipNext();
          else flipPrev();
          break;
        case "ArrowRight":
        case "KeyD":
          if (vert) flipPrev();
          else flipNext();
          break;
        case "ArrowDown":
        case "PageDown":
          flipNext();
          break;
        case "ArrowUp":
        case "PageUp":
          flipPrev();
          break;
        case "Space":
          if (e.shiftKey) flipPrev();
          else flipNext();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fixedLayout, readingMode, flipNext, flipPrev]);

  // Recompute the continuous character offset at the viewport centre
  // (rAF-throttled) and debounce a save.
  const handleScroll = () => {
    if (modeRef.current !== "continuous") return;
    clearLookup(); // the matched run scrolled away
    clearSentencePlay(); // the hovered sentence's box moved
    setFootnote(null);
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const host = hostRef.current;
      if (!host || !anchorsRef.current.anchors.length) return;
      charRef.current = currentCharAtCenter(host, anchorsRef.current.anchors, verticalRef.current);
      setCurrentChar(charRef.current);
      markSession(charRef.current, "continuous");
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(persist, 800);
    });
  };

  // Wheel: continuous maps vertical wheel onto the horizontal axis for tategaki;
  // paginated flips one page per (throttled) wheel notch.
  const handleWheel = (e: React.WheelEvent) => {
    if (modeRef.current === "paginated") {
      const delta = e.deltaY || e.deltaX;
      if (!delta) return;
      const now = Date.now();
      if (now - wheelTsRef.current < 250) return;
      wheelTsRef.current = now;
      if (delta > 0) flipNext();
      else flipPrev();
      return;
    }
    if (!verticalRef.current) return; // horizontal books scroll natively
    const host = hostRef.current;
    if (!host || host.scrollWidth <= host.clientWidth) return;
    if (e.deltaY !== 0) host.scrollLeft -= e.deltaY;
  };

  const jumpToReference = (reference: string) => {
    const host = hostRef.current;
    const shadow = host?.shadowRoot;
    if (!host || !shadow) return false;
    if (!scrollToElementId(host, shadow, reference, verticalRef.current)) {
      return false;
    }
    requestAnimationFrame(() => {
      charRef.current = currentCharAtCenter(host, anchorsRef.current.anchors, verticalRef.current);
      setCurrentChar(charRef.current);
      persist();
    });
    return true;
  };

  const handleJump = (reference: string) => {
    setTocOpen(false);
    if (modeRef.current === "fixed") {
      fixedRef.current?.jumpToId(reference);
    } else if (modeRef.current === "paginated") {
      controllerRef.current?.jumpToSectionId(reference);
    } else {
      jumpToReference(reference);
    }
  };

  // Follow internal links in either mode. No click-to-flip (wheel/arrows only),
  // so text stays freely selectable.
  const handleContentClick = (e: React.MouseEvent) => {
    const path = (e.nativeEvent.composedPath?.() || []) as Element[];
    const anchor = path.find((n) => n?.tagName === "A");
    const href = anchor?.getAttribute("href");
    if (!href || href[0] !== "#") return;
    const id = decodeURIComponent(href.slice(1));
    // A noteref opens the note in a popup instead of jumping away from the prose.
    const note = footnotesRef.current.get(id);
    if (note && anchor) {
      e.preventDefault();
      clearLookup(); // don't stack a dictionary popup behind it
      setFootnote({ html: note, anchor: anchor.getBoundingClientRect() });
      return;
    }
    if (modeRef.current === "paginated") {
      if (id && controllerRef.current?.jumpToSectionId(id)) e.preventDefault();
    } else if (id && jumpToReference(id)) {
      e.preventDefault();
    }
  };

  // A content rebuild or mode switch invalidates the open note's anchor box.
  useEffect(() => setFootnote(null), [parseToken, readingMode]);

  // F11 toggles native fullscreen for distraction-free reading. Leaving the
  // reader drops fullscreen so the user can't get stuck with the title bar
  // hidden on a page that has no toggle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        window.electronAPI.window.toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (useUiStore.getState().fullscreen) window.electronAPI.window.toggleFullscreen();
    };
  }, []);

  // Silence any in-flight read-aloud (and clear its karaoke highlight / button) on leave.
  useEffect(
    () => () => {
      stopVoicevox();
      setKaraokeHighlight(null);
      clearSentencePlay();
    },
    [clearSentencePlay],
  );

  if (!book) return null;

  const paged = readingMode === "paginated";

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <Button variant="ghost" size="icon" onClick={close} aria-label="Back to library">
          <ArrowLeft className="size-4" />
        </Button>
        <p className="min-w-0 truncate text-xs font-medium tracking-tight">【{book.title}】</p>
        {total > 0 && (
          <>
            <div className="h-4 w-px shrink-0 bg-border" />
            <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
              {(paged || fixedLayout) && pageInfo && (
                <span className="tabular-nums">
                  {pageInfo.page + 1}
                  <span className="opacity-50">/{pageInfo.totalPages}</span>
                </span>
              )}
              <div className="flex items-center gap-1.5">
                <div className="h-1 w-14 overflow-hidden bg-muted">
                  <div className="h-full bg-muted-foreground/70 transition-[width] duration-300 ease-out" style={{ width: `${progressPct}%` }} />
                </div>
                <span className="w-8 text-right tabular-nums">{progressPct}%</span>
              </div>
            </div>
          </>
        )}
        <div className="flex-1" />
        <Button variant="ghost" size="icon" onClick={() => setTocOpen(true)} disabled={!chapters.length} aria-label="Table of contents">
          <List className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => setSearchOpen(true)} disabled={!total || fixedLayout} aria-label="Search in book">
          <Search className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setGalleryOpen(true)}
          disabled={!illustrations.length}
          aria-label="Illustrations"
        >
          <Images className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            setNameInput(computeDefaultName());
            setBookmarksOpen(true);
          }}
          aria-label="Bookmarks"
        >
          <Bookmark className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => window.electronAPI.window.toggleFullscreen()}
          aria-label={fullscreen ? "Exit full screen" : "Full screen"}
        >
          {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
        </Button>
        <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)} aria-label="Reader settings">
          <Settings className="size-4" />
        </Button>
      </header>

      <div className="relative flex-1 overflow-hidden">
        {status !== "ready" && (
          <div className="absolute inset-0 flex items-center justify-center bg-background">
            {status === "error" ? (
              <p className="text-sm text-muted-foreground">Could not open this book.</p>
            ) : (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            )}
          </div>
        )}
        {fixedLayout ? (
          fixedDataRef.current && (
            <FixedLayoutView
              ref={fixedRef}
              html={htmlRef.current || ""}
              styleSheet={parsedRef.current?.styleSheet || ""}
              pages={fixedDataRef.current.pages}
              ppd={fixedDataRef.current.ppd}
              bookViewport={fixedDataRef.current.bookViewport}
              initialOrdinal={book.exploredCharCount || 0}
              onChange={onFixedChange}
            />
          )
        ) : (
          <div
            ref={hostRef}
            onWheel={handleWheel}
            onScroll={handleScroll}
            onClick={handleContentClick}
            onMouseMove={handleMouseMove}
            onMouseLeave={scheduleClear}
            className={
              paged
                ? // Padding lives on the host (outside the shadow scroller) so it
                  // never disturbs the page-flip arithmetic; the scroller measures
                  // its own client box, so columns inset to match.
                  "h-full w-full overflow-hidden py-8 px-8"
                : vertical
                  ? "h-full w-full overflow-x-auto overflow-y-hidden"
                  : "h-full w-full overflow-y-auto overflow-x-hidden"
            }
          />
        )}
        <DictionaryPopup
          result={lookup?.result ?? null}
          anchor={lookup?.anchor ?? null}
          onLayout={handlePopupLayout}
          onMouseEnter={() => {
            popupHoveredRef.current = true;
            if (clearTimerRef.current) {
              clearTimeout(clearTimerRef.current);
              clearTimerRef.current = 0;
            }
          }}
          onMouseLeave={() => {
            popupHoveredRef.current = false;
            scheduleClear();
          }}
          onMine={ankiEnabled ? mineEntry : undefined}
          onSpeak={ttsEnabled ? speakText : undefined}
          hiddenForCapture={capturing}
        />
        {sentencePlay && (
          <button
            type="button"
            onMouseEnter={() => {
              sentenceBtnHoveredRef.current = true;
              if (sentenceTimerRef.current) {
                clearTimeout(sentenceTimerRef.current);
                sentenceTimerRef.current = 0;
              }
            }}
            onMouseLeave={() => {
              sentenceBtnHoveredRef.current = false;
              scheduleSentencePlayClear();
            }}
            onClick={() => playSentence(sentencePlay.sctx)}
            title="Read this sentence aloud"
            aria-label="Read this sentence aloud"
            style={{ position: "fixed", left: sentencePlay.left, top: sentencePlay.top }}
            className="z-50 inline-flex items-center gap-1 rounded-sm border bg-popover px-2 py-1 text-[11px] font-medium text-popover-foreground shadow-md hover:bg-accent hover:text-accent-foreground"
          >
            <Volume2 className="size-3.5" />
            Read sentence
          </button>
        )}
        <FootnotePopup html={footnote?.html ?? null} anchor={footnote?.anchor ?? null} onClose={() => setFootnote(null)} />
      </div>

      <ReaderToc open={tocOpen} onOpenChange={setTocOpen} chapters={chapters} activeChapterId={activeChapterId} onJump={handleJump} />

      <ReaderBookmarks
        open={bookmarksOpen}
        onOpenChange={setBookmarksOpen}
        bookmarks={bookmarks}
        nameInput={nameInput}
        onNameInputChange={setNameInput}
        onAdd={handleAddBookmark}
        onJump={jumpToChar}
        onRemove={handleRemoveBookmark}
      />

      <ReaderSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        query={searchQuery}
        onQueryChange={runSearch}
        results={searchDisplay}
        total={searchResults.total}
        capped={searchResults.capped}
        onJump={jumpToSearchResult}
      />

      <ReaderGallery
        open={galleryOpen}
        onOpenChange={setGalleryOpen}
        illustrations={illustrations}
        total={total}
        onSelect={(char) => {
          setGalleryOpen(false);
          jumpToChar(char);
        }}
      />

      <ReaderSettingsPanel open={settingsOpen} onOpenChange={setSettingsOpen} fixedLayout={fixedLayout} vertical={vertical} />
    </div>
  );
}
