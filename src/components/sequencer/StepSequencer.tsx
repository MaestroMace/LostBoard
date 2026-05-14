import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../state/store';
import { DRUM_LABELS, DRUM_PADS, type DrumPad } from '../../audio/types';
import { audioEngine } from '../../audio/engine';
import { HexFrame } from '../hud/HexFrame';

export function StepSequencer() {
  const project = useStore((s) => s.project);
  const selectedTrackId = useStore((s) => s.selectedTrackId);
  const selectTrack = useStore((s) => s.selectTrack);
  const selectedClipId = useStore((s) => s.selectedClipId);
  const selectClip = useStore((s) => s.selectClip);
  const toggleStep = useStore((s) => s.toggleStep);
  const setStepVelocity = useStore((s) => s.setStepVelocity);
  const addClip = useStore((s) => s.addClip);
  const positionBeats = useStore((s) => s.positionBeats);

  const drumTracks = project.tracks.filter((t) => t.kind === 'drum');
  const activeTrack = drumTracks.find((t) => t.id === selectedTrackId) ?? drumTracks[0];

  const patternClips = useMemo(
    () => (activeTrack ? activeTrack.clips.filter((c) => c.kind === 'pattern') : []),
    [activeTrack],
  );
  const activeClip =
    (patternClips.find((c) => c.id === selectedClipId) ?? patternClips[0]) as
      | Extract<typeof patternClips[number], { kind: 'pattern' }>
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
          <button
            className="nerv-btn"
            onClick={() => addClip(activeTrack.id, 0, 4)}
          >
            CREATE PATTERN CLIP
          </button>
        </HexFrame>
      </div>
    );
  }

  const length = activeClip.pattern.length;
  const stepsInBeat = length / activeClip.length;
  const localBeat = positionBeats - activeClip.start;
  const currentStep =
    audioEngine.isPlaying() && localBeat >= 0 && localBeat < activeClip.length
      ? Math.floor(localBeat * stepsInBeat)
      : -1;

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }} className="hex-grid-bg">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="hud-label">STEP SEQUENCER // M.A.G.I. BALTHASAR</span>
        <select
          className="display"
          value={activeTrack.id}
          onChange={(e) => selectTrack(e.target.value)}
        >
          {drumTracks.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <select
          className="display"
          value={activeClip.id}
          onChange={(e) => selectClip(e.target.value)}
        >
          {patternClips.map((c) => (
            <option key={c.id} value={c.id}>{c.name ?? c.id}</option>
          ))}
        </select>
        <button className="nerv-btn" onClick={() => addClip(activeTrack.id, activeClip.start + activeClip.length, activeClip.length)}>
          + PATTERN
        </button>
      </div>

      <HexFrame title={`PATTERN // ${activeClip.name ?? activeClip.id}`}>
        <div style={{ display: 'grid', gap: 4, gridTemplateColumns: `64px repeat(${length}, 1fr)` }}>
          <div />
          {Array.from({ length }).map((_, i) => (
            <div
              key={i}
              className="hud-readout"
              style={{
                textAlign: 'center',
                fontSize: 8,
                opacity: i === currentStep ? 1 : 0.6,
                color: i === currentStep ? 'var(--nerv-green)' : undefined,
              }}
            >
              {i + 1}
            </div>
          ))}
          {DRUM_PADS.map((pad) => (
            <PadRow
              key={pad}
              pad={pad}
              steps={activeClip.pattern.steps[pad]}
              currentStep={currentStep}
              onToggle={(i) => toggleStep(activeTrack.id, activeClip.id, pad, i)}
              onVelocity={(i, v) => setStepVelocity(activeTrack.id, activeClip.id, pad, i, v)}
              onAudition={() => audioEngine.trigger(activeTrack.id, pad, 0.9, '8n')}
            />
          ))}
        </div>
      </HexFrame>
    </div>
  );
}

function PadRow({
  pad,
  steps,
  currentStep,
  onToggle,
  onVelocity,
  onAudition,
}: {
  pad: DrumPad;
  steps: { on: boolean; velocity: number }[];
  currentStep: number;
  onToggle: (i: number) => void;
  onVelocity: (i: number, v: number) => void;
  onAudition: () => void;
}) {
  return (
    <>
      <button
        onClick={onAudition}
        className="nerv-btn nerv-btn--icon"
        style={{ fontSize: 9, padding: '4px 6px' }}
      >
        {DRUM_LABELS[pad]}
      </button>
      {steps.map((s, i) => (
        <StepCell
          key={i}
          step={s}
          highlight={i === currentStep}
          quarter={i % 4 === 0}
          onClick={() => onToggle(i)}
          onWheel={(delta) => {
            const v = Math.max(0.05, Math.min(1, s.velocity + delta));
            onVelocity(i, v);
          }}
        />
      ))}
    </>
  );
}

function StepCell({
  step,
  highlight,
  quarter,
  onClick,
  onWheel,
}: {
  step: { on: boolean; velocity: number };
  highlight: boolean;
  quarter: boolean;
  onClick: () => void;
  onWheel: (delta: number) => void;
}) {
  return (
    <button
      onClick={onClick}
      onWheel={(e) => {
        e.preventDefault();
        onWheel(-Math.sign(e.deltaY) * 0.05);
      }}
      style={{
        height: 36,
        background: step.on
          ? `linear-gradient(180deg, rgba(255,106,0,${0.4 + step.velocity * 0.5}), rgba(255,106,0,${0.15 + step.velocity * 0.3}))`
          : 'rgba(0,0,0,0.55)',
        border: highlight
          ? '1px solid var(--nerv-green)'
          : step.on
            ? '1px solid var(--nerv-orange)'
            : `1px solid ${quarter ? 'rgba(255,106,0,0.45)' : 'rgba(255,106,0,0.18)'}`,
        boxShadow: step.on ? '0 0 6px rgba(255,106,0,0.5)' : 'none',
        position: 'relative',
        clipPath: 'polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px)',
      }}
      aria-pressed={step.on}
    >
      {step.on && (
        <span
          style={{
            position: 'absolute',
            left: 2,
            right: 2,
            bottom: 2,
            height: 3,
            background: 'rgba(255,255,255,0.55)',
            transform: `scaleX(${step.velocity})`,
            transformOrigin: '0 0',
          }}
        />
      )}
    </button>
  );
}
