import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { useSettingsStore, type FixedReadingMode, type FixedDirection, type FixedScrollAxis } from "@/stores/settings-store";
import { applyReaderVars, fixedLayoutStyles, fixedContinuousStyles } from "./reader-styles";
import { buildSpreads, type Spread, type SpreadPage } from "@/lib/reader/spreads";
import type { FixedLayoutPage } from "@/lib/epub/parse-book";

interface Viewport {
  width: number;
  height: number;
}

/** Imperative handle exposed to the parent reader via `ref`. */
export interface FixedLayoutHandle {
  flip: (dir: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  goToPage: (page: number) => void;
  refresh: () => void;
  setDirection: (dir: string) => void;
  setSpreadCount: (mode: string) => void;
  jumpToOrdinal: (ordinal: number) => void;
  jumpToId: (wrapperId: string) => boolean;
  prevChapter?: () => void;
  nextChapter?: () => void;
}

interface FixedLayoutViewProps {
  html: string;
  styleSheet: string;
  pages: FixedLayoutPage[];
  ppd: string;
  bookViewport: Viewport | null;
  initialOrdinal: number;
  onChange?: (firstOrdinal: number, totalPages: number) => void;
  onPageInfoChange?: (info: { currentPage: number; totalPages: number }) => void;
  readingMode?: FixedReadingMode;
  direction?: FixedDirection;
  scrollAxis?: FixedScrollAxis;
}

const LANDSCAPE_RATIO = 1.0;
const SPREAD_GAP = 0;
const MAX_PAGE_WIDTH = 1200;
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

export const FixedLayoutView = forwardRef<FixedLayoutHandle, FixedLayoutViewProps>(function FixedLayoutView(
  { html, styleSheet, pages, ppd, bookViewport, initialOrdinal, onChange, onPageInfoChange, readingMode: readingModeProp, direction: directionProp, scrollAxis: scrollAxisProp },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Element | null>(null);
  const scrollRef = useRef<Element | null>(null);
  const wrappersRef = useRef<Map<string, Element>>(new Map());
  const viewportsRef = useRef<Map<number, Viewport>>(new Map());
  const viewsRef = useRef<Spread[]>([]);
  const viewIndexRef = useRef(0);
  const ordinalRef = useRef(initialOrdinal || 0);
  const programmaticScrollRef = useRef(false);

  const spreadMode = useSettingsStore((s) => s.mangaSpread);
  const theme = useSettingsStore((s) => s.theme);
  const fixedReadingMode = useSettingsStore((s) => s.fixedReadingMode);
  const fixedDirection = useSettingsStore((s) => s.fixedDirection);
  const fixedScrollAxis = useSettingsStore((s) => s.fixedScrollAxis);

  const readingMode = readingModeProp ?? fixedReadingMode;
  const rawDirection = directionProp ?? fixedDirection;
  const direction = rawDirection === "auto" ? (ppd === "rtl" ? "rtl" : "ltr") : rawDirection;
  const scrollAxis = scrollAxisProp ?? fixedScrollAxis;

  const doubleSpreads = useMemo(() => buildSpreads(pages, ppd as "ltr" | "rtl"), [pages, ppd]);
  const singleViews = useMemo<Spread[]>(() => pages.map((p) => ({ index: p.ordinal, items: [p], single: true, pageSpread: p.pageSpread })), [pages]);
  const before = ppd === "rtl" ? "right" : "left";

  const forceDoubleSpreads = useMemo(() => {
    const result: Spread[] = [];
    let pending: Spread | null = null;
    for (const view of doubleSpreads) {
      if (view.items.length === 2) {
        if (pending) { result.push(pending); pending = null; }
        result.push(view);
      } else if (view.pageSpread === "left" || view.pageSpread === "right") {
        if (pending) { result.push(pending); pending = null; }
        result.push(view);
      } else if (view.items[0]?.ordinal === 0 && !pending) {
        result.push(view);
      } else {
        if (pending) {
          result.push({ index: result.length, items: [pending.items[0], view.items[0]], single: false, pageSpread: null });
          pending = null;
        } else {
          pending = view;
        }
      }
    }
    if (pending) result.push(pending);
    return result;
  }, [doubleSpreads]);

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
      const stage = stageRef.current;
      const landscape = !!stage && stage.clientWidth > stage.clientHeight;
      return landscape ? { width: FALLBACK_VIEWPORT.height, height: FALLBACK_VIEWPORT.width } : FALLBACK_VIEWPORT;
    },
    [bookViewport],
  );

