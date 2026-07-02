import { THEMES, type FontFamily, type ThemeName } from "@/stores/settings-store";
import { resolveFontStack, type CustomFont } from "@/stores/fonts-store";

/** Display rules shared by both reading modes (driven by inherited CSS vars). */
const SHARED_DISPLAY = `
  font-size: var(--reader-font-size, 1.25rem);
  line-height: var(--reader-line-height, 1.8);
  color: var(--reader-color, #1f1d1a);
  background: var(--reader-bg, #faf8f4);
`;

/**
 * Forces the writing direction onto the flattened book wrappers. JP novels carry
 * the 電書協 template's `.vrtl { writing-mode: vertical-rl }`, which would otherwise
 * override the reader's chosen mode. A two-class selector outranks the bare
 * `.vrtl`, winning even against its `!important`.
 */
function writingModeRules(scope: string, vertical: boolean) {
  const wm = vertical ? "vertical-rl" : "horizontal-tb";
  return `
    ${scope} .aoz-book-html-wrapper,
    ${scope} .aoz-book-body-wrapper {
      writing-mode: ${wm} !important;
      -webkit-writing-mode: ${wm} !important;
    }
  `;
}

/**
 * Continuous (scroll) reader CSS. Display props come from inherited host CSS
 * vars (settings apply live); only the writing mode is baked in, so this is
 * re-injected on toggle.
 */
export function continuousStyles(vertical: boolean) {
  return `
    :host { display: block; height: 100%; }
    .aozora-content {
      box-sizing: border-box;
      writing-mode: ${vertical ? "vertical-rl" : "horizontal-tb"};
      /* Vertical-rl flows along the block (height) axis, so it needs a definite
         viewport height; horizontal-tb grows down and only needs a floor. In
         horizontal the left/right padding is the adjustable side margin (a % of
         width, driven live by --reader-side-padding); equal padding centres it. */
      ${vertical ? "height: 100%; padding: 2.5rem 3rem;" : "min-height: 100%; padding: 2.5rem var(--reader-side-padding, 12%);"}
      ${SHARED_DISPLAY}
    }
    /* Vertical-rl only: give the structural wrappers a definite height so
       full-page images size against the viewport instead of collapsing to zero.
       In horizontal-tb the wrappers must stay auto-height — pinning them to one
       viewport makes each chapter overflow and overlap the next. */
    ${
      vertical
        ? `.aozora-content > div,
    .aozora-content .aoz-book-html-wrapper,
    .aozora-content .aoz-book-body-wrapper { height: 100%; }`
        : ""
    }
    /* Breathing room around full-page image spreads (image-only spine items)
       so consecutive illustrations don't sit flush against each other. The
       margin is on the inter-page (block) axis, correct for both writing modes. */
    .aozora-content > div:has(.aoz-no-text) { margin-block: 2.5rem; }
    ${writingModeRules(".aozora-content", vertical)}
    ${imageRules(".aozora-content", undefined, undefined, vertical)}
    ${furiganaRules(".aozora-content")}
    ${searchHitRule()}
    ${lookupHitRule()}
    ${karaokeHitRule()}
    .aozora-content a { color: inherit; }
    /* Force the reader's font over fonts the book hardcodes on its own elements
       (電書協-template novels set font-family on body/p/spans), so it must win
       across the whole subtree. gaiji/illustrations are images and unaffected. */
    .aozora-content,
    .aozora-content * {
      font-family: var(--reader-font-family, serif) !important;
    }
  `;
}

/**
 * Paginated (page-flip) reader CSS. `.aozora-content` is a fixed overflow-hidden
 * viewport; `.aoz-page-content` is the multi-column container the controller
 * sizes and scrolls. One spine section at a time, so each chapter starts fresh.
 */
