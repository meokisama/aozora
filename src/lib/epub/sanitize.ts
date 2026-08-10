/**
 * Strips the executable surfaces out of book content, which shares a renderer
 * with the privileged `window.electronAPI`. `innerHTML` never ran `<script>`, so
 * inline `on*` was the only live path — a leftover, not a feature (scripted EPUB
 * would need a sandboxed iframe, not this tree).
 *
 * Runs once on the flattened spine, the single source both reader modes,
 * fixed-layout, footnotes and search derive from.
 */

/** Execute code or pull in remote content; no book needs them. */
const REMOVED_TAGS = ["script", "iframe", "object", "embed"];

/** URL-bearing attributes, i.e. where a `javascript:` payload can hide. */
const URL_ATTRS = ["href", "src", "action", "formaction", "poster", "data", "background"];

/**
 * Drops whitespace/control chars, then lowercases: the URL parser ignores them,
 * so `java<TAB>script:` runs just like `javascript:`.
 */
function normalizeUrl(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (code > 0x20 && code !== 0x7f) out += ch;
  }
  return out.toLowerCase();
}

/** True for URLs that execute rather than fetch. */
function isExecutableUrl(value: string): boolean {
  const url = normalizeUrl(value);
  return url.startsWith("javascript:") || url.startsWith("vbscript:") || url.startsWith("data:text/html");
}

/**
 * Removes script elements, inline handlers and executable URLs in place. Returns
 * the count stripped — 0 for a well-formed book, so non-zero is worth logging.
 */
export function stripScripting(root: Element): number {
  let stripped = 0;

  for (const tag of REMOVED_TAGS) {
    // Snapshot: the live NodeList shrinks as elements are removed.
    for (const el of Array.from(root.getElementsByTagName(tag))) {
      el.remove();
      stripped++;
    }
  }

  for (const el of Array.from(root.getElementsByTagName("*"))) {
    for (const name of el.getAttributeNames()) {
      // Catches SVG's handlers (onbegin, …) as well as the HTML ones.
      if (/^on/i.test(name)) {
        el.removeAttribute(name);
        stripped++;
        continue;
      }
      // Namespaced too: xlink:href on SVG <a>/<image>.
      const local = name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;
      if (!URL_ATTRS.includes(local.toLowerCase())) continue;
      const value = el.getAttribute(name);
      if (value && isExecutableUrl(value)) {
        el.removeAttribute(name);
        stripped++;
      }
    }
  }

  return stripped;
}
