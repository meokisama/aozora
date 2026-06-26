import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Persisted renderer prefs for the hover dictionary; dictionaries and the lookup
 * engine live in the main process (src/main/services/dictionary-store.ts).
 * Lookup model is "hover + hold a modifier"; "none" means hover alone triggers it.
 */

export type LookupModifier = "shift" | "alt" | "ctrl" | "none";

export const LOOKUP_MODIFIERS: { value: LookupModifier; label: string }[] = [
  { value: "shift", label: "Hold Shift" },
  { value: "alt", label: "Hold Alt" },
  { value: "ctrl", label: "Hold Ctrl" },
  { value: "none", label: "Hover only" },
];

/** Whether a mouse/keyboard event satisfies the configured lookup modifier. */
export function modifierHeld(modifier: LookupModifier, e: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean }): boolean {
  switch (modifier) {
    case "shift":
      return e.shiftKey;
    case "alt":
      return e.altKey;
    case "ctrl":
      return e.ctrlKey;
    case "none":
      return true;
  }
}

interface DictionaryState {
  enabled: boolean;
  modifier: LookupModifier;
  setEnabled: (enabled: boolean) => void;
  setModifier: (modifier: LookupModifier) => void;
}

export const useDictionaryStore = create<DictionaryState>()(
  persist(
    (set) => ({
      enabled: true,
      modifier: "shift",
      setEnabled: (enabled) => set({ enabled }),
      setModifier: (modifier) => set({ modifier }),
    }),
    {
      name: "aozora-dictionary",
    },
  ),
);
