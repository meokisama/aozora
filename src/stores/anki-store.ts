import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AnkiConfig, AnkiDuplicateBehavior } from "@/lib/types";

/**
 * Anki mining config, persisted in the renderer. The main process is a stateless
 * AnkiConnect client, so `endpoint()` bundles the connection fields for each call.
 */

export const DEFAULT_ANKI_SERVER = "http://127.0.0.1:8765";

const DEFAULTS: AnkiConfig = {
  enabled: false,
  server: DEFAULT_ANKI_SERVER,
  apiKey: "",
  deck: "",
  model: "",
  fields: {},
  kanjiDeck: "",
  kanjiModel: "",
  kanjiFields: {},
  tags: ["aozora"],
  duplicateBehavior: "prevent",
  screenshot: true,
  screenshotQuality: 90,
};

interface AnkiState extends AnkiConfig {
  setEnabled: (enabled: boolean) => void;
  setServer: (server: string) => void;
  setApiKey: (apiKey: string) => void;
  setDeck: (deck: string) => void;
  /** Switching model clears the field map (its fields no longer apply). */
  setModel: (model: string) => void;
  setFields: (fields: Record<string, string>) => void;
  setField: (name: string, template: string) => void;
  setKanjiDeck: (deck: string) => void;
  /** Switching kanji model clears the kanji field map. */
  setKanjiModel: (model: string) => void;
  setKanjiFields: (fields: Record<string, string>) => void;
  setKanjiField: (name: string, template: string) => void;
  setTags: (tags: string[]) => void;
  setDuplicateBehavior: (duplicateBehavior: AnkiDuplicateBehavior) => void;
  setScreenshot: (screenshot: boolean) => void;
  setScreenshotQuality: (screenshotQuality: number) => void;
}

export const useAnkiStore = create<AnkiState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setEnabled: (enabled) => set({ enabled }),
      setServer: (server) => set({ server }),
      setApiKey: (apiKey) => set({ apiKey }),
      setDeck: (deck) => set({ deck }),
      setModel: (model) => set({ model, fields: {} }),
      setFields: (fields) => set({ fields }),
      setField: (name, template) => set((s) => ({ fields: { ...s.fields, [name]: template } })),
      setKanjiDeck: (kanjiDeck) => set({ kanjiDeck }),
      setKanjiModel: (kanjiModel) => set({ kanjiModel, kanjiFields: {} }),
      setKanjiFields: (kanjiFields) => set({ kanjiFields }),
      setKanjiField: (name, template) => set((s) => ({ kanjiFields: { ...s.kanjiFields, [name]: template } })),
      setTags: (tags) => set({ tags }),
      setDuplicateBehavior: (duplicateBehavior) => set({ duplicateBehavior }),
      setScreenshot: (screenshot) => set({ screenshot }),
      setScreenshotQuality: (screenshotQuality) => set({ screenshotQuality }),
    }),
    {
      name: "aozora-anki",
    },
  ),
);
