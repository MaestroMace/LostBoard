import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import type { Clip, Track } from '../../audio/types';
import { audioEngine } from '../../audio/engine';

const TRACK_HEAD_W = 196;
const ROW_H = 64;
const BEAT_W = 24;

export function ArrangeView() {
  const project = useStore((s) => s.project);
  const selectedTrackId = useStore((s) => s.selectedTrackId);
  const selectedClipId = useStore((s) => s.selectedClipId);
  const selectTrack = useStore((s) => s.selectTrack);
  const selectClip = useStore((s) => s.selectClip);
  const addClip = useStore((s) => s.addClip);
  const moveClip = useStore((s) => s.moveClip);
  const resizeClip = useStore((s) => s.resizeClip);
  const removeClip = useStore((s) => s.removeClip);
  const updateTrack = useStore((s) => s.updateTrack);
  const addTrack = useStore((s) => s.addTrack);
  const removeTrack = useStore((s) => s.removeTrack);
  const positionBeats = useStore((s) => s.positionBeats);
  const setView = useStore((s) => s.setView);

  const totalBeats = project.lengthBars * project.numerator;
  const timelineW = totalBeats * BEAT_W;
  const playheadX = positionBeats * BEAT_W;

  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="warning-stripe--thin warning-stripe" />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* Track headers */}
        <div
          style={{
            width: TRACK_HEAD_W,
            background: 'rgba(0,0,0,0.7)',
            borderRight: '1px solid rgba(255,106,0,0.4)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              height: 32,
              padding: '4px 8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid rgba(255,106,0,0.4)',
            }}
          >
            <span className="hud-label">TRACKS</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="nerv-btn nerv-btn--icon" onClick={() => addTrack('synth')} title="Add synth track">
                +SYN
              </button>
              <button className="nerv-btn nerv-btn--icon" onClick={() => addTrack('drum')} title="Add drum track">
                +DRM
              </button>
              <button className="nerv-btn nerv-btn--icon" onClick={() => addTrack('audio')} title="Add audio track">
                +AUD
              </button>
            </div>
          </div>
          <div style={{ overflow: 'auto', flex: 1 }}>
            {project.tracks.map((t) => (
              <TrackHeader
                key={t.id}
                track={t}
                selected={t.id === selectedTrackId}
                onSelect={() => selectTrack(t.id)}
                onUpdate={(p) => updateTrack(t.id, p)}
                onRemove={() => removeTrack(t.id)}
                onOpenInstrument={() => {
                  selectTrack(t.id);
                  setView(t.kind === 'drum' ? 'sequencer' : 'instrument');
                }}
              />
            ))}
          </div>
        </div>

        {/* Timeline */}
        <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', position: 'relative' }} className="hex-grid-bg">
          <Ruler beats={totalBeats} />
          <div style={{ position: 'relative', width: timelineW, minWidth: '100%' }}>
            {project.tracks.map((t) => (
              <TrackLane
                key={t.id}
                track={t}
                selectedClipId={selectedClipId}
                onSelectClip={selectClip}
                onAddClip={(beat) => {
                  selectTrack(t.id);
                  addClip(t.id, beat, 4);
                }}
                onMoveClip={moveClip}
                onResizeClip={resizeClip}
                onRemoveClip={removeClip}
              />
            ))}
            <Playhead x={playheadX} height={project.tracks.length * ROW_H + 32} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Ruler({ beats }: { beats: number }) {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 5,
        height: 32,
        background: 'linear-gradient(180deg, rgba(255,106,0,0.18), rgba(0,0,0,0.85))',
        borderBottom: '1px solid rgba(255,106,0,0.5)',
        display: 'flex',
        alignItems: 'flex-end',
      }}
    >
      {Array.from({ length: beats + 1 }).map((_, i) => {
        const isBar = i % 4 === 0;
        return (
          <div
            key={i}
            style={{
              width: BEAT_W,
              borderLeft: '1px solid rgba(255,106,0,0.4)',
              height: isBar ? 20 : 10,
              alignSelf: 'flex-end',
              position: 'relative',
            }}
          >
            {isBar && (
              <span
                className="hud-label"
                style={{ position: 'absolute', top: -16, left: 2, fontSize: 9 }}
              >
                {i / 4 + 1}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TrackHeader({
  track,
  selected,
  onSelect,
  onUpdate,
  onRemove,
  onOpenInstrument,
}: {
  track: Track;
  selected: boolean;
  onSelect: () => void;
  onUpdate: (p: Partial<Track>) => void;
  onRemove: () => void;
  onOpenInstrument: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      style={{
        height: ROW_H,
        padding: '4px 6px',
        borderBottom: '1px solid rgba(255,106,0,0.25)',
        background: selected ? 'rgba(255,106,0,0.12)' : 'transparent',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        cursor: 'pointer',
      }}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: track.color }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          className="hud-value"
          style={{
            flex: 1,
            fontSize: 11,
            background: 'transparent',
            border: '1px solid transparent',
            padding: '2px 4px',
            color: 'var(--nerv-orange-bright)',
            minWidth: 0,
          }}
          value={track.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          onClick={(e) => e.stopPropagation()}
        />
        {track.kind === 'audio' ? (
          <AudioImportButton trackId={track.id} />
        ) : (
          <button
            className="nerv-btn nerv-btn--icon"
            onClick={(e) => {
              e.stopPropagation();
              onOpenInstrument();
            }}
            title="Open instrument"
          >
            ⌘
          </button>
        )}
        <button
          className="nerv-btn nerv-btn--icon"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Delete track "${track.name}"?`)) onRemove();
          }}
          title="Delete track"
        >
          ✕
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 'auto' }}>
        <button
          className={`nerv-btn nerv-btn--icon ${track.mute ? 'is-active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onUpdate({ mute: !track.mute });
          }}
          style={{ minWidth: 28, padding: '4px 6px', fontSize: 9 }}
        >
          M
        </button>
        <button
          className={`nerv-btn nerv-btn--green nerv-btn--icon ${track.solo ? 'is-active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onUpdate({ solo: !track.solo });
          }}
          style={{ minWidth: 28, padding: '4px 6px', fontSize: 9 }}
        >
          S
        </button>
        <button
          className={`nerv-btn nerv-btn--rec nerv-btn--icon ${track.arm ? 'is-active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onUpdate({ arm: !track.arm });
          }}
          style={{ minWidth: 28, padding: '4px 6px', fontSize: 9 }}
        >
          ●
        </button>
        <input
          type="range"
          className="nerv-slider"
          min={-48}
          max={6}
          step={0.5}
          value={track.volume}
          onChange={(e) => onUpdate({ volume: parseFloat(e.target.value) })}
          onClick={(e) => e.stopPropagation()}
          style={{ flex: 1, height: 4 }}
        />
        <span className="hud-readout" style={{ fontSize: 8, width: 28, textAlign: 'right' }}>
          {track.volume.toFixed(0)}
        </span>
      </div>
    </div>
  );
}

function TrackLane({
  track,
  selectedClipId,
  onSelectClip,
  onAddClip,
  onMoveClip,
  onResizeClip,
  onRemoveClip,
}: {
  track: Track;
  selectedClipId: string | null;
  onSelectClip: (id: string) => void;
  onAddClip: (beat: number) => void;
  onMoveClip: (id: string, newStart: number) => void;
  onResizeClip: (id: string, newLength: number) => void;
  onRemoveClip: (id: string) => void;
}) {
  return (
    <div
      style={{
        position: 'relative',
        height: ROW_H,
        borderBottom: '1px solid rgba(255,106,0,0.18)',
        background: `linear-gradient(180deg, ${track.color}10, transparent)`,
      }}
      onDoubleClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const beat = Math.max(0, Math.floor((e.clientX - r.left) / BEAT_W));
        onAddClip(beat);
      }}
    >
      {/* beat grid lines */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            `linear-gradient(90deg, rgba(255,106,0,0.18) 1px, transparent 1px)`,
          backgroundSize: `${BEAT_W * 4}px 100%`,
        }}
      />
      {track.clips.map((c) => (
        <ClipBlock
          key={c.id}
          clip={c}
          color={track.color}
          selected={c.id === selectedClipId}
          onSelect={() => onSelectClip(c.id)}
          onMove={(s) => onMoveClip(c.id, s)}
          onResize={(l) => onResizeClip(c.id, l)}
          onRemove={() => onRemoveClip(c.id)}
        />
      ))}
    </div>
  );
}

function ClipBlock({
  clip,
  color,
  selected,
  onSelect,
  onMove,
  onResize,
  onRemove,
}: {
  clip: Clip;
  color: string;
  selected: boolean;
  onSelect: () => void;
  onMove: (start: number) => void;
  onResize: (length: number) => void;
  onRemove: () => void;
}) {
  const setView = useStore((s) => s.setView);
  const selectTrack = useStore((s) => s.selectTrack);
  const start = useRef(0);
  const baseStart = useRef(0);
  const baseLen = useRef(0);
  const mode = useRef<'move' | 'resize' | null>(null);

  function down(e: React.PointerEvent, m: 'move' | 'resize') {
    e.stopPropagation();
    onSelect();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    start.current = e.clientX;
    baseStart.current = clip.start;
    baseLen.current = clip.length;
    mode.current = m;
  }
  function move(e: React.PointerEvent) {
    if (!mode.current) return;
    const dx = e.clientX - start.current;
    const dBeats = Math.round(dx / BEAT_W);
    if (mode.current === 'move') onMove(Math.max(0, baseStart.current + dBeats));
    else onResize(Math.max(0.5, baseLen.current + dBeats));
  }
  function up(e: React.PointerEvent) {
    mode.current = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }

  return (
    <div
      onPointerDown={(e) => down(e, 'move')}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={(e) => {
        e.stopPropagation();
        selectTrack(clip.trackId);
        setView(clip.kind === 'pattern' ? 'sequencer' : 'pianoroll');
      }}
      style={{
        position: 'absolute',
        top: 4,
        left: clip.start * BEAT_W,
        width: clip.length * BEAT_W - 2,
        height: ROW_H - 8,
        background: `linear-gradient(180deg, ${color}66, ${color}22)`,
        border: `1px solid ${selected ? '#fff' : color}`,
        clipPath: 'polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)',
        cursor: 'grab',
        boxShadow: selected ? `0 0 12px ${color}` : 'none',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      <div
        className="hud-label"
        style={{
          position: 'absolute',
          top: 4,
          left: 8,
          fontSize: 8,
          letterSpacing: '0.2em',
          color: '#fff',
          textShadow: '0 0 4px #000',
        }}
      >
        {clip.name ?? clip.kind.toUpperCase()}
      </div>
      <ClipPreview clip={clip} />
      <button
        className="nerv-btn nerv-btn--icon"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        style={{ position: 'absolute', top: 2, right: 2, minWidth: 0, padding: '2px 4px', fontSize: 9 }}
      >
        ✕
      </button>
      <div
        onPointerDown={(e) => down(e, 'resize')}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 8,
          cursor: 'ew-resize',
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2))',
        }}
      />
    </div>
  );
}

