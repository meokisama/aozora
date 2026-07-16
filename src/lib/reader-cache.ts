/**
 * IndexedDB cache for parsed EPUB content. Derived, re-creatable data, so it
 * lives in the renderer rather than the main-process source of truth.
 */

import type { ParsedBook } from "@/lib/epub/parse-book";

const DB_NAME = "aozora-reader";
const STORE = "books";
// v2: the parsed payload gained fixed-layout fields (fixedLayout/pages/ppd/…).
// v3: added renditionSpread (book-level OPF spread mode) for the fixed-layout viewer.
// Pre-release policy is forward-only — drop the old cache rather than migrate, so
// previously-opened books re-parse and pick up the new fields.
const DB_VERSION = 3;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
      db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function runTx<T = unknown>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = run(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(request ? (request.result as T) : undefined);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

/** Returns the cached parsed book, or null on miss. */
export async function getCachedBook(id: string): Promise<ParsedBook | null> {
  const value = await runTx<ParsedBook>("readonly", (store) => store.get(id));
  return value ?? null;
}

export async function putCachedBook(id: string, data: ParsedBook): Promise<void> {
  await runTx("readwrite", (store) => store.put(data, id));
}

export async function deleteCachedBook(id: string): Promise<void> {
  await runTx("readwrite", (store) => store.delete(id));
}
