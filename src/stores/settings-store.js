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

/**
 * Colour themes (page background + body text). `dark` is the app's dark mode
 * (toggles the `.dark` class on the document root); `sepia` is the default warm
 * light mode. The reader reads bg/color from here; the rest of the app follows
 * the `.dark` class via the Tailwind palette in index.css.
 */
export const THEMES = {
  sepia: { bg: "#faf8f4", color: "#1f1d1a", dark: false },
  // Warm charcoal page with dimmed off-white text — matches the app's dark
  // surface (index.css `.dark`) and avoids the glare of pure black/white.
  dark: { bg: "#201f1c", color: "#cac4b8", dark: true },
};

export const FONT_SIZE_RANGE = { min: 14, max: 40, step: 1 };
export const LINE_HEIGHT_RANGE = { min: 1.2, max: 2.6, step: 0.1 };

const DEFAULTS = {
  fontSize: 20, // px
  lineHeight: 1.8,
  fontFamily: "serif", // keyof FONT_STACKS
  theme: "sepia", // keyof THEMES
};

export const useSettingsStore = create(
  persist(
    (set) => ({
      ...DEFAULTS,
      setFontSize: (fontSize) => set({ fontSize }),
      setLineHeight: (lineHeight) => set({ lineHeight }),
      setFontFamily: (fontFamily) => set({ fontFamily }),
      setTheme: (theme) => set({ theme }),
      reset: () => set({ ...DEFAULTS }),
    }),
    {
      name: "aozora-reader-settings",
      version: 3,
      // v2: themes reduced to sepia + dark; fold the removed "light" into sepia.
      // v3: writing mode dropped — direction now always follows the EPUB.
      migrate: (state) => {
        if (state && !THEMES[state.theme]) state.theme = "sepia";
        if (state) delete state.writingMode;
        return state;
      },
    }
  )
);
