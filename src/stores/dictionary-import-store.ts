import { create } from "zustand";
import type { DictionaryImportProgress } from "@/lib/types";

/**
 * Live state of an in-flight dictionary import. In a store (not the view's local
 * state) so it survives navigating away — the work runs in the main process and
 * any view can reflect "importing + %". Ephemeral, not persisted.
 *
 * `importing` is bracketed by begin()/finish(); progress events only refine the
 * status line. done/error also drop it so the flag never sticks if bypassed.
 */
interface DictionaryImportState {
  importing: boolean;
  status: string; // human-readable line, e.g. "Importing JMdict… 42%"
  /** Recommended-dictionary id being installed, or null for a manual file import. */
  installingId: string | null;
  /** Mark an import as starting (on click, before the file dialog). */
  begin: () => void;
  /** Mark a recommended dictionary as starting to download+install. */
  beginInstall: (id: string) => void;
  /** Fold a streamed progress event into the live status. */
  applyProgress: (p: DictionaryImportProgress) => void;
  /** Mark the import settled (success, cancel, or error). */
  finish: () => void;
}

export const useDictionaryImportStore = create<DictionaryImportState>((set) => ({
  importing: false,
  status: "",
  installingId: null,
  begin: () => set({ importing: true, status: "Opening…", installingId: null }),
  beginInstall: (id) => set({ importing: true, status: "Downloading…", installingId: id }),
  applyProgress: (p) =>
    set(() => {
      if (p.phase === "downloading") {
        const percent = p.total ? Math.floor(((p.received ?? 0) / p.total) * 100) : null;
        return { importing: true, status: `Downloading…${percent !== null ? ` ${percent}%` : ""}` };
      }
      if (p.phase === "reading") return { importing: true, status: "Reading…" };
      if (p.phase === "inserting") {
        const percent = p.total ? Math.floor(((p.inserted ?? 0) / p.total) * 100) : null;
        return { importing: true, status: `Importing ${p.title ?? ""}…${percent !== null ? ` ${percent}%` : ""}` };
      }
      // done | error: leave the authoritative reset to finish(), but clear the line.
      return { importing: false, status: "", installingId: null };
    }),
  finish: () => set({ importing: false, status: "", installingId: null }),
}));
