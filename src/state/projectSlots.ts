import type { Project } from '../audio/types';
import { openDb } from './idb';

/**
 * projectSlots — a tiny multi-slot save library backed by IndexedDB.
 *
 * Each slot stores `{ id, name, savedAt, project }`. Slots are addressable by
 * id and listable with metadata so the UI can show a library without loading
 * full project payloads up front. Project JSON is small enough that we just
 * fetch the whole record when listing — fine for typical slot counts.
 */
const STORE = 'projects';

export type ProjectSlot = {
  id: string;
  name: string;
  savedAt: number;
  project: Project;
};

export async function listSlots(): Promise<ProjectSlot[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    tx.oncomplete = () => {
      const all = (req.result as ProjectSlot[]) ?? [];
      all.sort((a, b) => b.savedAt - a.savedAt);
      resolve(all);
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function getSlot(id: string): Promise<ProjectSlot | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    tx.oncomplete = () => resolve((req.result as ProjectSlot) ?? null);
    tx.onerror = () => reject(tx.error);
  });
}

export async function putSlot(slot: ProjectSlot): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(slot, slot.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteSlot(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function newSlotId(): string {
  return `slot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
