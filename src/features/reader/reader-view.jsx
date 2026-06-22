import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, List, Loader2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useReaderStore } from "@/stores/reader-store";
import { useLibraryStore } from "@/stores/library-store";
import { useSettingsStore, FONT_STACKS, THEMES } from "@/stores/settings-store";
import { ReaderSettingsPanel } from "./settings-panel";
import { parseBook } from "@/lib/epub/parse-book";
import { buildReaderHtml } from "@/lib/epub/format-html";
import { getCachedBook, putCachedBook } from "@/lib/reader-cache";
import { collectAnchors, currentCharAtCenter, scrollToChar, scrollToElementId } from "@/lib/reader/position";
import { PaginatedController } from "@/lib/reader/paginated";

const api = () => window.electronAPI.library;

/** Display rules shared by both reading modes (driven by inherited CSS vars). */
const SHARED_DISPLAY = `
  font-size: var(--reader-font-size, 1.25rem);
  line-height: var(--reader-line-height, 1.8);
  color: var(--reader-color, #1f1d1a);
  background: var(--reader-bg, #faf8f4);
`;

/**
 * Continuous (scroll) reader CSS. Display properties come from inherited CSS
 * custom properties set on the shadow host, so settings changes apply live
 * without re-parsing. Only the writing mode (which also flips the
 * horizontal-only centring) is baked in, so this is re-injected on toggle.
 */
function continuousStyles(vertical) {
  return `
    :host { display: block; height: 100%; }
    .aozora-content {
      height: 100%;
      box-sizing: border-box;
      padding: 2.5rem 3rem;
      writing-mode: ${vertical ? "vertical-rl" : "horizontal-tb"};
      ${vertical ? "" : "max-width: 42rem; margin: 0 auto;"}
      ${SHARED_DISPLAY}
    }
    /* Give the structural wrappers a definite height so full-page images can
       size against the viewport instead of collapsing to zero. */
    .aozora-content > div,
    .aozora-content .aoz-book-html-wrapper,
    .aozora-content .aoz-book-body-wrapper { height: 100%; }
    /* Breathing room around full-page image spreads (image-only spine items)
       so consecutive illustrations don't sit flush against each other. The
       margin is on the inter-page (block) axis, correct for both writing modes. */
    .aozora-content > div:has(.aoz-no-text) { margin-block: 2.5rem; }
    ${imageRules(".aozora-content")}
    .aozora-content a { color: inherit; }
    /* The reader's font choice must win over fonts the book hardcodes on its
       own elements — many 電書協-template novels set font-family directly on
       body/p/spans, which would otherwise override the inherited container
       font (that's why "Serif" appeared to do nothing on some volumes). Apply
       it across the subtree; gaiji/illustrations are images and unaffected. */
    .aozora-content,
    .aozora-content * {
      font-family: var(--reader-font-family, serif) !important;
    }
  `;
}

/**
 * Paginated (page-flip) reader CSS. The `.aozora-content` element is a fixed,
 * overflow-hidden viewport; `.aoz-page-content` is the multi-column container
 * the controller sizes and scrolls. One spine section is rendered at a time, so
 * each chapter begins on a fresh page.
 */
function paginatedStyles(vertical) {
  return `
    :host { display: block; height: 100%; }
    .aozora-content {
      box-sizing: border-box;
      height: 100%;
      width: 100%;
      overflow: hidden;
      writing-mode: ${vertical ? "vertical-rl" : "horizontal-tb"};
      ${SHARED_DISPLAY}
    }
    ${imageRules(".aozora-content", "6rem", "8rem")}
    .aoz-page-content p { break-inside: avoid; }
    .aozora-content a { color: inherit; }
    .aozora-content,
    .aozora-content * {
      font-family: var(--reader-font-family, serif) !important;
    }
  `;
}

/**
 * Illustration sizing, shared by both modes. width/height auto !important
 * overrides the book's width="100%"/height="100%", which otherwise collapse to
 * 0 in vertical writing mode. The image is often buried under auto-height/inline
 * wrappers, so percentage max-* can't resolve — cap against the measured reader
 * size instead (5rem/6rem account for the content padding).
 */
function imageRules(scope, padV = "5rem", padH = "6rem") {
  return `
    ${scope} svg,
    ${scope} img:not([class*="gaiji"]) {
      width: auto !important;
      height: auto !important;
      max-height: calc(var(--reader-h, 100vh) - ${padV});
      max-width: calc(var(--reader-w, 100vw) - ${padH});
      break-inside: avoid;
      margin: auto;
    }
  `;
}

/** Writes the reader display settings onto the host as inherited CSS vars. */
function applyReaderVars(host, { fontSize, lineHeight, fontFamily, theme }) {
  if (!host) return;
  const t = THEMES[theme] || THEMES.sepia;
  host.style.setProperty("--reader-font-size", `${fontSize}px`);
  host.style.setProperty("--reader-line-height", String(lineHeight));
  host.style.setProperty("--reader-font-family", FONT_STACKS[fontFamily] || FONT_STACKS.serif);
  host.style.setProperty("--reader-color", t.color);
  host.style.setProperty("--reader-bg", t.bg);
  // Paint the host itself so the page-flip mode's outer padding (applied on the
  // host element, outside the shadow scroller) shares the page colour.
  host.style.backgroundColor = t.bg;
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
    if (!readyRef.current) return;
    if (modeRef.current === "paginated") {
      controllerRef.current?.refresh();
      return;
    }
    const id = requestAnimationFrame(() => restoreContinuous(verticalRef.current));
    return () => cancelAnimationFrame(id);
  }, [fontSize, lineHeight, fontFamily, theme, restoreContinuous]);

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
        <Button variant="ghost" size="icon" onClick={() => setTocOpen(true)} disabled={!chapters.length} aria-label="Table of contents">
          <List className="size-4" />
        </Button>
        <p className="min-w-0 flex-1 truncate text-xs font-medium">{book.title}</p>
        {paged && pageInfo && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {pageInfo.page + 1} / {pageInfo.totalPages}
          </span>
        )}
        {total > 0 && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{progressPct}%</span>}
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

      <Sheet open={tocOpen} onOpenChange={setTocOpen}>
        <SheetContent side="left" className="w-72 gap-0 p-0 sm:max-w-72">
          <SheetHeader className="border-b">
            <SheetTitle>Table of Contents</SheetTitle>
          </SheetHeader>
          <nav className="flex-1 overflow-y-auto p-2">
            {chapters.map((ch) => (
              <button
                key={ch.reference}
                type="button"
                onClick={() => handleJump(ch.reference)}
                className={`block w-full truncate rounded-none px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent ${
                  ch.reference === activeChapterId ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground"
                }`}
                title={ch.label}
              >
                {ch.label}
              </button>
            ))}
          </nav>
        </SheetContent>
      </Sheet>

      <ReaderSettingsPanel open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