export function paginatedStyles(vertical: boolean) {
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
    ${writingModeRules(".aozora-content", vertical)}
    ${imageRules(".aozora-content", "6rem", "8rem", vertical)}
    ${spreadRules(".aozora-content")}
    ${furiganaRules(".aozora-content")}
    ${searchHitRule()}
    ${lookupHitRule()}
    ${karaokeHitRule()}
    .aoz-page-content p { break-inside: avoid; }
    .aozora-content a { color: inherit; }
    .aozora-content,
    .aozora-content * {
      font-family: var(--reader-font-family, serif) !important;
    }
  `;
}

/**
 * Fixed-layout (manga) reader CSS. The stage centres the current spread; each
 * page is sized in JS to the authored viewport × fit scale, content laid out at
 * native pixels and uniformly scaled via `transform` (so positioned text layers
 * scale with the image). flex-direction (set inline per PPD) drives RTL order.
 */
export function fixedLayoutStyles() {
  return `
    :host { display: block; height: 100%; }
    .aoz-fxl-stage {
      box-sizing: border-box;
      height: 100%;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      background: var(--reader-bg, #faf8f4);
    }
    .aoz-fxl-spread { display: flex; flex-wrap: nowrap; align-items: center; }
    .aoz-fxl-page { position: relative; overflow: hidden; flex: 0 0 auto; }
    .aoz-fxl-blank { flex: 0 0 auto; }
    .aoz-fxl-canvas { position: absolute; top: 0; left: 0; transform-origin: top left; }
    /* The flattened spine wrappers fill the authored viewport box exactly, so
       the page's SVG/image scales with the canvas transform. */
    .aoz-fxl-canvas .aoz-book-html-wrapper,
    .aoz-fxl-canvas .aoz-book-body-wrapper {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
    }
    .aoz-fxl-canvas svg,
    .aoz-fxl-canvas img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
  `;
}

/**
 * Illustration sizing, shared by both modes. Capped against the reader's pixel
 * size (--reader-w/--reader-h; padV/padH budget the content padding) since the
 * book's percentage max-* can't resolve through the auto-height/inline wrappers.
 *
 * Full-page SVGs carry percentage width/height + a viewBox, so with both CSS dims
 * auto they have only a ratio and collapse to 0 width (the "blank illustration
 * page" bug). Anchoring height to the viewport lets the viewBox derive width, in
 * both writing modes (no definite-width ancestor needed). Raster <img> keep the cap.
 */
export function imageRules(scope: string, padV = "5rem", padH = "6rem", vertical = false) {
  const maxW = `calc(var(--reader-w, 100vw) - ${padH})`;
  const maxH = `calc(var(--reader-h, 100vh) - ${padV})`;
  // Centre in-flow illustrations: inline by default, so margin:auto can't, and
  // block lets the inline-axis auto margins do it. Horizontal-tb only — the axis
  // flips in vertical-rl (where they're already fine). Gaiji stay inline.
  const inflowCentering = vertical
    ? ""
    : `
    ${scope} img:not([class*="gaiji"]) { display: block; }
    ${scope} svg:not([class*="gaiji"]) { display: block; margin-inline: auto; }`;
  return `${inflowCentering}
    /* Kill native image-drag: a mousedown near an inline image starts a
       drag-ghost mid-selection instead of selecting text. */
    ${scope} img,
    ${scope} svg { -webkit-user-drag: none; }

    /* Centre image-only pages on both axes via flex. margin:auto can't (inline
       SVG, and vertical-rl block flow starts at the right edge — why these once
       sat flush right); flex centres regardless of writing mode. */
    ${scope} .aoz-no-text {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    ${scope} .aoz-no-text svg {
      width: auto;
      height: ${maxH};
      max-width: ${maxW};
      break-inside: avoid;
    }
    ${scope} svg {
      max-width: ${maxW};
      max-height: ${maxH};
      break-inside: avoid;
    }
    ${scope} img:not([class*="gaiji"]) {
      width: auto;
      height: auto;
      max-width: ${maxW};
      max-height: ${maxH};
      break-inside: avoid;
      margin: auto;
    }
  `;
}

/**
 * Two-page spread layout for mixed books (reflowable novel with embedded
 * fixed-layout image pages). `merge-spreads` groups a paired opener+closer into
 * one `.aoz-spread` section; here the halves lay side by side (RTL for RTL
 * books), each letterboxing its image so portrait pages stay centred.
 */
export function spreadRules(scope: string) {
  // Each half: capped to half the reader width and full height. SVG height is a
  // definite value — `div.main` between wrapper and SVG has no size, so a
  // `height: 100%` chain would collapse (the "blank illustration" bug).
  const maxH = `calc(var(--reader-h, 100vh) - 6rem)`;
  const halfW = `calc((var(--reader-w, 100vw) - 8rem) / 2)`;
  return `
    ${scope} .aoz-spread {
      /* Reset vertical-rl (set by the reflowable reader on RTL books): otherwise
         the inline axis is vertical and flex-direction:row stacks the pages
         top-to-bottom instead of side by side. */
      writing-mode: horizontal-tb;
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
    }
    ${scope} .aoz-spread[data-ppd="rtl"] { flex-direction: row-reverse; }
    ${scope} .aoz-spread[data-ppd="ltr"] { flex-direction: row; }
    ${scope} .aoz-spread > * {
      flex: 0 1 auto;
      min-width: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      margin: 0;
    }
    ${scope} .aoz-spread .aoz-no-text {
      display: flex;
      align-items: center;
      justify-content: center;
      width: auto;
      height: 100%;
    }
    ${scope} .aoz-spread svg,
    ${scope} .aoz-spread img {
      display: block;
      width: auto;
      height: ${maxH};
      max-width: ${halfW};
      max-height: ${maxH};
      object-fit: contain;
    }
  `;
}

/**
 * Furigana rules, shared by both modes. Inactive until the content root carries
 * a `.aoz-furigana-<mode>` class (added for any mode but "show"). Mirrors ttsu:
 * "hide" drops readings, "partial" dims them (hover/click reveals),
 * "toggle"/"full" hide until hover or a click (adds `.reveal-rt`). Colours from
 * `applyReaderVars`.
 */
export function furiganaRules(scope: string) {
  return `
    /* Keep readings out of text selection (and thus copy/lookup) regardless of
       furigana mode — selecting a base word otherwise drags in its kana. */
    ${scope} rt {
      user-select: none;
      -webkit-user-select: none;
    }

    ${scope}.aoz-furigana-hide rt { display: none; }

    ${scope}.aoz-furigana-partial rt { color: var(--reader-furigana-hint, #b8b2a6); }
    ${scope}.aoz-furigana-partial ruby.reveal-rt rt { color: inherit; }
    @media (hover: hover) {
      ${scope}.aoz-furigana-partial ruby:hover rt { color: inherit; }
    }

    ${scope}.aoz-furigana-full ruby,
    ${scope}.aoz-furigana-toggle ruby {
      cursor: pointer;
      text-shadow: var(--reader-furigana-glow, #faf8f4) 1px 0 10px;
    }
    ${scope}.aoz-furigana-full ruby rt,
    ${scope}.aoz-furigana-toggle ruby rt { visibility: hidden; }
    ${scope}.aoz-furigana-full ruby.reveal-rt,
    ${scope}.aoz-furigana-toggle ruby.reveal-rt { text-shadow: none; }
    ${scope}.aoz-furigana-full ruby.reveal-rt rt,
    ${scope}.aoz-furigana-toggle ruby.reveal-rt rt { visibility: visible; }
    @media (hover: hover) {
      ${scope}.aoz-furigana-full ruby:hover rt,
      ${scope}.aoz-furigana-toggle ruby:hover rt { visibility: visible; }
      ${scope}.aoz-furigana-toggle ruby:not(.reveal-rt):hover rt { visibility: hidden; }
    }
  `;
}

// A highlight Range runs from its start node to its end node in document order,
// so it sweeps across any furigana <rt> sitting between base-text nodes — and the
// CSS Custom Highlight API ignores `user-select: none`. Re-scoping the pseudo to
// `rt` (higher specificity than bare `::highlight()`) clears the wash off the
// reading so only the base text is painted.
const clearRt = (name: string) => `rt::highlight(${name}) { background-color: transparent; }`;

/**
 * Paints the active search hit. The match is a Range registered via the CSS
 * Custom Highlight API (see `lib/reader/highlight.js`), so this `::highlight()`
 * pseudo styles it without touching the book DOM.
 */
export function searchHitRule() {
  return `::highlight(aoz-search-hit) { background-color: rgba(250, 204, 21, 0.45); color: inherit; } ${clearRt("aoz-search-hit")}`;
}

/**
 * Paints the run the hover dictionary matched (`aoz-dict-hit` highlight Range).
 * A cooler wash than the search hit so the two stay distinguishable.
 */
export function lookupHitRule() {
  return `::highlight(aoz-dict-hit) { background-color: rgba(56, 189, 248, 0.35); color: inherit; } ${clearRt("aoz-dict-hit")}`;
}

/**
 * Paints the run being read aloud, advancing over the sentence in sync with the
 * TTS audio (`aoz-tts-karaoke` highlight Range). A warm green, distinct from the
 * search (yellow) and dictionary (cyan) washes.
 */
export function karaokeHitRule() {
  return `::highlight(aoz-tts-karaoke) { background-color: rgba(34, 197, 94, 0.4); color: inherit; } ${clearRt("aoz-tts-karaoke")}`;
}

/** Writes the reader display settings onto the host as inherited CSS vars. */
export function applyReaderVars(
  host: HTMLElement | null,
  {
    fontSize,
    lineHeight,
    fontFamily,
    theme,
    sideMargin,
  }: { fontSize: number; lineHeight: number; fontFamily: FontFamily; theme: ThemeName; sideMargin?: number },
  customFonts: CustomFont[] = [],
) {
  if (!host) return;
  const t = THEMES[theme] || THEMES.sepia;
  host.style.setProperty("--reader-font-size", `${fontSize}px`);
  host.style.setProperty("--reader-line-height", String(lineHeight));
  host.style.setProperty("--reader-side-padding", `${sideMargin ?? 12}%`);
  host.style.setProperty("--reader-font-family", resolveFontStack(fontFamily, customFonts));
  host.style.setProperty("--reader-color", t.color);
  host.style.setProperty("--reader-bg", t.bg);
  // Furigana dim-hint colour and the glow behind hidden readings, tuned per theme
  // so dimmed kana stay legible-but-muted and the glow blends into the page.
  host.style.setProperty("--reader-furigana-hint", t.dark ? "#6f6a60" : "#b3ada1");
  host.style.setProperty("--reader-furigana-glow", t.bg);
  // Paint the host so page-flip mode's outer padding (on the host, outside the
  // shadow scroller) shares the page colour.
  host.style.backgroundColor = t.bg;
}
