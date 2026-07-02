import { describe, it, expect } from "vitest";
import type { AnkiConfig, DictionaryEntry } from "@/lib/types";
import {
  SCREENSHOT_SENTINEL,
  glossToHtml,
  glossToText,
  cardDataFromEntry,
  renderField,
  buildNote,
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

const config = (fields: Record<string, string>): AnkiConfig => ({
  enabled: true,
  server: "http://127.0.0.1:8765",
  apiKey: "",
  deck: "Mining",
  model: "Basic",
  fields,
  tags: ["aozora"],
  duplicateBehavior: "prevent",
  screenshot: false,
  screenshotQuality: 90,
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
