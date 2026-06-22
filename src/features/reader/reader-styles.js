import { FONT_STACKS, THEMES } from "@/stores/settings-store";

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
export function continuousStyles(vertical) {
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
    ${furiganaRules(".aozora-content")}
    ${searchHitRule()}
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
export function paginatedStyles(vertical) {
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
    ${furiganaRules(".aozora-content")}
    ${searchHitRule()}
    .aoz-page-content p { break-inside: avoid; }
    .aozora-content a { color: inherit; }
    .aozora-content,
    .aozora-content * {
      font-family: var(--reader-font-family, serif) !important;
    }
  `;
}

/**
 * Illustration sizing, shared by both modes. Capped against the measured reader
 * size (the reader exposes its pixel dimensions as --reader-w/--reader-h;
 * 5rem/6rem account for the content padding) since the percentage max-* the book
 * would otherwise use can't resolve through the auto-height/inline wrappers.
 *
 * Full-page illustrations are wrapped in an <svg> that carries percentage
 * width/height + a viewBox. With both CSS dimensions auto such an SVG has no
 * intrinsic pixel size — only an aspect ratio — so it collapses to 0 width
 * (the "blank illustration page" bug). Anchoring the height to the reader
 * viewport and leaving the width auto lets the viewBox ratio derive the width,
 * and works in both writing modes because it doesn't depend on a
 * definite-width ancestor. Raster <img> keep the standard responsive cap
 * (they have intrinsic dimensions, so width/height auto + max-* is safe).
 */
export function imageRules(scope, padV = "5rem", padH = "6rem") {
  const maxW = `calc(var(--reader-w, 100vw) - ${padH})`;
  const maxH = `calc(var(--reader-h, 100vh) - ${padV})`;
  return `
    /* Centre image-only pages on both axes. margin:auto can't do it (the SVG is
       inline, and in vertical-rl the block flow starts at the right edge, which
       is why these pages sat flush right); a flex box centres regardless of the
       writing mode. Applied to the text-free wrappers we emit, so each
       illustration shrink-wraps and sits in the middle of the page. */
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
 * Furigana display rules, shared by both modes. Inactive until the content root
 * carries a `.aoz-furigana-<mode>` class (added only when the user picks a mode
 * other than "show"; see `reader-view.jsx`). Mirrors ttsu's furigana styles:
 * "hide" drops the readings, "partial" dims them (hover/click reveals), and
 * "toggle"/"full" hide them until hover or a click (which adds `.reveal-rt`).
 * Colours come from theme-driven vars set in `applyReaderVars`.
 */
export function furiganaRules(scope) {
  return `
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

/**
 * Paints the active search hit. The match is registered as a Range with the CSS
 * Custom Highlight API (see `lib/reader/highlight.js`), so this `::highlight()`
 * pseudo styles it without touching the book DOM. A translucent wash keeps the
 * text legible on any theme background.
 */
export function searchHitRule() {
  return `::highlight(aoz-search-hit) { background-color: rgba(250, 204, 21, 0.45); color: inherit; }`;
}

/** Writes the reader display settings onto the host as inherited CSS vars. */
export function applyReaderVars(host, { fontSize, lineHeight, fontFamily, theme }) {
  if (!host) return;
  const t = THEMES[theme] || THEMES.sepia;
  host.style.setProperty("--reader-font-size", `${fontSize}px`);
  host.style.setProperty("--reader-line-height", String(lineHeight));
  host.style.setProperty("--reader-font-family", FONT_STACKS[fontFamily] || FONT_STACKS.serif);
  host.style.setProperty("--reader-color", t.color);
  host.style.setProperty("--reader-bg", t.bg);
  // Furigana "dimmed" hint colour and the glow behind hidden readings, tuned per
  // theme so dimmed kana stay legible-but-muted and the glow blends into the page.
  host.style.setProperty("--reader-furigana-hint", t.dark ? "#6f6a60" : "#b3ada1");
  host.style.setProperty("--reader-furigana-glow", t.bg);
  // Paint the host itself so the page-flip mode's outer padding (applied on the
  // host element, outside the shadow scroller) shares the page colour.
  host.style.backgroundColor = t.bg;
}
