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

export const FONT_SIZE_RANGE = { min: 14, max: 40, step: 1 };
export const LINE_HEIGHT_RANGE = { min: 1.2, max: 2.6, step: 0.1 };

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
 *   - auto:   two-page spread in landscape, one page otherwise
 *   - single: always one page
 *   - double: always a spread
 */
export const MANGA_SPREAD_MODES: { value: MangaSpread; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "single", label: "Single" },
  { value: "double", label: "Spread" },
];

interface SettingsState {
  fontSize: number;
  lineHeight: number;
  fontFamily: FontFamily;
  theme: ThemeName;
  readingMode: ReadingMode;
  furiganaMode: FuriganaMode;
  mangaSpread: MangaSpread;
  setFontSize: (fontSize: number) => void;
  setLineHeight: (lineHeight: number) => void;
  setFontFamily: (fontFamily: FontFamily) => void;
  setTheme: (theme: ThemeName) => void;
  setReadingMode: (readingMode: ReadingMode) => void;
  setFuriganaMode: (furiganaMode: FuriganaMode) => void;
  setMangaSpread: (mangaSpread: MangaSpread) => void;
  reset: () => void;
}

type SettingsData = Pick<SettingsState, "fontSize" | "lineHeight" | "fontFamily" | "theme" | "readingMode" | "furiganaMode" | "mangaSpread">;

const DEFAULTS: SettingsData = {
  fontSize: 21, // px
  lineHeight: 1.8,
  fontFamily: "mincho",
  theme: "sepia",
  readingMode: "paginated",
  furiganaMode: "show",
  mangaSpread: "auto",
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
      reset: () => set({ ...DEFAULTS }),
    }),
    {
      name: "aozora-reader-settings",
    },
  ),
);
