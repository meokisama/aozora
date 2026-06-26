import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Library view prefs (sort + grid/list layout), persisted in the renderer via
 * Zustand persist, not the main process. Search text and the status tab are
 * ephemeral local component state in the library view.
 */

export type SortKey = "lastOpened" | "added" | "title" | "author" | "progress";
export type ViewMode = "grid" | "list";

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "lastOpened", label: "Last read" },
  { value: "added", label: "Date added" },
  { value: "title", label: "Title" },
  { value: "author", label: "Author" },
  { value: "progress", label: "Progress" },
];

interface LibraryPrefsState {
  sort: SortKey;
  view: ViewMode;
  setSort: (sort: SortKey) => void;
  setView: (view: ViewMode) => void;
}

export const useLibraryPrefs = create<LibraryPrefsState>()(
  persist(
    (set) => ({
      sort: "added",
      view: "grid",
      setSort: (sort) => set({ sort }),
      setView: (view) => set({ view }),
    }),
    { name: "aozora-library-prefs" },
  ),
);
