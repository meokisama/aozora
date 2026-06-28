/**
 * Storage + registration for user-imported reader fonts. Font files can be
 * several MB (CJK), so the bytes live in IndexedDB (not the localStorage-backed
 * settings store) and are registered as document-level FontFaces on load — which
 * makes them resolve inside the reader's shadow DOM, same as `@font-face`.
 */

const DB_NAME = "aozora-fonts";
const STORE = "fonts";

export interface StoredFont {
  id: string;
  /** User-facing name (derived from the file name). */
  label: string;
  /** Unique CSS font-family the FontFace registers under. */
  family: string;
  /** Raw font file. */
  blob: Blob;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
        req.transaction!.oncomplete = () => db.close();
      }),
  );
}

export const idbGetAll = (): Promise<StoredFont[]> => run<StoredFont[]>("readonly", (s) => s.getAll());
export const idbPut = (font: StoredFont): Promise<void> => run("readwrite", (s) => s.put(font)).then(() => undefined);
export const idbDelete = (id: string): Promise<void> => run("readwrite", (s) => s.delete(id)).then(() => undefined);

// Keep handles so a removed font can be torn out of document.fonts too.
const registered = new Map<string, FontFace>();

/** Loads a font file and adds it to `document.fonts` under `family`. */
export async function registerFont(family: string, source: Blob | ArrayBuffer): Promise<void> {
  const buf = source instanceof Blob ? await source.arrayBuffer() : source;
  const face = new FontFace(family, buf);
  await face.load();
  document.fonts.add(face);
  registered.set(family, face);
}

export function unregisterFont(family: string): void {
  const face = registered.get(family);
  if (face) {
    document.fonts.delete(face);
    registered.delete(family);
  }
}
