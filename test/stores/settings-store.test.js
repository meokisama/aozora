// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  useSettingsStore,
  FONT_STACKS,
  THEMES,
  FONT_SIZE_RANGE,
  LINE_HEIGHT_RANGE,
} from "@/stores/settings-store";

const DEFAULTS = {
  fontSize: 20,
  lineHeight: 1.8,
  fontFamily: "serif",
  theme: "sepia",
  readingMode: "paginated",
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
    useSettingsStore.getState().setFontFamily("sans");
    useSettingsStore.getState().setTheme("dark");
    useSettingsStore.getState().setReadingMode("continuous");
    const s = useSettingsStore.getState();
    expect(s.fontFamily).toBe("sans");
    expect(s.theme).toBe("dark");
    expect(s.readingMode).toBe("continuous");
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
    expect(JSON.parse(raw).state.fontSize).toBe(33);
  });
});

describe("settings-store constants", () => {
  it("font stacks exist for both families", () => {
    expect(FONT_STACKS.serif).toContain("Mincho");
    expect(FONT_STACKS.sans).toContain("Gothic");
    expect(Object.keys(FONT_STACKS)).toEqual(["serif", "sans"]);
  });

  it("themes carry bg/color and a dark flag", () => {
    expect(THEMES.sepia.dark).toBe(false);
    expect(THEMES.dark.dark).toBe(true);
    for (const t of Object.values(THEMES)) {
      expect(t.bg).toMatch(/^#/);
      expect(t.color).toMatch(/^#/);
    }
  });

  it("default font size and line height fall within their ranges", () => {
    expect(DEFAULTS.fontSize).toBeGreaterThanOrEqual(FONT_SIZE_RANGE.min);
    expect(DEFAULTS.fontSize).toBeLessThanOrEqual(FONT_SIZE_RANGE.max);
    expect(DEFAULTS.lineHeight).toBeGreaterThanOrEqual(LINE_HEIGHT_RANGE.min);
    expect(DEFAULTS.lineHeight).toBeLessThanOrEqual(LINE_HEIGHT_RANGE.max);
  });
});
