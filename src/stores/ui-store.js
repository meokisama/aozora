import { create } from "zustand";

/**
 * Top-level app navigation + the library's filter state. The reader is driven
 * separately by reader-store (an open book takes over the whole window); this
 * store decides which non-reader page shows — the library grid or the reading
 * stats page — and holds the sidebar's status/author filters so they survive
 * navigating to stats and back.
 */
export const useUiStore = create((set) => ({
  view: "library", // "library" | "stats"
  setView: (view) => set({ view }),

  statusFilter: "all", // all | favorites | reading | finished | unread
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  authorFilter: null, // selected author name, or null for all
  setAuthorFilter: (authorFilter) => set({ authorFilter }),
}));
