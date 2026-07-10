import { describe, it, expect } from "vitest";
import type { AnkiConfig, DictionaryEntry, KanjiEntry } from "@/lib/types";
import {
  SCREENSHOT_SENTINEL,
  glossToHtml,
  glossToText,
  cardDataFromEntry,
  cardDataFromKanji,
  renderField,
  renderKanjiField,
  buildNote,
  buildKanjiNote,
  type AnkiCardContext,
} from "@/lib/dictionary/anki-note";

const ctx: AnkiCardContext = {
  sentence: "私はパンを食べる。",
  documentTitle: "Test Book",
  documentAuthor: "Someone",
  hasScreenshot: false,
};

const entry = (over: Partial<DictionaryEntry> = {}): DictionaryEntry => ({
  expression: "食べる",
  reading: "たべる",
  reasons: [],
  byDict: [{ dictId: "d1", dictTitle: "JMdict", tags: [], glosses: ["to eat"] }],
  frequencies: [],
  pitches: [],
  ...over,
});

const config = (fields: Record<string, string>, over: Partial<AnkiConfig> = {}): AnkiConfig => ({
  enabled: true,
  server: "http://127.0.0.1:8765",
  apiKey: "",
  deck: "Mining",
  model: "Basic",
  fields,
  kanjiDeck: "Kanji",
  kanjiModel: "KanjiNote",
  kanjiFields: {},
  tags: ["aozora"],
  duplicateBehavior: "prevent",
  screenshot: false,
  screenshotQuality: 90,
  ...over,
});

const kanji = (over: Partial<KanjiEntry> = {}): KanjiEntry => ({
  dictId: "k1",
  dictTitle: "KANJIDIC",
  character: "食",
  onyomi: ["ショク", "ジキ"],
  kunyomi: ["く.う", "た.べる"],
  meanings: ["eat", "food"],
  tags: [],
  stats: { strokes: 9, grade: 2 },
  frequencies: [],
  ...over,
});

describe("glossToText / glossToHtml", () => {
  it("returns a plain string gloss unchanged", () => {
    expect(glossToText("to eat")).toBe("to eat");
    expect(glossToHtml("to eat")).toBe("to eat");
  });

  it("escapes HTML-special characters in text nodes", () => {
    expect(glossToHtml('a <b> & "c"')).toBe("a &lt;b&gt; &amp; &quot;c&quot;");
  });

  it("keeps whitelisted structural tags but drops attributes and unknown wrappers", () => {
    const tree = { tag: "ul", content: [{ tag: "li", content: "one" }, { tag: "li", content: "two" }] };
    expect(glossToHtml(tree)).toBe("<ul><li>one</li><li>two</li></ul>");
    // A styled span with data-* survives as a bare <span>; a custom wrapper is unwrapped.
    expect(glossToHtml({ tag: "span", style: { color: "red" }, content: "x" })).toBe("<span>x</span>");
    expect(glossToHtml({ tag: "unknownthing", content: "kept" })).toBe("kept");
  });

  it("flattens images to their alt text and links to their text", () => {
    expect(glossToHtml({ tag: "img", path: "x.png", alt: "pic" })).toBe("pic");
    expect(glossToText({ tag: "li", content: "a" })).toBe("\na");
  });
});

describe("renderField", () => {
  const data = cardDataFromEntry(entry(), ctx);

  it("substitutes known markers", () => {
    expect(renderField("{expression}", data)).toBe("食べる");
    expect(renderField("{reading}", data)).toBe("たべる");
    expect(renderField("{sentence}", data)).toBe("私はパンを食べる。");
    expect(renderField("{glossary-plain}", data)).toBe("to eat");
  });

  it("leaves unknown markers literal", () => {
    expect(renderField("{not-a-marker}", data)).toBe("{not-a-marker}");
  });

  it("renders furigana as ruby and plain bracket notation", () => {
    expect(renderField("{furigana}", data)).toBe("<ruby>食<rt>た</rt></ruby>べる");
    expect(renderField("{furigana-plain}", data)).toBe("食[た]べる");
  });

  it("emits the screenshot sentinel only when a screenshot is present", () => {
    expect(renderField("{screenshot}", data)).toBe("");
    const withShot = cardDataFromEntry(entry(), { ...ctx, hasScreenshot: true });
    expect(renderField("img:{screenshot}", withShot)).toBe(`img:${SCREENSHOT_SENTINEL}`);
  });
});

