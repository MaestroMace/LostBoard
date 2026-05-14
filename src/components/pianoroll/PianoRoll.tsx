import { useMemo, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import type { Note } from '../../audio/types';
import { audioEngine } from '../../audio/engine';
import { HexFrame } from '../hud/HexFrame';

const BEAT_W = 56;
const ROW_H = 16;
const LO = 36; // C2
const HI = 84; // C6

export function PianoRoll() {
  const project = useStore((s) => s.project);
  const selectedTrackId = useStore((s) => s.selectedTrackId);
  const selectTrack = useStore((s) => s.selectTrack);
  const selectedClipId = useStore((s) => s.selectedClipId);
  const selectClip = useStore((s) => s.selectClip);
  const addNote = useStore((s) => s.addNote);
  const removeNote = useStore((s) => s.removeNote);
  const updateNote = useStore((s) => s.updateNote);
  const addClip = useStore((s) => s.addClip);
  const positionBeats = useStore((s) => s.positionBeats);

  const synthTracks = project.tracks.filter((t) => t.kind === 'synth');
  const activeTrack = synthTracks.find((t) => t.id === selectedTrackId) ?? synthTracks[0];
  const midiClips = useMemo(
    () => (activeTrack ? activeTrack.clips.filter((c) => c.kind === 'midi') : []),
    [activeTrack],
  );
  const activeClip = (midiClips.find((c) => c.id === selectedClipId) ?? midiClips[0]) as
    | Extract<typeof midiClips[number], { kind: 'midi' }>
    | undefined;

  const [tool, setTool] = useState<'draw' | 'select'>('draw');
  const [snap, setSnap] = useState<0.25 | 0.5 | 1>(0.25);

  const scrollRef = useRef<HTMLDivElement>(null);

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
          <button className="nerv-btn" onClick={() => addClip(activeTrack.id, 0, 4)}>CREATE MIDI CLIP</button>
        </HexFrame>
      </div>
    );
  }

  const beats = Math.max(4, activeClip.length);
  const rows = HI - LO + 1;

  function gridDown(e: React.PointerEvent) {
    if (tool !== 'draw') return;
    if (!scrollRef.current) return;
    if (!activeTrack || !activeClip) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const beat = Math.floor((x / BEAT_W) / snap) * snap;
    const pitch = HI - Math.floor(y / ROW_H);
    if (beat < 0 || beat >= beats) return;
    if (pitch < LO || pitch > HI) return;
    const n: Omit<Note, 'id'> = {
      pitch,
      start: beat,
      length: snap,
      velocity: 0.9,
    };
    addNote(activeTrack.id, activeClip.id, n);
    audioEngine.trigger(activeTrack.id, pitch, 0.9, '16n');
  }

  function noteDown(e: React.PointerEvent, n: Note) {
    e.stopPropagation();
    if (!activeTrack || !activeClip) return;
    if (e.shiftKey || e.button === 2) {
      removeNote(activeTrack.id, activeClip.id, n.id);
      return;
    }
    const startX = e.clientX;
    const startY = e.clientY;
    const baseStart = n.start;
    const basePitch = n.pitch;
    const baseLen = n.length;
    const resizing = (e.currentTarget as HTMLElement).dataset.resize === '1';
    function move(ev: PointerEvent) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const at = activeTrack;
      const ac = activeClip;
      if (!at || !ac) return;
      if (resizing) {
        const newLen = Math.max(snap, Math.round((baseLen + dx / BEAT_W) / snap) * snap);
        updateNote(at.id, ac.id, n.id, { length: newLen });
      } else {
        const newStart = Math.max(0, Math.round((baseStart + dx / BEAT_W) / snap) * snap);
        const newPitch = Math.max(LO, Math.min(HI, basePitch - Math.round(dy / ROW_H)));
        updateNote(at.id, ac.id, n.id, { start: newStart, pitch: newPitch });
      }
    }
    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const localBeat = positionBeats - activeClip.start;
  const playheadX = localBeat * BEAT_W;

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid rgba(255,106,0,0.4)' }}>
        <span className="hud-label">PIANO ROLL // M.A.G.I. MELCHIOR</span>
        <select
          className="display"
          value={activeTrack.id}
          onChange={(e) => selectTrack(e.target.value)}
        >
          {synthTracks.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <select className="display" value={activeClip.id} onChange={(e) => selectClip(e.target.value)}>
          {midiClips.map((c) => (
            <option key={c.id} value={c.id}>{c.name ?? c.id}</option>
          ))}
        </select>
        <button className="nerv-btn" onClick={() => addClip(activeTrack.id, activeClip.start + activeClip.length, activeClip.length)}>+ CLIP</button>
        <div style={{ flex: 1 }} />
        <button className={`nerv-btn ${tool === 'draw' ? 'is-active' : ''}`} onClick={() => setTool('draw')}>DRAW</button>
        <button className={`nerv-btn ${tool === 'select' ? 'is-active' : ''}`} onClick={() => setTool('select')}>SELECT</button>
        <span className="hud-readout">SNAP</span>
        <select className="display" value={snap} onChange={(e) => setSnap(parseFloat(e.target.value) as any)}>
          <option value={1}>1/4</option>
          <option value={0.5}>1/8</option>
          <option value={0.25}>1/16</option>
        </select>
      </div>
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', position: 'relative', display: 'flex' }}>
        {/* keys */}
        <div style={{ width: 48, position: 'sticky', left: 0, background: 'rgba(0,0,0,0.85)', zIndex: 4, borderRight: '1px solid rgba(255,106,0,0.5)' }}>
          {Array.from({ length: rows }).map((_, i) => {
            const pitch = HI - i;
            const isBlack = [1, 3, 6, 8, 10].includes(pitch % 12);
            const isC = pitch % 12 === 0;
            return (
              <div
                key={i}
                onPointerDown={() => audioEngine.trigger(activeTrack.id, pitch, 0.9, '16n')}
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
        {/* grid */}
        <div
          onPointerDown={gridDown}
          style={{
            position: 'relative',
            width: beats * BEAT_W,
            height: rows * ROW_H,
            background: '#050505',
            backgroundImage: `
              linear-gradient(rgba(255,106,0,0.06) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,106,0,0.18) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,106,0,0.06) 1px, transparent 1px)
            `,
            backgroundSize: `100% ${ROW_H}px, ${BEAT_W}px 100%, ${BEAT_W / 4}px 100%`,
          }}
        >
          {/* black-key row shading */}
          {Array.from({ length: rows }).map((_, i) => {
            const pitch = HI - i;
            const isBlack = [1, 3, 6, 8, 10].includes(pitch % 12);
            if (!isBlack) return null;
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
          {activeClip.notes.map((n) => {
            const x = n.start * BEAT_W;
            const y = (HI - n.pitch) * ROW_H;
            const w = n.length * BEAT_W;
            return (
              <div
                key={n.id}
                onPointerDown={(e) => noteDown(e, n)}
                style={{
                  position: 'absolute',
                  left: x,
                  top: y,
                  width: Math.max(8, w),
                  height: ROW_H - 2,
                  background: `linear-gradient(180deg, ${activeTrack.color}cc, ${activeTrack.color}77)`,
                  border: '1px solid #fff',
                  boxShadow: '0 0 6px rgba(255,255,255,0.4)',
                  cursor: 'move',
                  borderRadius: 1,
                }}
              >
                <div
                  data-resize="1"
                  onPointerDown={(e) => noteDown(e, n)}
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: 0,
                    bottom: 0,
                    width: 6,
                    cursor: 'ew-resize',
                  }}
                />
              </div>
            );
          })}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: playheadX,
              width: 2,
              height: rows * ROW_H,
              background: 'var(--nerv-green)',
              boxShadow: '0 0 6px var(--nerv-green)',
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>
      <div style={{ padding: 6, fontSize: 9, color: 'rgba(255,106,0,0.6)', borderTop: '1px solid rgba(255,106,0,0.3)' }}>
        TIP: click empty grid to draw — drag notes to move — shift-click to delete — drag right-edge to resize
      </div>
    </div>
  );
}
