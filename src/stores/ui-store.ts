import { create } from "zustand";

export type AppView = "library" | "stats";
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
 * Top-level app navigation + the library's filter state. The reader is driven
 * separately by reader-store (an open book takes over the whole window); this
 * store decides which non-reader page shows — the library grid or the reading
 * stats page — and holds the sidebar's status/author filters so they survive
 * navigating to stats and back.
 */
export const useUiStore = create<UiState>((set) => ({
  view: "library",
  setView: (view) => set({ view }),

  statusFilter: "all",
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  authorFilter: null,
  setAuthorFilter: (authorFilter) => set({ authorFilter }),
}));
