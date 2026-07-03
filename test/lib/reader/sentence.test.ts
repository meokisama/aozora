// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { sentenceFromBlockText, sentenceContextAround } from "@/lib/reader/sentence";

describe("sentenceFromBlockText", () => {
  const text = "昔々ある所に。おじいさんは山へ芝刈りに行きました。おばあさんは川へ。";

  it("returns the sentence containing the offset, including its terminator", () => {
    // Offset inside the middle sentence (over 山).
    const i = text.indexOf("山");
    expect(sentenceFromBlockText(text, i)).toBe("おじいさんは山へ芝刈りに行きました。");
  });

  it("handles the first sentence (no preceding terminator)", () => {
    expect(sentenceFromBlockText(text, 1)).toBe("昔々ある所に。");
  });

  it("handles the last sentence (offset in the final clause)", () => {
    const i = text.lastIndexOf("川");
    expect(sentenceFromBlockText(text, i)).toBe("おばあさんは川へ。");
  });

  it("splits on ！？ and ASCII terminators too", () => {
    const t = "本当？そうだ! yes.";
    expect(sentenceFromBlockText(t, t.indexOf("そう"))).toBe("そうだ!");
  });

  it("clamps an out-of-range offset instead of throwing", () => {
    expect(sentenceFromBlockText("一文だけ。", 999)).toBe("一文だけ。");
  });
});

describe("sentenceContextAround", () => {
  /** SentenceContext for a caret at the start of the block's first text node. */
  function contextFor(html: string) {
    document.body.innerHTML = `<div id="root">${html}</div>`;
    const root = document.getElementById("root")!;
    const range = document.createRange();
    const walker = document.createTreeWalker(root.querySelector("p")!, NodeFilter.SHOW_TEXT);
    const first = walker.nextNode() as Text;
    range.setStart(first, 0);
    range.setEnd(first, 1);
    return sentenceContextAround(range, root)!;
  }

  it("substitutes furigana readings into the spoken sentence", () => {
    const sctx = contextFor("<p>これは<ruby>漢字<rt>かんじ</rt></ruby>です。次の文。</p>");
    expect(sctx.text).toBe("これは漢字です。");
    expect(sctx.spoken).toBe("これはかんじです。");
  });

  it("maps spoken offsets back onto the displayed sentence", () => {
    const sctx = contextFor("<p>これは<ruby>漢字<rt>かんじ</rt></ruby>です。次の文。</p>");
    // Outside ruby the texts are identical — exact.
    expect(sctx.displayedFromSpoken(3)).toBe(3);
    // The whole reading spoken (かんじ, 3 chars) → the whole base (漢字, 2 chars).
    expect(sctx.displayedFromSpoken(6)).toBe(5);
    // Mid-reading is proportional: 1 of 3 reading chars → 1 of 2 base chars.
    expect(sctx.displayedFromSpoken(4)).toBe(4);
    // Past the reading, exact again; the end maps to the end.
    expect(sctx.displayedFromSpoken(7)).toBe(6);
    expect(sctx.displayedFromSpoken(sctx.spoken.length)).toBe(sctx.text.length);
  });

  it("is the identity for a sentence without ruby", () => {
    const sctx = contextFor("<p>ただの文です。</p>");
    expect(sctx.spoken).toBe(sctx.text);
    for (let i = 0; i <= sctx.text.length; i++) expect(sctx.displayedFromSpoken(i)).toBe(i);
  });

  it("keeps the base when a ruby has no reading", () => {
    const sctx = contextFor("<p><ruby>漢字</ruby>です。</p>");
    expect(sctx.spoken).toBe("漢字です。");
  });
});
