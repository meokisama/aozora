import { createElement, Fragment, useEffect, useState, type CSSProperties, type Key, type ReactNode } from "react";
import type { GlossContent, GlossElement, GlossStyle } from "@/lib/types";

/**
 * Renders one Yomitan glossary item (a JSON tree of an HTML subset) as React
 * nodes, preserving structure. Port of Yomitan's `StructuredContentGenerator`
 * (references/yomitan/ext/js/display/structured-content-generator.js).
 *
 * Differences: `img` loads lazily as a data URL from the dictionary's stored
 * media (no canvas/OffscreenCanvas pipeline); `a` renders as inert text (no
 * in-popup navigation).
 */

// Structured-content element tags Yomitan emits that map 1:1 to HTML elements we
// can hand straight to React. Anything outside this set has its children
// rendered inline (so unknown wrappers never swallow their text).
const PASSTHROUGH_TAGS = new Set([
  "div",
  "span",
  "ol",
  "ul",
  "li",
  "details",
  "summary",
  "ruby",
  "rt",
  "rp",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
]);

/**
 * Maps a node's `data` field to `data-sc-*` attributes, matching Yomitan's
 * dataset convention (`{content:"x"}` → `data-sc-content="x"`). The dictionary's
 * scoped `styles.css` targets these, so they're what make rich dicts (Jitendex)
 * render their tag badges, cross-reference boxes, etc.
 */
function dataAttrs(data: Record<string, string> | undefined): Record<string, string> {
  if (!data) return {};
  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!key || typeof value !== "string") continue;
    const kebab = key.replace(/([A-Z])/g, "-$1").toLowerCase();
    attrs[`data-sc-${kebab}`] = value;
  }
  return attrs;
}

/** Maps the dictionary's structured-content style subset onto React inline style. */
function toCss(style: GlossStyle | undefined): CSSProperties | undefined {
  if (!style) return undefined;
  const css: Record<string, string> = {};
  const set = (key: string, value: string | undefined) => {
    if (typeof value === "string" && value.length > 0) css[key] = value;
  };
  const em = (key: string, value: number | string | undefined) => {
    if (typeof value === "number") css[key] = `${value}em`;
    else if (typeof value === "string") css[key] = value;
  };

  set("fontStyle", style.fontStyle);
  set("fontWeight", style.fontWeight);
  set("fontSize", style.fontSize);
  set("color", style.color);
  set("background", style.background);
  set("backgroundColor", style.backgroundColor);
  set("verticalAlign", style.verticalAlign);
  set("textAlign", style.textAlign);
  set("textEmphasis", style.textEmphasis);
  set("textShadow", style.textShadow);
  if (typeof style.textDecorationLine === "string") set("textDecoration", style.textDecorationLine);
  else if (Array.isArray(style.textDecorationLine)) css.textDecoration = style.textDecorationLine.join(" ");
  set("textDecorationStyle", style.textDecorationStyle);
  set("textDecorationColor", style.textDecorationColor);
  set("borderColor", style.borderColor);
  set("borderStyle", style.borderStyle);
  set("borderRadius", style.borderRadius);
  set("borderWidth", style.borderWidth);
  set("margin", style.margin);
  em("marginTop", style.marginTop);
  em("marginLeft", style.marginLeft);
  em("marginRight", style.marginRight);
  em("marginBottom", style.marginBottom);
  set("padding", style.padding);
  set("paddingTop", style.paddingTop);
  set("paddingLeft", style.paddingLeft);
  set("paddingRight", style.paddingRight);
  set("paddingBottom", style.paddingBottom);
  set("wordBreak", style.wordBreak);
  set("whiteSpace", style.whiteSpace);
  set("listStyleType", style.listStyleType);

  return Object.keys(css).length ? (css as CSSProperties) : undefined;
}

/**
 * A glossary image, resolved lazily to a data URL from the dictionary's stored
 * media. Falls back to alt/title text while loading or when the media is absent.
 */
function GlossImage({ dictId, path, alt, title }: { dictId: string; path: string; alt?: string; title?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void window.electronAPI.dictionary.getMedia(dictId, path).then((url) => {
      if (alive) setSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [dictId, path]);

  if (!src) {
    const label = alt ?? title;
    return label ? <span className="text-muted-foreground/60">[{label}]</span> : null;
  }
  return <img src={src} alt={alt ?? ""} title={title} className="my-1 inline-block max-h-40 max-w-full align-middle" />;
}

function renderNode(node: GlossContent | undefined, key: Key, dictId: string): ReactNode {
  if (node == null) return null;
  if (typeof node === "string") return node;
  if (Array.isArray(node)) {
    return node.map((child, i) => <Fragment key={i}>{renderNode(child, i, dictId)}</Fragment>);
  }

  const el = node as GlossElement;

  // Top-level glossary wrappers.
  if (el.type === "structured-content") return renderNode(el.content, key, dictId);
  if (el.type === "text") return el.text ?? null;

  const tag = el.tag;
  // No tag → treat as a bare container; render whatever children it has.
  if (!tag) return el.content != null ? renderNode(el.content, key, dictId) : null;

  if (tag === "br") return <br />;

  // Images: load lazily from the dictionary's stored media.
  if (tag === "img" || el.type === "image") {
    return el.path ? <GlossImage dictId={dictId} path={el.path} alt={el.alt} title={el.title} /> : null;
  }

  const children = el.content != null ? renderNode(el.content, "c", dictId) : null;

  // Links: render as plain text (no navigation target in the popup).
  if (tag === "a") return <span className="underline decoration-dotted" {...dataAttrs(el.data)}>{children}</span>;

  if (!PASSTHROUGH_TAGS.has(tag)) {
    return el.content != null ? renderNode(el.content, key, dictId) : null;
  }

  const props: Record<string, unknown> = { ...dataAttrs(el.data) };
  const style = toCss(el.style);
  if (style) props.style = style;
  if (el.lang) props.lang = el.lang;
  if (el.title) props.title = el.title;
  if (tag === "details" && el.open) props.open = true;
  if (tag === "td" || tag === "th") {
    if (typeof el.colSpan === "number") props.colSpan = el.colSpan;
    if (typeof el.rowSpan === "number") props.rowSpan = el.rowSpan;
  }

  return createElement(tag, props, children);
}

/** Renders a single glossary item (string or structured-content tree). */
export function StructuredGloss({ content, dictId }: { content: GlossContent; dictId: string }): ReactNode {
  return renderNode(content, "root", dictId);
}
