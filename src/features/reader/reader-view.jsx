import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, List, Loader2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useReaderStore } from "@/stores/reader-store";
import { useLibraryStore } from "@/stores/library-store";
import {
  useSettingsStore,
  FONT_STACKS,
  THEMES,
} from "@/stores/settings-store";
import { ReaderSettingsPanel } from "./settings-panel";
import { parseBook } from "@/lib/epub/parse-book";
import { buildReaderHtml } from "@/lib/epub/format-html";
import { getCachedBook, putCachedBook } from "@/lib/reader-cache";
import {
  collectAnchors,
  currentCharAtCenter,
  scrollToChar,
  scrollToElementId,
} from "@/lib/reader/position";

const api = () => window.electronAPI.library;

/**
 * Reader CSS. Display properties (font, size, line-height, colours) come from
 * inherited CSS custom properties set on the shadow host, so settings changes
 * apply live without re-parsing. Only the writing mode (which also flips the
 * horizontal-only centring) is baked in, so this is re-injected on toggle.
 */
function baseStyles(vertical) {
  return `
    :host { display: block; height: 100%; }
    .aozora-content {
      height: 100%;
      box-sizing: border-box;
      padding: 2.5rem 3rem;
      writing-mode: ${vertical ? "vertical-rl" : "horizontal-tb"};
      ${vertical ? "" : "max-width: 42rem; margin: 0 auto;"}
      font-size: var(--reader-font-size, 1.25rem);
      line-height: var(--reader-line-height, 1.8);
      font-family: var(--reader-font-family, serif);
      color: var(--reader-color, #1f1d1a);
      background: var(--reader-bg, #faf8f4);
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
    /* Illustrations (svg / non-gaiji img): fit the viewport, keep aspect ratio.
       width/height auto !important overrides the book's width="100%"/height="100%",
       which otherwise collapse to 0 in vertical writing mode. The image is often
       buried under auto-height/inline wrappers (.main > p > span.koboSpan), so
       percentage max-* can't resolve — cap against the measured reader size
       instead (5rem/6rem account for .aozora-content padding). */
    .aozora-content svg,
    .aozora-content img:not([class*="gaiji"]) {
      width: auto !important;
      height: auto !important;
      max-height: calc(var(--reader-h, 100vh) - 5rem);
      max-width: calc(var(--reader-w, 100vw) - 6rem);
      margin: auto;
    }
    .aozora-content a { color: inherit; }
  `;
}

/** Writes the reader display settings onto the host as inherited CSS vars. */
function applyReaderVars(host, { fontSize, lineHeight, fontFamily, theme }) {
  if (!host) return;
  const t = THEMES[theme] || THEMES.sepia;
  host.style.setProperty("--reader-font-size", `${fontSize}px`);
  host.style.setProperty("--reader-line-height", String(lineHeight));
  host.style.setProperty(
    "--reader-font-family",
    FONT_STACKS[fontFamily] || FONT_STACKS.serif
  );
  host.style.setProperty("--reader-color", t.color);
  host.style.setProperty("--reader-bg", t.bg);
}

/**
 * Continuous reader: parses the book (or loads it from the IndexedDB cache),
 * swaps in image object URLs, and renders the flattened HTML inside a shadow
 * root so the book's own CSS stays isolated from the app. Vertical books
 * (tategaki) scroll horizontally; the mouse wheel is mapped to that axis.
 *
 * Reading position is tracked as a character offset (exploredCharCount): on
 * scroll we read the character at the viewport centre, persist it (debounced)
 * to the main process, and restore it on the next open. Display settings are
 * applied live via inherited CSS variables.
 */
