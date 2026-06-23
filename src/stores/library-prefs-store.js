import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Library view preferences (sort order + grid/list layout). These are non-
 * critical UI prefs, so — like the reader settings — they persist in the
 * renderer via Zustand's persist middleware (localStorage) rather than going
 * through the main process. Search text and the status tab are ephemeral and
 * stay as local component state in the library view.
 */

export const SORT_OPTIONS = [
  { value: "lastOpened", label: "Last read" },
  { value: "added", label: "Date added" },
  { value: "title", label: "Title" },
  { value: "author", label: "Author" },
  { value: "progress", label: "Progress" },
];

export const useLibraryPrefs = create(
  persist(
    (set) => ({
      sort: "lastOpened", // one of SORT_OPTIONS[].value
      view: "grid", // "grid" | "list"
      setSort: (sort) => set({ sort }),
      setView: (view) => set({ view }),
    }),
    { name: "aozora-library-prefs" }
  )
);
