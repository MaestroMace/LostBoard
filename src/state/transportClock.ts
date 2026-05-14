import { useSyncExternalStore } from 'react';
import { audioEngine } from '../audio/engine';

/**
 * TransportClock — the playhead position lives OUTSIDE React state.
 *
 * A single rAF loop reads the engine's transport position and notifies
 * subscribers only when the value actually changes. Components read it via
 * `usePlayhead()` / `useSyncExternalStore`, so a moving playhead only
 * re-renders the tiny leaf components that display it — never the whole app.
 */
type Listener = () => void;

class TransportClock {
  private beats = 0;
  private listeners = new Set<Listener>();
  private raf = 0;

  private loop = () => {
    if (audioEngine.isInited()) {
      const b = audioEngine.getPositionBeats();
      if (b !== this.beats) {
        this.beats = b;
        this.emit();
      }
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      this.raf = requestAnimationFrame(this.loop);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.raf) {
        cancelAnimationFrame(this.raf);
        this.raf = 0;
      }
    };
  };

  getSnapshot = (): number => this.beats;

  /** Push a value immediately (e.g. on scrub) without waiting for the next frame. */
  set(beats: number) {
    if (beats === this.beats) return;
    this.beats = beats;
    this.emit();
  }

  private emit() {
    for (const l of this.listeners) l();
  }
}

export const transportClock = new TransportClock();

/** Seek the transport: moves the engine playhead and the clock together. */
export function seek(beats: number) {
  const b = Math.max(0, beats);
  audioEngine.setPosition(b);
  transportClock.set(b);
}

/** Subscribe a component to the playhead position (beats). */
export function usePlayhead(): number {
  return useSyncExternalStore(transportClock.subscribe, transportClock.getSnapshot);
}
