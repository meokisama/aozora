import { describe, it, expect } from "vitest";
import { resolveFontStack } from "@/stores/fonts-store";
import { FONT_STACKS } from "@/stores/settings-store";

describe("resolveFontStack", () => {
  it("returns the built-in stack for a built-in font", () => {
    expect(resolveFontStack("noto-sans")).toBe(FONT_STACKS["noto-sans"]);
    expect(resolveFontStack("gyosho")).toBe(FONT_STACKS.gyosho);
  });

  it("returns the registered family for an imported font", () => {
    const custom = [{ id: "abc", label: "My Font", family: "aoz-font-abc" }];
    expect(resolveFontStack("abc", custom)).toBe("'aoz-font-abc', serif");
  });

  it("falls back to mincho for an unknown id", () => {
    expect(resolveFontStack("missing")).toBe(FONT_STACKS.mincho);
    expect(resolveFontStack("missing", [{ id: "other", label: "x", family: "f" }])).toBe(FONT_STACKS.mincho);
  });
});
