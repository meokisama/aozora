import type { AnkiConfig, AnkiNote, DictionaryEntry, GlossContent, GlossElement, KanjiEntry } from "@/lib/types";
import { distributeFurigana } from "@/lib/dictionary/furigana";
import { escapeHtml } from "@/lib/dictionary/escape";
import { downstepNumber, pitchAccentSvg } from "@/lib/dictionary/pitch";

/**
 * Builds Anki notes from a dictionary lookup + the user's `{marker}` field
 * templates (Yomitan's convention — see references/yomitan/ext/js/data/
 * anki-template-util.js). The renderer resolves every marker except
 * `{screenshot}`: the window capture happens in the main process, so that marker
 * expands to a sentinel the main process later swaps for the stored `<img>` tag.
 */

/** Placeholder for `{screenshot}`; the main process replaces it post-capture. */
export const SCREENSHOT_SENTINEL = "%%AOZORA_SCREENSHOT%%";

/** Outcome of a mining attempt, shared by the reader and the popup's button state. */
export type MineStatus = "added" | "duplicate" | "error";

/** Sentence split around the matched run, for the cloze markers. */
export interface Cloze {
  prefix: string;
  body: string;
  suffix: string;
}

/** The marker values one term lookup contributes to a card, all pre-rendered to strings. */
export interface AnkiCardData {
  expression: string;
  reading: string;
  /** Reading distributed over the expression as HTML ruby. */
  furigana: string;
  /** Reading in Anki's ` kanji[reading]` bracket notation. */
  furiganaPlain: string;
  glossary: string; // HTML
  glossaryPlain: string; // newline-joined text
  sentence: string;
  /** Sentence text before / matched run / after (for cloze cards). */
  clozePrefix: string;
  clozeBody: string;
  clozeSuffix: string;
  pitchAccents: string; // downstep numbers, e.g. "0, 2"
  /** Pitch-accent graphs as concatenated inline SVGs (HTML). */
  pitchGraphs: string;
  frequencies: string;
  /** Definition / part-of-speech tag names, space-separated. */
  tags: string;
  /** Part-of-speech tag names only, space-separated. */
  partsOfSpeech: string;
  /** Source dictionary title(s) for the entry. */
  dictionary: string;
  documentTitle: string;
  documentAuthor: string;
  hasScreenshot: boolean;
  /** Note-level tags contributed by the source (e.g. the book title). */
  extraTags: string[];
}

/** The marker values one kanji contributes to a card, all pre-rendered to strings. */
export interface KanjiCardData {
  character: string;
  onyomi: string; // on'yomi readings, joined
  kunyomi: string; // kun'yomi readings, joined
  glossary: string; // meanings, joined
  strokeCount: string;
  frequencies: string;
  tags: string;
  dictionary: string;
  sentence: string;
  clozePrefix: string;
  clozeBody: string;
  clozeSuffix: string;
  documentTitle: string;
  documentAuthor: string;
  hasScreenshot: boolean;
  extraTags: string[];
}

// Structured-content tags safe to keep in an Anki card (attributes/styles dropped).
const HTML_TAGS = new Set([
  "div",
  "span",
  "ol",
  "ul",
  "li",
  "ruby",
  "rt",
  "rp",
  "br",
  "b",
  "i",
  "em",
  "strong",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
]);

/** Serializes a glossary tree to a safe HTML string (images/links flattened to text). */
export function glossToHtml(node: GlossContent | undefined): string {
  if (node == null) return "";
  if (typeof node === "string") return escapeHtml(node);
  if (Array.isArray(node)) return node.map(glossToHtml).join("");

  const el = node as GlossElement;
  if (el.type === "structured-content") return glossToHtml(el.content);
  if (el.type === "text") return escapeHtml(el.text ?? "");
  if (el.type === "image" || el.tag === "img") return el.alt ? escapeHtml(el.alt) : "";

  const tag = el.tag;
  if (!tag) return el.content != null ? glossToHtml(el.content) : "";
  if (tag === "br") return "<br>";
  const inner = el.content != null ? glossToHtml(el.content) : "";
  if (!HTML_TAGS.has(tag)) return inner; // unknown wrapper: keep its text, drop the tag
  return `<${tag}>${inner}</${tag}>`;
}

/** Serializes a glossary tree to plain text (block tags become newlines). */
export function glossToText(node: GlossContent | undefined): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(glossToText).join("");

  const el = node as GlossElement;
  if (el.type === "structured-content") return glossToText(el.content);
  if (el.type === "text") return el.text ?? "";
  if (el.type === "image" || el.tag === "img") return el.alt ?? "";
  if (el.tag === "br" || el.tag === "li") return "\n" + (el.content != null ? glossToText(el.content) : "");
  return el.content != null ? glossToText(el.content) : "";
}

