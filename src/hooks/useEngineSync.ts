import { useEffect } from 'react';
import { useStore } from '../state/store';
import { audioEngine } from '../audio/engine';
import type { Project, Track } from '../audio/types';

/**
 * useEngineSync — keeps the audio engine in step with the store WITHOUT the
 * old "re-schedule everything on every change" sledgehammer.
 *
 *  - Per-track params (volume / pan / mute / solo / synth / fx): applied live
 *    via `ensureTrack`, but only for the track whose object reference actually
 *    changed. Turning a synth knob touches one track, not all of them.
 *  - Transport scheduling (`schedule`) only runs when *schedulable* content
 *    changes — bpm, time signature, the track list, or a track's `clips`
 *    array reference. Store actions that only tweak params preserve the
 *    `clips` reference, so a knob drag never re-schedules the transport.
 */
type Snapshot = {
  bpm: number;
  numerator: number;
  denominator: number;
  trackById: Map<string, Track>;
};

function snapshot(p: Project): Snapshot {
  const trackById = new Map<string, Track>();
  for (const t of p.tracks) trackById.set(t.id, t);
  return { bpm: p.bpm, numerator: p.numerator, denominator: p.denominator, trackById };
}

export function useEngineSync() {
  useEffect(() => {
    let prev = snapshot(useStore.getState().project);

    const unsub = useStore.subscribe(
      (s) => s.project,
      (project) => {
        // 1. live per-track update — only the track(s) that changed
        for (const t of project.tracks) {
          if (prev.trackById.get(t.id) !== t) audioEngine.ensureTrack(t);
        }

        // 2. decide whether the transport needs a full re-schedule
        let needsSchedule =
          project.bpm !== prev.bpm ||
          project.numerator !== prev.numerator ||
          project.denominator !== prev.denominator ||
          project.tracks.length !== prev.trackById.size;

        if (!needsSchedule) {
          for (const t of project.tracks) {
            const pt = prev.trackById.get(t.id);
            if (!pt || pt.clips !== t.clips) {
              needsSchedule = true;
              break;
            }
          }
        }

        if (needsSchedule) audioEngine.schedule(project);

        prev = snapshot(project);
      },
    );

    return unsub;
  }, []);
}
