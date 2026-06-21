import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useReaderStore } from "@/stores/reader-store";
import { parseBook } from "@/lib/epub/parse-book";
import { buildReaderHtml } from "@/lib/epub/format-html";
import { getCachedBook, putCachedBook } from "@/lib/reader-cache";

const api = () => window.electronAPI.library;

function baseStyles(vertical) {
  return `
    :host { display: block; height: 100%; }
    .aozora-content {
      height: 100%;
      box-sizing: border-box;
      padding: 2.5rem 3rem;
      writing-mode: ${vertical ? "vertical-rl" : "horizontal-tb"};
      ${vertical ? "" : "max-width: 42rem; margin: 0 auto;"}
      font-size: 1.25rem;
      line-height: 1.8;
      color: #1f1d1a;
      background: #faf8f4;
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

/**
 * Minimal continuous reader: parses the book (or loads it from the IndexedDB
 * cache), swaps in image object URLs, and renders the flattened HTML inside a
 * shadow root so the book's own CSS stays isolated from the app. Vertical books
 * (tategaki) scroll horizontally; the mouse wheel is mapped to that axis.
 */
export function ReaderView() {
  const book = useReaderStore((s) => s.currentBook);
  const close = useReaderStore((s) => s.close);
  const hostRef = useRef(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error

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
        const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
        shadow.innerHTML = `<style>${baseStyles(parsed.vertical)}</style><style>${parsed.styleSheet}</style><div class="aozora-content">${html}</div>`;

        // Start at the beginning: for vertical-rl that's the rightmost edge.
        // Defer to the next frame so layout (and scrollWidth) is settled.
        if (parsed.vertical) {
          requestAnimationFrame(() => {
            host.scrollLeft = host.scrollWidth;
          });
        }

        setStatus("ready");
      } catch (err) {
        console.error("Failed to open book", err);
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
      const shadow = hostRef.current?.shadowRoot;
      if (shadow) shadow.innerHTML = "";
    };
  }, [book]);

  // Map vertical wheel scrolling onto the horizontal axis for tategaki.
  const handleWheel = (e) => {
    const host = hostRef.current;
    if (!host || host.scrollWidth <= host.clientWidth) return;
    if (e.deltaY !== 0) host.scrollLeft -= e.deltaY;
  };

  if (!book) return null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <Button variant="ghost" size="icon" onClick={close} aria-label="Back to library">
          <ArrowLeft className="size-4" />
        </Button>
        <p className="truncate text-xs font-medium">{book.title}</p>
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
          className="h-full w-full overflow-x-auto overflow-y-hidden"
        />
      </div>
    </div>
  );
}
