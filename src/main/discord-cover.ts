import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { app, nativeImage } from "electron";
import { libraryStore } from "./services/library-store.js";

/**
 * Turns a local book cover into a public https URL for Discord Rich Presence's
 * large image (the client only accepts an asset key or a reachable URL — a local
 * path / data: URL won't do). Covers are uploaded anonymously to catbox.moe,
 * which returns a permanent direct link; no account or credentials involved.
 *
 * Opt-in only, gated in the renderer — uploading a cover discloses what the user
 * is reading to a third-party host (and, once fetched, Discord's CDN). We reuse
 * the app's already-downscaled cover as-is.
 *
 * Dedup is by content hash: identical covers upload once, and the hash→URL map is
 * cached to userData so a cover is never re-uploaded across sessions.
 */

/**
 * Discord renders the large image small; letting its client shrink the stored
 * 300px cover pixelates it. So we downscale to about this width ourselves (good
 * filter) before upload. Bump it and stored URLs re-resolve automatically — the
 * width is part of the cache key.
 */
const DISCORD_COVER_WIDTH = 100;

/** Downscale the cover to DISCORD_COVER_WIDTH (aspect kept); pass through if already smaller/undecodable. */
const downscale = (buf: Buffer): Buffer => {
  try {
    const img = nativeImage.createFromBuffer(buf);
    const { width, height } = img.getSize();
    if (!width || !height || width <= DISCORD_COVER_WIDTH) return buf;
    const resized = img.resize({
      width: DISCORD_COVER_WIDTH,
      height: Math.round((height / width) * DISCORD_COVER_WIDTH),
      quality: "best",
    });
    return resized.toJPEG(88);
  } catch {
    return buf;
  }
};

const cachePath = (): string => path.join(app.getPath("userData"), "discord-cover-cache.json");

let cache: Record<string, string> | null = null;

const loadCache = (): Record<string, string> => {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(cachePath(), "utf8")) as Record<string, string>;
  } catch {
    cache = {};
  }
  return cache;
};

const saveCache = (): void => {
  try {
    fs.writeFileSync(cachePath(), JSON.stringify(cache));
  } catch {
    // Best-effort; a failed write just means we re-upload next time.
  }
};

/** Uploads never overlap for the same hash. */
const inflight = new Map<string, Promise<string | null>>();

const uploadToCatbox = async (buf: Buffer, filename: string): Promise<string | null> => {
  try {
    const form = new FormData();
    form.set("reqtype", "fileupload");
    form.set("fileToUpload", new Blob([new Uint8Array(buf)]), filename);
    const res = await fetch("https://catbox.moe/user/api.php", { method: "POST", body: form });
    if (!res.ok) return null;
    const url = (await res.text()).trim();
    return url.startsWith("https://") ? url : null;
  } catch {
    return null; // offline / catbox down — presence just falls back to the bundled asset
  }
};

/** Resolve a book's cover to a public URL, uploading + caching on first request. */
export const resolveCoverUrl = async (bookId: string): Promise<string | null> => {
  const coverPath = libraryStore.getBook(bookId)?.coverPath;
  if (!coverPath) return null;

  let buf: Buffer;
  try {
    buf = fs.readFileSync(coverPath);
  } catch {
    return null;
  }

  // Keyed on the source bytes + target width, so a cover edit or a width change
  // both re-upload while an unchanged cover stays cached.
  const key = `${createHash("sha256").update(buf).digest("hex")}@${DISCORD_COVER_WIDTH}`;
  const c = loadCache();
  if (c[key]) return c[key];
  const pending = inflight.get(key);
  if (pending) return pending;

  const task = (async () => {
    const url = await uploadToCatbox(downscale(buf), `${DISCORD_COVER_WIDTH}.jpg`);
    if (url) {
      c[key] = url;
      saveCache();
    }
    inflight.delete(key);
    return url;
  })();
  inflight.set(key, task);
  return task;
};
