import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bookmark, Highlighter, Images, List, Loader2, Maximize, Minimize, Search, Settings, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useReaderStore } from "@/stores/reader-store";
import { useLibraryStore } from "@/stores/library-store";
import { useSettingsStore, type WritingMode } from "@/stores/settings-store";
import { useFontsStore } from "@/stores/fonts-store";
import { useUiStore } from "@/stores/ui-store";
import { ReaderSettingsPanel } from "./settings-panel";
import { ReaderToc } from "./reader-toc";
import { ReaderBookmarks } from "./reader-bookmarks";
import { ReaderAnnotations } from "./reader-annotations";
import { AnnotationPopover } from "./annotation-popover";
import { AnnotationTrigger } from "./annotation-trigger";
import { ReaderSearch } from "./reader-search";
import { ReaderGallery } from "./reader-gallery";
import { collectIllustrations, type Illustration } from "@/lib/reader/illustrations";
import { applyReaderVars, continuousStyles, paginatedStyles } from "./reader-styles";
import { parseBook, type ParsedBook, type FixedLayoutPage } from "@/lib/epub/parse-book";
import type { Section } from "@/lib/epub/generate-html";
import type { Bookmark as BookmarkRecord } from "@/lib/types";
import { buildReaderHtml } from "@/lib/epub/format-html";
import { getCachedBook, putCachedBook } from "@/lib/reader-cache";
import { collectAnchors, currentCharAtCenter, scrollToChar, scrollToElementId, type Anchor } from "@/lib/reader/position";
import { PaginatedController, type PaginatedState } from "@/lib/reader/paginated";
import { mergeSpreadSections } from "@/lib/reader/merge-spreads";
import { FixedLayoutView, type FixedLayoutHandle } from "./fixed-layout-view";
import { buildSearchIndex, searchIndex, type SearchResult, type SearchIndexEntry } from "@/lib/reader/search";
import { clearSearchHighlight, highlightSearchResult } from "@/lib/reader/highlight";
import {
  paintAnnotations,
  clearAnnotationHighlights,
  rangeToCharSpan,
  charOffsetAt,
  annotationAtOffset,
  DEFAULT_ANNOTATION_COLOR,
} from "@/lib/reader/annotations";
import { caretRangeFromPoint } from "@/lib/reader/lookup-text";
import type { Annotation } from "@/lib/types";
import { useDictionaryStore } from "@/stores/dictionary-store";
import { useAnkiStore } from "@/stores/anki-store";
import { useTtsStore } from "@/stores/tts-store";
import { DictionaryPopup } from "./dictionary-popup";
import { FootnotePopup } from "./footnote-popup";
import { collectFootnotes } from "@/lib/reader/footnotes";
import { useReadingSession } from "./use-reading-session";
import { useHoverDictionary } from "./use-hover-dictionary";
import { useSentencePlay } from "./use-sentence-play";

const api = () => window.electronAPI.library;

/** Highlight editor state: anchored to a fresh selection (id null, awaiting a
 *  colour pick) or an existing highlight (id set, editable). */
interface AnnoPopoverState {
  anchor: DOMRect;
  id: string | null;
  color: string;
  note: string;
  startChar: number;
  endChar: number;
  text: string;
}

/** Pending selection awaiting the highlight button: the trigger anchors to `point`
 *  (mouse-release), picking it opens the editor against `rect` (selection box). No
 *  highlight exists until then. */
interface AnnoTriggerState {
  point: { x: number; y: number };
  rect: DOMRect;
  startChar: number;
  endChar: number;
  text: string;
}

const FURIGANA_CLASSES = ["aoz-furigana-hide", "aoz-furigana-partial", "aoz-furigana-toggle", "aoz-furigana-full"];

/** Effective writing direction: the user's override, or the book's own when "auto". */
function resolveVertical(mode: WritingMode, bookVertical: boolean): boolean {
  return mode === "auto" ? bookVertical : mode === "vertical";
}

/** Index of the last chapter that starts at or before `char` (chapters are in
 *  document order), or -1 if none — the shared basis for the active-chapter
 *  indicator, Discord presence, bookmark names, and search-result labels. */
