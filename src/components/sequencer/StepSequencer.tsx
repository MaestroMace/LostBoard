import { memo, useEffect, useMemo, useRef } from 'react';
import { useStore } from '../../state/store';
import { DRUM_LABELS, DRUM_PADS, type DrumPad, type Step } from '../../audio/types';
import { audioEngine } from '../../audio/engine';
import { HexFrame } from '../hud/HexFrame';
import { usePlayhead } from '../../state/transportClock';
import { useActiveTrack } from '../../hooks/useActiveTrack';
import { EditorTip } from '../hud/EditorTip';

function cellBg(on: boolean, vel: number) {
  return on
    ? `linear-gradient(180deg, rgba(255,106,0,${0.4 + vel * 0.5}), rgba(255,106,0,${0.15 + vel * 0.3}))`
    : 'rgba(0,0,0,0.55)';
}

export function StepSequencer() {
  const selectTrack = useStore((s) => s.selectTrack);
  const selectedClipId = useStore((s) => s.selectedClipIds[0] ?? null);
  const selectClip = useStore((s) => s.selectClip);
  const addClip = useStore((s) => s.addClip);

  const { pool: drumTracks, active: activeTrack } = useActiveTrack('drum');

  const patternClips = useMemo(
    () => (activeTrack ? activeTrack.clips.filter((c) => c.kind === 'pattern') : []),
    [activeTrack],
  );
  const activeClip = (patternClips.find((c) => c.id === selectedClipId) ?? patternClips[0]) as
    | Extract<(typeof patternClips)[number], { kind: 'pattern' }>
    | undefined;

  // keep the global clip selection in sync with what the editor actually shows
  useEffect(() => {
    if (activeClip && activeClip.id !== selectedClipId) selectClip(activeClip.id);
  }, [activeClip, selectedClipId, selectClip]);

  if (!activeTrack) {
    return (
      <div style={{ padding: 16 }}>
        <HexFrame title="N/A">No drum track. Add one from the Arrange view.</HexFrame>
      </div>
    );
  }

  if (!activeClip) {
    return (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <HexFrame title={activeTrack.name}>
          <p>This track has no pattern clip.</p>
          <button className="nerv-btn" onClick={() => addClip(activeTrack.id, 0, 4)}>
            CREATE PATTERN CLIP
          </button>
        </HexFrame>
      </div>
    );
  }

  const length = activeClip.pattern.length;

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', contain: 'layout style' }}>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
        className="hex-grid-bg"
      >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="hud-label">STEP SEQUENCER // M.A.G.I. BALTHASAR</span>
        <select className="display" value={activeTrack.id} onChange={(e) => selectTrack(e.target.value)}>
          {drumTracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select className="display" value={activeClip.id} onChange={(e) => selectClip(e.target.value)}>
          {patternClips.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name ?? c.id}
            </option>
          ))}
        </select>
        <button
          className="nerv-btn"
          onClick={() => addClip(activeTrack.id, activeClip.start + activeClip.length, activeClip.length)}
        >
          + PATTERN
        </button>
      </div>

      <HexFrame title={`PATTERN // ${activeClip.name ?? activeClip.id}`}>
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'grid', gap: 4, gridTemplateColumns: `64px repeat(${length}, 1fr)` }}>
            <div />
            {Array.from({ length }).map((_, i) => (
              <div key={i} className="hud-readout" style={{ textAlign: 'center', fontSize: 8, opacity: 0.6 }}>
                {i + 1}
              </div>
            ))}
            {DRUM_PADS.map((pad) => (
              <PadRow
                key={pad}
                pad={pad}
                trackId={activeTrack.id}
                clipId={activeClip.id}
                steps={activeClip.pattern.steps[pad]}
              />
            ))}
          </div>
          <StepCursor
            length={length}
            clipStart={activeClip.start}
            clipLength={activeClip.length}
          />
        </div>
      </HexFrame>
      </div>
      <EditorTip>tap a step to toggle · drag a step up/down to set its velocity</EditorTip>
    </div>
  );
}

