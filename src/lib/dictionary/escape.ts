/** Escapes the five XML/HTML metacharacters that matter for text + attribute
 * values (`&`, `<`, `>`, `"`). Safe for both HTML (Anki cards) and inline SVG. */
export const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
