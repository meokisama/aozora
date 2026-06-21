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

/** Font stacks favouring common system Japanese faces, with generic fallback. */
export const FONT_STACKS = {
  serif:
    "'Hiragino Mincho ProN', 'Yu Mincho', YuMincho, 'Noto Serif JP', 'Noto Serif CJK JP', 'MS Mincho', serif",
  sans:
    "'Hiragino Kaku Gothic ProN', 'Yu Gothic', YuGothic, 'Noto Sans JP', 'Noto Sans CJK JP', 'Meiryo', sans-serif",
};

/** Reader colour themes (page background + body text). */
export const THEMES = {
  light: { bg: "#ffffff", color: "#1a1a1a" },
  sepia: { bg: "#faf8f4", color: "#1f1d1a" },
  dark: { bg: "#16161a", color: "#cfccc4" },
};

export const FONT_SIZE_RANGE = { min: 14, max: 40, step: 1 };
export const LINE_HEIGHT_RANGE = { min: 1.2, max: 2.6, step: 0.1 };

const DEFAULTS = {
  fontSize: 20, // px
  lineHeight: 1.8,
  fontFamily: "serif", // keyof FONT_STACKS
  theme: "sepia", // keyof THEMES
  writingMode: "auto", // "auto" | "vertical" | "horizontal"
};

export const useSettingsStore = create(
  persist(
    (set) => ({
      ...DEFAULTS,
      setFontSize: (fontSize) => set({ fontSize }),
      setLineHeight: (lineHeight) => set({ lineHeight }),
      setFontFamily: (fontFamily) => set({ fontFamily }),
      setTheme: (theme) => set({ theme }),
      setWritingMode: (writingMode) => set({ writingMode }),
      reset: () => set({ ...DEFAULTS }),
    }),
    { name: "aozora-reader-settings", version: 1 }
  )
);
