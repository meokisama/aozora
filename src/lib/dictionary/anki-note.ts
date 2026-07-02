import type { AnkiConfig, AnkiNote, DictionaryEntry, GlossContent, GlossElement } from "@/lib/types";
import { distributeFurigana } from "@/lib/dictionary/furigana";
import { downstepNumber } from "@/lib/dictionary/pitch";

/**
 * Builds an Anki note from a dictionary lookup + the user's field templates.
 *
 * Fields are template strings carrying `{markers}` (Yomitan's convention — see
 * references/yomitan/ext/js/data/anki-template-util.js). The renderer resolves
 * every marker except `{screenshot}`, which it can't produce (the window capture
 * happens in the main process); that marker expands to a sentinel the main
 * process swaps for the stored image's `<img>` tag after `storeMediaFile`.
 */

/** Placeholder for `{screenshot}`; the main process replaces it post-capture. */
export const SCREENSHOT_SENTINEL = "%%AOZORA_SCREENSHOT%%";

/** Outcome of a mining attempt, shared by the reader and the popup's button state. */
export type MineStatus = "added" | "duplicate" | "error";

/** The marker values one lookup contributes to a card, all pre-rendered to strings. */
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
  pitchAccents: string; // downstep numbers, e.g. "0, 2"
  frequencies: string;
  documentTitle: string;
  documentAuthor: string;
  hasScreenshot: boolean;
  /** Note-level tags contributed by the source (e.g. the book title). */
  extraTags: string[];
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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

/** Context the reader supplies around a matched entry to complete a card. */
export interface AnkiCardContext {
  /** The full sentence containing the matched run. */
  sentence: string;
  documentTitle: string;
  documentAuthor: string;
  hasScreenshot: boolean;
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
  const frequencies = entry.frequencies.map((f) => f.displayValue ?? String(f.value)).join(", ");

  return {
    expression: entry.expression,
    reading,
    furigana: toFuriganaHtml(entry.expression, reading),
    furiganaPlain: toFuriganaPlain(entry.expression, reading),
    glossary,
    glossaryPlain,
    sentence: ctx.sentence,
    pitchAccents,
    frequencies,
    documentTitle: ctx.documentTitle,
    documentAuthor: ctx.documentAuthor,
    hasScreenshot: ctx.hasScreenshot,
    extraTags: ctx.documentTitle ? [ctx.documentTitle.replace(/\s+/g, "_")] : [],
  };
}

/** Every supported field marker and how it draws from the card data. */
const MARKERS: Record<string, (d: AnkiCardData) => string> = {
  expression: (d) => d.expression,
  reading: (d) => d.reading,
  furigana: (d) => d.furigana,
  "furigana-plain": (d) => d.furiganaPlain,
  glossary: (d) => d.glossary,
  "glossary-plain": (d) => d.glossaryPlain,
  sentence: (d) => d.sentence,
  "pitch-accents": (d) => d.pitchAccents,
  frequencies: (d) => d.frequencies,
  "document-title": (d) => d.documentTitle,
  "document-author": (d) => d.documentAuthor,
  screenshot: (d) => (d.hasScreenshot ? SCREENSHOT_SENTINEL : ""),
};

/** Markers offered in the settings field-mapping menu. */
export const FIELD_MARKERS = Object.keys(MARKERS);

/** Substitutes `{marker}` tokens in a field template; unknown markers stay literal. */
export function renderField(template: string, data: AnkiCardData): string {
  return template.replace(/\{([\w-]+)\}/g, (whole, marker: string) => {
    const fn = MARKERS[marker];
    return fn ? fn(data) : whole;
  });
}

/** Builds the AnkiConnect note object from the config's templates and card data. */
export function buildNote(config: AnkiConfig, data: AnkiCardData): AnkiNote {
  const tags = [...new Set([...config.tags, ...data.extraTags].filter(Boolean))];
  const fields: Record<string, string> = {};
  for (const [name, template] of Object.entries(config.fields)) {
    fields[name] = renderField(template, data);
  }
  return {
    deckName: config.deck,
    modelName: config.model,
    fields,
    tags,
    options: { allowDuplicate: config.duplicateBehavior === "allow" },
  };
}
