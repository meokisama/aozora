// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore, FONT_STACKS, THEMES, FONT_SIZE_RANGE, LINE_HEIGHT_RANGE, FURIGANA_MODES } from "@/stores/settings-store";

const DEFAULTS = {
  fontSize: 20,
  lineHeight: 1.8,
  fontFamily: "mincho",
  theme: "sepia",
  readingMode: "paginated",
  furiganaMode: "show",
};

beforeEach(() => {
  useSettingsStore.getState().reset();
});

describe("settings-store defaults", () => {
  it("exposes the documented defaults", () => {
    const s = useSettingsStore.getState();
    expect(s.fontSize).toBe(DEFAULTS.fontSize);
    expect(s.lineHeight).toBe(DEFAULTS.lineHeight);
    expect(s.fontFamily).toBe(DEFAULTS.fontFamily);
    expect(s.theme).toBe(DEFAULTS.theme);
    expect(s.readingMode).toBe(DEFAULTS.readingMode);
    expect(s.furiganaMode).toBe(DEFAULTS.furiganaMode);
  });
});

describe("settings-store setters", () => {
  it("setFontSize / setLineHeight update single fields", () => {
    useSettingsStore.getState().setFontSize(28);
    useSettingsStore.getState().setLineHeight(2.2);
    expect(useSettingsStore.getState().fontSize).toBe(28);
    expect(useSettingsStore.getState().lineHeight).toBe(2.2);
  });

  it("setFontFamily / setTheme / setReadingMode update their fields", () => {
    useSettingsStore.getState().setFontFamily("noto-sans");
    useSettingsStore.getState().setTheme("dark");
    useSettingsStore.getState().setReadingMode("continuous");
    const s = useSettingsStore.getState();
    expect(s.fontFamily).toBe("noto-sans");
    expect(s.theme).toBe("dark");
    expect(s.readingMode).toBe("continuous");
  });

  it("setFuriganaMode updates the furigana mode", () => {
    useSettingsStore.getState().setFuriganaMode("partial");
    expect(useSettingsStore.getState().furiganaMode).toBe("partial");
  });

  it("reset() restores every default", () => {
    const api = useSettingsStore.getState();
    api.setFontSize(40);
    api.setTheme("dark");
    api.setReadingMode("continuous");
    api.reset();
    const s = useSettingsStore.getState();
    expect(s).toMatchObject(DEFAULTS);
  });

  it("persists settings to localStorage under the expected key", () => {
    useSettingsStore.getState().setFontSize(33);
    const raw = localStorage.getItem("aozora-reader-settings");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).state.fontSize).toBe(33);
  });
});

describe("settings-store constants", () => {
  it("font stacks exist for every built-in family", () => {
    expect(FONT_STACKS.mincho).toContain("Mincho");
    expect(FONT_STACKS["noto-serif"]).toContain("Noto Serif JP");
    expect(FONT_STACKS["noto-sans"]).toContain("Noto Sans JP");
    expect(FONT_STACKS.gyosho).toContain("EPGyosho");
    expect(Object.keys(FONT_STACKS)).toEqual(["mincho", "noto-serif", "noto-sans", "gyosho"]);
  });

  it("themes carry bg/color and a dark flag", () => {
    expect(THEMES.sepia.dark).toBe(false);
    expect(THEMES.dark.dark).toBe(true);
    for (const t of Object.values(THEMES)) {
      expect(t.bg).toMatch(/^#/);
      expect(t.color).toMatch(/^#/);
    }
  });

  it("furigana modes lead with 'show' and cover the ttsu styles", () => {
    expect(FURIGANA_MODES[0].value).toBe("show");
    const values = FURIGANA_MODES.map((m) => m.value);
    expect(values).toEqual(["show", "hide", "partial", "toggle", "full"]);
    for (const m of FURIGANA_MODES) expect(m.label).toBeTruthy();
  });

  it("default furigana mode is one of the listed modes", () => {
    expect(FURIGANA_MODES.map((m) => m.value)).toContain(DEFAULTS.furiganaMode);
  });

  it("default font size and line height fall within their ranges", () => {
    expect(DEFAULTS.fontSize).toBeGreaterThanOrEqual(FONT_SIZE_RANGE.min);
    expect(DEFAULTS.fontSize).toBeLessThanOrEqual(FONT_SIZE_RANGE.max);
    expect(DEFAULTS.lineHeight).toBeGreaterThanOrEqual(LINE_HEIGHT_RANGE.min);
    expect(DEFAULTS.lineHeight).toBeLessThanOrEqual(LINE_HEIGHT_RANGE.max);
  });
});
