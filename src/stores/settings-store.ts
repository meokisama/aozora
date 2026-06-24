import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Global reader display settings. These are user preferences (not canonical
 * book data), so they persist in the renderer via Zustand's persist middleware
 * (localStorage, scoped to the app's userData partition) rather than going
 * through the main process.
 *
 * The reader applies these live through CSS custom properties on the shadow
 * host; see `reader-view.jsx`.
 */

export type FontFamily = "serif" | "sans";
export type ThemeName = "sepia" | "dark";
export type ReadingMode = "continuous" | "paginated";
export type FuriganaMode = "show" | "hide" | "partial" | "toggle" | "full";
export type MangaSpread = "auto" | "single" | "double";

/** Font stacks favouring common system Japanese faces, with generic fallback. */
export const FONT_STACKS: Record<FontFamily, string> = {
  serif:
    "'Shippori Mincho', 'Hiragino Mincho ProN', 'Yu Mincho', YuMincho, 'Noto Serif JP', 'Noto Serif CJK JP', 'MS Mincho', serif",
  sans:
    "'Hiragino Kaku Gothic ProN', 'Yu Gothic', YuGothic, 'Noto Sans JP', 'Noto Sans CJK JP', 'Meiryo', sans-serif",
};

/**
 * Colour themes (page background + body text). `dark` is the app's dark mode
 * (toggles the `.dark` class on the document root); `sepia` is the default warm
 * light mode. The reader reads bg/color from here; the rest of the app follows
 * the `.dark` class via the Tailwind palette in index.css.
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
 * Furigana display modes (mirrors ttsu's furigana handling, collapsed into one
 * setting). The reader maps every mode except "show" to a `.aoz-furigana-<value>`
 * class on the content root; see `reader-styles.js`.
 *   - show:    furigana rendered normally (the book's own styling)
 *   - hide:    remove furigana entirely (rt display:none)
 *   - partial: dim furigana; reveal on hover, or click to keep revealed
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
 * Page layout for fixed-layout books (manga / comics). Only applies to the
 * fixed-layout reader; reflowable novels ignore it.
 *   - auto:   two-page spread when the window is landscape, one page otherwise
 *   - single: always one page at a time
 *   - double: always a two-page spread
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

type SettingsData = Pick<
  SettingsState,
  "fontSize" | "lineHeight" | "fontFamily" | "theme" | "readingMode" | "furiganaMode" | "mangaSpread"
>;

const DEFAULTS: SettingsData = {
  fontSize: 20, // px
  lineHeight: 1.8,
  fontFamily: "serif",
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
    }
  )
);
