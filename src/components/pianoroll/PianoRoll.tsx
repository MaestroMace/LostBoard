import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import type { Note } from '../../audio/types';
import { audioEngine } from '../../audio/engine';
import { HexFrame } from '../hud/HexFrame';
import { usePlayhead } from '../../state/transportClock';
import { useActiveTrack } from '../../hooks/useActiveTrack';
import { usePinchZoom } from '../../hooks/usePinchZoom';
import { EditorTip } from '../hud/EditorTip';

const BASE_BEAT_W = 56;
const ROW_H = 16;
const LO = 36; // C2
const HI = 84; // C6
const ROWS = HI - LO + 1;
const VEL_LANE_H = 60;
const KEYS_W = 48;
const BeatWidthContext = createContext(BASE_BEAT_W);
const useBeatWidth = () => useContext(BeatWidthContext);

// ------- scale lock -------
type ScaleName =
  | 'chromatic'
  | 'major'
  | 'minor'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'harmonic minor'
  | 'pentatonic'
  | 'pent minor'
  | 'blues';

const SCALES: Record<ScaleName, number[]> = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
  pentatonic: [0, 2, 4, 7, 9],
  'pent minor': [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
};
const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ScaleContext = createContext<{ root: number; scale: ScaleName }>({ root: 0, scale: 'chromatic' });
const useScale = () => useContext(ScaleContext);

/** Snap a MIDI pitch to the nearest in-scale pitch. Falls through unchanged for chromatic. */
function snapPitchToScale(pitch: number, root: number, scale: ScaleName): number {
  const intervals = SCALES[scale];
  if (intervals.length === 12) return pitch;
  const inScale = (p: number) => intervals.includes((((p - root) % 12) + 12) % 12);
  for (let d = 0; d < 7; d++) {
    if (inScale(pitch - d)) return pitch - d;
    if (inScale(pitch + d)) return pitch + d;
  }
  return pitch;
}

