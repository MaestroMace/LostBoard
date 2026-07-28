import { useEffect, useSyncExternalStore } from 'react';

/**
 * Phone detection has to be orientation-aware.
 *
 * A Pixel 9 is 411x923 upright but 923x411 on its side. The original
 * `(max-width: 720px)` query therefore reported "desktop" in landscape and
 * handed a 411px-tall viewport the full desktop chrome — which is what made the
 * header collapse into itself. Either axis being phone-sized means phone.
 *
 * 560px is chosen as the short-viewport ceiling because phones in landscape sit
 * around 360-480px tall while the shortest laptops start at 600-720px, so it
 * separates the two without catching real desktops.
 */
const PHONE_QUERY = '(max-width: 720px), (max-height: 560px)';
const LANDSCAPE_QUERY = '(orientation: landscape)';

/** Narrow enough that even phone chrome has to give up label text. */
const CRAMPED_QUERY = '(max-width: 430px)';

function makeQuery(query: string) {
  const mql = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query) : null;
  return {
    subscribe(cb: () => void): () => void {
      if (!mql) return () => {};
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    get: (): boolean => mql?.matches ?? false,
  };
}

const phone = makeQuery(PHONE_QUERY);
const landscape = makeQuery(LANDSCAPE_QUERY);
const cramped = makeQuery(CRAMPED_QUERY);

/** True on phone-sized viewports in *either* orientation. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(phone.subscribe, phone.get, () => false);
}

export function useIsLandscape(): boolean {
  return useSyncExternalStore(landscape.subscribe, landscape.get, () => true);
}

/** True when horizontal space is tight enough to drop button labels. */
export function useIsCramped(): boolean {
  return useSyncExternalStore(cramped.subscribe, cramped.get, () => false);
}

export type LayoutMode = 'desktop' | 'phone-landscape' | 'phone-portrait';

export function useLayoutMode(): LayoutMode {
  const isPhone = useIsMobile();
  const isLandscape = useIsLandscape();
  if (!isPhone) return 'desktop';
  return isLandscape ? 'phone-landscape' : 'phone-portrait';
}

/**
 * Mirrors the active mode onto <html data-layout> so stylesheets can target a
 * mode directly instead of restating the media queries above and drifting out
 * of sync with them.
 */
export function useLayoutModeAttribute(): LayoutMode {
  const mode = useLayoutMode();
  useEffect(() => {
    document.documentElement.dataset.layout = mode;
    return () => {
      delete document.documentElement.dataset.layout;
    };
  }, [mode]);
  return mode;
}
