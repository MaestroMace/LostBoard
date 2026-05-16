import { useEffect, type RefObject } from 'react';

/**
 * usePinchZoom — attaches two-finger pinch-to-zoom handlers to a scroll
 * container. Mirrors the Cmd/Ctrl-wheel zoom on desktop, for touch.
 *
 * The hook drives the same `setZoom` updater the desktop wheel handler uses,
 * so the editor stays a single source of truth for the zoom value. The
 * starting zoom is captured at the moment the second finger lands by
 * sneaking a read through the functional setter form.
 */
export function usePinchZoom(
  scrollRef: RefObject<HTMLElement | null>,
  setZoom: (updater: (z: number) => number) => void,
  min = 0.25,
  max = 4,
): void {
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const active = new Map<number, { x: number; y: number }>();
    let start: { dist: number; zoom: number } | null = null;

    function dist(): number {
      const pts = Array.from(active.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      return Math.hypot(dx, dy) || 1;
    }

    function onDown(e: PointerEvent) {
      if (e.pointerType !== 'touch') return;
      active.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (active.size === 2) {
        const d0 = dist();
        // capture the current zoom value by returning it unchanged
        setZoom((z) => {
          start = { dist: d0, zoom: z };
          return z;
        });
      }
    }

    function onMove(e: PointerEvent) {
      if (!active.has(e.pointerId)) return;
      active.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (active.size !== 2 || !start) return;
      e.preventDefault();
      const ratio = dist() / start.dist;
      const next = Math.max(min, Math.min(max, start.zoom * ratio));
      setZoom(() => next);
    }

    function onUp(e: PointerEvent) {
      if (!active.has(e.pointerId)) return;
      active.delete(e.pointerId);
      if (active.size < 2) start = null;
    }

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove, { passive: false });
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, [scrollRef, setZoom, min, max]);
}
