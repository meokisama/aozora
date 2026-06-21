/**
 * IndexedDB cache for parsed EPUB content (flattened HTML + image blobs +
 * sections). This is derived, re-creatable data, so it lives in the renderer
 * rather than the main-process source of truth. Hand-rolled over a thin
 * IndexedDB wrapper to avoid an extra dependency.
 */

const DB_NAME = "aozora-reader";
const STORE = "books";
const DB_VERSION = 1;

// Bump when the parser output shape changes so stale entries are ignored.
// v2: internal class/marker prefix changed to aoz-.
// v3: internal <a> hrefs flattened to resolvable in-document fragments.
const CACHE_VERSION = 3;

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
      })
  );
}

/** Returns the cached parsed book, or null on miss / stale cache version. */
export async function getCachedBook(id) {
  const value = await runTx("readonly", (store) => store.get(id));
  if (value && value.cacheVersion === CACHE_VERSION) return value;
  return null;
}

export async function putCachedBook(id, data) {
  await runTx("readwrite", (store) =>
    store.put({ ...data, cacheVersion: CACHE_VERSION }, id)
  );
}

export async function deleteCachedBook(id) {
  await runTx("readwrite", (store) => store.delete(id));
}