  const emit = useCallback(() => {
    const views = viewsRef.current;
    if (!views.length) return;
    const view = views[viewIndexRef.current];
    const first = view?.items[0]?.ordinal ?? 0;
    ordinalRef.current = first;
    onChange?.(first, pages.length);
    onPageInfoChange?.({ currentPage: first + 1, totalPages: pages.length });
  }, [onChange, pages.length, onPageInfoChange]);

  function scrollToTarget(scroll: Element, target: Element) {
    if (scrollAxis === "vertical") {
      target.scrollIntoView({ block: "start" });
    } else {
      const sr = scroll.getBoundingClientRect();
      const tr = target.getBoundingClientRect();
      if (direction === "rtl") {
        (scroll as HTMLElement).scrollLeft += tr.right - sr.right;
      } else {
        (scroll as HTMLElement).scrollLeft += tr.left - sr.left;
      }
    }
  }

  function handleScroll() {
    if (programmaticScrollRef.current) {
      programmaticScrollRef.current = false;
      return;
    }
    const scroll = scrollRef.current;
    const stage = stageRef.current;
    if (!scroll || !stage || !stage.children.length) return;
    const scrollRect = scroll.getBoundingClientRect();
    const last = stage.children[stage.children.length - 1];
    const lastRect = last.getBoundingClientRect();

    let bestVi = 0;
    if (scrollAxis === "vertical") {
      if (lastRect.bottom <= scrollRect.bottom + 1) {
        bestVi = stage.children.length - 1;
      } else {
        let bestDist = Infinity;
        for (let i = 0; i < stage.children.length; i++) {
          const cr = stage.children[i].getBoundingClientRect();
          const dist = Math.abs(cr.top - scrollRect.top);
          if (dist < bestDist) { bestDist = dist; bestVi = i; }
        }
      }
    } else {
      if (
        (direction === "rtl" && lastRect.left >= scrollRect.left - 1) ||
        (direction !== "rtl" && lastRect.right <= scrollRect.right + 1)
      ) {
        bestVi = stage.children.length - 1;
      } else {
        let bestDist = Infinity;
        for (let i = 0; i < stage.children.length; i++) {
          const cr = stage.children[i].getBoundingClientRect();
          const dist = direction === "rtl"
            ? Math.abs(cr.right - scrollRect.right)
            : Math.abs(cr.left - scrollRect.left);
          if (dist < bestDist) { bestDist = dist; bestVi = i; }
        }
      }
    }

    if (bestVi !== viewIndexRef.current) {
      viewIndexRef.current = bestVi;
      ordinalRef.current = viewsRef.current[bestVi]?.items[0]?.ordinal ?? 0;
      emit();
    }
  }

  const handleScrollRef = useRef(handleScroll);
  handleScrollRef.current = handleScroll;

