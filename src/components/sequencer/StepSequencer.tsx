import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { DRUM_LABELS, DRUM_PADS, type DrumPad, type Step } from '../../audio/types';
import { audioEngine } from '../../audio/engine';
import { HexFrame } from '../hud/HexFrame';
import { usePlayhead } from '../../state/transportClock';
import { useActiveTrack } from '../../hooks/useActiveTrack';
import { EditorTip } from '../hud/EditorTip';
import { importSample } from '../../state/samples';
import { useIsMobile } from '../../hooks/useLayoutMode';

/**
 * Step-grid geometry.
 *
 * On touch the cells take a fixed, finger-sized width and the grid scrolls,
 * instead of dividing the viewport into 14px slivers nobody can hit. The grid
 * template and the playhead cursor both read these constants, so the two can
 * never drift apart — the cursor previously mirrored the template by hand in a
 * calc() string.
 */
const LABEL_COL_W = 96;
const GRID_GAP = 4;
const TOUCH_CELL_W = 40;

function cellBg(on: boolean, vel: number) {
  return on
    ? `linear-gradient(180deg, rgba(255,106,0,${0.4 + vel * 0.5}), rgba(255,106,0,${0.15 + vel * 0.3}))`
    : 'rgba(0,0,0,0.55)';
}

export function StepSequencer() {
  // fixed, finger-sized cells on touch; the grid scrolls instead of shrinking
  const touchCells = useIsMobile();
  const selectTrack = useStore((s) => s.selectTrack);
  const selectedClipId = useStore((s) => s.selectedClipIds[0] ?? null);
  const selectClip = useStore((s) => s.selectClip);
  const addClip = useStore((s) => s.addClip);
  const setPatternLength = useStore((s) => s.setPatternLength);

  const { pool: drumTracks, active: activeTrack } = useActiveTrack('drum');
  const [mode, setMode] = useState<'normal' | 'vel' | 'prob'>('normal');

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
        <HexFrame title="No drum track">Add a drum track from the Song tab, then come back here to program a beat.</HexFrame>
      </div>
    );
  }

  if (!activeClip) {
    return (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <HexFrame title={activeTrack.name}>
          <p>This track has no beat yet.</p>
          <button className="hud-btn" onClick={() => addClip(activeTrack.id, 0, 4)}>
            Create a beat
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
        <span className="hud-label">Drum Sequencer</span>
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
          className="hud-btn"
          onClick={() => addClip(activeTrack.id, activeClip.start + activeClip.length, activeClip.length)}
        >
          + Pattern
        </button>
        <span className="hud-readout" style={{ textTransform: 'none' }}>Length</span>
        <select
          className="display"
          value={activeClip.pattern.length}
          onChange={(e) => setPatternLength(activeTrack.id, activeClip.id, parseInt(e.target.value, 10))}
          title="Resize the pattern (beat positions are preserved)"
        >
          <option value={8}>8</option>
          <option value={16}>16</option>
          <option value={32}>32</option>
          <option value={64}>64</option>
        </select>
        <div style={{ flex: 1 }} />
        {/* Two bare words side by side gave no clue they were a mode switch. */}
        <span className="hud-label">Tapping sets</span>
        <button
          className={`hud-btn hud-btn--tight ${mode === 'normal' ? 'is-active' : ''}`}
          onClick={() => setMode('normal')}
          aria-pressed={mode === 'normal'}
          title="Tap a square to turn a hit on or off"
        >
          Hits
        </button>
        <button
          className={`hud-btn hud-btn--tight ${mode === 'vel' ? 'is-active' : ''}`}
          onClick={() => setMode('vel')}
          aria-pressed={mode === 'vel'}
          title="Tap a square to cycle how hard it hits: full, 3/4, half, quarter"
        >
          Loudness
        </button>
        <button
          className={`hud-btn hud-btn--tight ${mode === 'prob' ? 'is-active' : ''}`}
          onClick={() => setMode('prob')}
          aria-pressed={mode === 'prob'}
          title="Tap a square to set how often it actually plays: every time, 3 in 4, half, 1 in 4"
        >
          Chance
        </button>
      </div>

      {/* noclip: .hex-frame carries a clip-path, and clip-path clips
          DESCENDANTS. That is why every step past the frame edge was
          amputated — at 16 steps in portrait, scrolled right, not one cell was
          inside the box and the screen went blank. */}
      <HexFrame className="hex-frame--noclip">
        <div style={{ position: 'relative' }}>
          <div
            style={{
              display: 'grid',
              gap: 4,
              // wider patterns get a min width per step so cells stay tappable; outer container will scroll
              // 80px label column (fits the pad name + sample-swap dropdown)
              gridTemplateColumns: `${LABEL_COL_W}px repeat(${length}, ${
                touchCells ? `${TOUCH_CELL_W}px` : `minmax(${length > 16 ? 22 : 0}px, 1fr)`
              })`,
            }}
          >
            <div />
            {Array.from({ length }).map((_, i) => (
              <div key={i} className="hud-readout" style={{ textAlign: 'center', fontSize: 11, opacity: 0.6 }}>
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
                mode={mode}
              />
            ))}
          </div>
          <StepCursor
            touchCells={touchCells}
            length={length}
            clipStart={activeClip.start}
            clipLength={activeClip.length}
          />
        </div>
      </HexFrame>
      </div>
      <EditorTip>
        Tap a square to turn a hit on or off. Switch &ldquo;Tapping sets&rdquo; to Loudness to set how hard a hit
        lands, or Chance to make it play only some of the time. Drop an audio file onto a pad to use your own sound
        there &mdash; ◆ marks a pad you have changed.
      </EditorTip>
    </div>
  );
}

