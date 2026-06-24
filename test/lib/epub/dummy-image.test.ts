import { describe, it, expect } from "vitest";
import { buildDummyImage } from "@/lib/epub/dummy-image";

describe("buildDummyImage", () => {
  it("embeds the key in an aoz: segment of a gif data-URI", () => {
    const uri = buildDummyImage("images/cover.jpg");
    expect(uri.startsWith("data:image/gif;aoz:images/cover.jpg;base64,")).toBe(true);
  });

  it("is deterministic for the same key", () => {
    expect(buildDummyImage("a/b.png")).toBe(buildDummyImage("a/b.png"));
  });

  it("produces distinct URIs for different keys", () => {
    expect(buildDummyImage("a.png")).not.toBe(buildDummyImage("b.png"));
  });
});
