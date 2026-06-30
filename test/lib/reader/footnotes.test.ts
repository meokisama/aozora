// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { collectFootnotes } from "@/lib/reader/footnotes";

describe("collectFootnotes", () => {
  it("finds EPUB3 footnotes by epub:type", () => {
    const html = `
      <p>本文<a epub:type="noteref" href="#n1">※1</a>です。</p>
      <aside epub:type="footnote" id="n1">注釈の説明文。</aside>
    `;
    const map = collectFootnotes(html);
    expect(map.get("n1")).toContain("注釈の説明文");
  });

  it("finds endnotes by epub:type and the ARIA doc-endnote role", () => {
    const html = `
      <div epub:type="rearnote" id="r1">巻末注。</div>
      <div role="doc-endnote" id="e1">脚注。</div>
    `;
    const map = collectFootnotes(html);
    expect(map.has("r1")).toBe(true);
    expect(map.has("e1")).toBe(true);
  });

  it("finds an untyped <aside> reached from a noteref", () => {
    const html = `
      <p><a role="doc-noteref" href="#a1">*</a></p>
      <aside id="a1">説明。</aside>
    `;
    const map = collectFootnotes(html);
    expect(map.get("a1")).toContain("説明");
  });

  it("ignores ordinary internal links (TOC / cross-references)", () => {
    const html = `
      <p><a href="#chap2">第二章へ</a></p>
      <div id="chap2"><h1>第二章</h1><p>本文</p></div>
    `;
    const map = collectFootnotes(html);
    expect(map.has("chap2")).toBe(false);
  });

  it("does not add the prose marker that a note's back-link points to", () => {
    const html = `
      <p><a epub:type="noteref" id="ref1" href="#n1">※1</a>本文</p>
      <aside epub:type="footnote" id="n1">
        注釈。<a epub:type="noteref" href="#ref1">戻る</a>
      </aside>
    `;
    const map = collectFootnotes(html);
    expect(map.has("n1")).toBe(true);
    expect(map.has("ref1")).toBe(false); // the prose marker is not a note body
  });

  it("skips empty note bodies and returns an empty map for blank html", () => {
    expect(collectFootnotes("").size).toBe(0);
    const map = collectFootnotes(`<aside epub:type="footnote" id="x"></aside>`);
    expect(map.has("x")).toBe(false);
  });
});
