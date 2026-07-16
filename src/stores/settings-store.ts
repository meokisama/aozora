import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Global reader display prefs, persisted in the renderer via Zustand persist
 * (not the main process). The reader applies them live through CSS custom
 * properties on the shadow host; see `reader-view.jsx`.
 */

/** Built-in reader fonts. The active font (`SettingsState.fontFamily`) is a
 *  `BuiltinFont` key or a user-imported font's id, so the field is typed `string`. */
export type BuiltinFont = "mincho" | "noto-serif" | "noto-sans" | "gyosho";
export type FontFamily = string;
export type ThemeName = "sepia" | "dark";
export type ReadingMode = "continuous" | "paginated";
export type FuriganaMode = "show" | "hide" | "partial" | "toggle" | "full";
export type MangaSpread = "auto" | "single" | "double";
export type MangaReadingMode = "paginated" | "continuous";
export type MangaScrollDirection = "vertical" | "horizontal";
export type WritingMode = "auto" | "horizontal" | "vertical";

/** CSS font-family stacks per built-in font. `mincho` rides on system faces (Yu
 *  Mincho lead); `noto-serif`/`noto-sans` use the bundled Noto JP faces and
 *  `gyosho` the bundled EPGyosho face (all `@font-face` in index.css). */
export const FONT_STACKS: Record<BuiltinFont, string> = {
  mincho: "'Yu Mincho', YuMincho, 'Hiragino Mincho ProN', 'Noto Serif JP', 'MS Mincho', serif",
  "noto-serif": "'Noto Serif JP', serif",
  "noto-sans": "'Noto Sans JP', sans-serif",
  gyosho: "'EPGyosho', 'Noto Serif JP', 'Yu Mincho', YuMincho, serif",
};

/** Built-in options for the settings-panel Font dropdown (user-imported fonts
 *  are appended at render time from the fonts store). */
export const FONT_FAMILIES: { value: BuiltinFont; label: string }[] = [
  { value: "noto-serif", label: "Noto Serif JP" },
  { value: "noto-sans", label: "Noto Sans JP" },
  { value: "mincho", label: "Yu Mincho" },
  { value: "gyosho", label: "Epson" },
];

/**
 * Colour themes (page bg + body text). `dark` toggles the `.dark` class on the
 * document root, which the rest of the app follows via the Tailwind palette in
 * index.css; the reader reads bg/color directly from here.
 */
export const THEMES: Record<ThemeName, { bg: string; color: string; dark: boolean }> = {
  sepia: { bg: "#faf8f4", color: "#1f1d1a", dark: false },
  // Warm charcoal page with dimmed off-white text — matches the app's dark
  // surface (index.css `.dark`) and avoids the glare of pure black/white.
  dark: { bg: "#201f1c", color: "#cac4b8", dark: true },
};

export const FONT_SIZE_RANGE = { min: 14, max: 40, step: 0.5 };
export const LINE_HEIGHT_RANGE = { min: 1.2, max: 2.6, step: 0.05 };
/** Side margin (% of width) per edge for horizontal continuous reading. */
export const SIDE_MARGIN_RANGE = { min: 0, max: 30, step: 0.5 };
/** Page width (% of viewport) for the continuous manga strip. */
export const MANGA_STRIP_WIDTH_RANGE = { min: 30, max: 100, step: 1 };
/** Gap between pages (CSS px) in the continuous manga strip. */
export const MANGA_STRIP_GAP_RANGE = { min: 0, max: 40, step: 1 };

/**
 * Columns per page for horizontal paginated reading (ignored in vertical, which
 * is always single-column). `0` = auto (scales with viewport width, ttsu-style).
 */
export const PAGE_COLUMNS_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Auto" },
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
];

/**
 * Furigana display modes (mirrors ttsu, collapsed into one setting). Every mode
 * except "show" maps to a `.aoz-furigana-<value>` class on the content root
 * (see `reader-styles.js`).
 *   - show:    rendered normally (the book's own styling)
 *   - hide:    removed entirely (rt display:none)
 *   - partial: dimmed; reveal on hover, or click to keep revealed
 *   - toggle:  hidden; click to show, click again to hide
 *   - full:    hidden; reveal on hover, or click to keep revealed
 */
export const FURIGANA_MODES: { value: FuriganaMode; label: string }[] = [
  { value: "show", label: "Show" },
  { value: "hide", label: "Hide" },
  { value: "partial", label: "Dimmed" },
  { value: "toggle", label: "Toggle (click)" },
  { value: "full", label: "Reveal (hover/click)" },
];

/**
 * Page layout for fixed-layout books (manga); reflowable novels ignore it.
 *   - auto:   follow the book's OPF rendition:spread — none→single, both→spread,
 *             landscape/portrait→spread only in that window orientation (absent
 *             defaults to landscape, i.e. spread in landscape, one page otherwise)
 *   - single: always one page (overrides the book)
 *   - double: always a spread (overrides the book)
 */
export const MANGA_SPREAD_MODES: { value: MangaSpread; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "single", label: "Single" },
  { value: "double", label: "Spread" },
];

/**
 * Navigation model for fixed-layout books (manga), orthogonal to the page spread.
 *   - paginated:  one spread at a time, flip to advance (honours mangaSpread)
 *   - continuous: pages stacked vertically, fit to width, free scroll (long-strip)
 */