export function ReaderView() {
  const book = useReaderStore((s) => s.currentBook);
  const close = useReaderStore((s) => s.close);
  const applyProgress = useLibraryStore((s) => s.applyProgress);

  const fontSize = useSettingsStore((s) => s.fontSize);
  const lineHeight = useSettingsStore((s) => s.lineHeight);
  const fontFamily = useSettingsStore((s) => s.fontFamily);
  const theme = useSettingsStore((s) => s.theme);
  const writingMode = useSettingsStore((s) => s.writingMode);

  const hostRef = useRef(null);
  const anchorsRef = useRef({ anchors: [], total: 0 });
  const verticalRef = useRef(false);
  const charRef = useRef(0);
  const rafRef = useRef(0);
  const saveTimerRef = useRef(0);
  const readyRef = useRef(false);

  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [bookVertical, setBookVertical] = useState(true);
  const [sections, setSections] = useState([]);
  const [currentChar, setCurrentChar] = useState(0);
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Effective writing direction: follow the book unless the user forces one.
  const vertical =
    writingMode === "auto" ? bookVertical : writingMode === "vertical";

  const total = anchorsRef.current.total;
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
    const { total: totalChars } = anchorsRef.current;
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
    api().saveProgress(book.id, fields).catch(() => {});
  }, [book, applyProgress]);

  /** Scrolls back to the tracked character (or the book start for char 0). */
  const restorePosition = useCallback((vert) => {
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

  // Expose the reader area's pixel size as inherited CSS vars so illustrations
  // can be capped against it (percentage max-* can't resolve through the book's
  // auto-height/inline image wrappers).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => {
      host.style.setProperty("--reader-h", `${host.clientHeight}px`);
      host.style.setProperty("--reader-w", `${host.clientWidth}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!book) return;
    let cancelled = false;
    let objectUrls = [];

    // Reset position state up front so a stale read can't leak across books.
    readyRef.current = false;
    anchorsRef.current = { anchors: [], total: 0 };
    charRef.current = 0;
    setCurrentChar(0);
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

        const { html, objectUrls: urls } = buildReaderHtml(
          parsed.elementHtml,
          parsed.blobs
        );
        objectUrls = urls;

        const host = hostRef.current;
        if (!host) return;

        const settings = useSettingsStore.getState();
        const effVertical =
          settings.writingMode === "auto"
            ? parsed.vertical
            : settings.writingMode === "vertical";

        const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
        shadow.innerHTML = `<style data-aoz-base>${baseStyles(effVertical)}</style><style>${parsed.styleSheet}</style><div class="aozora-content">${html}</div>`;
        applyReaderVars(host, settings);

        const contentEl = shadow.querySelector(".aozora-content");
        anchorsRef.current = collectAnchors(contentEl);
        verticalRef.current = effVertical;
        setBookVertical(parsed.vertical);
        setSections(parsed.sections || []);

        // Restore the saved position (or start at the beginning). Deferred to
        // the next frame so layout — and scroll geometry — has settled.
        charRef.current = book.exploredCharCount || 0;
        requestAnimationFrame(() => {
          if (cancelled) return;
          restorePosition(effVertical);
          charRef.current = currentCharAtCenter(
            host,
            anchorsRef.current.anchors,
            effVertical
          );
          setCurrentChar(charRef.current);
          readyRef.current = true;
        });

        setStatus("ready");
      } catch (err) {
        console.error("Failed to open book", err);
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(saveTimerRef.current);
      cancelAnimationFrame(rafRef.current);
      persist();
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
      const shadow = hostRef.current?.shadowRoot;
      if (shadow) shadow.innerHTML = "";
    };
    // persist/restorePosition are stable enough; re-running would re-parse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book]);

  // Apply font/theme settings live, and re-centre on the tracked character so
  // the reading position holds across re-flow (font size / line height / font).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    applyReaderVars(host, { fontSize, lineHeight, fontFamily, theme });
    if (!readyRef.current) return;
    const id = requestAnimationFrame(() => restorePosition(verticalRef.current));
    return () => cancelAnimationFrame(id);
  }, [fontSize, lineHeight, fontFamily, theme, restorePosition]);

  // Re-inject the writing-mode-dependent styles when the toggle changes, then
  // restore the position for the new axis.
  useEffect(() => {
    const host = hostRef.current;
    const shadow = host?.shadowRoot;
    if (!host || !shadow || !readyRef.current) return;
    const base = shadow.querySelector("style[data-aoz-base]");
    if (base) base.textContent = baseStyles(vertical);
    verticalRef.current = vertical;
    const id = requestAnimationFrame(() => restorePosition(vertical));
    return () => cancelAnimationFrame(id);
  }, [vertical, restorePosition]);

  // Recompute the character offset at the viewport centre (rAF-throttled) and
  // debounce a save. Fires for wheel-driven, scrollbar, and programmatic scroll.
  const handleScroll = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const host = hostRef.current;
      if (!host || !anchorsRef.current.anchors.length) return;
      charRef.current = currentCharAtCenter(
        host,
        anchorsRef.current.anchors,
        verticalRef.current
      );
      setCurrentChar(charRef.current);
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(persist, 800);
    });
  };

  // Map vertical wheel scrolling onto the horizontal axis for tategaki.
  const handleWheel = (e) => {
    if (!verticalRef.current) return; // horizontal books scroll natively
    const host = hostRef.current;
    if (!host || host.scrollWidth <= host.clientWidth) return;
    if (e.deltaY !== 0) host.scrollLeft -= e.deltaY;
  };

  const handleJump = (reference) => {
    setTocOpen(false);
    const host = hostRef.current;
    const shadow = host?.shadowRoot;
    if (!host || !shadow) return;
    scrollToElementId(host, shadow, reference, verticalRef.current);
    requestAnimationFrame(() => {
      charRef.current = currentCharAtCenter(
        host,
        anchorsRef.current.anchors,
        verticalRef.current
      );
      setCurrentChar(charRef.current);
      persist();
    });
  };

  if (!book) return null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={close}
          aria-label="Back to library"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTocOpen(true)}
          disabled={!chapters.length}
          aria-label="Table of contents"
        >
          <List className="size-4" />
        </Button>
        <p className="min-w-0 flex-1 truncate text-xs font-medium">
          {book.title}
        </p>
        {total > 0 && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {progressPct}%
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSettingsOpen(true)}
          aria-label="Reader settings"
        >
          <Settings2 className="size-4" />
        </Button>
      </header>

      <div className="relative flex-1 overflow-hidden">
        {status !== "ready" && (
          <div className="absolute inset-0 flex items-center justify-center bg-background">
            {status === "error" ? (
              <p className="text-sm text-muted-foreground">
                Could not open this book.
              </p>
            ) : (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            )}
          </div>
        )}
        <div
          ref={hostRef}
          onWheel={handleWheel}
          onScroll={handleScroll}
          className={
            vertical
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
                  ch.reference === activeChapterId
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground"
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
