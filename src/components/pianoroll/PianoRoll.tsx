import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import type { Note } from '../../audio/types';
import { audioEngine } from '../../audio/engine';
import { HexFrame } from '../hud/HexFrame';
import { usePlayhead } from '../../state/transportClock';
import { useActiveTrack } from '../../hooks/useActiveTrack';
import { usePinchZoom } from '../../hooks/usePinchZoom';
import { EditorTip } from '../hud/EditorTip';
import { useLayoutMode } from '../../hooks/useLayoutMode';

const BASE_BEAT_W = 56;
const ROW_H = 16;
const LO = 36; // C2
const HI = 84; // C6
const ROWS = HI - LO + 1;
const VEL_LANE_H = 60;
/** Pixels of drag for the full velocity range, independent of lane height. */
const VEL_DRAG_TRAVEL = 90;
const KEYS_W = 56;
/** White-key letter by pitch-class, for the keyboard ruler labels. */
const WHITE_NOTE: Record<number, string> = { 0: 'C', 2: 'D', 4: 'E', 5: 'F', 7: 'G', 9: 'A', 11: 'B' };
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

  const mode = useLayoutMode();
  /** One 44px header row and a folded-away velocity lane: landscape has 230px
   *  of content region and this header was taking 111 of it. */
  const land = mode === 'phone-landscape';
  const [tool, setTool] = useState<'draw' | 'select' | 'erase'>('draw');
  const [showMore, setShowMore] = useState(false);
  const [showVel, setShowVel] = useState(false);
  const [snap, setSnap] = useState<0.25 | 0.5 | 1>(0.25);
  const [scaleRoot, setScaleRoot] = useState(0);
  const [scaleName, setScaleName] = useState<ScaleName>('chromatic');

  // Every hook must run on every render — these used to sit below the
  // early returns, which crashed React ("rendered fewer hooks") the moment
  // the editor swapped to an empty state: deleting the open clip, undoing
  // its creation, or switching to a synth track with no MIDI clips.
  const hasEditor = !!activeTrack && !!activeClip;
  const [zoom, setZoom] = useState(1);
  /** Once the user pinches or taps zoom, stop re-fitting under them. */
  const zoomTouched = useRef(false);
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
    // re-attach when the editor branch (and so the grid element) appears
  }, [hasEditor]);
  usePinchZoom(gridRef, setZoom, 0.25, 4, hasEditor);

  // When a clip opens, scroll the grid so its notes are centred — the bass
  // range sits near the bottom of C2–C6, so opening at scrollTop 0 showed an
  // empty grid and you had to hunt for your notes.
  useEffect(() => {
    const el = gridRef.current;
    if (!el || !activeClip) return;
    const ns = activeClip.notes;
    const center =
      ns.length > 0
        ? (Math.min(...ns.map((n) => n.pitch)) + Math.max(...ns.map((n) => n.pitch))) / 2
        : 60; // middle C
    el.scrollTop = Math.max(0, (HI - center) * ROW_H - el.clientHeight / 2);
    // Fit the clip to the width we have. The grid is sized `beats * BEAT_W`,
    // so a 4-beat clip drew 224px of a 923px screen and left 70% of the
    // display as dead black — landscape's one advantage over portrait, thrown
    // away. Desktop keeps 1x, where the established behaviour is fine.
    if (mode !== 'desktop' && !zoomTouched.current) {
      const avail = el.clientWidth - KEYS_W;
      const want = avail / (Math.max(4, activeClip.length) * BASE_BEAT_W);
      if (Number.isFinite(want) && want > 0) setZoom(Math.max(0.25, Math.min(4, want)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClip?.id, mode]);

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

  if (!activeTrack) {
    return (
      <div style={{ padding: 16 }}>
        <HexFrame title="No instrument track">Add a synth track from the Song tab, then come back here to shape its sound.</HexFrame>
      </div>
    );
  }
  if (!activeClip) {
    return (
      <div style={{ padding: 16 }}>
        <HexFrame title={activeTrack.name}>
          <p>This track has no notes yet.</p>
          <button className="hud-btn" onClick={() => addClip(activeTrack.id, 0, 4)}>
            Create a clip
          </button>
        </HexFrame>
      </div>
    );
  }

  const beats = Math.max(4, activeClip.length);
  const BEAT_W = BASE_BEAT_W * zoom;

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
          padding: land ? '0 8px' : 8,
          display: 'flex',
          flexDirection: land ? 'row' : 'column',
          alignItems: 'center',
          gap: 6,
          height: land ? 44 : undefined,
          boxSizing: 'border-box',
          flexWrap: 'nowrap',
          // inset shadow rather than a border: the divider costs zero layout
          // height, which matters when the whole row is 44px
          boxShadow: 'inset 0 -1px 0 rgba(255,106,0,0.4)',
          overflowX: land ? 'auto' : undefined,
          scrollbarWidth: 'none',
          flex: '0 0 auto',
        }}
      >
        {/* Row 1: what am I editing. Row 2: what does tapping do. Everything
            else folds away on a phone, where the four-row header was eating
            420px of a 923px screen before a single note was visible. */}
        <div style={land ? { display: 'contents' } : { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* the editor tab already says "Notes" */}
        {!land && <span className="hud-label">Notes</span>}
        <select className="display" style={{ maxWidth: 120 }} value={activeTrack.id} onChange={(e) => selectTrack(e.target.value)} aria-label="Track to edit">
          {synthTracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select className="display" style={{ maxWidth: 120 }} value={activeClip.id} onChange={(e) => selectClip(e.target.value)} aria-label="Clip to edit">
          {midiClips.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name ?? c.id}
            </option>
          ))}
        </select>
        <button
          className="hud-btn"
          onClick={() => addClip(activeTrack.id, activeClip.start + activeClip.length, activeClip.length)}
          title="Add another clip to this track, right after this one"
        >
          + Clip
        </button>
        {!land && <div style={{ flex: 1 }} />}
        <button
          className="hud-btn hud-btn--ghost hud-btn--tight"
          onClick={() => setShowMore((v) => !v)}
          aria-expanded={showMore}
          title="Snap, scale, quantize and humanize"
        >
          {showMore ? 'Fewer options' : 'More'}
        </button>
        </div>

        <div style={land ? { display: 'contents' } : { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Draws / Selects / Erases are self-describing verbs */}
        {!land && <span className="hud-label" style={{ minWidth: 74 }}>Tapping</span>}
        <button
          className={`hud-btn ${tool === 'draw' ? 'is-active' : ''}`}
          onClick={() => setTool('draw')}
          aria-pressed={tool === 'draw'}
          title="Tap or drag on the grid to add a note"
        >
          Draws
        </button>
        <button
          className={`hud-btn hud-btn--green ${tool === 'select' ? 'is-active' : ''}`}
          onClick={() => setTool('select')}
          aria-pressed={tool === 'select'}
          title="Drag a box round the notes you want to work on together"
        >
          Selects
        </button>
        <button
          className={`hud-btn hud-btn--rec ${tool === 'erase' ? 'is-active' : ''}`}
          onClick={() => setTool('erase')}
          aria-pressed={tool === 'erase'}
          title="Tap a note to remove it"
        >
          Erases
        </button>
        {selectedNoteIds.length > 0 && (
          <button
            className="hud-btn hud-btn--ghost hud-btn--tight"
            onClick={clearNoteSelection}
            title="Clear the selection"
          >
            Deselect ({selectedNoteIds.length})
          </button>
        )}
        {land && (
          <>
          <button
            className="hud-btn hud-btn--ghost hud-btn--tight"
            onClick={() => { zoomTouched.current = true; setZoom((z) => Math.max(0.25, z / 1.25)); }}
            aria-label="Zoom out"
            title={`Zoom out (now ${zoom.toFixed(2)}x)`}
          >
            &minus;
          </button>
          <button
            className="hud-btn hud-btn--ghost hud-btn--tight"
            onClick={() => { zoomTouched.current = true; setZoom((z) => Math.min(4, z * 1.25)); }}
            aria-label="Zoom in"
            title={`Zoom in (now ${zoom.toFixed(2)}x)`}
          >
            +
          </button>
          <button
            className={`hud-btn hud-btn--ghost hud-btn--tight ${showVel ? 'is-active' : ''}`}
            aria-pressed={showVel}
            onClick={() => setShowVel((v) => !v)}
            title="Show the bars that set how hard each note hits"
          >
            Loud
          </button>
          </>
        )}
        </div>

        {showMore && (
        <div
          style={
            land
              ? {
                  // An in-flow third row left the note grid 9px tall, so using
                  // any of these controls destroyed the thing you were editing.
                  position: 'absolute',
                  top: 44,
                  left: 0,
                  right: 0,
                  zIndex: 8,
                  background: '#0a0705',
                  border: '1px solid rgba(255,106,0,0.4)',
                  padding: 6,
                  display: 'flex',
                  gap: 6,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }
              : { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }
          }
        >
        <span className="hud-label" title="New and quantized notes land on this grid">Grid</span>
        <select className="display" value={snap} onChange={(e) => setSnap(parseFloat(e.target.value) as any)} aria-label="Note grid">
          <option value={1}>1/4</option>
          <option value={0.5}>1/8</option>
          <option value={0.25}>1/16</option>
        </select>
        <span className="hud-label" title="New notes are pulled to the nearest note of this scale">Key</span>
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
              ? `Pull the ${selectedNoteIds.length} selected note${selectedNoteIds.length === 1 ? '' : 's'} onto the grid`
              : `Pull every note onto the 1/${1 / snap === 4 ? 4 : 1 / snap === 8 ? 8 : 16} grid`
          }
        >
          Snap to grid{selectedNoteIds.length > 0 ? ' (selected)' : ''}
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
              ? `Nudge the ${selectedNoteIds.length} selected note${selectedNoteIds.length === 1 ? '' : 's'} slightly off the grid`
              : 'Nudge every note slightly off the grid so it sounds played rather than programmed'
          }
        >
          Loosen{selectedNoteIds.length > 0 ? ' (selected)' : ''}
        </button>
        </div>
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
            // Without this the flex row shrinks the grid below its true width,
            // so notes past the fold spill out with overflow:visible and the
            // scroll container never grows to reach them.
            flexShrink: 0,
            height: ROWS * ROW_H,
            background: '#050505',
            backgroundImage: `
              linear-gradient(rgba(255,106,0,0.06) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,106,0,0.18) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,106,0,0.06) 1px, transparent 1px)
            `,
            backgroundSize: `100% ${ROW_H}px, ${BEAT_W}px 100%, ${BEAT_W / 4}px 100%`,
            contain: 'layout style',
            // pan-y, not none: with `none` a vertical drag on the grid created a
            // note instead of scrolling, and 45 of the 49 pitch rows are
            // off-screen — so the content was unreachable AND every attempt to
            // reach it wrote junk into the clip. Marquee select still needs the
            // browser to keep its hands off, hence the tool check.
            touchAction: tool === 'select' ? 'none' : 'pan-y',
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
          {/* clip-end marker so the grid reads as "this is the clip" rather
              than a small box floating in a black void */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              right: 0,
              width: 2,
              background: 'var(--hud-orange)',
              boxShadow: '0 0 6px rgba(255,106,0,0.5)',
              pointerEvents: 'none',
            }}
          />
        </div>
        </div>
        {/* The lane is sticky inside the grid's own scroller, so in landscape
            it was permanently eating 60 of the 119 visible px — more than the
            note grid itself. Behind the "Loud" toggle it costs nothing until
            you want it. */}
        {(!land || showVel) && (
          <VelocityLane
            trackId={activeTrack.id}
            clipId={activeClip.id}
            notes={activeClip.notes}
            beats={beats}
            beatW={BEAT_W}
            color={activeTrack.color}
            selectedIds={selectedNoteIds}
            laneH={land ? 44 : VEL_LANE_H}
          />
        )}
      </div>
      <EditorTip>
        Draws: drag on empty grid and the note is as long as you drag. Selects: drag a box round several notes, then
        move them together. Erases: tap a note to remove it. Drag a note's right edge to change its length, and drag
        the bars under the grid to change how hard each note hits. ⌘ or Ctrl with the wheel zooms.
      </EditorTip>
      {/* Measured at 768-911 x 214-264 over a grid strip ending at 276 — the
          floater covered ~80% of the visible grid height on the right. */}
      {!land && <ZoomFloater zoom={zoom} setZoom={setZoom} />}
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
        // clear of the velocity lane — at bottom: 28 this sat on top of the
        // bars you drag to change how hard a note hits
        bottom: VEL_LANE_H + 12,
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
        aria-label="Zoom out"
        style={{ padding: '2px 6px', fontSize: 13 }}
      >
        −
      </button>
      <button
        className="hud-btn hud-btn--icon"
        title="Reset zoom to 1×"
        onClick={() => setZoom(() => 1)}
        style={{ minWidth: 38, padding: '2px 4px', fontSize: 12 }}
      >
        {zoom.toFixed(2)}×
      </button>
      <button
        className="hud-btn hud-btn--icon"
        title="Zoom in"
        onClick={() => setZoom((z) => Math.min(4, z * 1.25))}
        aria-label="Zoom in"
        style={{ padding: '2px 6px', fontSize: 13 }}
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
        width: KEYS_W,
        flexShrink: 0,
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
        const letter = WHITE_NOTE[pitch % 12];
        const oct = Math.floor(pitch / 12) - 1;
        return (
          <div
            key={i}
            onPointerDown={() => audioEngine.trigger(trackId, pitch, 0.9, '16n')}
            title={`${letter ?? WHITE_NOTE[(pitch % 12) - 1] + '#'}${oct} — tap to preview`}
            style={{
              height: ROW_H,
              // piano look: black keys near-black, white keys a lit brown so
              // the two read apart at a glance
              background: isBlack ? '#070504' : '#2a1a12',
              // brighter octave divider on every C
              borderBottom: isC ? '1px solid rgba(255,170,0,0.55)' : '1px solid rgba(255,106,0,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              paddingRight: 5,
              fontSize: 12,
              fontWeight: isC ? 700 : 400,
              // label every white key, not just C — far easier to orient
              color: isC ? 'var(--hud-amber)' : isBlack ? 'transparent' : 'rgba(255,179,71,0.8)',
              cursor: 'pointer',
              fontFamily: 'var(--font-data)',
              userSelect: 'none',
            }}
          >
            {isC ? `C${oct}` : (letter ?? '')}
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
    // multi-drag: same delta applied to every tracked note (no scale snap).
    // Clamp the SHARED delta so the whole selection stays inside beat 0 and
    // the visible LO..HI range — per-note clamping here while committing the
    // raw delta made released notes jump past the preview (and land outside
    // the editable pitch range, where they can't be grabbed again).
    let dStart = Math.round(dx / BEAT_W / snap) * snap;
    let dPitchRows = Math.round(dy / ROW_H);
    const minStart = Math.min(...d.tracked.map((t) => t.baseStart));
    const minPitch = Math.min(...d.tracked.map((t) => t.basePitch));
    const maxPitch = Math.max(...d.tracked.map((t) => t.basePitch));
    dStart = Math.max(dStart, -minStart);
    dPitchRows = Math.min(dPitchRows, minPitch - LO);
    dPitchRows = Math.max(dPitchRows, maxPitch - HI);
    d.nextDeltaStart = dStart;
    d.nextDeltaPitchRows = dPitchRows;
    for (const t of d.tracked) {
      t.el.style.left = `${(t.baseStart + dStart) * BEAT_W}px`;
      t.el.style.top = `${(HI - (t.basePitch - dPitchRows)) * ROW_H}px`;
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
  laneH = VEL_LANE_H,
}: {
  trackId: string;
  clipId: string;
  notes: Note[];
  beats: number;
  beatW: number;
  color: string;
  selectedIds: string[];
  laneH?: number;
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
    // A fixed travel distance, not the rendered lane height: at laneH 44 a
    // height-derived divisor made the full 0..1 range a 28px flick.
    const dvel = -dy / VEL_DRAG_TRAVEL;
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
        height: laneH,
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
        <span className="hud-label" style={{ fontSize: 11 }} title="How hard each note is played">Loud</span>
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
          const h = Math.max(2, n.velocity * (laneH - 16));
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