export function PianoRoll() {
  const selectTrack = useStore((s) => s.selectTrack);
  const selectedClipId = useStore((s) => s.selectedClipIds[0] ?? null);
  const selectClip = useStore((s) => s.selectClip);
  const addNote = useStore((s) => s.addNote);
  const addClip = useStore((s) => s.addClip);
  const quantizeClip = useStore((s) => s.quantizeClip);
  const humanizeClip = useStore((s) => s.humanizeClip);
  const selectedNoteIds = useStore((s) => s.selectedNoteIds);
  const clearNoteSelection = useStore((s) => s.clearNoteSelection);

  const { pool: synthTracks, active: activeTrack } = useActiveTrack('synth');
  const midiClips = useMemo(
    () => (activeTrack ? activeTrack.clips.filter((c) => c.kind === 'midi') : []),
    [activeTrack],
  );
  const activeClip = (midiClips.find((c) => c.id === selectedClipId) ?? midiClips[0]) as
    | Extract<(typeof midiClips)[number], { kind: 'midi' }>
    | undefined;

  // keep the global clip selection in sync with what the editor actually shows
  useEffect(() => {
    if (activeClip && activeClip.id !== selectedClipId) selectClip(activeClip.id);
  }, [activeClip, selectedClipId, selectClip]);

  const [tool, setTool] = useState<'draw' | 'select' | 'erase'>('draw');
  const [snap, setSnap] = useState<0.25 | 0.5 | 1>(0.25);
  const [scaleRoot, setScaleRoot] = useState(0);
  const [scaleName, setScaleName] = useState<ScaleName>('chromatic');

  if (!activeTrack) {
    return (
      <div style={{ padding: 16 }}>
        <HexFrame title="N/A">No synth track. Add one from the Arrange view.</HexFrame>
      </div>
    );
  }
  if (!activeClip) {
    return (
      <div style={{ padding: 16 }}>
        <HexFrame title={activeTrack.name}>
          <p>This track has no MIDI clip.</p>
          <button className="hud-btn" onClick={() => addClip(activeTrack.id, 0, 4)}>
            CREATE MIDI CLIP
          </button>
        </HexFrame>
      </div>
    );
  }

  const beats = Math.max(4, activeClip.length);
  const [zoom, setZoom] = useState(1);
  const BEAT_W = BASE_BEAT_W * zoom;
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setZoom((z) => Math.max(0.25, Math.min(4, z * (e.deltaY < 0 ? 1.12 : 1 / 1.12))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  usePinchZoom(gridRef, setZoom);

  /**
   * Draft note state for DRAW + drag-on-create. While the user holds down,
   * we render a translucent ghost at the cursor's pitch/start whose length
   * tracks the pointer. On release we commit it via addNote — so dragging
   * a few beats wide is one gesture instead of "tap, then drag the right
   * edge".
   */
  const [draft, setDraft] = useState<
    | { startBeat: number; pitch: number; length: number; pointerId: number }
    | null
  >(null);
  /** Marquee selection rectangle while the user drags in SELECT mode. Coords are in grid pixels. */
  const [marquee, setMarquee] = useState<
    | { x0: number; y0: number; x1: number; y1: number; pointerId: number }
    | null
  >(null);

  function gridLocal(e: React.PointerEvent): { x: number; y: number } {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function gridDown(e: React.PointerEvent) {
    if (!activeTrack || !activeClip) return;
    // empty-grid pointerdown clears any note selection (Ableton/Logic style)
    if (selectedNoteIds.length > 0) clearNoteSelection();
    const { x, y } = gridLocal(e);
    const beat = Math.floor(x / BEAT_W / snap) * snap;
    const rawPitch = HI - Math.floor(y / ROW_H);
    if (tool === 'draw') {
      const pitch = snapPitchToScale(rawPitch, scaleRoot, scaleName);
      if (beat < 0 || beat >= beats || pitch < LO || pitch > HI) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDraft({ startBeat: beat, pitch, length: snap, pointerId: e.pointerId });
      audioEngine.trigger(activeTrack.id, pitch, 0.9, '16n');
    } else if (tool === 'select') {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setMarquee({ x0: x, y0: y, x1: x, y1: y, pointerId: e.pointerId });
    }
    // ERASE on empty grid: nothing happens (the user clicks notes to delete)
  }
  function gridMove(e: React.PointerEvent) {
    const { x, y } = gridLocal(e);
    if (draft && e.pointerId === draft.pointerId) {
      // length follows the pointer's distance from the draft's start beat
      const dragBeat = x / BEAT_W;
      const lenRaw = Math.max(snap, dragBeat - draft.startBeat + snap);
      const length = Math.max(snap, Math.round(lenRaw / snap) * snap);
      if (length !== draft.length) setDraft({ ...draft, length });
    } else if (marquee && e.pointerId === marquee.pointerId) {
      setMarquee({ ...marquee, x1: x, y1: y });
    }
  }
  function gridUp(e: React.PointerEvent) {
    if (!activeTrack || !activeClip) return;
    if (draft && e.pointerId === draft.pointerId) {
      const noteId = addNote(activeTrack.id, activeClip.id, {
        pitch: draft.pitch,
        start: draft.startBeat,
        length: draft.length,
        velocity: 0.9,
      });
      // auto-select the freshly placed note so the user can immediately
      // adjust velocity or drag it
      if (noteId) useStore.getState().selectNote(noteId);
      setDraft(null);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* may already be released */
      }
    } else if (marquee && e.pointerId === marquee.pointerId) {
      const xMin = Math.min(marquee.x0, marquee.x1);
      const xMax = Math.max(marquee.x0, marquee.x1);
      const yMin = Math.min(marquee.y0, marquee.y1);
      const yMax = Math.max(marquee.y0, marquee.y1);
      const hits: string[] = [];
      for (const n of activeClip.notes) {
        const nx0 = n.start * BEAT_W;
        const nx1 = nx0 + Math.max(8, n.length * BEAT_W);
        const ny0 = (HI - n.pitch) * ROW_H;
        const ny1 = ny0 + ROW_H;
        if (nx1 >= xMin && nx0 <= xMax && ny1 >= yMin && ny0 <= yMax) hits.push(n.id);
      }
      useStore.setState({ selectedNoteIds: hits });
      setMarquee(null);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* may already be released */
      }
    }
  }

  return (
    <BeatWidthContext.Provider value={BEAT_W}>
    <ScaleContext.Provider value={{ root: scaleRoot, scale: scaleName }}>
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', contain: 'layout style', position: 'relative' }}>
      <div
        style={{
          padding: 8,
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          flexWrap: 'wrap',
          borderBottom: '1px solid rgba(255,106,0,0.4)',
        }}
      >
        <span className="hud-label">PIANO ROLL // TRIAD DENEB</span>
        <select className="display" value={activeTrack.id} onChange={(e) => selectTrack(e.target.value)}>
          {synthTracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select className="display" value={activeClip.id} onChange={(e) => selectClip(e.target.value)}>
          {midiClips.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name ?? c.id}
            </option>
          ))}
        </select>
        <button
          className="hud-btn"
          onClick={() => addClip(activeTrack.id, activeClip.start + activeClip.length, activeClip.length)}
        >
          + CLIP
        </button>
        <div style={{ flex: 1 }} />
        <button className={`hud-btn ${tool === 'draw' ? 'is-active' : ''}`} onClick={() => setTool('draw')}>
          DRAW
        </button>
        <button
          className={`hud-btn hud-btn--green ${tool === 'select' ? 'is-active' : ''}`}
          onClick={() => setTool('select')}
          title="Drag a rectangle to select notes inside"
        >
          SELECT
        </button>
        <button
          className={`hud-btn hud-btn--rec ${tool === 'erase' ? 'is-active' : ''}`}
          onClick={() => setTool('erase')}
        >
          ERASE
        </button>
        <span className="hud-readout">SNAP</span>
        <select className="display" value={snap} onChange={(e) => setSnap(parseFloat(e.target.value) as any)}>
          <option value={1}>1/4</option>
          <option value={0.5}>1/8</option>
          <option value={0.25}>1/16</option>
        </select>
        <span className="hud-readout">SCALE</span>
        <select
          className="display"
          value={scaleRoot}
          onChange={(e) => setScaleRoot(parseInt(e.target.value, 10))}
          title="Scale root"
        >
          {ROOTS.map((n, i) => (
            <option key={i} value={i}>
              {n}
            </option>
          ))}
        </select>
        <select
          className="display"
          value={scaleName}
          onChange={(e) => setScaleName(e.target.value as ScaleName)}
          title="Scale — new notes snap to it"
        >
          {(Object.keys(SCALES) as ScaleName[]).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button
          className="hud-btn hud-btn--ghost"
          onClick={() =>
            quantizeClip(
              activeTrack.id,
              activeClip.id,
              snap,
              selectedNoteIds.length > 0 ? selectedNoteIds : undefined,
            )
          }
          title={
            selectedNoteIds.length > 0
              ? `Quantize ${selectedNoteIds.length} selected note${selectedNoteIds.length === 1 ? '' : 's'} to the current SNAP`
              : `Quantize every note to the current SNAP (1/${1 / snap === 4 ? 4 : 1 / snap === 8 ? 8 : 16})`
          }
        >
          ⎌ QUANTIZE{selectedNoteIds.length > 0 ? ` SEL` : ''}
        </button>
        <button
          className="hud-btn hud-btn--ghost"
          onClick={() =>
            humanizeClip(
              activeTrack.id,
              activeClip.id,
              0.4,
              selectedNoteIds.length > 0 ? selectedNoteIds : undefined,
            )
          }
          title={
            selectedNoteIds.length > 0
              ? `Humanize ${selectedNoteIds.length} selected note${selectedNoteIds.length === 1 ? '' : 's'}`
              : 'Add small random velocity + timing wobble to every note'
          }
        >
          ~ HUMANIZE{selectedNoteIds.length > 0 ? ` SEL` : ''}
        </button>
        {selectedNoteIds.length > 0 && (
          <button
            className="hud-btn hud-btn--ghost"
            onClick={clearNoteSelection}
            title="Clear note selection"
          >
            ✕ DESEL ({selectedNoteIds.length})
          </button>
        )}
      </div>
      <div
        ref={gridRef}
        style={{ flex: 1, overflow: 'auto', position: 'relative', contain: 'layout style' }}
      >
        <div style={{ display: 'flex' }}>
        <Keys trackId={activeTrack.id} />
        <div
          onPointerDown={gridDown}
          onPointerMove={gridMove}
          onPointerUp={gridUp}
          onPointerCancel={gridUp}
          style={{
            position: 'relative',
            width: beats * BEAT_W,
            height: ROWS * ROW_H,
            background: '#050505',
            backgroundImage: `
              linear-gradient(rgba(255,106,0,0.06) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,106,0,0.18) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,106,0,0.06) 1px, transparent 1px)
            `,
            backgroundSize: `100% ${ROW_H}px, ${BEAT_W}px 100%, ${BEAT_W / 4}px 100%`,
            contain: 'layout style',
            touchAction: 'none',
          }}
        >
          <BlackKeyShading />
          <ScaleShading root={scaleRoot} scale={scaleName} />
          {activeClip.notes.map((n) => (
            <NoteEl
              key={n.id}
              note={n}
              trackId={activeTrack.id}
              clipId={activeClip.id}
              color={activeTrack.color}
              snap={snap}
              tool={tool}
              selected={selectedNoteIds.includes(n.id)}
            />
          ))}
          {draft && (
            <div
              style={{
                position: 'absolute',
                left: draft.startBeat * BEAT_W,
                top: (HI - draft.pitch) * ROW_H,
                width: Math.max(8, draft.length * BEAT_W),
                height: ROW_H - 2,
                background: `linear-gradient(180deg, ${activeTrack.color}aa, ${activeTrack.color}55)`,
                border: '1px dashed #fff',
                borderRadius: 1,
                pointerEvents: 'none',
              }}
            />
          )}
          {marquee && (
            <div
              style={{
                position: 'absolute',
                left: Math.min(marquee.x0, marquee.x1),
                top: Math.min(marquee.y0, marquee.y1),
                width: Math.abs(marquee.x1 - marquee.x0),
                height: Math.abs(marquee.y1 - marquee.y0),
                background: 'rgba(120,255,140,0.08)',
                border: '1px dashed var(--hud-green)',
                pointerEvents: 'none',
              }}
            />
          )}
          <PianoRollPlayhead clipStart={activeClip.start} />
        </div>
        </div>
        <VelocityLane
          trackId={activeTrack.id}
          clipId={activeClip.id}
          notes={activeClip.notes}
          beats={beats}
          beatW={BEAT_W}
          color={activeTrack.color}
          selectedIds={selectedNoteIds}
        />
      </div>
      <EditorTip>
        DRAW — drag empty grid to draw a note with that length · SELECT — drag empty grid for a rectangle marquee ·
        click a note to select (Cmd/Ctrl to multi-toggle) · drag selected notes to move them in lockstep · drag the right
        edge to resize · drag the velocity bars below the grid to shape dynamics · ⌘+wheel to zoom
      </EditorTip>
      <ZoomFloater zoom={zoom} setZoom={setZoom} />
    </div>
    </ScaleContext.Provider>
    </BeatWidthContext.Provider>
  );
}

