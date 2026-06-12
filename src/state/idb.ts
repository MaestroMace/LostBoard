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
  const opening: Promise<IDBDatabase> = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('samples')) db.createObjectStore('samples');
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects');
    };
    req.onsuccess = () => {
      const db = req.result;
      // another tab upgrading the DB closes this connection — drop the
      // cache so the next call reopens instead of using a dead handle
      db.onversionchange = () => {
        db.close();
        if (dbPromise === opening) dbPromise = null;
      };
      resolve(db);
    };
    // a stale tab holding the old version would otherwise leave this
    // promise pending forever and hang rehydration + the slot library
    req.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'));
    req.onerror = () => reject(req.error);
  });
  // don't cache a failed open — a transient error (e.g. private-browsing
  // restrictions lifting, tab unblocking) should be retryable
  opening.catch(() => {
    if (dbPromise === opening) dbPromise = null;
  });
  dbPromise = opening;
  return dbPromise;
}
