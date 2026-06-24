import { create } from "zustand";
import type { Book } from "@/lib/types";

interface ReaderState {
  currentBook: Book | null;
  open: (book: Book) => void;
  close: () => void;
}

/** Tracks which book (if any) is currently open in the reader. */
export const useReaderStore = create<ReaderState>((set) => ({
  currentBook: null,
  open: (book) => set({ currentBook: book }),
  close: () => set({ currentBook: null }),
}));
