import { describe, expect, it } from "vitest";
import { deinflect } from "@/lib/dictionary/deinflect";

/** Convenience: the candidate base forms produced for a surface form. */
const forms = (word: string) => deinflect(word).map((d) => d.term);

describe("deinflect", () => {
  it("returns the surface form itself first, with no reasons", () => {
    const [first] = deinflect("食べる");
    expect(first.term).toBe("食べる");
    expect(first.reasons).toEqual([]);
    expect(first.conditions).toBe(0);
  });

  describe("plain past (た / だ)", () => {
    it.each([
      ["食べた", "食べる"], // ichidan
      ["買った", "買う"],
      ["待った", "待つ"],
      ["取った", "取る"],
      ["飲んだ", "飲む"],
      ["死んだ", "死ぬ"],
      ["遊んだ", "遊ぶ"],
      ["書いた", "書く"],
      ["泳いだ", "泳ぐ"],
      ["話した", "話す"],
      ["行った", "行く"], // irregular
    ])("%s → %s", (surface, base) => {
      expect(forms(surface)).toContain(base);
    });
  });

  describe("te-form (て / で)", () => {
    it.each([
      ["食べて", "食べる"],
      ["買って", "買う"],
      ["飲んで", "飲む"],
      ["書いて", "書く"],
      ["話して", "話す"],
      ["行って", "行く"],
    ])("%s → %s", (surface, base) => {
      expect(forms(surface)).toContain(base);
    });
  });

  describe("negative (ない)", () => {
    it.each([
      ["食べない", "食べる"], // ichidan
      ["飲まない", "飲む"],
      ["買わない", "買う"],
      ["書かない", "書く"],
      ["話さない", "話す"],
      ["飲まなかった", "飲む"], // negative past chains back through ない
    ])("%s → %s", (surface, base) => {
      expect(forms(surface)).toContain(base);
    });
  });

  describe("polite (ます family)", () => {
    it.each([
      ["食べます", "食べる"],
      ["飲みます", "飲む"],
      ["書きます", "書く"],
      ["食べました", "食べる"],
      ["飲みません", "飲む"],
      ["行きませんでした", "行く"],
    ])("%s → %s", (surface, base) => {
      expect(forms(surface)).toContain(base);
    });
  });

  describe("progressive (ている / てる)", () => {
    it.each([
      ["食べている", "食べる"],
      ["飲んでいる", "飲む"],
      ["食べてる", "食べる"],
      ["食べていた", "食べる"],
    ])("%s → %s", (surface, base) => {
      expect(forms(surface)).toContain(base);
    });
  });

  describe("potential / passive / causative", () => {
    it.each([
      ["食べられる", "食べる"],
      ["飲める", "飲む"], // potential
      ["書ける", "書く"],
      ["書かれる", "書く"], // passive
      ["書かせる", "書く"], // causative
      ["食べさせる", "食べる"],
    ])("%s → %s", (surface, base) => {
      expect(forms(surface)).toContain(base);
    });
  });

  describe("desire (たい) and its inflections", () => {
    it.each([
      ["食べたい", "食べる"],
      ["飲みたい", "飲む"],
      ["行きたい", "行く"],
      ["食べたくない", "食べる"], // たくない → たい → る
      ["食べたかった", "食べる"],
    ])("%s → %s", (surface, base) => {
      expect(forms(surface)).toContain(base);
    });
  });

  describe("conditionals and volitional", () => {
    it.each([
      ["読めば", "読む"],
      ["食べれば", "食べる"],
      ["食べたら", "食べる"], // たら → た → る
      ["飲んだら", "飲む"],
      ["食べよう", "食べる"],
      ["飲もう", "飲む"],
    ])("%s → %s", (surface, base) => {
      expect(forms(surface)).toContain(base);
    });
  });

  describe("irregular する / くる", () => {
    it.each([
      ["した", "する"],
      ["して", "する"],
      ["しない", "する"],
      ["します", "する"],
      ["きた", "くる"],
      ["こない", "くる"],
      ["きます", "くる"],
    ])("%s → %s", (surface, base) => {
      expect(forms(surface)).toContain(base);
    });
  });

  describe("i-adjectives", () => {
    it.each([
      ["高かった", "高い"],
      ["高くない", "高い"],
      ["高くて", "高い"],
      ["高く", "高い"],
      ["高ければ", "高い"],
    ])("%s → %s", (surface, base) => {
      expect(forms(surface)).toContain(base);
    });
  });

  describe("advanced forms (full Yomitan ruleset)", () => {
    it.each([
      ["食べさせられる", "食べる"], // causative-passive
      ["食べちゃう", "食べる"], // ～ちゃう (colloquial しまう)
      ["飲みすぎる", "飲む"], // ～すぎる on the masu-stem
      ["高すぎる", "高い"], // ～すぎる on an adjective
      ["食べなさい", "食べる"], // polite imperative
      ["来た", "来る"], // kuru, kanji form
      ["行かない", "行く"], // irregular iku negative
      ["読まず", "読む"], // ～ず negative
    ])("%s → %s", (surface, base) => {
      expect(forms(surface)).toContain(base);
    });
  });

  it("records a reason chain for inflected forms", () => {
    const match = deinflect("食べました").find((d) => d.term === "食べる");
    expect(match).toBeDefined();
    expect(match!.reasons.length).toBeGreaterThan(0);
  });

  it("terminates on adversarial input (cycle detection)", () => {
    const results = deinflect("たたたたたたたたたた");
    expect(Array.isArray(results)).toBe(true);
    expect(results[0].term).toBe("たたたたたたたたたた");
  });
});