/** Leaf: reads the playhead and renders a single moving highlight column. */
const StepCursor = memo(function StepCursor({
  length,
  clipStart,
  clipLength,
  touchCells,
}: {
  length: number;
  clipStart: number;
  clipLength: number;
  touchCells: boolean;
}) {
  const positionBeats = usePlayhead();
  const localBeat = positionBeats - clipStart;
  const stepsInBeat = length / clipLength;
  const step =
    audioEngine.isPlaying() && localBeat >= 0 && localBeat < clipLength
      ? Math.floor(localBeat * stepsInBeat)
      : -1;
  if (step < 0) return null;
  // mirror the grid template: an 80px label column + `length` 1fr tracks
  // separated by 4px gaps (length gaps total, including the one after the
  // label column)
  // Fixed-width cells make this exact; the fluid case still has to mirror the
  // 1fr template.
  const colW = touchCells
    ? `${TOUCH_CELL_W}px`
    : `((100% - ${LABEL_COL_W}px - ${length} * ${GRID_GAP}px) / ${length})`;
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: `calc(${LABEL_COL_W}px + ${step + 1} * ${GRID_GAP}px + ${step} * ${colW})`,
        width: `calc(${colW})`,
        border: '1px solid var(--hud-green)',
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
  mode,
}: {
  pad: DrumPad;
  trackId: string;
  clipId: string;
  steps: Step[];
  mode: 'normal' | 'vel' | 'prob';
}) {
  return (
    <>
      <PadHeader pad={pad} trackId={trackId} />
      {steps.map((s, i) => (
        <StepCell
          key={i}
          on={s.on}
          velocity={s.velocity}
          probability={s.probability}
          quarter={i % 4 === 0}
          trackId={trackId}
          clipId={clipId}
          pad={pad}
          index={i}
          mode={mode}
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
/**
 * PadHeader — the leftmost cell of each pad row. Click the label to preview;
 * pick a sample from the dropdown to swap the pad's voice from the built-in
 * drum synth to any imported / recorded audio sample in the project.
 */
const PadHeader = memo(function PadHeader({ pad, trackId }: { pad: DrumPad; trackId: string }) {
  const sampleId = useStore((s) => {
    const t = s.project.tracks.find((tr) => tr.id === trackId);
    return t?.padSamples?.[pad] ?? '';
  });
  const tracks = useStore((s) => s.project.tracks);
  const setPadSample = useStore((s) => s.setPadSample);
  const [hover, setHover] = useState(false);

  // unique audio-clip samples available for assignment
  const samples = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; name: string }[] = [];
    for (const t of tracks) {
      for (const c of t.clips) {
        if (c.kind === 'audio' && !seen.has(c.sampleId)) {
          seen.add(c.sampleId);
          out.push({ id: c.sampleId, name: c.name ?? c.sampleId.slice(0, 8) });
        }
      }
    }
    return out;
  }, [tracks]);

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setHover(false);
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('audio')) return;
    try {
      const { id } = await importSample(file);
      setPadSample(trackId, pad, id);
    } catch (err) {
      console.error('Pad drop failed', err);
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!hover) setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={handleDrop}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        alignItems: 'stretch',
        outline: hover ? '2px dashed var(--hud-orange-bright)' : 'none',
      }}
    >
      <button
        onClick={() => audioEngine.trigger(trackId, pad, 0.9, '8n')}
        className="hud-btn hud-btn--icon"
        style={{ fontSize: 12, padding: '3px 4px', width: '100%' }}
        title={
          sampleId
            ? 'Custom sample assigned — click to preview · drop an audio file to replace'
            : 'Synth pad — click to preview · drop an audio file to assign'
        }
      >
        {DRUM_LABELS[pad]}
        {sampleId && <span style={{ color: 'var(--hud-orange-bright)' }}> ◆</span>}
      </button>
      {/* Only worth a row when there is something to choose. It used to render
          permanently disabled under all eight pads, doubling the grid height. */}
      {samples.length > 0 && (
      <select
        className="display"
        value={sampleId}
        onChange={(e) => setPadSample(trackId, pad, e.target.value || null)}
        title="Swap this pad's voice for a sample"
        style={{ fontSize: 11, padding: '1px 2px', width: '100%' }}
      >
        <option value="">Built-in sound</option>
        {samples.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      )}
    </div>
  );
});

