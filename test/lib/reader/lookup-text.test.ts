// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { extractRunAt } from "@/lib/reader/lookup-text";

/** Builds a detached content root from HTML and returns it. */
function root(html: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "aozora-content";
  el.innerHTML = html;
  return el;
}

/** The nth text node (document order) within `el`, skipping nothing. */
function textNodes(el: Element): Text[] {
  const out: Text[] = [];
  const walk = (n: Node) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === Node.TEXT_NODE) out.push(c as Text);
      else walk(c);
    }
  };
  walk(el);
  return out;
}

describe("extractRunAt", () => {
  it("reads the run forward from the cursor offset within a text node", () => {
    const el = root("<p>今日は晴れです</p>");
    const node = textNodes(el)[0];
    const run = extractRunAt(node, 0, el);
    expect(run?.text).toBe("今日は晴れです");

    const mid = extractRunAt(node, 2, el); // start at は
    expect(mid?.text).toBe("は晴れです");
  });

  it("excludes furigana (<rt>) and stitches the base text across ruby", () => {
    const el = root("<p>今日は<ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby>だ</p>");
    const first = textNodes(el)[0]; // "今日は"
    const run = extractRunAt(first, 0, el);
    expect(run?.text).toBe("今日は漢字だ"); // readings dropped, base glued together
  });

  it("caps the run at maxLength code units", () => {
    const el = root("<p>あいうえおかきくけこ</p>");
    const node = textNodes(el)[0];
    expect(extractRunAt(node, 0, el, 3)?.text).toBe("あいう");
  });

  it("does not cross a block boundary", () => {
    const el = root("<p>走って</p><p>いく</p>");
    const node = textNodes(el)[0];
    expect(extractRunAt(node, 0, el)?.text).toBe("走って"); // stops at </p>
  });

  it("stops at a gaiji image (a term can't span it)", () => {
    const el = root('<p>あ<img class="gaiji" src="x">い</p>');
    const node = textNodes(el)[0];
    expect(extractRunAt(node, 0, el)?.text).toBe("あ");
  });

  it("returns null when the start node is furigana or not readable text", () => {
    const el = root("<p>今日は<ruby>漢<rt>かん</rt>字</ruby></p>");
    const rt = el.querySelector("rt")!.firstChild as Text; // "かん"
    expect(extractRunAt(rt, 0, el)).toBeNull();
  });

  it("builds a Range over the matched prefix, across ruby", () => {
    const el = root("<p>今日は<ruby>漢<rt>かん</rt>字</ruby>だ</p>");
    const node = textNodes(el)[0];
    const run = extractRunAt(node, 0, el)!;
    expect(run.text).toBe("今日は漢字だ");

    // Highlight the first 4 code units: 今日は + 漢 (spans into the ruby base).
    const range = run.rangeForLength(4)!;
    expect(range.toString()).toBe("今日は漢");

    expect(run.rangeForLength(0)).toBeNull();
  });
});