const ZoomFloater = memo(function ZoomFloater({
  zoom,
  setZoom,
}: {
  zoom: number;
  setZoom: (u: (z: number) => number) => void;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        right: 12,
        bottom: 28,
        display: 'flex',
        gap: 2,
        background: 'rgba(0,0,0,0.85)',
        border: '1px solid rgba(255,106,0,0.4)',
        padding: 2,
        zIndex: 6,
      }}
    >
      <button
        className="hud-btn hud-btn--icon"
        title="Zoom out"
        onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))}
        style={{ minWidth: 24, padding: '2px 6px', fontSize: 11 }}
      >
        −
      </button>
      <button
        className="hud-btn hud-btn--icon"
        title="Reset zoom to 1×"
        onClick={() => setZoom(() => 1)}
        style={{ minWidth: 38, padding: '2px 4px', fontSize: 9 }}
      >
        {zoom.toFixed(2)}×
      </button>
      <button
        className="hud-btn hud-btn--icon"
        title="Zoom in"
        onClick={() => setZoom((z) => Math.min(4, z * 1.25))}
        style={{ minWidth: 24, padding: '2px 6px', fontSize: 11 }}
      >
        ＋
      </button>
    </div>
  );
});

const Keys = memo(function Keys({ trackId }: { trackId: string }) {
  return (
    <div
      style={{
        width: 48,
        position: 'sticky',
        left: 0,
        background: 'rgba(0,0,0,0.85)',
        zIndex: 4,
        borderRight: '1px solid rgba(255,106,0,0.5)',
        contain: 'layout style paint',
      }}
    >
      {Array.from({ length: ROWS }).map((_, i) => {
        const pitch = HI - i;
        const isBlack = [1, 3, 6, 8, 10].includes(pitch % 12);
        const isC = pitch % 12 === 0;
        return (
          <div
            key={i}
            onPointerDown={() => audioEngine.trigger(trackId, pitch, 0.9, '16n')}
            style={{
              height: ROW_H,
              background: isBlack ? '#0a0a0a' : '#1a0f0a',
              borderBottom: '1px solid rgba(255,106,0,0.18)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              paddingRight: 4,
              fontSize: 8,
              color: isC ? 'var(--hud-amber)' : 'rgba(255,106,0,0.5)',
              cursor: 'pointer',
              fontFamily: 'var(--font-data)',
            }}
          >
            {isC ? `C${Math.floor(pitch / 12) - 1}` : ''}
          </div>
        );
      })}
    </div>
  );
});

