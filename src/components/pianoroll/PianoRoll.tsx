import { memo, useMemo, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import type { Note } from '../../audio/types';
import { audioEngine } from '../../audio/engine';
import { HexFrame } from '../hud/HexFrame';
import { usePlayhead } from '../../state/transportClock';

const BEAT_W = 56;
const ROW_H = 16;
const LO = 36; // C2
const HI = 84; // C6
const ROWS = HI - LO + 1;

export function PianoRoll() {
  const tracks = useStore((s) => s.project.tracks);
  const selectedTrackId = useStore((s) => s.selectedTrackId);
  const selectTrack = useStore((s) => s.selectTrack);
  const selectedClipId = useStore((s) => s.selectedClipId);
  const selectClip = useStore((s) => s.selectClip);
  const addNote = useStore((s) => s.addNote);
  const addClip = useStore((s) => s.addClip);

  const synthTracks = useMemo(() => tracks.filter((t) => t.kind === 'synth'), [tracks]);
  const activeTrack = synthTracks.find((t) => t.id === selectedTrackId) ?? synthTracks[0];
  const midiClips = useMemo(
    () => (activeTrack ? activeTrack.clips.filter((c) => c.kind === 'midi') : []),
    [activeTrack],
  );
  const activeClip = (midiClips.find((c) => c.id === selectedClipId) ?? midiClips[0]) as
    | Extract<(typeof midiClips)[number], { kind: 'midi' }>
    | undefined;

  const [tool, setTool] = useState<'draw' | 'select'>('draw');
  const [snap, setSnap] = useState<0.25 | 0.5 | 1>(0.25);

  if (!activeTrack) {
    return (
      <div style={{ padding: 16 }}>
        <HexFrame title="N/A">No synth track. Add one to edit MIDI.</HexFrame>
      </div>
    );
  }
  if (!activeClip) {
    return (
      <div style={{ padding: 16 }}>
        <HexFrame title={activeTrack.name}>
          <p>This track has no MIDI clip.</p>
          <button className="nerv-btn" onClick={() => addClip(activeTrack.id, 0, 4)}>
            CREATE MIDI CLIP
          </button>
        </HexFrame>
      </div>
    );
  }

  const beats = Math.max(4, activeClip.length);

  function gridDown(e: React.PointerEvent) {
    if (tool !== 'draw' || !activeTrack || !activeClip) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const beat = Math.floor((e.clientX - r.left) / BEAT_W / snap) * snap;
    const pitch = HI - Math.floor((e.clientY - r.top) / ROW_H);
    if (beat < 0 || beat >= beats || pitch < LO || pitch > HI) return;
    addNote(activeTrack.id, activeClip.id, { pitch, start: beat, length: snap, velocity: 0.9 });
    audioEngine.trigger(activeTrack.id, pitch, 0.9, '16n');
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', contain: 'layout style' }}>
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
        <span className="hud-label">PIANO ROLL // M.A.G.I. MELCHIOR</span>
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
          className="nerv-btn"
          onClick={() => addClip(activeTrack.id, activeClip.start + activeClip.length, activeClip.length)}
        >
          + CLIP
        </button>
        <div style={{ flex: 1 }} />
        <button className={`nerv-btn ${tool === 'draw' ? 'is-active' : ''}`} onClick={() => setTool('draw')}>
          DRAW
        </button>
        <button className={`nerv-btn ${tool === 'select' ? 'is-active' : ''}`} onClick={() => setTool('select')}>
          SELECT
        </button>
        <span className="hud-readout">SNAP</span>
        <select className="display" value={snap} onChange={(e) => setSnap(parseFloat(e.target.value) as any)}>
          <option value={1}>1/4</option>
          <option value={0.5}>1/8</option>
          <option value={0.25}>1/16</option>
        </select>
      </div>
      <div style={{ flex: 1, overflow: 'auto', position: 'relative', display: 'flex', contain: 'layout style' }}>
        <Keys trackId={activeTrack.id} />
        <div
          onPointerDown={gridDown}
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
          }}
        >
          <BlackKeyShading />
          {activeClip.notes.map((n) => (
            <NoteEl
              key={n.id}
              note={n}
              trackId={activeTrack.id}
              clipId={activeClip.id}
              color={activeTrack.color}
              snap={snap}
            />
          ))}
          <PianoRollPlayhead clipStart={activeClip.start} />
        </div>
      </div>
      <div
        style={{
          padding: 6,
          fontSize: 9,
          color: 'rgba(255,106,0,0.6)',
          borderTop: '1px solid rgba(255,106,0,0.3)',
        }}
      >
        TIP: click empty grid to draw — drag notes to move — shift-click to delete — drag right-edge to resize
      </div>
    </div>
  );
}

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
              color: isC ? 'var(--nerv-amber)' : 'rgba(255,106,0,0.5)',
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

/** Memoized note — drag/resize via direct DOM mutation, commit on release. */
const NoteEl = memo(function NoteEl({
  note,
  trackId,
  clipId,
  color,
  snap,
}: {
  note: Note;
  trackId: string;
  clipId: string;
  color: string;
  snap: number;
}) {
  const updateNote = useStore((s) => s.updateNote);
  const removeNote = useStore((s) => s.removeNote);
  const elRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    resizing: boolean;
    startX: number;
    startY: number;
    baseStart: number;
    basePitch: number;
    baseLen: number;
    nextStart: number;
    nextPitch: number;
    nextLen: number;
  } | null>(null);

  function down(e: React.PointerEvent, resizing: boolean) {
    e.stopPropagation();
    if (e.shiftKey || e.button === 2) {
      removeNote(trackId, clipId, note.id);
      return;
    }
    elRef.current?.setPointerCapture(e.pointerId);
    drag.current = {
      resizing,
      startX: e.clientX,
      startY: e.clientY,
      baseStart: note.start,
      basePitch: note.pitch,
      baseLen: note.length,
      nextStart: note.start,
      nextPitch: note.pitch,
      nextLen: note.length,
    };
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    const el = elRef.current;
    if (!d || !el) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (d.resizing) {
      d.nextLen = Math.max(snap, Math.round((d.baseLen + dx / BEAT_W) / snap) * snap);
      el.style.width = `${Math.max(8, d.nextLen * BEAT_W)}px`;
    } else {
      d.nextStart = Math.max(0, Math.round((d.baseStart + dx / BEAT_W) / snap) * snap);
      d.nextPitch = Math.max(LO, Math.min(HI, d.basePitch - Math.round(dy / ROW_H)));
      el.style.left = `${d.nextStart * BEAT_W}px`;
      el.style.top = `${(HI - d.nextPitch) * ROW_H}px`;
    }
  }
  function up(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    elRef.current?.releasePointerCapture(e.pointerId);
    if (d.resizing) {
      if (d.nextLen !== d.baseLen) updateNote(trackId, clipId, note.id, { length: d.nextLen });
    } else if (d.nextStart !== d.baseStart || d.nextPitch !== d.basePitch) {
      updateNote(trackId, clipId, note.id, { start: d.nextStart, pitch: d.nextPitch });
    }
  }

  return (
    <div
      ref={elRef}
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
        border: '1px solid #fff',
        boxShadow: '0 0 6px rgba(255,255,255,0.4)',
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

const PianoRollPlayhead = memo(function PianoRollPlayhead({ clipStart }: { clipStart: number }) {
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
        background: 'var(--nerv-green)',
        boxShadow: '0 0 6px var(--nerv-green)',
        pointerEvents: 'none',
        transform: `translateX(${x}px)`,
        willChange: 'transform',
      }}
    />
  );
});
