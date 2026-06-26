import { create } from "zustand";

export type AppView = "library" | "stats" | "dictionaries";
export type StatusFilter = "all" | "favorites" | "reading" | "finished" | "unread";

interface UiState {
  view: AppView;
  setView: (view: AppView) => void;
  statusFilter: StatusFilter;
  setStatusFilter: (statusFilter: StatusFilter) => void;
  authorFilter: string | null;
  setAuthorFilter: (authorFilter: string | null) => void;
}

/**
 * Top-level navigation + library filter state. The reader is driven separately
 * by reader-store; this store picks the non-reader page and holds the sidebar's
 * status/author filters so they survive navigating away and back.
 */
export const useUiStore = create<UiState>((set) => ({
  view: "library",
  setView: (view) => set({ view }),

  statusFilter: "all",
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  authorFilter: null,
  setAuthorFilter: (authorFilter) => set({ authorFilter }),
}));
