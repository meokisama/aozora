/**
 * A 1x1 transparent GIF whose data-URI smuggles the original image path in a
 * `aoz:<key>` segment. During flattening, every image src is replaced with this
 * placeholder; at render time the placeholder is swapped back for an object URL
 * built from the stored blob (see format-html.js). This keeps the flattened
 * HTML a plain serializable string with no live blob references.
 */
export function buildDummyImage(key) {
  return `data:image/gif;aoz:${key};base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==`;
}
