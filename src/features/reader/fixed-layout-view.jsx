import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { applyReaderVars, fixedLayoutStyles } from "./reader-styles";
import { buildSpreads } from "@/lib/reader/spreads";

/**
 * Aspect ratio (width / height) at or above which the reader shows a two-page
 * spread in "auto" mode. A single manga page is portrait (~0.7), so two side by
 * side (~1.4) only make sense once the window is at least roughly square.
 */
const LANDSCAPE_RATIO = 1.0;
/** Gap between the two halves of a spread, in CSS px (0 = pages touch, like paper). */
const SPREAD_GAP = 0;
/** Used only if a page declares no viewBox and the book no base viewport. */
const FALLBACK_VIEWPORT = { width: 1200, height: 1800 };

function parseViewBox(value) {
  if (!value) return null;
  const parts = value.trim().split(/[\s,]+/).map(Number);
  if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
    return { width: parts[2], height: parts[3] };
  }
  return null;
}

/**
 * Fixed-layout (manga / comic) viewer. Renders one spread at a time into its own
 * shadow root, scaling each page to fit. Navigation is by spread; the reported
 * position is the leading page's ordinal (orientation-independent, so it
 * survives switching between single- and two-page layouts).
 *
 * Imperative API (via ref): `jumpToOrdinal(n)`, `jumpToId(wrapperId)`,
 * `flip(dir)`, `refresh()`.
 *
 * @param {object} props
 * @param {string} props.html         flattened HTML, image refs already swapped for object URLs
 * @param {string} props.styleSheet   the book's own stylesheet
 * @param {object[]} props.pages       [{ idref, wrapperId, pageSpread, ordinal }]
 * @param {"ltr"|"rtl"} props.ppd
 * @param {{width:number,height:number}|null} props.bookViewport
 * @param {number} props.initialOrdinal
 * @param {(firstOrdinal:number, totalPages:number) => void} props.onChange
 */