export const MANGA_READING_MODES: { value: MangaReadingMode; label: string }[] = [
  { value: "paginated", label: "Paginated" },
  { value: "continuous", label: "Continuous" },
];

/**
 * Scroll axis for the continuous manga strip.
 *   - vertical:   pages stacked top→bottom, fit to width, scroll down (webtoon)
 *   - horizontal: pages in a row, fit to height, scroll sideways in the book's
 *     progression direction (right→left for RTL manga)
 */
export const MANGA_SCROLL_DIRECTIONS: { value: MangaScrollDirection; label: string }[] = [
  { value: "vertical", label: "Vertical" },
  { value: "horizontal", label: "Horizontal" },
];

/**
 * User-selectable text directions. The default is `"auto"` — follow each EPUB's
 * own PPD / CSS (tategaki for most LNs, horizontal for foreign books). Picking
 * `horizontal`/`vertical` writes an explicit global override that applies to
 * every book until switched back to `auto`.
 */
export const WRITING_MODES: { value: WritingMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "horizontal", label: "Horizontal" },
  { value: "vertical", label: "Vertical" },
];

interface SettingsState {
  fontSize: number;
  lineHeight: number;
  fontFamily: FontFamily;
  theme: ThemeName;
  readingMode: ReadingMode;
  furiganaMode: FuriganaMode;
  mangaSpread: MangaSpread;
  mangaReadingMode: MangaReadingMode;
  mangaScrollDirection: MangaScrollDirection;
  mangaStripWidth: number;
  mangaStripGap: number;
  writingMode: WritingMode;
  pageColumns: number;
  sideMargin: number;
  discordRichPresence: boolean;
  discordCover: boolean;
  setFontSize: (fontSize: number) => void;
  setLineHeight: (lineHeight: number) => void;
  setFontFamily: (fontFamily: FontFamily) => void;
  setTheme: (theme: ThemeName) => void;
  setReadingMode: (readingMode: ReadingMode) => void;
  setFuriganaMode: (furiganaMode: FuriganaMode) => void;
  setMangaSpread: (mangaSpread: MangaSpread) => void;
  setMangaReadingMode: (mangaReadingMode: MangaReadingMode) => void;
  setMangaScrollDirection: (mangaScrollDirection: MangaScrollDirection) => void;
  setMangaStripWidth: (mangaStripWidth: number) => void;
  setMangaStripGap: (mangaStripGap: number) => void;
  setWritingMode: (writingMode: WritingMode) => void;
  setPageColumns: (pageColumns: number) => void;
  setSideMargin: (sideMargin: number) => void;
  setDiscordRichPresence: (discordRichPresence: boolean) => void;
  setDiscordCover: (discordCover: boolean) => void;
  reset: () => void;
}

type SettingsData = Pick<
  SettingsState,
  | "fontSize"
  | "lineHeight"
  | "fontFamily"
  | "theme"
  | "readingMode"
  | "furiganaMode"
  | "mangaSpread"
  | "mangaReadingMode"
  | "mangaScrollDirection"
  | "mangaStripWidth"
  | "mangaStripGap"
  | "writingMode"
  | "pageColumns"
  | "sideMargin"
  | "discordRichPresence"
  | "discordCover"
>;

const DEFAULTS: SettingsData = {
  fontSize: 21, // px
  lineHeight: 1.8,
  fontFamily: "mincho",
  theme: "sepia",
  readingMode: "paginated",
  furiganaMode: "show",
  mangaSpread: "auto",
  mangaReadingMode: "paginated",
  mangaScrollDirection: "vertical",
  mangaStripWidth: 100, // % of the fit axis (viewport width vertical / height horizontal)
  mangaStripGap: 12, // px between pages in the continuous strip
  writingMode: "auto",
  pageColumns: 0, // auto
  sideMargin: 12, // % per edge
  discordRichPresence: true, // opt-out; shares the current book to Discord
  discordCover: true, // opt-out; uploads the cover to a public host (catbox.moe) for the large image
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setFontSize: (fontSize) => set({ fontSize }),
      setLineHeight: (lineHeight) => set({ lineHeight }),
      setFontFamily: (fontFamily) => set({ fontFamily }),
      setTheme: (theme) => set({ theme }),
      setReadingMode: (readingMode) => set({ readingMode }),
      setFuriganaMode: (furiganaMode) => set({ furiganaMode }),
      setMangaSpread: (mangaSpread) => set({ mangaSpread }),
      setMangaReadingMode: (mangaReadingMode) => set({ mangaReadingMode }),
      setMangaScrollDirection: (mangaScrollDirection) => set({ mangaScrollDirection }),
      setMangaStripWidth: (mangaStripWidth) => set({ mangaStripWidth }),
      setMangaStripGap: (mangaStripGap) => set({ mangaStripGap }),
      setWritingMode: (writingMode) => set({ writingMode }),
      setPageColumns: (pageColumns) => set({ pageColumns }),
      setSideMargin: (sideMargin) => set({ sideMargin }),
      setDiscordRichPresence: (discordRichPresence) => set({ discordRichPresence }),
      setDiscordCover: (discordCover) => set({ discordCover }),
      reset: () => set({ ...DEFAULTS }),
    }),
    {
      name: "aozora-reader-settings",
    },
  ),
);
