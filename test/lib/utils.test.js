import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("joins plain class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("flattens arrays (clsx behaviour)", () => {
    expect(cn(["a", "b"], "c")).toBe("a b c");
  });

  it("resolves conditional object syntax", () => {
    expect(cn({ a: true, b: false, c: true })).toBe("a c");
  });

  it("merges conflicting tailwind utilities, last one wins", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-xs", "text-sm")).toBe("text-sm");
  });

  it("keeps non-conflicting tailwind utilities", () => {
    expect(cn("px-2", "py-4")).toBe("px-2 py-4");
  });
});
