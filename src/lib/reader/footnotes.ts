/**
 * Footnote detection for the reader. An EPUB footnote is a noteref <a> in the
 * prose linking (#id) to a note body elsewhere in the document. We build an
 * id→html map once at load so the popup can show a note regardless of which
 * section is currently rendered: paginated mode keeps only the current section
 * live, and endnotes often sit in a different section than their reference.
 */

const NOTE_TYPES = new Set(["footnote", "endnote", "rearnote", "note"]);

function epubTypes(el: Element): string[] {
  return (el.getAttribute("epub:type") || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/** A note body: an epub:type note token, or the matching ARIA doc role. */
function isNoteBody(el: Element): boolean {
  if (epubTypes(el).some((t) => NOTE_TYPES.has(t))) return true;
  const role = el.getAttribute("role");
  return role === "doc-footnote" || role === "doc-endnote";
}

/** A noteref: the in-prose marker that links to a note body. */
function isNoteref(a: Element): boolean {
  if (epubTypes(a).includes("noteref")) return true;
  return a.getAttribute("role") === "doc-noteref";
}

/**
 * Scans flattened reader HTML (object URLs already swapped in) and returns a map
 * of fragment id → note inner HTML. Bodies are found two ways and merged:
 * (1) elements that declare note semantics (epub:type/role) — the EPUB3 norm;
 * (2) <aside> targets reached from a noteref link — catches books that mark the
 * link but leave the aside untyped. Back-links inside notes point at prose
 * markers (not <aside>), so they never pollute the map.
 */
export function collectFootnotes(html: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!html) return map;
  const doc = new DOMParser().parseFromString(html, "text/html");

  const add = (el: Element | null) => {
    if (!el?.id || map.has(el.id)) return;
    const inner = el.innerHTML.trim();
    if (inner) map.set(el.id, inner);
  };

  for (const el of doc.querySelectorAll("[id]")) {
    if (isNoteBody(el)) add(el);
  }

  for (const a of doc.querySelectorAll("a[href^='#']")) {
    if (!isNoteref(a)) continue;
    const id = decodeURIComponent((a.getAttribute("href") || "").slice(1));
    const target = id ? doc.getElementById(id) : null;
    if (target?.tagName === "ASIDE") add(target);
  }

  return map;
}
