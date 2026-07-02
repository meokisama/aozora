import { ipcMain } from "electron";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { resolveCoverUrl } from "./discord-cover.js";

/**
 * Discord Rich Presence, spoken directly over Discord's local IPC socket — no
 * third-party dependency. The protocol is tiny: connect to the running Discord
 * client's named pipe, handshake with an application client id, then push
 * `SET_ACTIVITY` frames. Every message is an 8-byte header (opcode + payload
 * length, both int32 LE) followed by a UTF-8 JSON body.
 *
 * The whole module is best-effort: if Discord isn't running the connection just
 * fails and we retry later; nothing here ever throws into the app.
 *
 * Set the app's Application ID below (or via AOZORA_DISCORD_CLIENT_ID) — created
 * at https://discord.com/developers/applications. Upload an "Art Asset" named
 * `aozora` there for the large icon. Presence is a no-op until the id is set.
 */
const CLIENT_ID = process.env.AOZORA_DISCORD_CLIENT_ID ?? "1521878992423223326";

/** Shown as a button at the bottom of the presence card (max 2 buttons, label ≤ 32 chars). */
const DOWNLOAD_BUTTON = { label: "Get Aozora青空", url: "https://github.com/meokisama/aozora/releases" };

/**
 * A public https image URL can be used as `large_image` directly — the Discord
 * client fetches, proxies and caches it (no upload / external-assets call needed).
 * The catch: the client expands the URL into an internal `mp:external/{id}/...`
 * asset key that must stay ≤ 256 chars, so an over-long URL is silently dropped.
 * We reproduce that expansion to pre-flight the length and fall back to the
 * bundled "aozora" asset when it wouldn't fit or isn't a valid http(s) URL.
 */
const usableCoverUrl = (url: string): string | null => {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const scheme = u.protocol.replace(/:$/, "");
    // media.discordapp.net collapses to cdn.discordapp.com in the expanded key.
    const host = u.hostname === "media.discordapp.net" ? "cdn.discordapp.com" : u.hostname;
    const key = `mp:external/${"x".repeat(43)}/${encodeURIComponent(u.search)}/${scheme}/${host}${u.pathname}`;
    return key.length <= 256 ? u.href : null;
  } catch {
    return null;
  }
};

// Cover upload runs off-band (see resolveCover); these hold the last resolved URL
// and the book it belongs to, so a stale upload can't attach to a newer book.
let resolvedCoverFor = "";
let resolvedCoverUrl = "";
let coverToken = 0;

/** Resolve the large image: resolved cover for the open book, else the bundled asset. */
const largeImage = (): string => {
  const fromCover = desired?.coverBookId && desired.coverBookId === resolvedCoverFor ? resolvedCoverUrl : "";
  return (fromCover && usableCoverUrl(fromCover)) || "aozora";
};

/** Kick off (or reuse) the cover upload for the given book, then re-send once ready. */
const resolveCover = (bookId?: string | null): void => {
  if (!bookId || bookId === resolvedCoverFor) return; // none requested, or already resolved
  const token = ++coverToken;
  void resolveCoverUrl(bookId).then((url) => {
    if (token !== coverToken) return; // a newer book superseded this upload
    resolvedCoverFor = bookId;
    resolvedCoverUrl = url ?? "";
    if (enabled) scheduleSend();
  });
};

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

/** Discord throttles SET_ACTIVITY (~5 / 15s); we coalesce to one send per this. */
const MIN_SEND_INTERVAL = 4000;

interface PresenceInput {
  bookTitle: string;
  author?: string | null;
  chapterName?: string | null; // full title — shown in the cover's hover tooltip
  chapterIndex?: number; // 1-based position in the TOC
  chapterTotal?: number;
  progress?: number; // 0-100
  coverBookId?: string | null; // set (opt-in) so the main process uploads its cover for large_image
}

let socket: net.Socket | null = null;
let connected = false; // handshake acked (READY received)
let enabled = false;

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 0;

let desired: PresenceInput | null = null; // latest requested presence; null = cleared

// Trailing-send throttle state.
let lastSendAt = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// Elapsed-time timer: reset only when the book changes so Discord shows a stable
// "reading for HH:MM".
let sessionKey = "";
let sessionStart = 0;

/** Candidate socket paths; Discord may sit on any of ipc-0..9. */
const candidatePaths = (): string[] => {
  if (process.platform === "win32") {
    return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);
  }
  const base = (process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || "/tmp").replace(/\/$/, "");
  const prefixes = ["", "app/com.discordapp.Discord/", "snap.discord/"]; // flatpak / snap sandboxes
  const paths: string[] = [];
  for (let i = 0; i < 10; i++) {
    for (const p of prefixes) paths.push(`${base}/${p}discord-ipc-${i}`);
  }
  return paths;
};

const encode = (op: number, payload: unknown): Buffer => {
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(8);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(json.length, 4);
  return Buffer.concat([header, json]);
};

const write = (op: number, payload: unknown): void => {
  if (!socket || socket.destroyed) return;
  try {
    socket.write(encode(op, payload));
  } catch {
    // Connection died mid-write; the close/error handler will reconnect.
  }
};

const safeParse = (body: Buffer): { cmd?: string; evt?: string } | null => {
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    return null;
  }
};

const clamp = (s: string, max: number): string => {
  const t = (s ?? "").trim();
  return t.length > max ? t.slice(0, max) : t;
};