/** Leaf: reads the playhead and renders a single moving highlight column. */
const StepCursor = memo(function StepCursor({
  length,
  clipStart,
  clipLength,
}: {
  length: number;
  clipStart: number;
  clipLength: number;
}) {
  const positionBeats = usePlayhead();
  const localBeat = positionBeats - clipStart;
  const stepsInBeat = length / clipLength;
  const step =
    audioEngine.isPlaying() && localBeat >= 0 && localBeat < clipLength
      ? Math.floor(localBeat * stepsInBeat)
      : -1;
  if (step < 0) return null;
  // grid is `64px repeat(length, 1fr)` with a 4px gap (length gaps total)
  const colW = `((100% - 64px - ${length} * 4px) / ${length})`;
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: `calc(64px + ${step + 1} * 4px + ${step} * ${colW})`,
        width: `calc(${colW})`,
        border: '1px solid var(--nerv-green)',
        boxShadow: '0 0 8px rgba(0,255,136,0.5)',
        background: 'rgba(0,255,136,0.08)',
        pointerEvents: 'none',
        zIndex: 5,
        willChange: 'left',
      }}
    />
  );
});

const PadRow = memo(function PadRow({
  pad,
  trackId,
  clipId,
  steps,
}: {
  pad: DrumPad;
  trackId: string;
  clipId: string;
  steps: Step[];
}) {
  return (
    <>
      <button
        onClick={() => audioEngine.trigger(trackId, pad, 0.9, '8n')}
        className="nerv-btn nerv-btn--icon"
        style={{ fontSize: 9, padding: '4px 6px' }}
      >
        {DRUM_LABELS[pad]}
      </button>
      {steps.map((s, i) => (
        <StepCell
          key={i}
          on={s.on}
          velocity={s.velocity}
          quarter={i % 4 === 0}
          trackId={trackId}
          clipId={clipId}
          pad={pad}
          index={i}
        />
      ))}
    </>
  );
});

/**
 * StepCell — tap to toggle, drag UP/DOWN to set velocity (works on mouse and
 * touch). Velocity changes are painted directly to the DOM during the drag
 * and committed to the store only on release, so dragging never re-schedules
 * the transport mid-gesture.
 */
const StepCell = memo(function StepCell({
  on,
  velocity,
  quarter,
  trackId,
  clipId,
  pad,
  index,
}: {
  on: boolean;
  velocity: number;
  quarter: boolean;
  trackId: string;
  clipId: string;
  pad: DrumPad;
  index: number;
}) {
  const toggleStep = useStore((s) => s.toggleStep);
  const setStepVelocity = useStore((s) => s.setStepVelocity);
  const btnRef = useRef<HTMLButtonElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ startY: number; startVel: number; vel: number; moved: boolean } | null>(null);

  function down(e: React.PointerEvent) {
    btnRef.current?.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startVel: velocity, vel: velocity, moved: false };
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || !on) return;
    const dy = d.startY - e.clientY;
    if (Math.abs(dy) > 5) d.moved = true;
    if (!d.moved) return;
    d.vel = Math.max(0.05, Math.min(1, d.startVel + dy / 140));
    if (barRef.current) barRef.current.style.transform = `scaleX(${d.vel})`;
    if (btnRef.current) btnRef.current.style.background = cellBg(true, d.vel);
  }
  function up(e: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    btnRef.current?.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (!d.moved) {
      toggleStep(trackId, clipId, pad, index);
    } else if (on && d.vel !== d.startVel) {
      setStepVelocity(trackId, clipId, pad, index, d.vel);
    }
  }

  return (
    <button
      ref={btnRef}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onWheel={(e) => {
        if (!on) return;
        e.preventDefault();
        const v = Math.max(0.05, Math.min(1, velocity - Math.sign(e.deltaY) * 0.05));
        setStepVelocity(trackId, clipId, pad, index, v);
      }}
      style={{
        height: 38,
        background: cellBg(on, velocity),
        border: on
          ? '1px solid var(--nerv-orange)'
          : `1px solid ${quarter ? 'rgba(255,106,0,0.45)' : 'rgba(255,106,0,0.18)'}`,
        boxShadow: on ? '0 0 6px rgba(255,106,0,0.5)' : 'none',
        position: 'relative',
        clipPath: 'polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px)',
        touchAction: 'none',
      }}
      aria-pressed={on}
      title="Tap to toggle · drag up/down for velocity"
    >
      <span
        ref={barRef}
        style={{
          position: 'absolute',
          left: 2,
          right: 2,
          bottom: 2,
          height: 3,
          background: 'rgba(255,255,255,0.55)',
          transform: `scaleX(${velocity})`,
          transformOrigin: '0 0',
          opacity: on ? 1 : 0,
        }}
      />
    </button>
  );
});
