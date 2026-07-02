import { describe, it, expect } from "vitest";
import { sentenceFromBlockText } from "@/lib/reader/sentence";

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