/** Darkens rows that fall outside the current scale (no-op for chromatic). */
const ScaleShading = memo(function ScaleShading({ root, scale }: { root: number; scale: ScaleName }) {
  const intervals = SCALES[scale];
  if (intervals.length === 12) return null;
  return (
    <>
      {Array.from({ length: ROWS }).map((_, i) => {
        const pitch = HI - i;
        const interval = (((pitch - root) % 12) + 12) % 12;
        if (intervals.includes(interval)) return null;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: i * ROW_H,
              height: ROW_H,
              background: 'rgba(0,0,0,0.5)',
              pointerEvents: 'none',
            }}
          />
        );
      })}
    </>
  );
});

const BlackKeyShading = memo(function BlackKeyShading() {
  return (
    <>
      {Array.from({ length: ROWS }).map((_, i) => {
        const pitch = HI - i;
        if (![1, 3, 6, 8, 10].includes(pitch % 12)) return null;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: i * ROW_H,
              height: ROW_H,
              background: 'rgba(0,0,0,0.35)',
              pointerEvents: 'none',
            }}
          />
        );
      })}
    </>
  );
});

/**
 * Memoized note — supports four interactions, all via direct DOM mutation
 * during the drag (commit on release):
 *   - resize from the right edge (single note only)
 *   - move a single note (with scale-snap on pitch)
 *   - move every selected note in lockstep when the dragged note is part
 *     of the current selection (no scale snap, chromatic delta — matches
 *     how Ableton handles multi-drag)
 *   - delete via the ERASE tool, Shift-click, or right-click
 */