const PROB_CYCLE = [1, 0.75, 0.5, 0.25] as const;
/** Loudness steps, cycled by tapping in 'vel' mode — the touch replacement for
 *  a vertical drag the browser now owns. */
const VEL_CYCLE = [1, 0.75, 0.5, 0.25];
function nextVelocity(current: number): number {
  const idx = VEL_CYCLE.findIndex((v) => Math.abs(v - current) < 0.01);
  return VEL_CYCLE[(idx + 1) % VEL_CYCLE.length];
}

function nextProbability(current: number): number {
  const idx = PROB_CYCLE.findIndex((v) => Math.abs(v - current) < 0.01);
  return PROB_CYCLE[(idx + 1) % PROB_CYCLE.length];
}

const StepCell = memo(function StepCell({
  on,
  velocity,
  probability,
  quarter,
  trackId,
  clipId,
  pad,
  index,
  mode,
}: {
  on: boolean;
  velocity: number;
  probability?: number;
  quarter: boolean;
  trackId: string;
  clipId: string;
  pad: DrumPad;
  index: number;
  mode: 'normal' | 'vel' | 'prob';
}) {
  const touchCell = useIsMobile();
  const toggleStep = useStore((s) => s.toggleStep);
  const setStepVelocity = useStore((s) => s.setStepVelocity);
  const setStepProbability = useStore((s) => s.setStepProbability);
  const btnRef = useRef<HTMLButtonElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ startY: number; startVel: number; vel: number; moved: boolean } | null>(null);
  const prob = probability ?? 1;

  // Wheel-to-set-velocity must stop the container scrolling, but React's
  // root-attached wheel listener is passive — preventDefault there is a
  // no-op. Attach a native non-passive listener instead, reading the live
  // cell state through a ref so the listener never needs re-binding.
  const wheelState = useRef({ on, velocity });
  useEffect(() => {
    wheelState.current = { on, velocity };
  });
  useEffect(() => {
    const el = btnRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const s = wheelState.current;
      if (!s.on) return;
      e.preventDefault();
      const v = Math.max(0.05, Math.min(1, s.velocity - Math.sign(e.deltaY) * 0.05));
      setStepVelocity(trackId, clipId, pad, index, v);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [trackId, clipId, pad, index, setStepVelocity]);

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
      // tap: prob mode cycles probability (on cells only), normal mode toggles
      if (mode === 'prob' && on) {
        setStepProbability(trackId, clipId, pad, index, nextProbability(prob));
      } else if (mode === 'vel' && on) {
        setStepVelocity(trackId, clipId, pad, index, nextVelocity(velocity));
      } else {
        toggleStep(trackId, clipId, pad, index);
      }
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
      style={{
        height: touchCell ? 44 : 38,
        background: cellBg(on, velocity),
        border: on
          ? '1px solid var(--hud-orange)'
          : `1px solid ${quarter ? 'rgba(255,106,0,0.45)' : 'rgba(255,106,0,0.18)'}`,
        boxShadow: on ? '0 0 6px rgba(255,106,0,0.5)' : 'none',
        position: 'relative',
        clipPath: 'polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px)',
        // Step cells are ~79% of the working area, so with touchAction 'none'
        // every one of them was a scroll dead zone: a 90px upward swipe moved
        // the grid 0px and changed the step's velocity from 0.9 to 1.0. On
        // touch the browser gets the vertical axis back and loudness moves to
        // its own tap mode; a mouse keeps drag-for-velocity.
        touchAction: touchCell ? 'pan-y' : 'none',
      }}
      aria-pressed={on}
      title={
        mode === 'prob'
          ? 'Tap to cycle how often this plays'
          : mode === 'vel'
            ? 'Tap to cycle how hard this hits'
            : 'Tap to turn this hit on or off'
      }
    >
      {on && prob < 1 && (
        <span
          style={{
            position: 'absolute',
            top: 2,
            right: 3,
            fontSize: 11,
            lineHeight: 1,
            color: '#fff',
            textShadow: '0 0 3px #000',
            pointerEvents: 'none',
          }}
        >
          {Math.round(prob * 100)}
        </span>
      )}
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
