import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Library view preferences (sort order + grid/list layout). These are non-
 * critical UI prefs, so — like the reader settings — they persist in the
 * renderer via Zustand's persist middleware (localStorage) rather than going
 * through the main process. Search text and the status tab are ephemeral and
 * stay as local component state in the library view.
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