export const FixedLayoutView = forwardRef(function FixedLayoutView(
  { html, styleSheet, pages, ppd, bookViewport, initialOrdinal, onChange },
  ref,
) {
  const hostRef = useRef(null);
  const stageRef = useRef(null);
  const wrappersRef = useRef(new Map()); // idref/wrapperId → original element
  const viewportsRef = useRef(new Map()); // ordinal → { width, height }
  const viewsRef = useRef([]); // current view list (spreads or single pages)
  const viewIndexRef = useRef(0);
  const ordinalRef = useRef(initialOrdinal || 0);

  const spreadMode = useSettingsStore((s) => s.mangaSpread);
  const theme = useSettingsStore((s) => s.theme);

  const doubleSpreads = useMemo(() => buildSpreads(pages, ppd), [pages, ppd]);
  const singleViews = useMemo(
    () => pages.map((p) => ({ index: p.ordinal, items: [p], single: true, pageSpread: p.pageSpread })),
    [pages],
  );

  const before = ppd === "rtl" ? "right" : "left"; // opener side

  // Authored pixel size of a page: its SVG viewBox, else the book viewport, else
  // a portrait fallback. Cached per ordinal (read once off the detached wrapper).
  const pageViewport = useCallback(
    (page) => {
      const cached = viewportsRef.current.get(page.ordinal);
      if (cached) return cached;
      const el = wrappersRef.current.get(page.idref);
      const vb = parseViewBox(el?.querySelector("svg")?.getAttribute("viewBox"));
      const vp = vb || bookViewport || FALLBACK_VIEWPORT;
      viewportsRef.current.set(page.ordinal, vp);
      return vp;
    },
    [bookViewport],
  );

  const emit = useCallback(() => {
    const views = viewsRef.current;
    if (!views.length) return; // not laid out yet — don't report a bogus position
    const view = views[viewIndexRef.current];
    const first = view?.items[0]?.ordinal ?? 0;
    ordinalRef.current = first;
    onChange?.(first, pages.length);
  }, [onChange, pages.length]);

  // Builds the DOM for the current view and scales each page to fit the stage.
  const layout = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const stageW = stage.clientWidth;
    const stageH = stage.clientHeight;
    if (stageW === 0 || stageH === 0) return;

    const isDouble =
      spreadMode === "double" || (spreadMode === "auto" && stageW / stageH >= LANDSCAPE_RATIO);
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
      const boxW = Math.floor(vp.width * scale);
      const boxH = Math.floor(vp.height * scale);

      if (slot.blank) {
        const blank = document.createElement("div");
        blank.className = "aoz-fxl-blank";
        blank.style.width = `${boxW}px`;
        blank.style.height = `${boxH}px`;
        spread.appendChild(blank);
        continue;
      }

      const box = document.createElement("div");
      box.className = "aoz-fxl-page";
      box.style.width = `${boxW}px`;
      box.style.height = `${boxH}px`;

      const canvas = document.createElement("div");
      canvas.className = "aoz-fxl-canvas";
      canvas.style.width = `${vp.width}px`;
      canvas.style.height = `${vp.height}px`;
      canvas.style.transform = `scale(${scale})`;

      const original = wrappersRef.current.get(slot.page.idref);
      if (original) canvas.appendChild(original.cloneNode(true));
      box.appendChild(canvas);
      spread.appendChild(box);
    }

    stage.replaceChildren(spread);
  }, [spreadMode, doubleSpreads, singleViews, ppd, before, pageViewport]);

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
    layout();
    emit();

    return () => {
      shadow.innerHTML = "";
      stageRef.current = null;
    };
    // initialOrdinal is the entry position; later moves go through the ref API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, styleSheet, pages]);

  // Re-layout when the spread mode toggles (single↔double↔auto).
  useEffect(() => {
    if (!stageRef.current) return;
    layout();
    emit();
  }, [spreadMode, layout, emit]);

  // Repaint the page background when the theme changes (the parent's settings
  // effect only touches the reflowable host, which manga doesn't mount).
  useEffect(() => {
    if (hostRef.current) applyReaderVars(hostRef.current, useSettingsStore.getState());
  }, [theme]);

  const flip = useCallback(
    (dir) => {
      const next = viewIndexRef.current + dir;
      if (next < 0 || next >= viewsRef.current.length) return;
      viewIndexRef.current = next;
      ordinalRef.current = viewsRef.current[next].items[0].ordinal;
      layout();
      emit();
    },
    [layout, emit],
  );

  useImperativeHandle(
    ref,
    () => ({
      flip,
      refresh: () => {
        layout();
        emit();
      },
      jumpToOrdinal: (ordinal) => {
        ordinalRef.current = Math.min(Math.max(0, ordinal), Math.max(0, pages.length - 1));
        layout();
        emit();
      },
      jumpToId: (wrapperId) => {
        const idref = String(wrapperId).replace(/^aoz-/, "");
        const page = pages.find((p) => p.idref === idref);
        if (!page) return false;
        ordinalRef.current = page.ordinal;
        layout();
        emit();
        return true;
      },
    }),
    [flip, layout, emit, pages],
  );

  // Resize: re-layout (auto mode may flip between single and double). The
  // observer's initial callback also covers the case where the stage had no
  // size at mount — it lays out and reports the real starting position then.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => {
      layout();
      emit();
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [layout, emit]);

  // Keyboard + wheel navigation. In RTL the left key advances (reading goes
  // right-to-left); in LTR the right key advances.
  useEffect(() => {
    const rtl = ppd === "rtl";
    const onKey = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
      switch (e.code) {
        case "ArrowLeft":
        case "KeyA":
          flip(rtl ? 1 : -1);
          break;
        case "ArrowRight":
        case "KeyD":
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

  const wheelTsRef = useRef(0);
  const onWheel = (e) => {
    const delta = e.deltaY || e.deltaX;
    if (!delta) return;
    const now = e.timeStamp;
    if (now - wheelTsRef.current < 250) return;
    wheelTsRef.current = now;
    flip(delta > 0 ? 1 : -1);
  };

  return <div ref={hostRef} onWheel={onWheel} className="h-full w-full overflow-hidden" />;
});
