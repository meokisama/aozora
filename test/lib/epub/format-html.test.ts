// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildReaderHtml } from "@/lib/epub/format-html";
import { buildDummyImage } from "@/lib/epub/dummy-image";

// jsdom provides a real URL.createObjectURL; spy on it so we can both observe
// calls and return a deterministic URL.
let counter = 0;
beforeEach(() => {
  counter = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:mock/${counter++}`);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildReaderHtml", () => {
  it("replaces dummy-image placeholders with object URLs", () => {
    const key = "images/p1.png";
    const html = `<img src="${buildDummyImage(key)}">`;
    const { html: out, objectUrls } = buildReaderHtml(html, { [key]: new Blob(["x"], { type: "image/png" }) });

    expect(objectUrls).toHaveLength(1);
    expect(out).toContain(objectUrls[0]);
    expect(out).not.toContain("data:image/gif;aoz:");
  });

  it("also replaces the bare aoz:<key> reference form", () => {
    const key = "images/p2.jpg";
    const html = `<image href="aoz:${key}"/>`;
    const { html: out, objectUrls } = buildReaderHtml(html, { [key]: new Blob(["y"], { type: "image/jpeg" }) });
    expect(out).toContain(objectUrls[0]);
    expect(out).not.toContain(`aoz:${key}`);
  });

  it("replaces every occurrence of the same placeholder", () => {
    const key = "a.png";
    const dummy = buildDummyImage(key);
    const html = `<img src="${dummy}"><img src="${dummy}">`;
    const { html: out, objectUrls } = buildReaderHtml(html, { [key]: new Blob(["z"], { type: "image/png" }) });
    const occurrences = out.split(objectUrls[0]).length - 1;
    expect(occurrences).toBe(2);
  });

  it("creates one object URL per blob key", () => {
    const blobs = {
      "a.png": new Blob(["a"], { type: "image/png" }),
      "b.png": new Blob(["b"], { type: "image/png" }),
    };
    const html = `${buildDummyImage("a.png")} ${buildDummyImage("b.png")}`;
    const { objectUrls } = buildReaderHtml(html, blobs);
    expect(objectUrls).toHaveLength(2);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  });

  it("infers a mime type from the key when the blob has none", () => {
    const key = "img/cover.png";
    buildReaderHtml(buildDummyImage(key), { [key]: new Blob(["x"]) /* no type */ });
    const passedBlob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(passedBlob.type).toBe("image/png");
  });

  it("returns html unchanged when there are no blobs", () => {
    const html = "<p>no images</p>";
    const { html: out, objectUrls } = buildReaderHtml(html, {});
    expect(out).toBe(html);
    expect(objectUrls).toEqual([]);
  });
});
