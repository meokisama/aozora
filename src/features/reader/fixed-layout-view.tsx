import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { applyReaderVars, fixedLayoutStyles } from "./reader-styles";
import { buildSpreads, type Spread, type SpreadPage } from "@/lib/reader/spreads";
import { ordinalAtCenter, type StripBox } from "@/lib/reader/strip";
import type { FixedLayoutPage } from "@/lib/epub/parse-book";

interface Viewport {
  width: number;
  height: number;
}

/** Imperative handle exposed to the parent reader via `ref`. */
export interface FixedLayoutHandle {
  flip: (dir: number) => void;
  refresh: () => void;
  jumpToOrdinal: (ordinal: number) => void;
  jumpToId: (wrapperId: string) => boolean;
}

interface FixedLayoutViewProps {
  html: string;
  styleSheet: string;
  pages: FixedLayoutPage[];
  ppd: string;
  bookViewport: Viewport | null;
  initialOrdinal: number;
  onChange?: (firstOrdinal: number, totalPages: number) => void;
}

// Aspect ratio (w/h) at/above which "auto" mode shows a two-page spread: a
// portrait page (~0.7) only pairs sensibly once the window is roughly square.
const LANDSCAPE_RATIO = 1.0;
/** Gap between the two halves of a spread, in CSS px (0 = pages touch, like paper). */
const SPREAD_GAP = 0;
/** Used only if a page declares no viewBox and the book no base viewport. */
const FALLBACK_VIEWPORT = { width: 1200, height: 1800 };

function parseViewBox(value: string | null | undefined): Viewport | null {
  if (!value) return null;
  const parts = value
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
    return { width: parts[2], height: parts[3] };
  }
  return null;
}

/**
 * Fixed-layout (manga / comic) viewer. Renders one spread at a time into its own
 * shadow root, scaling each page to fit. The reported position is the leading
 * page's ordinal — orientation-independent, so it survives switching between
 * single- and two-page layouts. Imperative API via ref (see FixedLayoutHandle).
 */