const NoteEl = memo(function NoteEl({
  note,
  trackId,
  clipId,
  color,
  snap,
  tool,
  selected,
}: {
  note: Note;
  trackId: string;
  clipId: string;
  color: string;
  snap: number;
  tool: 'draw' | 'select' | 'erase';
  selected: boolean;
}) {
  const BEAT_W = useBeatWidth();
  const { root, scale } = useScale();
  const updateNote = useStore((s) => s.updateNote);
  const removeNote = useStore((s) => s.removeNote);
  const selectNote = useStore((s) => s.selectNote);
  const toggleNoteSelected = useStore((s) => s.toggleNoteSelected);
  const moveNotesBy = useStore((s) => s.moveNotesBy);
  const elRef = useRef<HTMLDivElement>(null);
  const drag = useRef<
    | null
    | {
        kind: 'resize';
        startX: number;
        baseLen: number;
        nextLen: number;
      }
    | {
        kind: 'move-single';
        startX: number;
        startY: number;
        baseStart: number;
        basePitch: number;
        nextStart: number;
        nextPitch: number;
      }
    | {
        kind: 'move-multi';
        startX: number;
        startY: number;
        tracked: { id: string; baseStart: number; basePitch: number; el: HTMLElement }[];
        nextDeltaStart: number;
        nextDeltaPitchRows: number;
      }
  >(null);

  function down(e: React.PointerEvent, resizing: boolean) {
    e.stopPropagation();
    if (tool === 'erase' || e.button === 2) {
      removeNote(trackId, clipId, note.id);
      return;
    }
    // Cmd/Ctrl-click toggles multi-select; shift-click deletes (preserves
    // the old shortcut). Resize never multi-applies — only the right-edge
    // handle, single note.
    if (e.shiftKey) {
      removeNote(trackId, clipId, note.id);
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      toggleNoteSelected(note.id);
      return;
    }
    elRef.current?.setPointerCapture(e.pointerId);
    if (resizing) {
      drag.current = { kind: 'resize', startX: e.clientX, baseLen: note.length, nextLen: note.length };
      return;
    }
    // unselected note: become the only selection and drag as a single.
    // selected note: drag the whole current selection in lockstep.
    if (!selected) selectNote(note.id);
    const ids = useStore.getState().selectedNoteIds;
    if (ids.length > 1) {
      const track = useStore.getState().project.tracks.find((t) => t.id === trackId);
      const clip = track?.clips.find((c) => c.id === clipId);
      const notes = clip && clip.kind === 'midi' ? clip.notes : [];
      const tracked: { id: string; baseStart: number; basePitch: number; el: HTMLElement }[] = [];
      for (const id of ids) {
        const n = notes.find((nn) => nn.id === id);
        const el = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
        if (n && el) tracked.push({ id, baseStart: n.start, basePitch: n.pitch, el });
      }
      drag.current = {
        kind: 'move-multi',
        startX: e.clientX,
        startY: e.clientY,
        tracked,
        nextDeltaStart: 0,
        nextDeltaPitchRows: 0,
      };
    } else {
      drag.current = {
        kind: 'move-single',
        startX: e.clientX,
        startY: e.clientY,
        baseStart: note.start,
        basePitch: note.pitch,
        nextStart: note.start,
        nextPitch: note.pitch,
      };
    }
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    const el = elRef.current;
    if (!d || !el) return;
    const dx = e.clientX - d.startX;
    if (d.kind === 'resize') {
      d.nextLen = Math.max(snap, Math.round((d.baseLen + dx / BEAT_W) / snap) * snap);
      el.style.width = `${Math.max(8, d.nextLen * BEAT_W)}px`;
      return;
    }
    const dy = e.clientY - d.startY;
    if (d.kind === 'move-single') {
      d.nextStart = Math.max(0, Math.round((d.baseStart + dx / BEAT_W) / snap) * snap);
      const rawPitch = Math.max(LO, Math.min(HI, d.basePitch - Math.round(dy / ROW_H)));
      d.nextPitch = snapPitchToScale(rawPitch, root, scale);
      el.style.left = `${d.nextStart * BEAT_W}px`;
      el.style.top = `${(HI - d.nextPitch) * ROW_H}px`;
      return;
    }
    // multi-drag: same delta applied to every tracked note (no scale snap)
    const dStart = Math.round(dx / BEAT_W / snap) * snap;
    const dPitchRows = Math.round(dy / ROW_H);
    d.nextDeltaStart = dStart;
    d.nextDeltaPitchRows = dPitchRows;
    for (const t of d.tracked) {
      const newStart = Math.max(0, t.baseStart + dStart);
      const newPitch = Math.max(LO, Math.min(HI, t.basePitch - dPitchRows));
      t.el.style.left = `${newStart * BEAT_W}px`;
      t.el.style.top = `${(HI - newPitch) * ROW_H}px`;
    }
  }
  function up(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    try {
      elRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* may already be released */
    }
    if (d.kind === 'resize') {
      if (d.nextLen !== d.baseLen) updateNote(trackId, clipId, note.id, { length: d.nextLen });
    } else if (d.kind === 'move-single') {
      if (d.nextStart !== d.baseStart || d.nextPitch !== d.basePitch) {
        updateNote(trackId, clipId, note.id, { start: d.nextStart, pitch: d.nextPitch });
      }
    } else if (d.kind === 'move-multi') {
      if (d.nextDeltaStart !== 0 || d.nextDeltaPitchRows !== 0) {
        moveNotesBy(
          trackId,
          clipId,
          d.tracked.map((t) => t.id),
          d.nextDeltaStart,
          -d.nextDeltaPitchRows,
        );
      }
    }
  }

  return (
    <div
      ref={elRef}
      data-note-id={note.id}
      onPointerDown={(e) => down(e, false)}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'absolute',
        left: note.start * BEAT_W,
        top: (HI - note.pitch) * ROW_H,
        width: Math.max(8, note.length * BEAT_W),
        height: ROW_H - 2,
        background: `linear-gradient(180deg, ${color}cc, ${color}77)`,
        border: selected ? '1px solid var(--hud-green)' : '1px solid #fff',
        boxShadow: selected
          ? '0 0 8px var(--hud-green), inset 0 0 0 1px rgba(120,255,140,0.4)'
          : '0 0 6px rgba(255,255,255,0.4)',
        cursor: 'move',
        borderRadius: 1,
        touchAction: 'none',
        contain: 'layout style paint',
      }}
    >
      <div
        onPointerDown={(e) => down(e, true)}
        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize', touchAction: 'none' }}
      />
    </div>
  );
});