describe("cardDataFromEntry", () => {
  it("dedupes pitch downstep numbers and joins frequencies for display", () => {
    const data = cardDataFromEntry(
      entry({
        pitches: [
          { dictId: "p", dictTitle: "P", reading: "たべる", position: 2, nasal: [], devoice: [] },
          { dictId: "p", dictTitle: "P", reading: "たべる", position: 2, nasal: [], devoice: [] },
          { dictId: "p", dictTitle: "P", reading: "たべる", position: 0, nasal: [], devoice: [] },
        ],
        frequencies: [
          { dictId: "f", dictTitle: "Freq", value: 123, displayValue: "123" },
          { dictId: "f2", dictTitle: "Freq2", value: 4, displayValue: null },
        ],
      }),
      ctx,
    );
    expect(data.pitchAccents).toBe("2, 0");
    expect(data.frequencies).toBe("123, 4");
  });

  it("numbers multiple glosses across dictionaries as an ordered list", () => {
    const data = cardDataFromEntry(
      entry({ byDict: [{ dictId: "d", dictTitle: "T", tags: [], glosses: ["to eat", "to live on"] }] }),
      ctx,
    );
    expect(data.glossary).toBe("<ol><li>to eat</li><li>to live on</li></ol>");
    expect(data.glossaryPlain).toBe("to eat\nto live on");
  });

  it("derives a book tag from the document title", () => {
    expect(cardDataFromEntry(entry(), ctx).extraTags).toEqual(["Test_Book"]);
  });
});

describe("buildNote", () => {
  it("renders every field template and merges config + source tags without duplicates", () => {
    const note = buildNote(config({ Front: "{expression}", Back: "{glossary-plain}" }), cardDataFromEntry(entry(), ctx));
    expect(note.deckName).toBe("Mining");
    expect(note.modelName).toBe("Basic");
    expect(note.fields).toEqual({ Front: "食べる", Back: "to eat" });
    expect(note.tags).toEqual(["aozora", "Test_Book"]);
    expect(note.options.allowDuplicate).toBe(false);
  });

  it("sets allowDuplicate when the config allows duplicates", () => {
    const note = buildNote({ ...config({ Front: "{expression}" }), duplicateBehavior: "allow" }, cardDataFromEntry(entry(), ctx));
    expect(note.options.allowDuplicate).toBe(true);
  });
});

describe("term markers — tags / part-of-speech / dictionary / pitch graph", () => {
  const withTags = entry({
    byDict: [
      {
        dictId: "d1",
        dictTitle: "JMdict",
        tags: [
          { name: "v1", category: "partOfSpeech", notes: "ichidan verb", order: 0 },
          { name: "vt", category: "partOfSpeech", notes: "transitive", order: 1 },
          { name: "news", category: "frequent", notes: "", order: 2 },
        ],
        glosses: ["to eat"],
      },
    ],
  });

  it("joins tag names, filters parts of speech, and lists the source dictionary", () => {
    const data = cardDataFromEntry(withTags, ctx);
    expect(renderField("{tags}", data)).toBe("v1 vt news");
    expect(renderField("{part-of-speech}", data)).toBe("v1 vt");
    expect(renderField("{dictionary}", data)).toBe("JMdict");
  });

  it("renders a pitch-accent graph as an inline SVG (empty without pitch data)", () => {
    expect(renderField("{pitch-accent-graphs}", cardDataFromEntry(entry(), ctx))).toBe("");
    const withPitch = cardDataFromEntry(
      entry({ pitches: [{ dictId: "p", dictTitle: "P", reading: "たべる", position: 2, nasal: [], devoice: [] }] }),
      ctx,
    );
    const svg = renderField("{pitch-accent-graphs}", withPitch);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("</svg>");
  });
});

describe("cloze markers", () => {
  it("uses the supplied cloze split", () => {
    const data = cardDataFromEntry(entry(), { ...ctx, cloze: { prefix: "私はパンを", body: "食べる", suffix: "。" } });
    expect(renderField("{cloze-prefix}", data)).toBe("私はパンを");
    expect(renderField("{cloze-body}", data)).toBe("食べる");
    expect(renderField("{cloze-suffix}", data)).toBe("。");
  });

  it("falls back to the whole expression as the body when no cloze is given", () => {
    const data = cardDataFromEntry(entry(), ctx);
    expect(renderField("{cloze-prefix}{cloze-body}{cloze-suffix}", data)).toBe("食べる");
  });
});

describe("kanji cards", () => {
  it("fills kanji markers from a kanji entry", () => {
    const data = cardDataFromKanji(kanji(), ctx);
    expect(renderKanjiField("{character}", data)).toBe("食");
    expect(renderKanjiField("{onyomi}", data)).toBe("ショク、ジキ");
    expect(renderKanjiField("{kunyomi}", data)).toBe("く.う、た.べる");
    expect(renderKanjiField("{glossary}", data)).toBe("eat, food");
    expect(renderKanjiField("{stroke-count}", data)).toBe("9");
    expect(renderKanjiField("{dictionary}", data)).toBe("KANJIDIC");
  });

  it("builds a kanji note against the kanji deck/model/fields", () => {
    const note = buildKanjiNote(config({}, { kanjiFields: { Front: "{character}", Back: "{glossary}" } }), cardDataFromKanji(kanji(), ctx));
    expect(note.deckName).toBe("Kanji");
    expect(note.modelName).toBe("KanjiNote");
    expect(note.fields).toEqual({ Front: "食", Back: "eat, food" });
    expect(note.tags).toEqual(["aozora", "Test_Book"]);
  });
});
