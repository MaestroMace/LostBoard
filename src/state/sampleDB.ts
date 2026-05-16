import { openDb } from './idb';

/**
 * sampleDB — IndexedDB persistence for recorded / imported audio blobs.
 * Audio buffers can't live in localStorage (too big, not serialisable); on
 * app start the engine re-decodes everything stored here.
 */
const STORE = 'samples';

export async function putSample(id: string, blob: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllSamples(): Promise<{ id: string; blob: Blob }[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const keysReq = store.getAllKeys();
    const valsReq = store.getAll();
    tx.oncomplete = () => {
      const keys = keysReq.result as string[];
      const vals = valsReq.result as Blob[];
      resolve(keys.map((id, i) => ({ id, blob: vals[i] })));
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteSample(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