/**
 * VelocityLane — a strip under the grid with a vertical bar per note,
 * showing its velocity. Drag a bar up or down to set it (or many bars
 * when the dragged note is part of the current selection — the same
 * lockstep gesture as multi-drag in the grid). Horizontal scroll mirrors
 * the grid container's so the bars stay aligned with their notes.
 */
const VelocityLane = memo(function VelocityLane({
  trackId,
  clipId,
  notes,
  beats,
  beatW,
  color,
  selectedIds,
}: {
  trackId: string;
  clipId: string;
  notes: Note[];
  beats: number;
  beatW: number;
  color: string;
  selectedIds: string[];
}) {
  const setNoteVelocities = useStore((s) => s.setNoteVelocities);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<
    | null
    | {
        ids: string[];
        startY: number;
        /** Base velocity per id (parallel array) — applied with the same delta to preserve relative dynamics. */
        baseVelocities: Record<string, number>;
        lastDelta: number;
        pointerId: number;
      }
  >(null);

  function down(e: React.PointerEvent, noteId: string, velocity: number) {
    e.stopPropagation();
    const ids = selectedIds.includes(noteId) && selectedIds.length > 1 ? [...selectedIds] : [noteId];
    const baseVelocities: Record<string, number> = {};
    for (const id of ids) baseVelocities[id] = notes.find((n) => n.id === id)?.velocity ?? velocity;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { ids, startY: e.clientY, baseVelocities, lastDelta: 0, pointerId: e.pointerId };
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dy = e.clientY - d.startY;
    // lane-height of drag spans the full 0..1 range
    const dvel = -dy / Math.max(1, VEL_LANE_H - 16);
    if (Math.abs(dvel - d.lastDelta) < 0.005) return;
    d.lastDelta = dvel;
    // apply the SAME delta to every tracked note so a multi-note drag
    // preserves their relative dynamics
    const valuesById: Record<string, number> = {};
    for (const id of d.ids) valuesById[id] = d.baseVelocities[id] + dvel;
    setNoteVelocities(trackId, clipId, valuesById);
  }
  function up(e: React.PointerEvent) {
    if (!drag.current) return;
    drag.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* may already be released */
    }
  }

  return (
    <div
      ref={ref}
      style={{
        height: VEL_LANE_H,
        display: 'flex',
        borderTop: '1px solid rgba(255,106,0,0.4)',
        background: 'rgba(0,0,0,0.65)',
        flexShrink: 0,
        position: 'sticky',
        bottom: 0,
        zIndex: 5,
        contain: 'layout style',
      }}
    >
      <div
        style={{
          width: KEYS_W,
          flexShrink: 0,
          borderRight: '1px solid rgba(255,106,0,0.5)',
          display: 'flex',
          alignItems: 'flex-end',
          padding: '4px 6px',
          background: 'rgba(0,0,0,0.85)',
          position: 'sticky',
          left: 0,
          zIndex: 6,
        }}
      >
        <span className="hud-label" style={{ fontSize: 8 }}>VEL</span>
      </div>
      <div
        data-velocity-lane
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        style={{
          position: 'relative',
          width: beats * beatW,
          flexShrink: 0,
          touchAction: 'none',
        }}
      >
        {notes.map((n) => {
          const isSel = selectedIds.includes(n.id);
          const h = Math.max(2, n.velocity * (VEL_LANE_H - 16));
          return (
            <div
              key={n.id}
              onPointerDown={(e) => down(e, n.id, n.velocity)}
              style={{
                position: 'absolute',
                left: n.start * beatW,
                bottom: 6,
                width: Math.max(3, Math.min(beatW * 0.4, 10)),
                height: h,
                background: isSel ? 'var(--hud-green)' : color,
                opacity: isSel ? 0.95 : 0.7,
                cursor: 'ns-resize',
                touchAction: 'none',
                borderTop: '1px solid #fff',
                boxShadow: isSel ? '0 0 6px var(--hud-green)' : undefined,
              }}
              title={`vel ${(n.velocity * 100).toFixed(0)}%`}
            />
          );
        })}
      </div>
    </div>
  );
});

const PianoRollPlayhead = memo(function PianoRollPlayhead({ clipStart }: { clipStart: number }) {
  const BEAT_W = useBeatWidth();
  const positionBeats = usePlayhead();
  const x = (positionBeats - clipStart) * BEAT_W;
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: 2,
        height: ROWS * ROW_H,
        background: 'var(--hud-green)',
        boxShadow: '0 0 6px var(--hud-green)',
        pointerEvents: 'none',
        transform: `translateX(${x}px)`,
        willChange: 'transform',
      }}
    />
  );
});