function ClipPreview({ clip }: { clip: Clip }) {
  if (clip.kind === 'midi') {
    if (clip.notes.length === 0) return null;
    const lo = Math.min(...clip.notes.map((n) => n.pitch));
    const hi = Math.max(...clip.notes.map((n) => n.pitch));
    const range = Math.max(1, hi - lo);
    return (
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${clip.length * BEAT_W} ${ROW_H - 8}`}
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, opacity: 0.85 }}
      >
        {clip.notes.map((n) => {
          const y = ((hi - n.pitch) / range) * (ROW_H - 18) + 14;
          return (
            <rect
              key={n.id}
              x={n.start * BEAT_W}
              y={y}
              width={Math.max(2, n.length * BEAT_W)}
              height={3}
              fill="#fff"
              opacity={0.7}
            />
          );
        })}
      </svg>
    );
  }
  if (clip.kind === 'audio') {
    return <AudioWaveform sampleId={clip.sampleId} width={clip.length * BEAT_W} />;
  }
  // pattern preview: dots
  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${clip.pattern.length} 8`}
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, opacity: 0.7 }}
    >
      {Object.entries(clip.pattern.steps).map(([pad, steps], ri) =>
        steps.map((s, i) =>
          s.on ? <rect key={`${pad}${i}`} x={i + 0.05} y={ri + 0.05} width={0.9} height={0.9} fill="#fff" /> : null,
        ),
      )}
    </svg>
  );
}

