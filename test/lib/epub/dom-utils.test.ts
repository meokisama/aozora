// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  isElementGaiji,
  isNodeGaiji,
  getCharacterCount,
  getParagraphNodes,
  countCharacters,
  clearAllBadImageRef,
  fixXHtmlHref,
  tagGaijiImages,
} from "@/lib/epub/dom-utils";

/** Builds a detached element from an HTML string. */
function el(html: string, tag = "div") {
  const node = document.createElement(tag);
  node.innerHTML = html;
  return node;
}

describe("isElementGaiji / isNodeGaiji", () => {
  it("matches any class containing 'gaiji'", () => {
    const img = el('<img class="foo gaiji-wide">', "p").firstChild as Element;
    expect(isElementGaiji(img)).toBe(true);
    expect(isNodeGaiji(img)).toBe(true);
  });

  it("is false for a plain image", () => {
    const img = el('<img class="cover">', "p").firstChild as Element;
    expect(isElementGaiji(img)).toBe(false);
    expect(isNodeGaiji(img)).toBe(false);
  });

  it("isNodeGaiji is false for non-image nodes", () => {
    const span = el('<span class="gaiji">x</span>', "p").firstChild as Node;
    expect(isNodeGaiji(span)).toBe(false);
  });
});

describe("tagGaijiImages", () => {
  it("tags an image inline with text (Calibre/KFX gaiji without a gaiji class)", () => {
    const root = el('<p>その<img src="aoz:x.jpg" class="class_s8x"/>田</p>');
    tagGaijiImages(root);
    const img = root.querySelector("img")!;
    expect(isElementGaiji(img)).toBe(true);
  });

  it("tags an image used as a ruby base character", () => {
    const root = el("<p><ruby><rb><img src=\"aoz:x.jpg\"/></rb><rt>くし</rt></ruby>田</p>");
    tagGaijiImages(root);
    expect(isElementGaiji(root.querySelector("img")!)).toBe(true);
  });

  it("climbs out through an inline wrapper to find the text sibling", () => {
    const root = el('<p>あ<a><img src="aoz:x.jpg"/></a>い</p>');
    tagGaijiImages(root);
    expect(isElementGaiji(root.querySelector("img")!)).toBe(true);
  });

  it("leaves a standalone block image (illustration) untagged", () => {
    const root = el('<div><p>text</p><img src="aoz:big.jpg"/><p>more</p></div>');
    tagGaijiImages(root);
    expect(isElementGaiji(root.querySelector("img")!)).toBe(false);
  });

  it("leaves an image alone in its own paragraph untagged", () => {
    const root = el('<p><img src="aoz:big.jpg"/></p>');
    tagGaijiImages(root);
    expect(isElementGaiji(root.querySelector("img")!)).toBe(false);
  });

  it("does not double-tag an image that already has a gaiji class", () => {
    const root = el('<p>あ<img class="gaiji" src="aoz:x.jpg"/>い</p>');
    tagGaijiImages(root);
    expect(root.querySelector("img")!.className).toBe("gaiji");
  });
});

describe("getCharacterCount", () => {
  it("counts hiragana / kanji codepoints", () => {
    const p = el("今日は晴れ。"); // 5 JP chars + a fullwidth period (stripped)
    expect(getCharacterCount(p)).toBe(5);
  });

  it("counts ASCII letters and digits (i-flag keeps a-z)", () => {
    const p = el("Vol2");
    expect(getCharacterCount(p)).toBe(4);
  });

  it("strips spaces and western punctuation", () => {
    const p = el("hello, world!");
    expect(getCharacterCount(p)).toBe(10); // helloworld
  });

  it("counts a gaiji image as one character", () => {
    const img = el('<img class="gaiji">', "p").firstChild as Node;
    expect(getCharacterCount(img)).toBe(1);
  });

  it("returns 0 for empty / whitespace-only content", () => {
    expect(getCharacterCount(el("   "))).toBe(0);
    expect(getCharacterCount(el(""))).toBe(0);
  });
});

describe("getParagraphNodes", () => {
  it("collects text nodes, skipping pure-whitespace ones", () => {
    const root = el("<p>あ</p>\n  \n<p>い</p>");
    const nodes = getParagraphNodes(root);
    expect(nodes).toHaveLength(2);
    expect(nodes.map((n) => n.textContent)).toEqual(["あ", "い"]);
  });

  it("skips ruby readings (<rt>) but keeps the base text", () => {
    const root = el("<ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby>");
    expect(countCharacters(root)).toBe(2); // 漢 + 字, not かん/じ
  });

  it("skips aria-hidden and hidden subtrees", () => {
    const root = el('<span>見</span><span aria-hidden="true">隠</span><span hidden>秘</span>');
    expect(countCharacters(root)).toBe(1);
  });

  it("includes gaiji images as nodes", () => {
    const root = el('text<img class="gaiji">');
    const nodes = getParagraphNodes(root);
    // one text node + one gaiji image
    expect(nodes.some((n) => isNodeGaiji(n))).toBe(true);
  });
});

describe("countCharacters", () => {
  it("sums character counts across paragraphs and gaiji", () => {
    const root = el('<p>あいう</p><p>えお<img class="gaiji"></p>');
    expect(countCharacters(root)).toBe(6); // 3 + 2 + 1 gaiji
  });
});

describe("clearAllBadImageRef", () => {
  it("removes src that is not an aoz placeholder, preserving it in data-aoz-src", () => {
    const root = el('<img src="images/real.jpg">');
    clearAllBadImageRef(root);
    const img = root.querySelector("img")!;
    expect(img.hasAttribute("src")).toBe(false);
    expect(img.getAttribute("data-aoz-src")).toBe("images/real.jpg");
  });

  it("keeps an aoz: src untouched", () => {
    const root = el('<img src="aoz:images/x.jpg">');
    clearAllBadImageRef(root);
    expect(root.querySelector("img")!.getAttribute("src")).toBe("aoz:images/x.jpg");
  });

  it("keeps the dummy gif data-URI untouched", () => {
    const src = "data:image/gif;aoz:x.png;base64,abc";
    const root = el(`<img src="${src}">`);
    clearAllBadImageRef(root);
    expect(root.querySelector("img")!.getAttribute("src")).toBe(src);
  });
});

describe("fixXHtmlHref", () => {
  it("normalizes xlink:href on svg <image> to a plain href", () => {
    // Foreign (SVG) content keeps <image> as a distinct element in jsdom.
    const root = el('<svg><image xlink:href="aoz:pic.png"/></svg>');
    fixXHtmlHref(root);
    const image = root.getElementsByTagName("image")[0];
    expect(image.getAttribute("href")).toBe("aoz:pic.png");
  });

  it("leaves an existing href alone", () => {
    const root = el('<svg><image href="aoz:a.png" xlink:href="aoz:b.png"/></svg>');
    fixXHtmlHref(root);
    expect(root.getElementsByTagName("image")[0].getAttribute("href")).toBe("aoz:a.png");
  });
});
