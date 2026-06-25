import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Renderer-side preferences for the hover dictionary. The dictionaries
 * themselves and the lookup engine live in the main process (see
 * `src/main/services/dictionary-store.ts`); this store only holds the reader's
 * lookup behaviour, persisted like the other reader settings.
 *
 * The locked decision is "hover + hold a modifier" (not click-to-look-up), so a
 * lookup fires while the pointer is over text *and* the chosen modifier key is
 * held. "none" means hover alone triggers it.
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
