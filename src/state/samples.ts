import { audioEngine } from '../audio/engine';
import type { Project } from '../audio/types';
import { getAllSamples, putSample, deleteSample } from './sampleDB';
import { listSlots } from './projectSlots';
import { useStore } from './store';

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

/** Every sampleId a project references — audio clips, drum-pad samples, sampler sources. */
function collectSampleRefs(project: Project, into: Set<string>) {
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.kind === 'audio') into.add(clip.sampleId);
    }
    if (track.padSamples) {
      for (const id of Object.values(track.padSamples)) {
        if (id) into.add(id);
      }
    }
    if (track.samplerSampleId) into.add(track.samplerSampleId);
  }
}

/**
 * Delete persisted samples that no project references any more.
 *
 * "Referenced" spans the live project AND every saved slot — samples are
 * shared across slots by stable id, so a sample only counts as orphaned
 * once nothing in the whole library points at it. Returns the number of
 * blobs removed. Also drops them from the engine's runtime bank so the
 * memory is actually freed this session.
 */
export async function gcOrphanedSamples(): Promise<number> {
  const referenced = new Set<string>();
  collectSampleRefs(useStore.getState().project, referenced);
  try {
    for (const slot of await listSlots()) collectSampleRefs(slot.project, referenced);
  } catch (e) {
    console.warn('Could not read slots for sample GC; aborting to stay safe', e);
    return 0;
  }

  let stored: { id: string; blob: Blob }[] = [];
  try {
    stored = await getAllSamples();
  } catch (e) {
    console.warn('Could not read persisted samples for GC', e);
    return 0;
  }

  let removed = 0;
  for (const { id } of stored) {
    if (referenced.has(id)) continue;
    try {
      await deleteSample(id);
      audioEngine.dropSample(id);
      removed++;
    } catch (e) {
      console.warn(`Failed to delete orphaned sample ${id}`, e);
    }
  }
  return removed;
}
