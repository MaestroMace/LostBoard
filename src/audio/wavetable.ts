/**
 * wavetable — derive an oscillator timbre from an arbitrary audio buffer.
 *
 * A wavetable oscillator plays a single-cycle waveform. Rather than try to
 * detect the true cycle length of an arbitrary import, we take a window of
 * the buffer, run a small DFT, and reinterpret the magnitude spectrum as a
 * harmonic series — bin k becomes the amplitude of the k-th harmonic. The
 * result isn't a literal cycle of the source, but it carries the source's
 * harmonic balance and makes a usable, characterful wavetable from any
 * sound (the same trick "sample → wavetable" importers use).
 */

export const WAVETABLE_HARMONICS = 32;

/**
 * Extract a normalized partials array (length `harmonics`) from an audio
 * buffer. Picks a window with real energy, DFTs it, returns magnitudes
 * scaled so the loudest harmonic is 1.
 */
export function partialsFromBuffer(buffer: AudioBuffer, harmonics = WAVETABLE_HARMONICS): number[] {
  const data = buffer.getChannelData(0);
  const W = Math.min(2048, data.length);
  if (W < 16) return [1];

  // scan in W-sized hops for the most energetic window so a leading
  // silence in the file doesn't yield a flat spectrum
  let start = 0;
  let bestEnergy = -1;
  for (let s = 0; s + W <= data.length; s += W) {
    let e = 0;
    for (let n = 0; n < W; n += 8) e += data[s + n] * data[s + n];
    if (e > bestEnergy) {
      bestEnergy = e;
      start = s;
    }
  }

  const partials: number[] = [];
  for (let k = 1; k <= harmonics; k++) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < W; n++) {
      const x = data[start + n];
      const phase = (-2 * Math.PI * k * n) / W;
      re += x * Math.cos(phase);
      im += x * Math.sin(phase);
    }
    partials.push(Math.sqrt(re * re + im * im));
  }

  const max = Math.max(...partials, 1e-9);
  return partials.map((p) => p / max);
}
