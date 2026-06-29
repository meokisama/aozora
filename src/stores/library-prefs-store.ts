import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Library view prefs (sort + grid/list layout), persisted in the renderer via
 * Zustand persist, not the main process. Search text and the status tab are
 * ephemeral local component state in the library view.
 */

export type SortKey = "lastOpened" | "added" | "title" | "author" | "progress";
export type ViewMode = "grid" | "list";
export type CardSize = "small" | "medium" | "large";

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "lastOpened", label: "Last read" },
  { value: "added", label: "Date added" },
  { value: "title", label: "Title" },
  { value: "author", label: "Author" },
  { value: "progress", label: "Progress" },
];

export const CARD_SIZE_OPTIONS: { value: CardSize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

interface LibraryPrefsState {
  sort: SortKey;
  view: ViewMode;
  cardSize: CardSize;
  showCardMetadata: boolean;
  setSort: (sort: SortKey) => void;
  setView: (view: ViewMode) => void;
  setCardSize: (cardSize: CardSize) => void;
  setShowCardMetadata: (showCardMetadata: boolean) => void;
}

export const useLibraryPrefs = create<LibraryPrefsState>()(
  persist(
    (set) => ({
      sort: "added",
      view: "grid",
      cardSize: "medium",
      showCardMetadata: true,
      setSort: (sort) => set({ sort }),
      setView: (view) => set({ view }),
      setCardSize: (cardSize) => set({ cardSize }),
      setShowCardMetadata: (showCardMetadata) => set({ showCardMetadata }),
    }),
    { name: "aozora-library-prefs" },
  ),
);
