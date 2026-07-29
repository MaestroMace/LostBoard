import { audioEngine } from '../audio/engine';

/**
 * MeterBus — one rAF loop drives every level meter by writing directly to the
 * DOM. No React re-renders: a meter moving at 60 fps costs nothing on the
 * React side.
 */
type Key = string; // track id, or 'master'

function dbToFill(db: number): number {
  if (db <= -60 || !Number.isFinite(db)) return 0;
  if (db >= 0) return 1;
  return (db + 60) / 60;
}

class MeterBus {
  private els = new Map<Key, HTMLElement>();
  private axis = new Map<Key, 'x' | 'y'>();
  private raf = 0;

  register(key: Key, el: HTMLElement): () => void {
    // Axis is read once here, not per frame: this loop runs 60x/sec per meter
    // and a dataset lookup inside it would be the most-executed line in the app.
    this.axis.set(key, el.dataset.axis === 'x' ? 'x' : 'y');
    this.els.set(key, el);
    this.ensureRunning();
    return () => {
      this.els.delete(key);
      this.axis.delete(key);
      if (this.els.size === 0) this.stop();
    };
  }

  private ensureRunning() {
    if (this.raf) return;
    const loop = () => {
      for (const [key, el] of this.els) {
        const db = key === 'master' ? audioEngine.getMasterLevel() : audioEngine.getTrackLevel(key);
        // scaleY, not height: height forces a layout pass for every meter on
        // every frame (the mixer was doing ~220 layouts per 5s). A transform
        // stays on the compositor.
        const fill = dbToFill(db).toFixed(3);
        el.style.transform = this.axis.get(key) === 'x' ? `scaleX(${fill})` : `scaleY(${fill})`;
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stop() {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }
}

export const meterBus = new MeterBus();
