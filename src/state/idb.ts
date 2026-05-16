/**
 * idb — shared IndexedDB connection for LostBoard. One DB (`lostboard`) with
 * an object store per concern (`samples`, `projects`). Bumping the version
 * adds new stores in `onupgradeneeded`; existing data is preserved.
 */
const DB_NAME = 'lostboard';
const VERSION = 2;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('samples')) db.createObjectStore('samples');
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
