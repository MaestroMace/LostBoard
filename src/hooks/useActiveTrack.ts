import { useEffect, useMemo } from 'react';
import { useStore } from '../state/store';
import type { Track, TrackKind } from '../audio/types';

/**
 * useActiveTrack — resolves the track an editor (instrument / fx / piano roll /
 * sequencer) should operate on, and keeps the global selection coherent.
 *
 * The selected track is global, but each editor only handles tracks of a
 * certain kind. Without this hook an editor would silently fall back to the
 * "first track of its kind" while `selectedTrackId` still pointed elsewhere —
 * so the Arrange view's highlight and the editor would disagree. Here we make
 * the fallback authoritative by writing it back to the store, so wherever you
 * navigate, the selection always matches what's actually on screen.
 */
export function useActiveTrack(kind: TrackKind | 'any'): { pool: Track[]; active: Track | undefined } {
  const tracks = useStore((s) => s.project.tracks);
  const selectedTrackId = useStore((s) => s.selectedTrackId);
  const selectTrack = useStore((s) => s.selectTrack);

  const pool = useMemo(
    () => (kind === 'any' ? tracks : tracks.filter((t) => t.kind === kind)),
    [tracks, kind],
  );
  const active = pool.find((t) => t.id === selectedTrackId) ?? pool[0];

  useEffect(() => {
    if (active && active.id !== selectedTrackId) selectTrack(active.id);
  }, [active, selectedTrackId, selectTrack]);

  return { pool, active };
}
