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
  tempoMap: Project['tempoMap'];
  swing: number;
  swingSubdivision: string;
  trackById: Map<string, Track>;
};

function snapshot(p: Project): Snapshot {
  const trackById = new Map<string, Track>();
  for (const t of p.tracks) trackById.set(t.id, t);
  return {
    bpm: p.bpm,
    numerator: p.numerator,
    denominator: p.denominator,
    tempoMap: p.tempoMap,
    swing: p.swing ?? 0,
    swingSubdivision: p.swingSubdivision ?? '8n',
    trackById,
  };
}

function recordToMap(rec: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(rec));
}

function rescheduleForCurrentMode() {
  const s = useStore.getState();
  if (s.sessionMode) {
    audioEngine.scheduleSession(s.project, recordToMap(s.sessionPlaying));
  } else {
    audioEngine.schedule(s.project);
  }
}

export function useEngineSync() {
  useEffect(() => {
    let prev = snapshot(useStore.getState().project);

    const unsubProject = useStore.subscribe(
      (s) => s.project,
      (project) => {
        // live per-track update — only the track(s) that changed
        let anyTrackChanged = false;
        for (const t of project.tracks) {
          if (prev.trackById.get(t.id) !== t) {
            audioEngine.ensureTrack(t);
            anyTrackChanged = true;
          }
        }
        // sidechain wiring needs every node to exist; reconcile after the per-track pass
        if (anyTrackChanged || project.tracks.length !== prev.trackById.size) {
          audioEngine.applySidechains(project);
        }

        // swing applies to already-scheduled events live — no re-schedule needed
        // swing is now baked into the scheduled note times, so a swing
        // change must re-apply (engine) AND re-schedule
        const swing = project.swing ?? 0;
        const swingSub = project.swingSubdivision ?? '8n';
        const swingChanged = swing !== prev.swing || swingSub !== prev.swingSubdivision;
        if (swingChanged) audioEngine.setSwing(swing, swingSub);

        // decide whether the transport needs a full re-schedule
        let needsSchedule =
          swingChanged ||
          project.bpm !== prev.bpm ||
          project.numerator !== prev.numerator ||
          project.denominator !== prev.denominator ||
          project.tempoMap !== prev.tempoMap ||
          project.tracks.length !== prev.trackById.size;
        if (!needsSchedule) {
          for (const t of project.tracks) {
            const pt = prev.trackById.get(t.id);
            if (
              !pt ||
              pt.clips !== t.clips ||
              pt.automation !== t.automation ||
              pt.midiOutChannel !== t.midiOutChannel ||
              pt.swing !== t.swing
            ) {
              needsSchedule = true;
              break;
            }
          }
        }
        if (needsSchedule) rescheduleForCurrentMode();
        prev = snapshot(project);
      },
    );

    // Switching between session and arrangement requires a full re-schedule
    // (different events, different loops) — the engine handles the swap.
    const unsubMode = useStore.subscribe(
      (s) => s.sessionMode,
      (on) => {
        if (on) {
          audioEngine.scheduleSession(
            useStore.getState().project,
            recordToMap(useStore.getState().sessionPlaying),
          );
        } else {
          audioEngine.stopAllSessionClips();
          audioEngine.schedule(useStore.getState().project);
        }
      },
    );

    // Launching a different session clip while in session mode rebuilds the loops.
    const unsubPlaying = useStore.subscribe(
      (s) => s.sessionPlaying,
      (playing) => {
        if (!useStore.getState().sessionMode) return;
        audioEngine.scheduleSession(useStore.getState().project, recordToMap(playing));
      },
    );

    return () => {
      unsubProject();
      unsubMode();
      unsubPlaying();
    };
  }, []);
}
