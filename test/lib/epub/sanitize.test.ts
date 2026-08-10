// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { stripScripting } from "@/lib/epub/sanitize";

/** Parses a fragment the way the EPUB pipeline hands content to stripScripting. */
function fragment(html: string): Element {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

describe("stripScripting", () => {
  it("leaves ordinary book markup untouched", () => {
    const html = `<p class="vrtl">彼は<ruby>本<rt>ほん</rt></ruby>を読んだ。<a href="chapter2.xhtml#note1">注</a><img src="aoz:cover.jpg" alt=""></p>`;
    const el = fragment(html);
    expect(stripScripting(el)).toBe(0);
    expect(el.innerHTML).toBe(html);
  });

  it("removes script elements", () => {
    const el = fragment(`<p>text</p><script>alert(1)</script>`);
    expect(stripScripting(el)).toBe(1);
    expect(el.querySelector("script")).toBeNull();
    expect(el.textContent).toBe("text");
  });

  it("removes elements that would pull in remote content", () => {
    const el = fragment(`<iframe src="https://evil.test"></iframe><object data="x"></object><embed src="y">`);
    expect(stripScripting(el)).toBe(3);
    expect(el.children.length).toBe(0);
  });

  it("strips inline event handlers, whatever their case", () => {
    const el = fragment(`<div onmouseover="steal()" ONCLICK="steal()" class="keep">x</div>`);
    expect(stripScripting(el)).toBe(2);
    const div = el.firstElementChild!;
    expect(div.getAttribute("class")).toBe("keep");
    expect(div.getAttributeNames().some((n) => n.startsWith("on"))).toBe(false);
  });

  it("strips SVG handlers and namespaced hrefs", () => {
    const el = fragment(`<svg><image onload="steal()" xlink:href="javascript:steal()"></image></svg>`);
    expect(stripScripting(el)).toBe(2);
    const image = el.querySelector("image")!;
    expect(image.getAttributeNames()).toEqual([]);
  });

  it("strips executable URLs but keeps fetchable ones", () => {
    const el = fragment(`<a href="javascript:steal()">a</a><a href="https://ok.test">b</a><a href="#frag">c</a>`);
    expect(stripScripting(el)).toBe(1);
    const [a, b, c] = Array.from(el.querySelectorAll("a"));
    expect(a.hasAttribute("href")).toBe(false);
    expect(b.getAttribute("href")).toBe("https://ok.test");
    expect(c.getAttribute("href")).toBe("#frag");
  });

  // The URL parser drops tabs and newlines before resolving the scheme, so these
  // all execute in a browser despite not reading as `javascript:`. (A NUL byte is
  // not in that set — the HTML parser turns it into U+FFFD, which breaks the
  // scheme outright, so it needs no help from us.)
  it("sees through whitespace inside a URL", () => {
    const tab = String.fromCharCode(9);
    const lf = String.fromCharCode(10);
    const el = fragment(`<a href="java${tab}script:steal()">a</a><a href=" JavaScript:steal()">b</a><a href="java${lf}script:steal()">c</a>`);
    expect(stripScripting(el)).toBe(3);
    expect(el.querySelectorAll("a[href]").length).toBe(0);
  });

  it("strips data: URLs that render markup, not ones that render images", () => {
    const el = fragment(`<a href="data:text/html;base64,PHNjcmlwdD4=">a</a><img src="data:image/gif;aoz:cover.jpg">`);
    expect(stripScripting(el)).toBe(1);
    expect(el.querySelector("a")!.hasAttribute("href")).toBe(false);
    expect(el.querySelector("img")!.getAttribute("src")).toBe("data:image/gif;aoz:cover.jpg");
  });
});