export const FixedLayoutView = forwardRef<FixedLayoutHandle, FixedLayoutViewProps>(function FixedLayoutView(
  { html, styleSheet, pages, ppd, bookViewport, initialOrdinal, onChange },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Element | null>(null);
  const wrappersRef = useRef<Map<string, Element>>(new Map()); // idref/wrapperId → original element
  const viewportsRef = useRef<Map<number, Viewport>>(new Map()); // ordinal → { width, height }
  const viewsRef = useRef<Spread[]>([]); // current view list (spreads or single pages)
  const viewIndexRef = useRef(0);
  const ordinalRef = useRef(initialOrdinal || 0);
  const stripLayoutRef = useRef<StripBox[]>([]); // continuous mode: static page positions
  const stripHorizontalRef = useRef(false); // continuous mode: scroll axis is horizontal
  const stripRafRef = useRef(0);
  const renderRef = useRef<() => void>(() => {}); // latest render(), for buildPageBox's onload

  const spreadMode = useSettingsStore((s) => s.mangaSpread);
  const readingMode = useSettingsStore((s) => s.mangaReadingMode);
  const scrollDirection = useSettingsStore((s) => s.mangaScrollDirection);
  const stripWidth = useSettingsStore((s) => s.mangaStripWidth);
  const stripGap = useSettingsStore((s) => s.mangaStripGap);
  const theme = useSettingsStore((s) => s.theme);

  const doubleSpreads = useMemo(() => buildSpreads(pages, ppd as "ltr" | "rtl"), [pages, ppd]);
  const singleViews = useMemo<Spread[]>(() => pages.map((p) => ({ index: p.ordinal, items: [p], single: true, pageSpread: p.pageSpread })), [pages]);

  const before = ppd === "rtl" ? "right" : "left"; // opener side

  // Authored pixel size of a page, cached per ordinal. Resolution order mirrors
  // bibi: SVG viewBox → book viewport → the bitmap's own size (width/height attrs,
  // else its natural size once loaded; see layout's onload). Ensures a lone <img>
  // manga page is measured rather than falling to a wrong-aspect portrait guess.
  const pageViewport = useCallback(
    (page: SpreadPage): Viewport => {
      const cached = viewportsRef.current.get(page.ordinal);
      if (cached) return cached;
      const el = wrappersRef.current.get(page.idref ?? "");
      const vb = parseViewBox(el?.querySelector("svg")?.getAttribute("viewBox"));
      let vp = vb || bookViewport;
      if (!vp) {
        const img = el?.querySelector("img");
        const aw = Number(img?.getAttribute("width"));
        const ah = Number(img?.getAttribute("height"));
        if (aw > 0 && ah > 0) vp = { width: aw, height: ah };
        else if (img && img.naturalWidth > 0) vp = { width: img.naturalWidth, height: img.naturalHeight };
      }
      if (vp) {
        viewportsRef.current.set(page.ordinal, vp);
        return vp;
      }
      // Size still unknown (image not loaded yet): guess by stage orientation so the
      // pre-load box isn't wildly mis-shaped. Not cached — the onload measurement
      // replaces it on the next layout.
      const stage = stageRef.current;
      const landscape = !!stage && stage.clientWidth > stage.clientHeight;
      return landscape ? { width: FALLBACK_VIEWPORT.height, height: FALLBACK_VIEWPORT.width } : FALLBACK_VIEWPORT;
    },
    [bookViewport],
  );

  const emit = useCallback(() => {
    if (useSettingsStore.getState().mangaReadingMode === "continuous") {
      if (!pages.length) return;
      onChange?.(ordinalRef.current, pages.length);
      return;
    }
    const views = viewsRef.current;
    if (!views.length) return; // not laid out yet — don't report a bogus position
    const view = views[viewIndexRef.current];
    const first = view?.items[0]?.ordinal ?? 0;
    ordinalRef.current = first;
    onChange?.(first, pages.length);
  }, [onChange, pages.length]);

  // Builds one scaled page box (the `.aoz-fxl-page` → transformed `.aoz-fxl-canvas`
  // clone), shared by the spread and strip paths so both render pages identically.
  // `remeasure` re-lays-out once the bitmap's true size loads (spread mode, where a
  // wrong pre-load aspect misfits the page); `lazy` defers off-screen decode (strip
  // mode, which sizes every box up front and stays static — see layoutStrip).
  const buildPageBox = useCallback(
    (page: SpreadPage, vp: Viewport, scale: number, opts: { remeasure?: boolean; lazy?: boolean } = {}): HTMLElement => {
      const { remeasure = true, lazy = false } = opts;
      const box = document.createElement("div");
      box.className = "aoz-fxl-page";
      box.style.width = `${Math.floor(vp.width * scale)}px`;
      box.style.height = `${Math.floor(vp.height * scale)}px`;

      const canvas = document.createElement("div");
      canvas.className = "aoz-fxl-canvas";
      canvas.style.width = `${vp.width}px`;
      canvas.style.height = `${vp.height}px`;
      canvas.style.transform = `scale(${scale})`;

      const original = wrappersRef.current.get(page.idref ?? "");
      if (original) {
        const clone = original.cloneNode(true) as Element;
        if (lazy) {
          for (const img of clone.querySelectorAll("img")) {
            img.loading = "lazy";
            img.decoding = "async";
          }
        }
        canvas.appendChild(clone);
        const ordinal = page.ordinal as number | undefined;
        const img = remeasure && ordinal != null && !viewportsRef.current.has(ordinal) ? clone.querySelector("img") : null;
        if (img) {
          img.addEventListener(
            "load",
            () => {
              if (img.naturalWidth > 0 && ordinal != null && !viewportsRef.current.has(ordinal)) {
                viewportsRef.current.set(ordinal, { width: img.naturalWidth, height: img.naturalHeight });
                renderRef.current();
              }
            },
            { once: true },
          );
        }
      }
      box.appendChild(canvas);
      return box;
    },
    [],
  );

  // Build the current view's DOM and scale each page to fit the stage.
  const layout = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const stageW = stage.clientWidth;
    const stageH = stage.clientHeight;
    if (stageW === 0 || stageH === 0) return;

    const isDouble = spreadMode === "double" || (spreadMode === "auto" && stageW / stageH >= LANDSCAPE_RATIO);
    const views = isDouble ? doubleSpreads : singleViews;
    viewsRef.current = views;

    // Re-anchor the view index on the tracked ordinal (so flipping survives a
    // single↔double switch or resize).
    let vi = views.findIndex((v) => v.items.some((p) => p.ordinal === ordinalRef.current));
    if (vi < 0) vi = 0;
    viewIndexRef.current = vi;
    const view = views[vi];

    // Slots: a paired spread fills both halves; a lone left/right page reserves
    // the facing half with a blank so it sits on its declared side.
    let slots;
    if (view.items.length === 2) {
      slots = [{ page: view.items[0] }, { page: view.items[1] }];
    } else if (isDouble && (view.pageSpread === "left" || view.pageSpread === "right")) {
      slots = view.pageSpread === before ? [{ page: view.items[0] }, { blank: true }] : [{ blank: true }, { page: view.items[0] }];
    } else {
      slots = [{ page: view.items[0] }];
    }

    const halfWidth = (stageW - SPREAD_GAP) / 2;
    const budgetW = slots.length > 1 ? halfWidth : stageW;

    const spread = document.createElement("div");
    spread.className = "aoz-fxl-spread";
    spread.style.flexDirection = ppd === "rtl" ? "row-reverse" : "row";
    spread.style.gap = `${SPREAD_GAP}px`;

    for (const slot of slots) {
      const vp = slot.page ? pageViewport(slot.page) : pageViewport(view.items[0]);
      const scale = Math.min(budgetW / vp.width, stageH / vp.height);

      if (slot.blank) {
        const blank = document.createElement("div");
        blank.className = "aoz-fxl-blank";
        blank.style.width = `${Math.floor(vp.width * scale)}px`;
        blank.style.height = `${Math.floor(vp.height * scale)}px`;
        spread.appendChild(blank);
        continue;
      }

      spread.appendChild(buildPageBox(slot.page!, vp, scale));
    }

    stage.replaceChildren(spread);
  }, [spreadMode, doubleSpreads, singleViews, ppd, before, pageViewport, buildPageBox]);

  // Scrolls the strip so the given page sits at its leading edge in reading order:
  // top for vertical, left for horizontal-LTR, right for horizontal-RTL (where the
  // page's trailing edge aligns to the viewport's right so the next page reveals
  // to its left).
  const scrollStripToOrdinal = useCallback(
    (ordinal: number) => {
      const stage = stageRef.current;
      const box = stripLayoutRef.current.find((b) => b.ordinal === ordinal);
      if (!stage || !box) return;
      if (!stripHorizontalRef.current) stage.scrollTop = box.start;
      else if (ppd === "rtl") stage.scrollLeft = box.start + box.size - stage.clientWidth;
      else stage.scrollLeft = box.start;
    },
    [ppd],
  );

  // Continuous long-strip: lay every page in one line — a vertical column (fit to
  // width) or a horizontal filmstrip (fit to height) — and record positions along
  // the scroll axis so scroll ↔ page maps cheaply. Horizontal honours the book's
  // progression (RTL builds the row last→first so page 0 sits at the right). Sizes
  // come from the known viewports up front, so the strip is static after build —
  // off-screen pages decode lazily (buildPageBox) and scrolling does no re-layout.
  const layoutStrip = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const stageW = stage.clientWidth;
    const stageH = stage.clientHeight;
    if (stageW === 0 || stageH === 0) return;

    const horizontal = scrollDirection === "horizontal";
    stripHorizontalRef.current = horizontal;
    stage.classList.toggle("is-strip-h", horizontal);
    stage.classList.toggle("is-strip", !horizontal);

    const strip = document.createElement("div");
    strip.className = horizontal ? "aoz-fxl-strip-h" : "aoz-fxl-strip";
    strip.style.gap = `${stripGap}px`;
    strip.style[horizontal ? "paddingInline" : "paddingBlock"] = `${stripGap}px`;

    // Fit the cross axis to the stage × the size %; the scroll-axis extent follows
    // from the page aspect. RTL horizontal walks pages in reverse so the leading
    // edge (smallest offset) is the last page.
    const target = horizontal ? Math.round((stageH * stripWidth) / 100) : Math.round((stageW * stripWidth) / 100);
    const ordered = horizontal && ppd === "rtl" ? [...pages].reverse() : pages;

    const boxes: StripBox[] = [];
    let start = stripGap; // leading padding pushes the first page in
    for (const page of ordered) {
      const vp = pageViewport(page);
      const scale = horizontal ? target / vp.height : target / vp.width;
      const size = horizontal ? Math.floor(vp.width * scale) : Math.floor(vp.height * scale);
      strip.appendChild(buildPageBox(page, vp, scale, { lazy: true, remeasure: false }));
      boxes.push({ ordinal: page.ordinal, start, size });
      start += size + stripGap;
    }
    // Keep boxes sorted by start ascending (ordinalAtCenter's precondition); the
    // RTL reverse above already produces ascending starts.
    stripLayoutRef.current = boxes;
    stage.replaceChildren(strip);
    scrollStripToOrdinal(ordinalRef.current);
  }, [pages, ppd, scrollDirection, pageViewport, buildPageBox, scrollStripToOrdinal, stripWidth, stripGap]);

  // Picks the render path for the current reading mode; the spread path clears the
  // strip's scroller class so its centring/overflow rules apply again.
  const render = useCallback(() => {
    if (readingMode === "continuous") {
      layoutStrip();
    } else {
      stageRef.current?.classList.remove("is-strip", "is-strip-h");
      layout();
    }
  }, [readingMode, layout, layoutStrip]);

  // Keep the ref pointing at the latest render() so buildPageBox's onload re-lays
  // out without a circular useCallback dependency.
  renderRef.current = render;

  // Build the shadow DOM once (and whenever the parsed content changes).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
    applyReaderVars(host, useSettingsStore.getState());
    shadow.innerHTML = `<style data-aoz-base>${fixedLayoutStyles()}</style><style>${styleSheet}</style><div class="aoz-fxl-stage"></div>`;
    stageRef.current = shadow.querySelector(".aoz-fxl-stage");

    // Index the spine wrappers from the flattened HTML (parsed once, off-screen).
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    const map = new Map();
    for (const child of Array.from(tmp.children)) {
      if (child.id) map.set(child.id.replace(/^aoz-/, ""), child);
    }
    wrappersRef.current = map;
    viewportsRef.current = new Map();

    ordinalRef.current = Math.min(Math.max(0, initialOrdinal || 0), Math.max(0, pages.length - 1));
    render();
    emit();

    // Continuous mode reports the page under the viewport centre as the strip
    // scrolls (rAF-throttled). Inert in paginated mode. Attached to the stage
    // here since that's where the scroller lives (and is rebuilt per book).
    const stage = stageRef.current;
    const onScroll = () => {
      if (useSettingsStore.getState().mangaReadingMode !== "continuous") return;
      if (stripRafRef.current) return;
      stripRafRef.current = requestAnimationFrame(() => {
        stripRafRef.current = 0;
        const s = stageRef.current;
        const boxes = stripLayoutRef.current;
        if (!s || !boxes.length) return;
        const center = stripHorizontalRef.current ? s.scrollLeft + s.clientWidth / 2 : s.scrollTop + s.clientHeight / 2;
        const ordinal = ordinalAtCenter(boxes, center);
        if (ordinal !== ordinalRef.current) {
          ordinalRef.current = ordinal;
          onChange?.(ordinal, pages.length);
        }
      });
    };
    stage?.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      stage?.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(stripRafRef.current);
      stripRafRef.current = 0;
      shadow.innerHTML = "";
      stageRef.current = null;
    };
    // initialOrdinal is the entry position; later moves go through the ref API.
  }, [html, styleSheet, pages]);

  // Re-render when the reading mode (paginated↔continuous) or spread mode
  // (single↔double↔auto) toggles.
  useEffect(() => {
    if (!stageRef.current) return;
    render();
    emit();
  }, [spreadMode, readingMode, render, emit]);

  // Repaint the page background when the theme changes (the parent's settings
  // effect only touches the reflowable host, which manga doesn't mount).
  useEffect(() => {
    if (hostRef.current) applyReaderVars(hostRef.current, useSettingsStore.getState());
  }, [theme]);

  // Advance/retreat one step. In continuous mode a "step" scrolls ~one viewport
  // along the strip's axis (native scroll then reports the new page); in paginated
  // mode it swaps spreads. Horizontal RTL advances leftward.
  const flip = useCallback(
    (dir: number) => {
      const stage = stageRef.current;
      if (useSettingsStore.getState().mangaReadingMode === "continuous") {
        if (!stage) return;
        if (stripHorizontalRef.current) {
          const sign = ppd === "rtl" ? -1 : 1;
          stage.scrollBy({ left: dir * sign * (stage.clientWidth * 0.9), behavior: "smooth" });
        } else {
          stage.scrollBy({ top: dir * (stage.clientHeight * 0.9), behavior: "smooth" });
        }
        return;
      }
      const next = viewIndexRef.current + dir;
      if (next < 0 || next >= viewsRef.current.length) return;
      viewIndexRef.current = next;
      ordinalRef.current = viewsRef.current[next].items[0].ordinal;
      layout();
      emit();
    },
    [ppd, layout, emit],
  );

  // Jumps to a page in either mode: the strip scrolls it to the top, a spread
  // re-lays-out around it. Shared by jumpToOrdinal/jumpToId below.
  const goToOrdinal = useCallback(
    (ordinal: number) => {
      ordinalRef.current = Math.min(Math.max(0, ordinal), Math.max(0, pages.length - 1));
      if (useSettingsStore.getState().mangaReadingMode === "continuous") {
        scrollStripToOrdinal(ordinalRef.current);
        emit();
      } else {
        layout();
        emit();
      }
    },
    [layout, emit, scrollStripToOrdinal, pages.length],
  );

  useImperativeHandle(
    ref,
    () => ({
      flip,
      refresh: () => {
        render();
        emit();
      },
      jumpToOrdinal: (ordinal: number) => goToOrdinal(ordinal),
      jumpToId: (wrapperId: string) => {
        const idref = String(wrapperId).replace(/^aoz-/, "");
        const page = pages.find((p) => p.idref === idref);
        if (!page) return false;
        goToOrdinal(page.ordinal);
        return true;
      },
    }),
    [flip, goToOrdinal, render, emit, pages],
  );

  // Resize: re-render (auto spread may flip single↔double; the strip re-fits page
  // widths). The observer's initial callback also covers the case where the stage
  // had no size at mount — it lays out and reports the real starting position then.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => {
      render();
      emit();
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [render, emit]);

  // Keyboard navigation. The left/right keys follow the reading direction (RTL
  // left advances); they drive paginated flips and horizontal strip scrolling, but
  // are inert in the vertical strip (scrolling is vertical there). Up/Down/Space
  // always step along whichever axis is active.
  useEffect(() => {
    const rtl = ppd === "rtl";
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
      const continuous = useSettingsStore.getState().mangaReadingMode === "continuous";
      const verticalStrip = continuous && !stripHorizontalRef.current;
      switch (e.code) {
        case "ArrowLeft":
        case "KeyA":
          if (verticalStrip) return;
          flip(rtl ? 1 : -1);
          break;
        case "ArrowRight":
        case "KeyD":
          if (verticalStrip) return;
          flip(rtl ? -1 : 1);
          break;
        case "ArrowDown":
        case "PageDown":
          flip(1);
          break;
        case "ArrowUp":
        case "PageUp":
          flip(-1);
          break;
        case "Space":
          flip(e.shiftKey ? -1 : 1);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ppd, flip]);

  // Wheel flips pages in paginated mode. In the continuous strip: the vertical
  // strip scrolls natively (leave it alone); the horizontal filmstrip maps the
  // vertical wheel onto the horizontal axis (wheel-down advances — leftward in
  // RTL) since most wheels/trackpads only emit deltaY.
  const wheelTsRef = useRef(0);
  const onWheel = (e: React.WheelEvent) => {
    if (useSettingsStore.getState().mangaReadingMode === "continuous") {
      const stage = stageRef.current;
      if (!stripHorizontalRef.current || !stage) return; // vertical strip: native scroll
      const delta = e.deltaY || e.deltaX;
      if (delta) stage.scrollLeft += ppd === "rtl" ? -delta : delta;
      return;
    }
    const delta = e.deltaY || e.deltaX;
    if (!delta) return;
    const now = e.timeStamp;
    if (now - wheelTsRef.current < 250) return;
    wheelTsRef.current = now;
    flip(delta > 0 ? 1 : -1);
  };

  return <div ref={hostRef} onWheel={onWheel} className="h-full w-full overflow-hidden" />;
});
