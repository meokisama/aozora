import { create } from "zustand";

/** Tracks which book (if any) is currently open in the reader. */
export const useReaderStore = create((set) => ({
  currentBook: null,
  open: (book) => set({ currentBook: book }),
  close: () => set({ currentBook: null }),
}));
