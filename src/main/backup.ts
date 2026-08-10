import { ipcMain, app, dialog, BrowserWindow } from "electron";
import path from "node:path";
import fs from "node:fs";
import { Readable, Writable } from "node:stream";
import { ZipReaderStream, ZipWriterStream, configure } from "@zip.js/zip.js";
import { libraryStore } from "./services/library-store.js";
import type { BackupManifest, BackupPrefs, BackupResult, RestoreResult } from "@/lib/types";

/**
 * Export / restore of what re-importing can't bring back: progress, bookmarks,
 * highlights, session history and prefs.
 *
 * A plain .zip, streamed both ways so a library carrying its .epub originals
 * never has to fit in memory:
 *
 *   manifest.json          format + provenance; validated before anything is touched
 *   prefs.json             renderer localStorage (aozora-* keys only)
 *   aozora.db              VACUUM INTO snapshot, WAL folded in
 *   books/<id>/cover.*     always — the library looks broken without covers
 *   books/<id>/book.epub   only when "include book files" is on
 *
 * Excludes the dictionary DB (large, re-importable) and imported fonts. Stored
 * uncompressed: epubs and covers gain nothing from deflate and it costs real
 * time on a multi-GB library.
 */

configure({ useWebWorkers: false });

const MANIFEST = "manifest.json";
const PREFS = "prefs.json";
const DB = "aozora.db";
const BOOKS = "books";

/** Every Zustand persist store is namespaced with this; nothing else travels. */
const PREFS_PREFIX = "aozora-";

const userDataPath = (...parts: string[]): string => path.join(app.getPath("userData"), ...parts);

/** `aozora-backup-2026-08-10.zip` */
function defaultFileName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `aozora-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.zip`;
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/* ── Export ─────────────────────────────────────────────────────────────── */

/** For the small JSON entries. */
async function addText(zip: ZipWriterStream, name: string, text: string): Promise<void> {
  const writer = zip.writable<Uint8Array>(name).getWriter();
  await writer.write(new TextEncoder().encode(text));
  await writer.close();
}

/** Streamed, so entry size doesn't drive memory use. */
async function addFile(zip: ZipWriterStream, name: string, filePath: string): Promise<void> {
  const source = Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream<Uint8Array>;
  await source.pipeTo(zip.writable<Uint8Array>(name));
}

async function writeArchive(target: string, dbSnapshot: string, includeBooks: boolean, prefs: BackupPrefs): Promise<void> {
  const manifest: BackupManifest = {
    format: 1,
    appVersion: app.getVersion(),
    createdAt: Date.now(),
    includeBooks,
    bookCount: libraryStore.listBooks().length,
  };

  const zip = new ZipWriterStream({ level: 0 });
  const piped = zip.readable.pipeTo(Writable.toWeb(fs.createWriteStream(target)) as WritableStream<Uint8Array>);

  await addText(zip, MANIFEST, JSON.stringify(manifest, null, 2));
  await addText(zip, PREFS, JSON.stringify(prefs, null, 2));
  await addFile(zip, DB, dbSnapshot);

  const booksDir = libraryStore.getBooksDir();
  const ids = fs.existsSync(booksDir) ? fs.readdirSync(booksDir, { withFileTypes: true }).filter((e) => e.isDirectory()) : [];
  for (const entry of ids) {
    const dir = path.join(booksDir, entry.name);
    for (const file of fs.readdirSync(dir)) {
      if (file !== "book.epub" && !file.startsWith("cover.")) continue;
      if (file === "book.epub" && !includeBooks) continue;
      await addFile(zip, `${BOOKS}/${entry.name}/${file}`, path.join(dir, file));
    }
  }

  await zip.close();
  await piped;
}

/* ── Restore ────────────────────────────────────────────────────────────── */

/**
 * Unpacks into `staging`. Entry names are checked to resolve inside it — a
 * hand-made archive could otherwise carry `../` names and write anywhere.
 */
