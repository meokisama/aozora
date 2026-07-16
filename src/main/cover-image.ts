import { nativeImage } from "electron";

/**
 * Downscales an image buffer to `width` (aspect preserved) as a JPEG. Returns
 * null when the image is already narrower, empty, or undecodable (SVG, corrupt) —
 * callers decide whether to keep the original bytes.
 */
export function resizeCover(buf: Buffer, width: number, quality: number): Buffer | null {
  try {
    const img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) return null;
    const { width: w, height: h } = img.getSize();
    if (!w || !h || w <= width) return null;
    return img.resize({ width, height: Math.round((h / w) * width), quality: "best" }).toJPEG(quality);
  } catch {
    return null;
  }
}
