import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bookmark, List, Loader2, Search, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useReaderStore } from "@/stores/reader-store";
import { useLibraryStore } from "@/stores/library-store";
import { useSettingsStore } from "@/stores/settings-store";
import { ReaderSettingsPanel } from "./settings-panel";
import { ReaderToc } from "./reader-toc";
import { ReaderBookmarks } from "./reader-bookmarks";
import { ReaderSearch } from "./reader-search";
import { applyReaderVars, continuousStyles, paginatedStyles } from "./reader-styles";
import { parseBook } from "@/lib/epub/parse-book";
import { buildReaderHtml } from "@/lib/epub/format-html";
import { getCachedBook, putCachedBook } from "@/lib/reader-cache";
import { collectAnchors, currentCharAtCenter, scrollToChar, scrollToElementId } from "@/lib/reader/position";
import { PaginatedController } from "@/lib/reader/paginated";
import { buildSearchIndex, searchIndex } from "@/lib/reader/search";
import { clearSearchHighlight, highlightSearchResult } from "@/lib/reader/highlight";

const api = () => window.electronAPI.library;

const FURIGANA_CLASSES = ["aoz-furigana-hide", "aoz-furigana-partial", "aoz-furigana-toggle", "aoz-furigana-full"];

/** Reflects the current furigana mode as a class on the content root. "show"
 *  clears the class so the book's own furigana styling applies untouched. */
function applyFuriganaClass(root) {
  if (!root) return;
  root.classList.remove(...FURIGANA_CLASSES);
  const mode = useSettingsStore.getState().furiganaMode;
  if (mode && mode !== "show") root.classList.add(`aoz-furigana-${mode}`);
}

/** Click-to-reveal for the toggle/full/partial furigana modes. Delegated on the
 *  persistent content root so it survives paginated section swaps (which replace
 *  the inner HTML). Reads the live mode on each click. */