async function extractArchive(archivePath: string, staging: string): Promise<void> {
  fs.mkdirSync(staging, { recursive: true });
  const source = Readable.toWeb(fs.createReadStream(archivePath)) as ReadableStream<Uint8Array>;

  for await (const entry of source.pipeThrough(new ZipReaderStream())) {
    const dest = path.resolve(staging, entry.filename);
    if (dest !== staging && !dest.startsWith(staging + path.sep)) {
      throw new Error(`backup contains an entry outside the archive root: ${entry.filename}`);
    }
    if (entry.directory || !entry.readable) {
      fs.mkdirSync(dest, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await entry.readable.pipeTo(Writable.toWeb(fs.createWriteStream(dest)) as WritableStream<Uint8Array>);
  }
}

function readManifest(staging: string): BackupManifest {
  const file = path.join(staging, MANIFEST);
  if (!fs.existsSync(file)) throw new Error("not an Aozora backup (no manifest)");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8")) as BackupManifest;
  if (manifest?.format !== 1) throw new Error(`unsupported backup format (${manifest?.format})`);
  if (!fs.existsSync(path.join(staging, DB))) throw new Error("backup is missing its database");
  return manifest;
}

/** Defensive: a backup may not dictate arbitrary localStorage keys. */
function readPrefs(staging: string): BackupPrefs {
  const file = path.join(staging, PREFS);
  if (!fs.existsSync(file)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    const prefs: BackupPrefs = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key.startsWith(PREFS_PREFIX) && typeof value === "string") prefs[key] = value;
    }
    return prefs;
  } catch {
    return {}; // corrupt prefs shouldn't cost the user their library
  }
}

/* ── IPC ────────────────────────────────────────────────────────────────── */

export const registerBackupIpc = (): void => {
  ipcMain.handle("system:export-backup", async (event, includeBooks: boolean, prefs: BackupPrefs): Promise<BackupResult> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(win!, {
      title: "Export backup",
      defaultPath: defaultFileName(),
      filters: [{ name: "Zip archive", extensions: ["zip"] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };

    const snapshot = path.join(app.getPath("temp"), `aozora-snapshot-${Date.now()}.db`);
    try {
      libraryStore.snapshotTo(snapshot);
      await writeArchive(filePath, snapshot, includeBooks, prefs);
      return { ok: true, path: filePath, bytes: fs.statSync(filePath).size };
    } catch (err) {
      // A partial archive still opens, and looks like a valid backup.
      fs.rmSync(filePath, { force: true });
      return { ok: false, error: errorMessage(err) };
    } finally {
      fs.rmSync(snapshot, { force: true });
    }
  });

  ipcMain.handle("system:import-backup", async (event): Promise<RestoreResult> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
      title: "Restore backup",
      properties: ["openFile"],
      filters: [{ name: "Aozora backup", extensions: ["zip"] }],
    });
    if (canceled || !filePaths.length) return { ok: false, canceled: true };

    const staging = path.join(app.getPath("temp"), `aozora-restore-${Date.now()}`);
    try {
      // Unpacked and validated before any live file is touched, so a bad archive
      // is a no-op rather than a half-restore.
      await extractArchive(filePaths[0], staging);
      const manifest = readManifest(staging);
      const prefs = readPrefs(staging);

      libraryStore.close(); // release the DB file before replacing it
      const live = userDataPath(DB);
      const rollback = `${live}.pre-restore`;
      if (fs.existsSync(live)) fs.copyFileSync(live, rollback);
      fs.copyFileSync(path.join(staging, DB), live);
      // The snapshot is self-contained; leftover WAL/SHM belong to the old DB.
      fs.rmSync(`${live}-wal`, { force: true });
      fs.rmSync(`${live}-shm`, { force: true });

      // An older backup can lack columns this build reads, and this DB has no
      // migration path — put the user's own data back rather than leave them a
      // library that throws on every query.
      const schemaError = libraryStore.schemaError();
      if (schemaError) {
        libraryStore.close();
        if (fs.existsSync(rollback)) fs.copyFileSync(rollback, live);
        return {
          ok: false,
          error: `this backup was made by Aozora ${manifest.appVersion} and can't be read by ${app.getVersion()} — ${schemaError}`,
        };
      }

      // Merged, not replaced: a data-only backup has no .epub files, and wiping
      // the directory would delete the ones already here.
      const restoredBooks = path.join(staging, BOOKS);
      if (fs.existsSync(restoredBooks)) {
        fs.cpSync(restoredBooks, libraryStore.getBooksDir(), { recursive: true, force: true });
      }

      const missing = libraryStore.relocateBooks();
      return { ok: true, prefs, missingBooks: missing.length, manifest };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  });

  // Restores finish in the renderer (it owns localStorage); it asks for the
  // relaunch once the prefs are written.
  ipcMain.handle("system:relaunch", () => {
    app.relaunch();
    app.exit(0);
  });
};
