import { useSyncExternalStore } from 'react';

/**
 * useIsMobile — true when the viewport is phone-sized (portrait iPhone, etc.).
 * Backed by matchMedia so it updates on rotation/resize without polling.
 */
const QUERY = '(max-width: 720px)';
const mql = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(QUERY) : null;

function subscribe(cb: () => void): () => void {
  if (!mql) return () => {};
  mql.addEventListener('change', cb);
  return () => mql.removeEventListener('change', cb);
}

function getSnapshot(): boolean {
  return mql?.matches ?? false;
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