  const buildSpread = useCallback(
    (view: Spread, isDouble: boolean, stageW: number, stageH: number) => {
      let slots: ({ page: SpreadPage } | { blank: true })[];

      const spread = document.createElement("div");
      spread.className = "aoz-fxl-spread";
      spread.style.flexDirection = direction === "rtl" ? "row-reverse" : "row";
      spread.style.justifyContent = "center";
      if (view.items.length === 2) {
        slots = [{ page: view.items[0] }, { page: view.items[1] }];
      } else if (isDouble && (view.pageSpread === "left" || view.pageSpread === "right")) {
        slots = view.pageSpread === before ? [{ page: view.items[0] }, { blank: true }] : [{ blank: true }, { page: view.items[0] }];
      } else {
        slots = [{ page: view.items[0] }];
      }
      spread.style.gap = `${SPREAD_GAP}px`;

      const halfWidth = (stageW - SPREAD_GAP) / 2;
      const rawBudgetW = slots.length > 1 ? halfWidth : stageW;
      const budgetW = Math.min(rawBudgetW, MAX_PAGE_WIDTH);

      let totalW = 0;
      for (const slot of slots) {
        const vp = "page" in slot ? pageViewport(slot.page) : pageViewport(view.items[0]);
        const isVerticalCont = readingMode === "continuous" && scrollAxis === "vertical";
        const scale = isVerticalCont ? budgetW / vp.width : Math.min(budgetW / vp.width, stageH / vp.height);
        const boxW = Math.min(Math.floor(vp.width * scale), Math.floor(budgetW));
        const boxH = isVerticalCont ? Math.floor(vp.height * scale) : Math.min(Math.floor(vp.height * scale), Math.floor(stageH));
        const adjustedScale = Math.max((boxW + (isVerticalCont ? 0 : 1)) / vp.width, boxH / vp.height);

        if ("blank" in slot) {
          const blank = document.createElement("div");
          blank.className = "aoz-fxl-blank";
          blank.style.width = `${boxW}px`;
          blank.style.height = `${boxH}px`;
          spread.appendChild(blank);
          totalW += boxW;
          continue;
        }

        const box = document.createElement("div");
        box.className = "aoz-fxl-page";
        box.style.width = `${boxW + (isVerticalCont ? 0 : 1)}px`;
        box.style.height = `${boxH}px`;

        const canvas = document.createElement("div");
        canvas.className = "aoz-fxl-canvas";
        canvas.style.width = `${vp.width}px`;
        canvas.style.height = `${vp.height}px`;
        canvas.style.transform = `scale(${adjustedScale})`;

        const original = wrappersRef.current.get(slot.page?.idref ?? "");
        if (original) {
          const clone = original.cloneNode(true) as Element;
          canvas.appendChild(clone);
          const ordinal = slot.page?.ordinal;
          const img = ordinal != null && !viewportsRef.current.has(ordinal) ? clone.querySelector("img") : null;
          if (img) {
            img.addEventListener(
              "load",
              () => {
                if (img.naturalWidth > 0 && !viewportsRef.current.has(ordinal)) {
                  viewportsRef.current.set(ordinal, { width: img.naturalWidth, height: img.naturalHeight });
                  if (readingMode === "continuous") {
                    rebuildContRef.current();
                  } else {
                    layoutRef.current();
                  }
                }
              },
              { once: true },
            );
          }
        }
        box.appendChild(canvas);
        spread.appendChild(box);
        totalW += boxW;
      }
      if (slots.length > 1 && SPREAD_GAP > 0) {
        totalW += SPREAD_GAP * (slots.length - 1);
      }
      spread.style.flex = "0 0 auto";
      spread.style.width = `${totalW}px`;
      return spread;
    },
    [pageViewport, readingMode, direction, scrollAxis, before],
  );

  const rebuildContinuous = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const views = singleViews;
    viewsRef.current = views;

    stage.innerHTML = "";
    const scroll = scrollRef.current;
    if (scrollAxis === "vertical") {
      stage.classList.add("aoz-fxl-inner-column");
      stage.classList.remove("aoz-fxl-inner");
      if (scroll) {
        (scroll as HTMLElement).style.overflowX = "hidden";
        (scroll as HTMLElement).style.overflowY = "scroll";
      }
    } else {
      stage.classList.remove("aoz-fxl-inner-column");
      stage.classList.add("aoz-fxl-inner");
      if (scroll) {
        (scroll as HTMLElement).style.overflowX = "scroll";
        (scroll as HTMLElement).style.overflowY = "hidden";
      }
    }

    const stageW = stage.clientWidth;
    const stageH = scroll ? scroll.clientHeight : stage.clientHeight;
    if (stageW === 0 || stageH === 0) return;

    for (const view of views) {
      const el = buildSpread(view, false, stageW, stageH);
      if (scrollAxis === "vertical") el.style.width = "100%";
      stage.appendChild(el);
    }