/** Discord rejects details/state shorter than 2 chars, so omit those. */
const buildActivity = (): Record<string, unknown> => {
  // No book open → an "idle" presence rather than nothing.
  if (!desired) {
    return {
      state: "Browsing the library",
      assets: { large_image: largeImage(), large_text: "Aozora" },
      buttons: [DOWNLOAD_BUTTON],
    };
  }

  // Line 2 stays short so it never truncates: "Chapter 3/20 · 42%".
  const bits: string[] = [];
  if (desired.chapterIndex && desired.chapterTotal) bits.push(`Chapter ${desired.chapterIndex}/${desired.chapterTotal}`);
  if (typeof desired.progress === "number") bits.push(`${desired.progress}%`);

  const details = clamp(desired.bookTitle, 128);
  const state = clamp(bits.join(" · "), 128);
  // The long chapter title lives in the cover's hover tooltip instead of a line.
  const largeText = clamp(desired.chapterName || desired.author || "Aozora", 128);

  const activity: Record<string, unknown> = {
    assets: { large_image: largeImage(), large_text: largeText },
    timestamps: { start: sessionStart },
    buttons: [DOWNLOAD_BUTTON],
  };
  if (details.length >= 2) activity.details = details;
  if (state.length >= 2) activity.state = state;
  return activity;
};

const sendActivity = (): void => {
  if (!connected) return;
  write(OP_FRAME, {
    cmd: "SET_ACTIVITY",
    args: { pid: process.pid, activity: buildActivity() },
    nonce: randomUUID(),
  });
  lastSendAt = Date.now();
};

/** Push the current `desired` presence, respecting the rate limit (trailing send). */
const scheduleSend = (): void => {
  if (!connected) {
    connect(); // flushes on READY
    return;
  }
  const elapsed = Date.now() - lastSendAt;
  if (elapsed >= MIN_SEND_INTERVAL) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    sendActivity();
    return;
  }
  if (flushTimer) return; // a trailing send is already queued
  flushTimer = setTimeout(() => {
    flushTimer = null;
    sendActivity();
  }, MIN_SEND_INTERVAL - elapsed);
};

const scheduleReconnect = (): void => {
  if (reconnectTimer || !enabled) return;
  reconnectDelay = Math.min(reconnectDelay ? reconnectDelay * 2 : 5000, 60000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
};

const onDisconnect = (): void => {
  if (socket) {
    socket.removeAllListeners();
    socket.destroy();
  }
  socket = null;
  connected = false;
  if (enabled) scheduleReconnect();
};

const handleFrame = (op: number, body: Buffer): void => {
  if (op === OP_PING) {
    write(OP_PONG, safeParse(body));
    return;
  }
  if (op === OP_CLOSE) {
    onDisconnect();
    return;
  }
  if (op === OP_FRAME) {
    const msg = safeParse(body);
    // The handshake is acked by a READY dispatch; only then can we set activity.
    if (msg?.cmd === "DISPATCH" && msg.evt === "READY") {
      connected = true;
      reconnectDelay = 0;
      sendActivity();
    }
  }
};

const attachReaders = (sock: net.Socket): void => {
  let buffer = Buffer.alloc(0);
  sock.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 8) {
      const op = buffer.readInt32LE(0);
      const len = buffer.readInt32LE(4);
      if (buffer.length < 8 + len) break; // frame split across chunks
      const payload = buffer.subarray(8, 8 + len);
      buffer = buffer.subarray(8 + len);
      handleFrame(op, payload);
    }
  });
  sock.on("close", onDisconnect);
  sock.on("error", onDisconnect);
};

/** Try each candidate pipe in turn; handshake on the first that connects. */
function connect(index = 0): void {
  if (!enabled || !CLIENT_ID || socket) return;
  const paths = candidatePaths();
  if (index >= paths.length) {
    scheduleReconnect(); // no Discord client found; back off and retry
    return;
  }

  const sock = net.connect(paths[index]);
  let opened = false;

  sock.on("connect", () => {
    opened = true;
    socket = sock;
    attachReaders(sock);
    write(OP_HANDSHAKE, { v: 1, client_id: CLIENT_ID });
  });

  sock.on("error", () => {
    if (opened) return; // post-connect errors are handled by attachReaders
    sock.destroy();
    connect(index + 1); // this pipe was empty; try the next
  });
}

const update = (input: PresenceInput): void => {
  if (input.bookTitle !== sessionKey) {
    sessionKey = input.bookTitle;
    sessionStart = Date.now();
  }
  desired = input;
  resolveCover(input.coverBookId); // no-op unless the cover opt-in sent a book id
  if (enabled) scheduleSend();
};

const clearActivity = (): void => {
  desired = null;
  sessionKey = "";
  if (connected) sendActivity(); // switches to the idle presence
};

const setEnabled = (next: boolean): void => {
  if (next === enabled) return;
  enabled = next;
  if (enabled) {
    connect();
    return;
  }
  // Tear down. Closing the socket makes Discord drop the presence on its own.
  desired = null;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectDelay = 0;
  if (socket) {
    socket.removeAllListeners();
    socket.destroy();
    socket = null;
  }
  connected = false;
};

export const registerDiscordIpc = (): void => {
  ipcMain.on("discord:set-enabled", (_event, next: boolean) => setEnabled(!!next));
  ipcMain.on("discord:update", (_event, input: PresenceInput) => update(input));
  ipcMain.on("discord:clear", () => clearActivity());
};