function AudioWaveform({ sampleId, width }: { sampleId: string; width: number }) {
  const buffer = audioEngine.getSample(sampleId);
  if (!buffer) {
    return (
      <div
        className="hud-readout--dim hud-readout"
        style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8 }}
      >
        SAMPLE NOT LOADED
      </div>
    );
  }
  const data = buffer.getChannelData(0);
  const cols = Math.max(8, Math.min(400, Math.floor(width)));
  const block = Math.floor(data.length / cols) || 1;
  const peaks: number[] = [];
  for (let i = 0; i < cols; i++) {
    let max = 0;
    for (let j = 0; j < block; j++) {
      const v = Math.abs(data[i * block + j] ?? 0);
      if (v > max) max = v;
    }
    peaks.push(max);
  }
  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${cols} 100`}
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, opacity: 0.85 }}
    >
      {peaks.map((p, i) => (
        <rect key={i} x={i} y={50 - p * 48} width={0.9} height={Math.max(0.5, p * 96)} fill="#fff" />
      ))}
    </svg>
  );
}

function AudioImportButton({ trackId }: { trackId: string }) {
  const addAudioClip = useStore((s) => s.addAudioClip);
  return (
    <label
      className="nerv-btn nerv-btn--icon"
      title="Import audio file"
      onClick={(e) => e.stopPropagation()}
      style={{ cursor: 'pointer' }}
    >
      ⬆
      <input
        type="file"
        accept="audio/*"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            const { id, duration } = await audioEngine.loadAudioFile(file);
            addAudioClip(trackId, 0, id, duration, file.name.slice(0, 14).toUpperCase());
          } catch (err) {
            console.error(err);
            alert('Could not decode that audio file.');
          }
          e.target.value = '';
        }}
      />
    </label>
  );
}

function Playhead({ x, height }: { x: number; height: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: x,
        width: 2,
        height,
        background: 'var(--nerv-green)',
        boxShadow: '0 0 6px var(--nerv-green)',
        pointerEvents: 'none',
        zIndex: 10,
      }}
    />
  );
}