    let vi = views.findIndex((v) => v.items.some((p) => p.ordinal === ordinalRef.current));
    if (vi < 0) vi = 0;
    viewIndexRef.current = vi;
    const target = stage.children[vi] as Element;
    if (target) {
      programmaticScrollRef.current = true;
      if (scroll) {
        scrollToTarget(scroll, target);
      } else {
        target.scrollIntoView({ block: "center", inline: "center" });
      }
    }
  }, [singleViews, buildSpread, scrollAxis]);

  const rebuildContRef = useRef(rebuildContinuous);
  rebuildContRef.current = rebuildContinuous;

  const layout = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const stageW = stage.clientWidth;
    const stageH = stage.clientHeight;
    if (stageW === 0 || stageH === 0) return;

    const isCont = readingMode === "continuous";
    const isDouble = spreadMode === "double" || (spreadMode === "auto" && ((isCont && scrollAxis === "vertical" && stageW >= 1200) || (!isCont && stageW / stageH >= LANDSCAPE_RATIO)));
    const hasPairs = doubleSpreads.some((v) => v.items.length === 2);
    const spreadViews = spreadMode === "double" || (spreadMode === "auto" && !hasPairs) ? forceDoubleSpreads : doubleSpreads;
    const views = isDouble ? spreadViews : singleViews;
    viewsRef.current = views;

    let vi = views.findIndex((v) => v.items.some((p) => p.ordinal === ordinalRef.current));
    if (vi < 0) vi = 0;
    viewIndexRef.current = vi;
    const view = views[vi];
    stage.replaceChildren(buildSpread(view, isDouble, stageW, stageH));
  }, [spreadMode, doubleSpreads, singleViews, forceDoubleSpreads, buildSpread, readingMode, scrollAxis]);

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const setupStage = useCallback((mode: string) => {
    const host = hostRef.current;
    if (!host) return;
    const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
    applyReaderVars(host, useSettingsStore.getState());

    const isCont = mode === "continuous";
    if (isCont) {
      shadow.innerHTML = `<style data-aoz-base>${fixedContinuousStyles()}</style><style>${styleSheet}</style><div class="aoz-fxl-cont"><div class="aoz-fxl-inner"></div></div>`;
      stageRef.current = shadow.querySelector(".aoz-fxl-inner");
      scrollRef.current = shadow.querySelector(".aoz-fxl-cont");
      if (scrollAxis === "vertical") {
        (scrollRef.current as HTMLElement).style.overflowX = "hidden";
        (scrollRef.current as HTMLElement).style.overflowY = "scroll";
      } else {
        (scrollRef.current as HTMLElement).style.overflowX = "scroll";
        (scrollRef.current as HTMLElement).style.overflowY = "hidden";
      }
    } else {
      shadow.innerHTML = `<style data-aoz-base>${fixedLayoutStyles()}</style><style>${styleSheet}</style><div class="aoz-fxl-stage"></div>`;
      stageRef.current = shadow.querySelector(".aoz-fxl-stage");
    }

    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    const map = new Map();
    for (const child of Array.from(tmp.children)) {
      if (child.id) map.set(child.id.replace(/^aoz-/, ""), child);
    }
    wrappersRef.current = map;
    viewportsRef.current = new Map();

    ordinalRef.current = Math.min(Math.max(0, ordinalRef.current), Math.max(0, pages.length - 1));
    if (isCont) {
      rebuildContRef.current();
      emit();
    } else {
      layoutRef.current();
      emit();
    }
  }, [html, styleSheet, pages, theme, scrollAxis, emit]);

  const setupRef = useRef(setupStage);
  setupRef.current = setupStage;

  const emitRef = useRef(emit);
  emitRef.current = emit;

  useEffect(() => {
    setupStage(readingMode);
    return () => {
      const host = hostRef.current;
      if (host) {
        const s = host.shadowRoot;
        if (s) s.innerHTML = "";
      }
      stageRef.current = null;
      scrollRef.current = null;
    };
  }, [html, styleSheet, pages, readingMode, setupStage]);

  useEffect(() => {
    if (!stageRef.current) return;
    if (readingMode === "continuous") {
      rebuildContinuous();
      emit();
    } else {
      layout();
      emit();
    }
  }, [spreadMode, layout, emit, readingMode, rebuildContinuous]);

  useEffect(() => {
    if (hostRef.current) applyReaderVars(hostRef.current, useSettingsStore.getState());
  }, [theme]);

  const flip = useCallback(
    (dir: number) => {
      if (readingMode === "continuous") {
        const stage = stageRef.current;
        const scroll = scrollRef.current;
        let nextOrdinal = ordinalRef.current + dir;
        let vi = -1;
        while (nextOrdinal >= 0 && nextOrdinal < pages.length) {
          vi = viewsRef.current.findIndex((v) => v.items.some((p) => p.ordinal === nextOrdinal));
          if (vi < 0) break;
          const target = stage?.children[vi] as Element | undefined;
          if (target && scroll) {
            const tr = target.getBoundingClientRect();
            const sr = scroll.getBoundingClientRect();
            const leading = scrollAxis === "vertical" ? tr.top : (direction === "rtl" ? tr.right : tr.left);
            const scrollLeading = scrollAxis === "vertical" ? sr.top : (direction === "rtl" ? sr.right : sr.left);
            if (Math.abs(leading - scrollLeading) > 1) break;
          }
          nextOrdinal += dir;
        }
        if (vi < 0 || nextOrdinal < 0 || nextOrdinal >= pages.length) return;
        ordinalRef.current = nextOrdinal;
        viewIndexRef.current = vi;
        const target = stage?.children[vi] as Element | undefined;
        if (target) {
          programmaticScrollRef.current = true;
          if (scroll) scrollToTarget(scroll, target);
        }
        emit();
      } else {
        const next = viewIndexRef.current + dir;
        if (next < 0 || next >= viewsRef.current.length) return;
        viewIndexRef.current = next;
        ordinalRef.current = viewsRef.current[next].items[0].ordinal;
        layout();
        emit();
      }
    },
    [layout, emit, readingMode, pages.length, direction, scrollAxis],
  );

  const flipRef = useRef(flip);
  flipRef.current = flip;

  useImperativeHandle(
    ref,
    () => ({
      flip,
      nextPage: () => flip(1),
      prevPage: () => flip(-1),
      goToPage: (page: number) => {
        const ordinal = Math.max(0, page - 1);
        ordinalRef.current = Math.min(ordinal, Math.max(0, pages.length - 1));
        if (readingMode === "continuous") {
          const stage = stageRef.current;
          const scroll = scrollRef.current;
          if (stage) {
            const vi = viewsRef.current.findIndex((v) => v.items.some((p) => p.ordinal === ordinalRef.current));
            if (vi >= 0) {
              viewIndexRef.current = vi;
              const target = stage.children[vi] as Element;
              if (target) {
                programmaticScrollRef.current = true;
                if (scroll) scrollToTarget(scroll, target);
              }
            }
          }
          emit();
        } else {
          layout();
          emit();
        }
      },
      refresh: () => {
        const mode = useSettingsStore.getState().fixedReadingMode;
        if (mode !== readingMode) {
          setupRef.current(mode);
        } else if (mode === "continuous") {
          rebuildContRef.current();
        } else {
          layoutRef.current();
          emitRef.current();
        }
      },
      setDirection: (dir: string) => {
        if (readingMode === "continuous") {
          rebuildContRef.current();
        } else {
          layoutRef.current();
          emitRef.current();
        }
      },
      setSpreadCount: () => {
        if (readingMode === "continuous") return;
        layoutRef.current();
        emitRef.current();
      },
      jumpToOrdinal: (ordinal: number) => {
        ordinalRef.current = Math.min(Math.max(0, ordinal), Math.max(0, pages.length - 1));
        if (readingMode === "continuous") {
          const stage = stageRef.current;
          const scroll = scrollRef.current;
          if (stage) {
            const vi = viewsRef.current.findIndex((v) => v.items.some((p) => p.ordinal === ordinalRef.current));
            if (vi >= 0) {
              viewIndexRef.current = vi;
              const target = stage.children[vi] as Element;
              if (target) {
                programmaticScrollRef.current = true;
                if (scroll) scrollToTarget(scroll, target);
              }
            }
          }
          emit();
        } else {
          layout();
          emit();
        }
      },
      jumpToId: (wrapperId: string) => {
        const idref = String(wrapperId).replace(/^aoz-/, "");
        const page = pages.find((p) => p.idref === idref);
        if (!page) return false;
        ordinalRef.current = page.ordinal;
        if (readingMode === "continuous") {
          const stage = stageRef.current;
          const scroll = scrollRef.current;
          if (stage) {
            const vi = viewsRef.current.findIndex((v) => v.items.some((p) => p.ordinal === ordinalRef.current));
            if (vi >= 0) {
              viewIndexRef.current = vi;
              const target = stage.children[vi] as Element;
              if (target) {
                programmaticScrollRef.current = true;
                if (scroll) scrollToTarget(scroll, target);
              }
            }
          }
          emit();
        } else {
          layout();
          emit();
        }
        return true;
      },
    }),
    [flip, layout, emit, pages, readingMode, scrollAxis],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => {
      if (readingMode === "continuous") {
        rebuildContRef.current();
        emitRef.current();
      } else {
        layoutRef.current();
        emitRef.current();
      }
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [readingMode]);

  useEffect(() => {
    if (readingMode === "continuous") {
      const el = scrollRef.current;
      if (!el) return;

      const onScroll = () => handleScrollRef.current();
      el.addEventListener("scroll", onScroll, { passive: true });

      const onWheel = (e: WheelEvent) => {
        if (scrollAxis === "horizontal") {
          (el as HTMLElement).scrollLeft += e.deltaY;
          e.preventDefault();
        }
      };
      el.addEventListener("wheel", onWheel, { passive: false });

      let dragState: { prevX: number; prevY: number } | null = null;
      const onDragStart = (e: MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        dragState = { prevX: e.clientX, prevY: e.clientY };
        (el as HTMLElement).style.cursor = "grabbing";
        (el as HTMLElement).style.userSelect = "none";
      };
      const onDragMove = (e: MouseEvent) => {
        if (!dragState) return;
        (el as HTMLElement).scrollLeft -= e.clientX - dragState.prevX;
        (el as HTMLElement).scrollTop -= e.clientY - dragState.prevY;
        dragState.prevX = e.clientX;
        dragState.prevY = e.clientY;
      };
      const onDragEnd = () => {
        if (!dragState) return;
        dragState = null;
        (el as HTMLElement).style.cursor = "";
        (el as HTMLElement).style.userSelect = "";
      };
      el.addEventListener("mousedown", onDragStart);
      window.addEventListener("mousemove", onDragMove);
      window.addEventListener("mouseup", onDragEnd);
      el.addEventListener("mouseleave", onDragEnd);

      return () => {
        el.removeEventListener("scroll", onScroll);
        el.removeEventListener("wheel", onWheel);
        el.removeEventListener("mousedown", onDragStart);
        window.removeEventListener("mousemove", onDragMove);
        window.removeEventListener("mouseup", onDragEnd);
        el.removeEventListener("mouseleave", onDragEnd);
        if (dragState) {
          (el as HTMLElement).style.cursor = "";
          (el as HTMLElement).style.userSelect = "";
        }
      };
    } else {
      const el = stageRef.current;
      if (!el) return;

      const onWheel = (e: WheelEvent) => {
        flipRef.current(e.deltaY > 0 ? 1 : -1);
        e.preventDefault();
      };
      el.addEventListener("wheel", onWheel, { passive: false });

      return () => {
        el.removeEventListener("wheel", onWheel);
      };
    }
  }, [readingMode, scrollAxis]);

  const wheelTsRef = useRef(0);
  const onWheel = (e: React.WheelEvent) => {
    if (readingMode !== "paginated") return;
    const delta = e.deltaY || e.deltaX;
    if (!delta) return;
    const now = e.timeStamp;
    if (now - wheelTsRef.current < 250) return;
    wheelTsRef.current = now;
    flip(delta > 0 ? 1 : -1);
  };

  return <div ref={hostRef} onWheel={onWheel} className="h-full w-full overflow-hidden" />;
});
