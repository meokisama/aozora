import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AnkiConfig, AnkiDuplicateBehavior, AnkiEndpoint } from "@/lib/types";

/**
 * Anki mining config, persisted in the renderer (like reader prefs). The main
 * process is a stateless AnkiConnect client, so `endpoint()` bundles the two
 * connection fields to pass on each call.
 */

export const DEFAULT_ANKI_SERVER = "http://127.0.0.1:8765";

const DEFAULTS: AnkiConfig = {
  enabled: false,
  server: DEFAULT_ANKI_SERVER,
  apiKey: "",
  deck: "",
  model: "",
  fields: {},
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
  setTags: (tags: string[]) => void;
  setDuplicateBehavior: (duplicateBehavior: AnkiDuplicateBehavior) => void;
  setScreenshot: (screenshot: boolean) => void;
  setScreenshotQuality: (screenshotQuality: number) => void;
  reset: () => void;
  /** The connection fields, for a main-process call. */
  endpoint: () => AnkiEndpoint;
  /** True once enabled and pointed at a deck + model — enough to mine. */
  isConfigured: () => boolean;
}

export const useAnkiStore = create<AnkiState>()(
  persist(
    (set, get) => ({
      ...DEFAULTS,
      setEnabled: (enabled) => set({ enabled }),
      setServer: (server) => set({ server }),
      setApiKey: (apiKey) => set({ apiKey }),
      setDeck: (deck) => set({ deck }),
      setModel: (model) => set({ model, fields: {} }),
      setFields: (fields) => set({ fields }),
      setField: (name, template) => set((s) => ({ fields: { ...s.fields, [name]: template } })),
      setTags: (tags) => set({ tags }),
      setDuplicateBehavior: (duplicateBehavior) => set({ duplicateBehavior }),
      setScreenshot: (screenshot) => set({ screenshot }),
      setScreenshotQuality: (screenshotQuality) => set({ screenshotQuality }),
      reset: () => set({ ...DEFAULTS }),
      endpoint: () => {
        const { server, apiKey } = get();
        return { server, apiKey };
      },
      isConfigured: () => {
        const { enabled, deck, model, fields } = get();
        return enabled && !!deck && !!model && Object.keys(fields).length > 0;
      },
    }),
    {
      name: "aozora-anki",
    },
  ),
);
