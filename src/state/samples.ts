import { audioEngine } from '../audio/engine';
import { getAllSamples, putSample } from './sampleDB';

/**
 * samples — orchestrates the runtime sample bank (in the engine) and the
 * persistent IndexedDB store. Import/record goes through `importSample` so the
 * blob is both decoded for playback and saved for next session;
 * `rehydrateSamples` re-decodes everything on startup.
 */

/** Decode a blob into the engine bank AND persist it. Returns id + duration. */
export async function importSample(blob: Blob): Promise<{ id: string; duration: number }> {
  const { id, duration } = await audioEngine.loadAudioFile(blob);
  try {
    await putSample(id, blob);
  } catch (e) {
    console.warn('Could not persist sample to IndexedDB', e);
  }
  return { id, duration };
}

/** Re-decode every persisted sample back into the engine's runtime bank. */
export async function rehydrateSamples(): Promise<number> {
  let entries: { id: string; blob: Blob }[] = [];
  try {
    entries = await getAllSamples();
  } catch (e) {
    console.warn('Could not read persisted samples', e);
    return 0;
  }
  let ok = 0;
  await Promise.all(
    entries.map(async ({ id, blob }) => {
      if (audioEngine.hasSample(id)) {
        ok++;
        return;
      }
      try {
        await audioEngine.decodeSample(id, blob);
        ok++;
      } catch (e) {
        console.warn(`Failed to rehydrate sample ${id}`, e);
      }
    }),
  );
  return ok;
}
