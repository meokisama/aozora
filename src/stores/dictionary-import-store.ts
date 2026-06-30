import { create } from "zustand";
import type { DictionaryImportProgress } from "@/lib/types";

/**
 * Live state of an in-flight dictionary import. Kept in a store (not the
 * Dictionaries view's local state) so it survives navigating away — the work
 * runs in the main process regardless of which view is mounted, and any view
 * (or the title bar) can reflect "importing + %". Ephemeral, so not persisted.
 *
 * `importing` is bracketed by begin()/finish() around the import call; progress
 * events only refine the status line and percent. done/error also drop
 * `importing` so the flag never sticks if begin/finish are ever bypassed.
 */
interface DictionaryImportState {
  importing: boolean;
  status: string; // human-readable line, e.g. "Importing JMdict… 42%"
  percent: number | null; // 0–100 while inserting, else null
  /** Mark an import as starting (on click, before the file dialog). */
  begin: () => void;
  /** Fold a streamed progress event into the live status. */
  applyProgress: (p: DictionaryImportProgress) => void;
  /** Mark the import settled (success, cancel, or error). */
  finish: () => void;
}

export const useDictionaryImportStore = create<DictionaryImportState>((set) => ({
  importing: false,
  status: "",
  percent: null,
  begin: () => set({ importing: true, status: "Opening…", percent: null }),
  applyProgress: (p) =>
    set(() => {
      if (p.phase === "reading") return { importing: true, status: "Reading…", percent: null };
      if (p.phase === "inserting") {
        const percent = p.total ? Math.floor(((p.inserted ?? 0) / p.total) * 100) : null;
        return { importing: true, status: `Importing ${p.title ?? ""}…${percent !== null ? ` ${percent}%` : ""}`, percent };
      }
      // done | error: leave the authoritative reset to finish(), but clear the line.
      return { importing: false, status: "", percent: null };
    }),
  finish: () => set({ importing: false, status: "", percent: null }),
}));
