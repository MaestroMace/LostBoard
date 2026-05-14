import { memo, useMemo } from 'react';
import { useStore } from '../../state/store';
import { DRUM_LABELS, DRUM_PADS, type DrumPad, type Step } from '../../audio/types';
import { audioEngine } from '../../audio/engine';
import { HexFrame } from '../hud/HexFrame';
import { usePlayhead } from '../../state/transportClock';

export function StepSequencer() {
  const tracks = useStore((s) => s.project.tracks);
  const selectedTrackId = useStore((s) => s.selectedTrackId);
  const selectTrack = useStore((s) => s.selectTrack);
  const selectedClipId = useStore((s) => s.selectedClipId);
  const selectClip = useStore((s) => s.selectClip);
  const addClip = useStore((s) => s.addClip);

  const drumTracks = useMemo(() => tracks.filter((t) => t.kind === 'drum'), [tracks]);
  const activeTrack = drumTracks.find((t) => t.id === selectedTrackId) ?? drumTracks[0];

  const patternClips = useMemo(
    () => (activeTrack ? activeTrack.clips.filter((c) => c.kind === 'pattern') : []),
    [activeTrack],
  );
  const activeClip = (patternClips.find((c) => c.id === selectedClipId) ?? patternClips[0]) as
    | Extract<(typeof patternClips)[number], { kind: 'pattern' }>
    | undefined;

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
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        contain: 'layout style',
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

  return (
    <button
      onClick={() => toggleStep(trackId, clipId, pad, index)}
      onWheel={(e) => {
        e.preventDefault();
        const v = Math.max(0.05, Math.min(1, velocity - Math.sign(e.deltaY) * 0.05));
        setStepVelocity(trackId, clipId, pad, index, v);
      }}
      style={{
        height: 36,
        background: on
          ? `linear-gradient(180deg, rgba(255,106,0,${0.4 + velocity * 0.5}), rgba(255,106,0,${0.15 + velocity * 0.3}))`
          : 'rgba(0,0,0,0.55)',
        border: on
          ? '1px solid var(--nerv-orange)'
          : `1px solid ${quarter ? 'rgba(255,106,0,0.45)' : 'rgba(255,106,0,0.18)'}`,
        boxShadow: on ? '0 0 6px rgba(255,106,0,0.5)' : 'none',
        position: 'relative',
        clipPath: 'polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px)',
      }}
      aria-pressed={on}
    >
      {on && (
        <span
          style={{
            position: 'absolute',
            left: 2,
            right: 2,
            bottom: 2,
            height: 3,
            background: 'rgba(255,255,255,0.55)',
            transform: `scaleX(${velocity})`,
            transformOrigin: '0 0',
          }}
        />
      )}
    </button>
  );
});