/** ` kanji[reading]`-style furigana; bare kana stays unbracketed. */
function toFuriganaPlain(expression: string, reading: string): string {
  return distributeFurigana(expression, reading || expression)
    .map((seg) => (seg.reading ? ` ${seg.text}[${seg.reading}]` : seg.text))
    .join("")
    .trimStart();
}

function toFuriganaHtml(expression: string, reading: string): string {
  return distributeFurigana(expression, reading || expression)
    .map((seg) => (seg.reading ? `<ruby>${escapeHtml(seg.text)}<rt>${escapeHtml(seg.reading)}</rt></ruby>` : escapeHtml(seg.text)))
    .join("");
}

/** Context the reader supplies around a matched entry/kanji to complete a card. */
export interface AnkiCardContext {
  /** The full sentence containing the matched run. */
  sentence: string;
  /** The sentence split around the matched run; falls back to the whole sentence. */
  cloze?: Cloze;
  documentTitle: string;
  documentAuthor: string;
  hasScreenshot: boolean;
}

/** Book-title note tag shared by term + kanji cards. */
function extraTagsFor(ctx: AnkiCardContext): string[] {
  return ctx.documentTitle ? [ctx.documentTitle.replace(/\s+/g, "_")] : [];
}

/** Flattens a dictionary entry + its reading context into card marker values. */
export function cardDataFromEntry(entry: DictionaryEntry, ctx: AnkiCardContext): AnkiCardData {
  const reading = entry.reading ?? "";
  const allGlosses = entry.byDict.flatMap((g) => g.glosses);
  const glossary =
    allGlosses.length <= 1 ? glossToHtml(allGlosses[0]) : `<ol>${allGlosses.map((g) => `<li>${glossToHtml(g)}</li>`).join("")}</ol>`;
  const glossaryPlain = allGlosses
    .map((g) => glossToText(g).trim())
    .filter(Boolean)
    .join("\n");

  const pitchAccents = [...new Set(entry.pitches.map((p) => downstepNumber(p.position)))].join(", ");
  const pitchGraphs = entry.pitches
    .map((p) => pitchAccentSvg(p.reading, p.position, p.nasal, p.devoice))
    .filter(Boolean)
    .join("");
  const frequencies = entry.frequencies.map((f) => f.displayValue ?? String(f.value)).join(", ");

  const allTags = entry.byDict.flatMap((g) => g.tags);
  const tags = [...new Set(allTags.map((t) => t.name))].join(" ");
  const partsOfSpeech = [...new Set(allTags.filter((t) => t.category === "partOfSpeech").map((t) => t.name))].join(" ");
  const dictionary = [...new Set(entry.byDict.map((g) => g.dictTitle))].join(", ");
  const cloze: Cloze = ctx.cloze ?? { prefix: "", body: entry.expression, suffix: "" };

  return {
    expression: entry.expression,
    reading,
    furigana: toFuriganaHtml(entry.expression, reading),
    furiganaPlain: toFuriganaPlain(entry.expression, reading),
    glossary,
    glossaryPlain,
    sentence: ctx.sentence,
    clozePrefix: cloze.prefix,
    clozeBody: cloze.body,
    clozeSuffix: cloze.suffix,
    pitchAccents,
    pitchGraphs,
    frequencies,
    tags,
    partsOfSpeech,
    dictionary,
    documentTitle: ctx.documentTitle,
    documentAuthor: ctx.documentAuthor,
    hasScreenshot: ctx.hasScreenshot,
    extraTags: extraTagsFor(ctx),
  };
}

/** Flattens a kanji entry + its reading context into kanji-card marker values. */
export function cardDataFromKanji(kanji: KanjiEntry, ctx: AnkiCardContext): KanjiCardData {
  const cloze: Cloze = ctx.cloze ?? { prefix: "", body: kanji.character, suffix: "" };
  const strokeCount = kanji.stats.strokes != null ? String(kanji.stats.strokes) : "";
  return {
    character: kanji.character,
    onyomi: kanji.onyomi.join("、"),
    kunyomi: kanji.kunyomi.join("、"),
    glossary: kanji.meanings.join(", "),
    strokeCount,
    frequencies: kanji.frequencies.map((f) => f.displayValue ?? String(f.value)).join(", "),
    tags: [...new Set(kanji.tags.map((t) => t.name))].join(" "),
    dictionary: kanji.dictTitle,
    sentence: ctx.sentence,
    clozePrefix: cloze.prefix,
    clozeBody: cloze.body,
    clozeSuffix: cloze.suffix,
    documentTitle: ctx.documentTitle,
    documentAuthor: ctx.documentAuthor,
    hasScreenshot: ctx.hasScreenshot,
    extraTags: extraTagsFor(ctx),
  };
}

