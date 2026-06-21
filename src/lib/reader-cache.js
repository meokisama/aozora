/**
 * IndexedDB cache for parsed EPUB content (flattened HTML + image blobs +
 * sections). This is derived, re-creatable data, so it lives in the renderer
 * rather than the main-process source of truth. Hand-rolled over a thin
 * IndexedDB wrapper to avoid an extra dependency.
 */

const DB_NAME = "aozora-reader";
const STORE = "books";
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function runTx(mode, run) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = run(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(request ? request.result : undefined);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

/** Returns the cached parsed book, or null on miss. */
export async function getCachedBook(id) {
  const value = await runTx("readonly", (store) => store.get(id));
  return value ?? null;
}

export async function putCachedBook(id, data) {
  await runTx("readwrite", (store) => store.put(data, id));
}

export async function deleteCachedBook(id) {
  await runTx("readwrite", (store) => store.delete(id));
}