function chapterIndexAt(chapters: Section[], char: number): number {
  let idx = -1;
  for (let i = 0; i < chapters.length; i++) {
    if ((chapters[i].startCharacter ?? 0) <= char) idx = i;
    else break;
  }
  return idx;
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
  // Kanji cards need their own note type; only offer the button once it's set up.
  const ankiKanjiEnabled = useAnkiStore((s) => s.enabled && !!s.kanjiDeck && !!s.kanjiModel && Object.keys(s.kanjiFields).length > 0);
  const ttsEnabled = useTtsStore((s) => s.enabled);
  const sentenceHotkey = useTtsStore((s) => s.sentenceHotkey);
  const voicevoxSpeaker = useTtsStore((s) => s.voicevoxSpeaker);
  const voicevoxServer = useTtsStore((s) => s.voicevoxServer);

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
  const annotationsRef = useRef<Annotation[]>([]); // mirror of the annotations state, for ref-only callers
  const annoPopoverRef = useRef<AnnoPopoverState | null>(null); // mirror, so close/save can read without a dep

  const dictEnabled = useDictionaryStore((s) => s.enabled);
  const dictModifier = useDictionaryStore((s) => s.modifier);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [parseToken, setParseToken] = useState(0); // bumped when parsed content is ready
  const [fixedLayout, setFixedLayout] = useState(false); // manga / fixed-layout book
  // Effective writing direction (see resolveVertical); drives the host overflow axis.
  const [vertical, setVertical] = useState(true);
  const [sections, setSections] = useState<Section[]>([]);
  const [currentChar, setCurrentChar] = useState(0);
  const [pageInfo, setPageInfo] = useState<{ page: number; totalPages: number } | null>(null); // paginated mode
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<BookmarkRecord[]>([]);
  const [nameInput, setNameInput] = useState("");
  const [annotationsOpen, setAnnotationsOpen] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [annoPopover, setAnnoPopover] = useState<AnnoPopoverState | null>(null);
  const [annoTrigger, setAnnoTrigger] = useState<AnnoTriggerState | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [illustrations, setIllustrations] = useState<Illustration[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ results: SearchResult[]; total: number; capped: boolean }>({
    results: [],
    total: 0,
    capped: false,
  });
  const [footnote, setFootnote] = useState<{ html: string; anchor: DOMRect } | null>(null);

  // Mirrors whether any reader overlay (panel/gallery) is open, so the global
  // page-flip key handler can stand down instead of flipping pages behind it.
  const panelOpenRef = useRef(false);
  panelOpenRef.current = tocOpen || settingsOpen || bookmarksOpen || searchOpen || galleryOpen || annotationsOpen;

  // Ref mirrors so the paginated onChange callback (bound once at construction)
  // and the popover close/save handlers can read current values without deps.
  annotationsRef.current = annotations;
  annoPopoverRef.current = annoPopover;

  const total = totalRef.current;
  // Fixed-layout position is a page ordinal, so the last page (total-1) is 100%;
  // reflowable position is a character offset out of the total.
  const progressPct = total ? Math.round((fixedLayout && total > 1 ? currentChar / (total - 1) : currentChar / total) * 100) : 0;

  // Chapters that carry a TOC label (sub-sections fold into their parent).
  const chapters = useMemo(() => sections.filter((s) => s.label), [sections]);
  const activeChapterIndex = useMemo(() => chapterIndexAt(chapters, currentChar), [chapters, currentChar]);
  const activeChapterId = activeChapterIndex >= 0 ? chapters[activeChapterIndex].reference : null;

  // Discord Rich Presence: mirror the current book/chapter/progress while reading.
  // Enabling/disabling and the idle presence live in App (always mounted); the
  // main process throttles the actual sends.
  useEffect(() => {
    if (!discordRichPresence || !book) return;
    const idx = activeChapterIndex;
    window.electronAPI.discord.update({
      bookTitle: book.title,
      author: book.author,
      chapterName: idx >= 0 ? chapters[idx].label : undefined,
      chapterIndex: idx >= 0 ? idx + 1 : undefined,
      chapterTotal: chapters.length || undefined,
      progress: progressPct,
      coverBookId: discordCover ? book.id : undefined, // opt-in: main uploads the cover for the large image
    });
  }, [discordRichPresence, discordCover, book, chapters, activeChapterIndex, progressPct]);

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

  // Hover dictionary (lookup + popup + Anki mining) and read-aloud (sentence
  // button + karaoke) both hang off the reader's shadow content; they read
  // hostRef/modeRef but keep their own timers/refs. Character position stays here.
  const {
    lookup,
    capturing,
    clearLookup,
    mineEntry,
    mineKanji,
    onMouseMove: onDictMouseMove,
    onMouseLeave: onDictMouseLeave,
    onPopupLayout,
    onPopupEnter,
    onPopupLeave,
  } = useHoverDictionary({ hostRef, modeRef, book, enabled: dictEnabled, modifier: dictModifier, fixedLayout });
  const {
    sentencePlay,
    speakText,
    playSentence,
    clearSentencePlay,
    onMouseMove: onTtsMouseMove,
    onButtonEnter,
    onButtonLeave,
  } = useSentencePlay({ hostRef, modeRef, enabled: ttsEnabled, hotkey: sentenceHotkey, fixedLayout, voicevoxServer, voicevoxSpeaker });

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

  /** Repaints the highlight washes for whatever region is currently rendered
   *  (the whole book in continuous mode, the current section in paginated). Reads
   *  refs only, so it's stable and safe to call from the controller's onChange. */
  const repaintAnnotations = useCallback(() => {
    if (!readyRef.current) return;
    const shadow = hostRef.current?.shadowRoot;
    if (!shadow) return;
    if (modeRef.current === "paginated") {
      paintAnnotations(shadow.querySelector(".aoz-page-content"), annotationsRef.current, controllerRef.current?.sectionStart ?? 0);
    } else if (modeRef.current === "continuous") {
      paintAnnotations(shadow.querySelector(".aozora-content"), annotationsRef.current, 0);
    }
  }, []);

  // Closes the highlight editor, persisting a changed note for an existing one.
  // Stable (reads refs only) so scroll/flip handlers can dismiss it.
  const closeAnnoPopover = useCallback(() => {
    const p = annoPopoverRef.current;
    if (!p) return;
    if (p.id) {
      const current = annotationsRef.current.find((a) => a.id === p.id);
      const note = p.note.trim();
      if (current && (current.note ?? "") !== note) {
        setAnnotations((prev) => prev.map((a) => (a.id === p.id ? { ...a, note: note || null } : a)));
        api()
          .updateAnnotation({ id: p.id, note: note || null })
          .catch(() => {});
      }
    }
    setAnnoPopover(null);
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
      setAnnoTrigger(null); // the pending selection flipped away
      closeAnnoPopover(); // its anchored selection flipped away
      repaintAnnotations(); // the new section's highlights (previous section's cleared)
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(persist, 800);
    },
    [persist, markSession, clearLookup, repaintAnnotations, closeAnnoPopover],
  );

  // Position updates from the fixed-layout viewer: a 0-based page ordinal. Progress
  // reaches 1 on the last page so finished manga count as read.
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
    const i = chapterIndexAt(chapters, char);
    const label = i >= 0 ? chapters[i].label || "" : "";
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

  // --- Highlights (annotations). ---------------------------------------------

  // Picks a colour in the editor: creates the highlight (from a fresh selection)
  // or recolours the existing one. The highlight only lands in the DB on this
  // first colour pick, so merely selecting text to copy never persists anything.
  const handleAnnoColor = useCallback(
    async (color: string) => {
      const p = annoPopoverRef.current;
      if (!p || !book) return;
      if (p.id) {
        setAnnotations((prev) => prev.map((a) => (a.id === p.id ? { ...a, color } : a)));
        setAnnoPopover({ ...p, color });
        api()
          .updateAnnotation({ id: p.id, color })
          .catch(() => {});
        return;
      }
      const totalChars = totalRef.current || 0;
      const progress = totalChars ? Math.min(1, Math.max(0, p.startChar / totalChars)) : 0;
      try {
        const rec = await api().addAnnotation({
          bookId: book.id,
          startChar: p.startChar,
          endChar: p.endChar,
          color,
          snippet: p.text.slice(0, 160) || undefined,
          progress,
        });
        if (rec) {
          setAnnotations((prev) => [...prev, rec].sort((a, b) => a.startChar - b.startChar || a.createdAt - b.createdAt));
          setAnnoPopover({ ...p, id: rec.id, color });
          // Drop the text selection so it doesn't sit highlighted under the wash.
          (hostRef.current?.shadowRoot as ShadowRoot & { getSelection?: () => Selection | null })?.getSelection?.()?.removeAllRanges?.();
        }
      } catch (err) {
        console.error("Failed to add highlight", err);
      }
    },
    [book],
  );

  const handleRemoveAnnotation = useCallback(async (id: string) => {
    if (annoPopoverRef.current?.id === id) setAnnoPopover(null);
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
    try {
      await api().removeAnnotation(id);
    } catch (err) {
      console.error("Failed to remove highlight", err);
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
      const i = chapterIndexAt(chapters, r.charOffset);
      const label = i >= 0 ? chapters[i].label || "" : "";
      const progress = total ? Math.round((r.charOffset / total) * 100) : 0;
      return { ...r, label, progress };
    });
  }, [searchResults, chapters, total]);

  // Fan the reader's mousemove out to both hover gestures; each records the
  // cursor and scans/reveals per its own modifier.
  const handleMouseMove = (e: React.MouseEvent) => {
    onTtsMouseMove(e);
    onDictMouseMove(e);
  };

  /** The content root + section base char for the currently-rendered region. */
  const currentContentRoot = useCallback((): { root: Element | null; base: number } => {
    const shadow = hostRef.current?.shadowRoot;
    if (!shadow) return { root: null, base: 0 };
    if (modeRef.current === "paginated") {
      return { root: shadow.querySelector(".aoz-page-content"), base: controllerRef.current?.sectionStart ?? 0 };
    }
    return { root: shadow.querySelector(".aozora-content"), base: 0 };
  }, []);

  // Finishing a selection surfaces the highlight trigger at the mouse-release point
  // (not the full editor, which would cover what you read). Picking it opens the
  // editor; ignoring it leaves the selection. Fixed-layout has no selectable text.
  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (modeRef.current === "fixed") return;
      const shadow = hostRef.current?.shadowRoot as (ShadowRoot & { getSelection?: () => Selection | null }) | undefined;
      const sel = shadow?.getSelection?.() ?? window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const { root, base } = currentContentRoot();
      if (!root || !root.contains(range.commonAncestorContainer)) return;
      const span = rangeToCharSpan(root, range, base);
      if (!span) return;
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      clearLookup();
      setFootnote(null);
      setAnnoPopover(null);
      setAnnoTrigger({ point: { x: e.clientX, y: e.clientY }, rect, startChar: span.startChar, endChar: span.endChar, text: span.text });
    },
    [currentContentRoot, clearLookup],
  );

  // Trigger → editor: promote the pending selection into the colour/note editor,
  // anchored to the selection box. No colour pre-selected, so picking one is what
  // creates the highlight.
  const openAnnoEditor = useCallback(() => {
    const t = annoTrigger;
    if (!t) return;
    setAnnoTrigger(null);
    setAnnoPopover({ anchor: t.rect, id: null, color: "", note: "", startChar: t.startChar, endChar: t.endChar, text: t.text });
  }, [annoTrigger]);

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
    clearAnnotationHighlights();
    clearLookup();
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults({ results: [], total: 0, capped: false });
    setAnnotations([]);
    setAnnoPopover(null);

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

  // Load this book's highlights (repainted onto the content by the effect below).
  useEffect(() => {
    if (!book) {
      setAnnotations([]);
      return;
    }
    let cancelled = false;
    api()
      .listAnnotations(book.id)
      .then((list) => {
        if (!cancelled) setAnnotations(list || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [book]);

  // Repaint whenever the highlight set changes (add / recolour / delete), the
  // content is rebuilt, or the feature is toggled. Continuous ranges persist
  // across scroll/reflow, so this need not run on scroll; paginated section swaps
  // repaint via onPagedChange.
  useEffect(() => {
    repaintAnnotations();
  }, [annotations, parseToken, repaintAnnotations]);

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
        repaintAnnotations();
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
        repaintAnnotations();
      });
    }

    return () => {
      cancelled = true;
      clearTimeout(saveTimerRef.current);
      cancelAnimationFrame(rafRef.current);
      persist();
      readyRef.current = false;
      clearSearchHighlight();
      clearAnnotationHighlights();
      clearLookup();
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
    setAnnoTrigger(null); // the pending selection scrolled away
    if (annoPopoverRef.current) closeAnnoPopover(); // its anchored selection scrolled away
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
    if (href && href[0] === "#") {
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
      return;
    }

    // Not a link: a click landing on an existing highlight opens its editor. Skip
    // while a selection is active (that's a fresh highlight — handleMouseUp owns it).
    if (modeRef.current === "fixed") return;
    const shadow = hostRef.current?.shadowRoot as (ShadowRoot & { getSelection?: () => Selection | null }) | undefined;
    const sel = shadow?.getSelection?.() ?? window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const { root, base } = currentContentRoot();
    if (!root) return;
    const caret = caretRangeFromPoint(e.clientX, e.clientY, root);
    if (!caret) return;
    const offset = charOffsetAt(root, caret.startContainer, caret.startOffset, base);
    const hit = annotationAtOffset(annotationsRef.current, offset);
    if (!hit) return;
    clearLookup();
    setFootnote(null);
    setAnnoPopover({
      anchor: new DOMRect(e.clientX, e.clientY, 0, 0),
      id: hit.id,
      color: hit.color,
      note: hit.note ?? "",
      startChar: hit.startChar,
      endChar: hit.endChar,
      text: hit.snippet ?? "",
    });
  };

  // A content rebuild or mode switch invalidates the open note / highlight-editor
  // anchor box.
  useEffect(() => {
    setFootnote(null);
    setAnnoPopover(null);
    setAnnoTrigger(null);
  }, [parseToken, readingMode]);

  // F11 toggles native fullscreen. Leaving the reader drops it so the user can't
  // get stuck with the title bar hidden on a page that has no toggle.
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
        <Button variant="ghost" size="icon" onClick={() => setGalleryOpen(true)} disabled={!illustrations.length} aria-label="Illustrations">
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
        <Button variant="ghost" size="icon" onClick={() => setAnnotationsOpen(true)} disabled={!total || fixedLayout} aria-label="Highlights">
          <Highlighter className="size-4" />
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
            onMouseUp={handleMouseUp}
            onMouseMove={handleMouseMove}
            onMouseLeave={onDictMouseLeave}
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
          onLayout={onPopupLayout}
          onMouseEnter={onPopupEnter}
          onMouseLeave={onPopupLeave}
          onMine={ankiEnabled ? mineEntry : undefined}
          onMineKanji={ankiKanjiEnabled ? mineKanji : undefined}
          onSpeak={ttsEnabled ? speakText : undefined}
          hiddenForCapture={capturing}
        />
        {sentencePlay && (
          <button
            type="button"
            onMouseEnter={onButtonEnter}
            onMouseLeave={onButtonLeave}
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
        <AnnotationTrigger point={annoTrigger?.point ?? null} onPick={openAnnoEditor} onClose={() => setAnnoTrigger(null)} />
        <AnnotationPopover
          anchor={annoPopover?.anchor ?? null}
          color={annoPopover?.color ?? DEFAULT_ANNOTATION_COLOR}
          note={annoPopover?.note ?? ""}
          isNew={!annoPopover?.id}
          onColor={handleAnnoColor}
          onNote={(note) => setAnnoPopover((p) => (p ? { ...p, note } : p))}
          onDelete={annoPopover?.id ? () => handleRemoveAnnotation(annoPopover.id!) : undefined}
          onClose={closeAnnoPopover}
        />
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

      <ReaderAnnotations
        open={annotationsOpen}
        onOpenChange={setAnnotationsOpen}
        annotations={annotations}
        onJump={jumpToChar}
        onRemove={handleRemoveAnnotation}
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
