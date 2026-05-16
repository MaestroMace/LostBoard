import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { DRUM_LABELS, DRUM_PADS, type DrumPad, type Step } from '../../audio/types';
import { audioEngine } from '../../audio/engine';
import { HexFrame } from '../hud/HexFrame';
import { usePlayhead } from '../../state/transportClock';
import { useActiveTrack } from '../../hooks/useActiveTrack';
import { EditorTip } from '../hud/EditorTip';
import { importSample } from '../../state/samples';

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
  const setPatternLength = useStore((s) => s.setPatternLength);

  const { pool: drumTracks, active: activeTrack } = useActiveTrack('drum');
  const [mode, setMode] = useState<'normal' | 'prob'>('normal');

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
        <span className="hud-readout">STEPS</span>
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
        <button
          className={`nerv-btn ${mode === 'normal' ? 'is-active' : ''}`}
          onClick={() => setMode('normal')}
          aria-pressed={mode === 'normal'}
          title="Normal mode — tap toggles, drag sets velocity"
        >
          NORM
        </button>
        <button
          className={`nerv-btn ${mode === 'prob' ? 'is-active' : ''}`}
          onClick={() => setMode('prob')}
          aria-pressed={mode === 'prob'}
          title="Probability mode — tap cycles trigger chance (100/75/50/25%)"
        >
          PROB
        </button>
      </div>

      <HexFrame title={`PATTERN // ${activeClip.name ?? activeClip.id}`}>
        <div style={{ position: 'relative' }}>
          <div
            style={{
              display: 'grid',
              gap: 4,
              // wider patterns get a min width per step so cells stay tappable; outer container will scroll
              // 80px label column (fits the pad name + sample-swap dropdown)
              gridTemplateColumns: `80px repeat(${length}, minmax(${length > 16 ? 22 : 0}px, 1fr))`,
            }}
          >
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
                mode={mode}
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
      <EditorTip>
        NORM tap to toggle · drag up/down for velocity · PROB tap to cycle 100/75/50/25% · pad dropdown swaps the
        voice for any imported sample (◆ marks customised pads) · or drag an audio file straight onto a pad to
        import + assign
      </EditorTip>
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
  mode,
}: {
  pad: DrumPad;
  trackId: string;
  clipId: string;
  steps: Step[];
  mode: 'normal' | 'prob';
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
        outline: hover ? '2px dashed var(--nerv-orange-bright)' : 'none',
      }}
    >
      <button
        onClick={() => audioEngine.trigger(trackId, pad, 0.9, '8n')}
        className="nerv-btn nerv-btn--icon"
        style={{ fontSize: 9, padding: '3px 4px', width: '100%' }}
        title={
          sampleId
            ? 'Custom sample assigned — click to preview · drop an audio file to replace'
            : 'Synth pad — click to preview · drop an audio file to assign'
        }
      >
        {DRUM_LABELS[pad]}
        {sampleId && <span style={{ color: 'var(--nerv-orange-bright)' }}> ◆</span>}
      </button>
      <select
        className="display"
        value={sampleId}
        onChange={(e) => setPadSample(trackId, pad, e.target.value || null)}
        title="Swap this pad's voice for a sample"
        style={{ fontSize: 8, padding: '1px 2px', width: '100%' }}
        disabled={samples.length === 0}
      >
        <option value="">SYNTH</option>
        {samples.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
});

const PROB_CYCLE = [1, 0.75, 0.5, 0.25] as const;
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
  mode: 'normal' | 'prob';
}) {
  const toggleStep = useStore((s) => s.toggleStep);
  const setStepVelocity = useStore((s) => s.setStepVelocity);
  const setStepProbability = useStore((s) => s.setStepProbability);
  const btnRef = useRef<HTMLButtonElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ startY: number; startVel: number; vel: number; moved: boolean } | null>(null);
  const prob = probability ?? 1;

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
      title={
        mode === 'prob'
          ? 'Tap to cycle trigger probability'
          : 'Tap to toggle · drag up/down for velocity'
      }
    >
      {on && prob < 1 && (
        <span
          style={{
            position: 'absolute',
            top: 2,
            right: 3,
            fontSize: 8,
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
