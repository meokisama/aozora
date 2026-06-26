/**
 * A 1x1 transparent GIF data-URI that smuggles the original image path in an
 * `aoz:<key>` segment. Image srcs are replaced with this during flattening, then
 * swapped back for object URLs at render time (see format-html). Keeps the
 * flattened HTML a plain serializable string with no live blob references.
 */
export function buildDummyImage(key: string): string {
  return `data:image/gif;aoz:${key};base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==`;
}