function bindRubyReveal(root) {
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
 * Reader shell. The book is parsed once (or loaded from the IndexedDB cache),
 * its image references swapped for object URLs, and the flattened HTML rendered
 * inside a shadow root so the book's own CSS stays isolated from the app.
 *
 * Two layouts share that parsed content without re-parsing:
 *   - continuous: the whole HTML scrolls (tategaki scrolls horizontally);
 *   - paginated: one spine section at a time, flipped page by page.
 *
 * Reading position is a character offset (exploredCharCount), so it survives
 * re-flow (font/size changes) and switching between the two modes. It is
 * persisted (debounced) to the main process and restored on the next open.
 */
export function ReaderView() {
  const book = useReaderStore((s) => s.currentBook);
  const close = useReaderStore((s) => s.close);
  const applyProgress = useLibraryStore((s) => s.applyProgress);

  const fontSize = useSettingsStore((s) => s.fontSize);
  const lineHeight = useSettingsStore((s) => s.lineHeight);
  const fontFamily = useSettingsStore((s) => s.fontFamily);
  const theme = useSettingsStore((s) => s.theme);
  const readingMode = useSettingsStore((s) => s.readingMode);
  const furiganaMode = useSettingsStore((s) => s.furiganaMode);

  const hostRef = useRef(null);
  const parsedRef = useRef(null);
  const htmlRef = useRef(null);
  const objectUrlsRef = useRef([]);
  const anchorsRef = useRef({ anchors: [], total: 0 });
  const controllerRef = useRef(null);
  const totalRef = useRef(0);
  const verticalRef = useRef(false);
  const modeRef = useRef(readingMode);
  const charRef = useRef(0);
  const rafRef = useRef(0);
  const saveTimerRef = useRef(0);
  const wheelTsRef = useRef(0);
  const readyRef = useRef(false);
  const searchIndexRef = useRef(null); // lazily built on first search

  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [parseToken, setParseToken] = useState(0); // bumped when parsed content is ready
  // Writing direction comes from the EPUB itself (page-progression-direction /
  // the book's CSS); there is no manual override.
  const [vertical, setVertical] = useState(true);
  const [sections, setSections] = useState([]);
  const [currentChar, setCurrentChar] = useState(0);
  const [pageInfo, setPageInfo] = useState(null); // { page, totalPages } in paginated mode
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState([]);
  const [nameInput, setNameInput] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState({ results: [], total: 0, capped: false });

  const total = totalRef.current;
  const progressPct = total ? Math.round((currentChar / total) * 100) : 0;

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

  /** Scrolls the continuous reader to the tracked character (or the book start). */
  const restoreContinuous = useCallback((vert) => {
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
    (state) => {
      charRef.current = state.char;
      setCurrentChar(state.char);
      setPageInfo({ page: state.page, totalPages: state.totalPages });
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(persist, 800);
    },
    [persist],
  );

  // The bookmark name suggested for the current position: the current TOC
  // chapter's title + the reading-progress percentage (e.g. "第四章 · 45%").
  // The user can edit it before saving. Falls back to just the percentage when
  // the book has no TOC chapter covering this position.
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

  // Jumps the reader to a saved character offset, in whichever mode is active.
  const jumpToChar = useCallback(
    (char) => {
      setBookmarksOpen(false);
      charRef.current = char;
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

  const handleRemoveBookmark = useCallback(async (id) => {
    try {
      await api().removeBookmark(id);
      setBookmarks((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      console.error("Failed to remove bookmark", err);
    }
  }, []);

  // Runs a query against the (lazily built) in-book index. The index is derived
  // from the already-parsed HTML once and reused for every keystroke.
  const runSearch = useCallback((query) => {
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

  // Jumps to a search hit and highlights it in whichever mode is active. The
  // highlight is placed after the target paragraph is on screen (the paginated
  // controller renders its section asynchronously).
  const jumpToSearchResult = useCallback(
    async (result) => {
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
          highlightSearchResult(root()?.querySelector(".aoz-page-content"), result.charOffset, query, ctrl.sectionStart);
        });
        return;
      }
      jumpToChar(result.charOffset);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          highlightSearchResult(root()?.querySelector(".aozora-content"), result.charOffset, query, 0);
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
    htmlRef.current = null;
    parsedRef.current = null;
    totalRef.current = 0;
    charRef.current = 0;
    setCurrentChar(0);
    setPageInfo(null);
    setSections([]);
    searchIndexRef.current = null;
    clearSearchHighlight();
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults({ results: [], total: 0, capped: false });

    (async () => {
      setStatus("loading");
      try {
        let parsed = await getCachedBook(book.id);
        if (!parsed) {
          const bytes = await api().readBook(book.id);
          parsed = await parseBook(new Blob([bytes]));
          await putCachedBook(book.id, parsed);
        }
        if (cancelled) return;

        const { html, objectUrls } = buildReaderHtml(parsed.elementHtml, parsed.blobs);
        objectUrlsRef.current = objectUrls;
        parsedRef.current = parsed;
        htmlRef.current = html;
        verticalRef.current = parsed.vertical;
        charRef.current = book.exploredCharCount || 0;
        setVertical(parsed.vertical);
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
    const host = hostRef.current;
    const html = htmlRef.current;
    const parsed = parsedRef.current;
    if (!host || !html || !parsed) return;

    let cancelled = false;
    const vert = verticalRef.current;
    const mode = readingMode;
    modeRef.current = mode;
    readyRef.current = false;
    setStatus("loading");

    const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
    applyReaderVars(host, useSettingsStore.getState());

    if (mode === "paginated") {
      shadow.innerHTML = `<style data-aoz-base>${paginatedStyles(vert)}</style><style>${parsed.styleSheet}</style><div class="aozora-content"><div class="aoz-page-content"></div></div>`;
      const scrollEl = shadow.querySelector(".aozora-content");
      const contentEl = shadow.querySelector(".aoz-page-content");
      applyFuriganaClass(scrollEl);
      bindRubyReveal(scrollEl);

      const temp = document.createElement("div");
      temp.innerHTML = html;
      const sectionEls = Array.from(temp.children);

      const controller = new PaginatedController({
        scrollEl,
        contentEl,
        sections: sectionEls,
        vertical: vert,
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
      anchorsRef.current = collectAnchors(contentEl);
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
      controllerRef.current?.destroy();
      controllerRef.current = null;
      if (shadow) shadow.innerHTML = "";
    };
    // persist/restoreContinuous/onPagedChange are stable; book content arrives
    // via parseToken and the refs above. Re-running here would re-layout only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parseToken, readingMode]);

  // Apply font/theme settings live, and re-flow to keep the reading position.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    applyReaderVars(host, { fontSize, lineHeight, fontFamily, theme });
    applyFuriganaClass(host.shadowRoot?.querySelector(".aozora-content"));
    if (!readyRef.current) return;
    if (modeRef.current === "paginated") {
      controllerRef.current?.refresh();
      return;
    }
    const id = requestAnimationFrame(() => restoreContinuous(verticalRef.current));
    return () => cancelAnimationFrame(id);
  }, [fontSize, lineHeight, fontFamily, theme, furiganaMode, restoreContinuous]);

  // Page-flip helpers (forward = toward the end of the book, regardless of mode).
  const flipNext = useCallback(() => controllerRef.current?.flipPage(1), []);
  const flipPrev = useCallback(() => controllerRef.current?.flipPage(-1), []);

  // Keyboard navigation for the page-flip reader.
  useEffect(() => {
    if (readingMode !== "paginated") return;
    const onKey = (e) => {
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
  }, [readingMode, flipNext, flipPrev]);

  // Recompute the continuous character offset at the viewport centre
  // (rAF-throttled) and debounce a save.
  const handleScroll = () => {
    if (modeRef.current !== "continuous") return;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const host = hostRef.current;
      if (!host || !anchorsRef.current.anchors.length) return;
      charRef.current = currentCharAtCenter(host, anchorsRef.current.anchors, verticalRef.current);
      setCurrentChar(charRef.current);
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(persist, 800);
    });
  };

  // Wheel: continuous maps vertical wheel onto the horizontal axis for tategaki;
  // paginated flips one page per (throttled) wheel notch.
  const handleWheel = (e) => {
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

  const jumpToReference = (reference) => {
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

  const handleJump = (reference) => {
    setTocOpen(false);
    if (modeRef.current === "paginated") {
      controllerRef.current?.jumpToSectionId(reference);
    } else {
      jumpToReference(reference);
    }
  };

  // Click handling: follow internal links in either mode. (Page flipping is via
  // the mouse wheel and arrow keys only — no click-to-flip — so text stays
  // freely selectable.)
  const handleContentClick = (e) => {
    const path = e.nativeEvent.composedPath?.() || [];
    const anchor = path.find((n) => n?.tagName === "A");
    const href = anchor?.getAttribute("href");
    if (!href || href[0] !== "#") return;
    const id = decodeURIComponent(href.slice(1));
    if (modeRef.current === "paginated") {
      if (id && controllerRef.current?.jumpToSectionId(id)) e.preventDefault();
    } else if (id && jumpToReference(id)) {
      e.preventDefault();
    }
  };

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
              {paged && pageInfo && (
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
        <Button variant="ghost" size="icon" onClick={() => setSearchOpen(true)} disabled={!total} aria-label="Search in book">
          <Search className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => setTocOpen(true)} disabled={!chapters.length} aria-label="Table of contents">
          <List className="size-4" />
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
        <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)} aria-label="Reader settings">
          <Settings2 className="size-4" />
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
        <div
          ref={hostRef}
          onWheel={handleWheel}
          onScroll={handleScroll}
          onClick={handleContentClick}
          className={
            paged
              ? // Outer padding lives here (on the host, outside the shadow
                // scroller) so it never disturbs the page-flip arithmetic. The
                // scroller measures its own client box, so columns inset to
                // match. Tune freely: py-* = top/bottom, px-* = sides.
                "h-full w-full overflow-hidden py-8 px-8"
              : vertical
                ? "h-full w-full overflow-x-auto overflow-y-hidden"
                : "h-full w-full overflow-y-auto overflow-x-hidden"
          }
        />
      </div>

      <ReaderToc
        open={tocOpen}
        onOpenChange={setTocOpen}
        chapters={chapters}
        activeChapterId={activeChapterId}
        onJump={handleJump}
      />

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

      <ReaderSettingsPanel open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