/** Every supported term field marker and how it draws from the card data. */
const MARKERS: Record<string, (d: AnkiCardData) => string> = {
  expression: (d) => d.expression,
  reading: (d) => d.reading,
  furigana: (d) => d.furigana,
  "furigana-plain": (d) => d.furiganaPlain,
  glossary: (d) => d.glossary,
  "glossary-plain": (d) => d.glossaryPlain,
  sentence: (d) => d.sentence,
  "cloze-prefix": (d) => d.clozePrefix,
  "cloze-body": (d) => d.clozeBody,
  "cloze-suffix": (d) => d.clozeSuffix,
  "pitch-accents": (d) => d.pitchAccents,
  "pitch-accent-graphs": (d) => d.pitchGraphs,
  frequencies: (d) => d.frequencies,
  tags: (d) => d.tags,
  "part-of-speech": (d) => d.partsOfSpeech,
  dictionary: (d) => d.dictionary,
  "document-title": (d) => d.documentTitle,
  "document-author": (d) => d.documentAuthor,
  screenshot: (d) => (d.hasScreenshot ? SCREENSHOT_SENTINEL : ""),
};

/** Every supported kanji field marker and how it draws from the kanji card data. */
const KANJI_MARKERS: Record<string, (d: KanjiCardData) => string> = {
  character: (d) => d.character,
  onyomi: (d) => d.onyomi,
  kunyomi: (d) => d.kunyomi,
  glossary: (d) => d.glossary,
  "stroke-count": (d) => d.strokeCount,
  frequencies: (d) => d.frequencies,
  tags: (d) => d.tags,
  dictionary: (d) => d.dictionary,
  sentence: (d) => d.sentence,
  "cloze-prefix": (d) => d.clozePrefix,
  "cloze-body": (d) => d.clozeBody,
  "cloze-suffix": (d) => d.clozeSuffix,
  "document-title": (d) => d.documentTitle,
  "document-author": (d) => d.documentAuthor,
  screenshot: (d) => (d.hasScreenshot ? SCREENSHOT_SENTINEL : ""),
};

/** Markers offered in the settings field-mapping menu (term note type). */
export const FIELD_MARKERS = Object.keys(MARKERS);
/** Markers offered for the kanji note type. */
export const KANJI_FIELD_MARKERS = Object.keys(KANJI_MARKERS);

/** Substitutes `{marker}` tokens from a marker table; unknown markers stay literal. */
function renderTemplate<T>(template: string, data: T, markers: Record<string, (d: T) => string>): string {
  return template.replace(/\{([\w-]+)\}/g, (whole, marker: string) => {
    const fn = markers[marker];
    return fn ? fn(data) : whole;
  });
}

/** Substitutes `{marker}` tokens in a term field template; unknown markers stay literal. */
export function renderField(template: string, data: AnkiCardData): string {
  return renderTemplate(template, data, MARKERS);
}

/** Substitutes `{marker}` tokens in a kanji field template; unknown markers stay literal. */
export function renderKanjiField(template: string, data: KanjiCardData): string {
  return renderTemplate(template, data, KANJI_MARKERS);
}

/** Builds an AnkiConnect note from a field map, a marker renderer, and note options. */
function buildNoteFrom<T extends { extraTags: string[] }>(
  deckName: string,
  modelName: string,
  fieldTemplates: Record<string, string>,
  data: T,
  render: (template: string, data: T) => string,
  configTags: string[],
  allowDuplicate: boolean,
): AnkiNote {
  const tags = [...new Set([...configTags, ...data.extraTags].filter(Boolean))];
  const fields: Record<string, string> = {};
  for (const [name, template] of Object.entries(fieldTemplates)) fields[name] = render(template, data);
  return { deckName, modelName, fields, tags, options: { allowDuplicate } };
}

/** Builds the AnkiConnect note for a term from the config's templates and card data. */
export function buildNote(config: AnkiConfig, data: AnkiCardData): AnkiNote {
  return buildNoteFrom(config.deck, config.model, config.fields, data, renderField, config.tags, config.duplicateBehavior === "allow");
}

/** Builds the AnkiConnect note for a kanji from the config's kanji templates and data. */
export function buildKanjiNote(config: AnkiConfig, data: KanjiCardData): AnkiNote {
  return buildNoteFrom(
    config.kanjiDeck,
    config.kanjiModel,
    config.kanjiFields,
    data,
    renderKanjiField,
    config.tags,
    config.duplicateBehavior === "allow",
  );
}
