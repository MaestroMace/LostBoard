import { memo, useRef } from 'react';
import { useStore } from '../../state/store';
import type { Clip, Track } from '../../audio/types';
import { audioEngine } from '../../audio/engine';
import { usePlayhead } from '../../state/transportClock';
import { useIsMobile } from '../../hooks/useIsMobile';
import { importSample } from '../../state/samples';

const ROW_H = 64;
const BEAT_W = 24;

export function ArrangeView() {
  const tracks = useStore((s) => s.project.tracks);
  const totalBeats = useStore((s) => s.project.lengthBars * s.project.numerator);
  const addTrack = useStore((s) => s.addTrack);
  const isMobile = useIsMobile();
  const headW = isMobile ? 144 : 196;

  const timelineW = totalBeats * BEAT_W;
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="warning-stripe--thin warning-stripe" />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* Track headers */}
        <div
          style={{
            width: headW,
            flexShrink: 0,
            background: 'rgba(0,0,0,0.7)',
            borderRight: '1px solid rgba(255,106,0,0.4)',
            display: 'flex',
            flexDirection: 'column',
            contain: 'layout style',
          }}
        >
          <div
            style={{
              height: 32,
              padding: '4px 6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 4,
              borderBottom: '1px solid rgba(255,106,0,0.4)',
            }}
          >
            {!isMobile && <span className="hud-label">TRACKS</span>}
            <div style={{ display: 'flex', gap: 3 }}>
              <button
                className="nerv-btn nerv-btn--icon"
                onClick={() => addTrack('synth')}
                title="Add synth track"
                style={{ minWidth: 0, padding: '4px 5px', fontSize: 9 }}
              >
                +SYN
              </button>
              <button
                className="nerv-btn nerv-btn--icon"
                onClick={() => addTrack('drum')}
                title="Add drum track"
                style={{ minWidth: 0, padding: '4px 5px', fontSize: 9 }}
              >
                +DRM
              </button>
              <button
                className="nerv-btn nerv-btn--icon"
                onClick={() => addTrack('audio')}
                title="Add audio track"
                style={{ minWidth: 0, padding: '4px 5px', fontSize: 9 }}
              >
                +AUD
              </button>
            </div>
          </div>
          <div style={{ overflow: 'auto', flex: 1 }}>
            {tracks.map((t) => (
              <TrackHeader key={t.id} track={t} compact={isMobile} />
            ))}
          </div>
        </div>

        {/* Timeline */}
        <div
          ref={scrollRef}
          style={{ flex: 1, overflow: 'auto', position: 'relative', contain: 'layout style' }}
          className="hex-grid-bg"
        >
          <Ruler beats={totalBeats} />
          <div style={{ position: 'relative', width: timelineW, minWidth: '100%' }}>
            {tracks.map((t) => (
              <TrackLane key={t.id} trackId={t.id} clips={t.clips} color={t.color} />
            ))}
            <Playhead height={tracks.length * ROW_H + 34} />
          </div>
        </div>
      </div>
    </div>
  );
}

const Ruler = memo(function Ruler({ beats }: { beats: number }) {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 5,
        height: 34,
        background: 'linear-gradient(180deg, rgba(255,106,0,0.18), rgba(0,0,0,0.85))',
        borderBottom: '1px solid rgba(255,106,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end' }}>
        {Array.from({ length: beats + 1 }).map((_, i) => {
          const isBar = i % 4 === 0;
          return (
            <div
              key={i}
              style={{
                width: BEAT_W,
                borderLeft: '1px solid rgba(255,106,0,0.4)',
                height: isBar ? 15 : 7,
                alignSelf: 'flex-end',
                position: 'relative',
              }}
            >
              {isBar && (
                <span className="hud-label" style={{ position: 'absolute', top: -14, left: 2, fontSize: 9 }}>
                  {i / 4 + 1}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <LoopLane beats={beats} />
    </div>
  );
});

/** Draggable loop-region strip along the bottom of the ruler. */
const LoopLane = memo(function LoopLane({ beats }: { beats: number }) {
  const loopEnabled = useStore((s) => s.project.loopEnabled);
  const loopStart = useStore((s) => s.project.loopStart);
  const loopEnd = useStore((s) => s.project.loopEnd);
  const setLoop = useStore((s) => s.setLoop);
  const laneRef = useRef<HTMLDivElement>(null);
  const drag = useRef<
    { mode: 'new' | 'move' | 'l' | 'r'; baseStart: number; baseEnd: number; downBeat: number } | null
  >(null);

  function beatAt(clientX: number): number {
    const r = laneRef.current?.getBoundingClientRect();
    if (!r) return 0;
    return Math.max(0, Math.min(beats, Math.round((clientX - r.left) / BEAT_W)));
  }
  function begin(e: React.PointerEvent, mode: 'new' | 'move' | 'l' | 'r') {
    if (mode !== 'new') e.stopPropagation();
    laneRef.current?.setPointerCapture(e.pointerId);
    drag.current = { mode, baseStart: loopStart, baseEnd: loopEnd, downBeat: beatAt(e.clientX) };
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const b = beatAt(e.clientX);
    if (d.mode === 'new') {
      const lo = Math.min(d.downBeat, b);
      const hi = Math.max(d.downBeat, b);
      if (hi > lo) setLoop(true, lo, hi);
    } else if (d.mode === 'move') {
      const len = d.baseEnd - d.baseStart;
      let ns = Math.max(0, Math.min(beats - len, d.baseStart + (b - d.downBeat)));
      setLoop(true, ns, ns + len);
    } else if (d.mode === 'l') {
      setLoop(true, Math.min(b, d.baseEnd - 1), d.baseEnd);
    } else {
      setLoop(true, d.baseStart, Math.max(b, d.baseStart + 1));
    }
  }
  function end(e: React.PointerEvent) {
    drag.current = null;
    laneRef.current?.releasePointerCapture(e.pointerId);
  }

  const x = loopStart * BEAT_W;
  const w = Math.max(2, (loopEnd - loopStart) * BEAT_W);

  return (
    <div
      ref={laneRef}
      onPointerDown={(e) => begin(e, 'new')}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      title="Drag to set the loop region"
      style={{
        position: 'relative',
        height: 13,
        background: 'rgba(0,0,0,0.5)',
        borderTop: '1px solid rgba(255,106,0,0.25)',
        cursor: 'crosshair',
        touchAction: 'none',
      }}
    >
      <div
        onPointerDown={(e) => begin(e, 'move')}
        style={{
          position: 'absolute',
          left: x,
          width: w,
          top: 0,
          bottom: 0,
          background: loopEnabled ? 'rgba(255,106,0,0.4)' : 'rgba(255,106,0,0.12)',
          border: `1px solid ${loopEnabled ? 'var(--nerv-orange)' : 'rgba(255,106,0,0.4)'}`,
          boxShadow: loopEnabled ? '0 0 6px rgba(255,106,0,0.5)' : 'none',
          cursor: 'grab',
          touchAction: 'none',
        }}
      >
        <div
          onPointerDown={(e) => begin(e, 'l')}
          style={{ position: 'absolute', left: -3, top: 0, bottom: 0, width: 8, cursor: 'ew-resize', touchAction: 'none' }}
        />
        <div
          onPointerDown={(e) => begin(e, 'r')}
          style={{ position: 'absolute', right: -3, top: 0, bottom: 0, width: 8, cursor: 'ew-resize', touchAction: 'none' }}
        />
      </div>
    </div>
  );
});

/** Memoized track header — only re-renders when ITS track object changes. */
const TrackHeader = memo(function TrackHeader({ track, compact }: { track: Track; compact: boolean }) {
  const selected = useStore((s) => s.selectedTrackId === track.id);
  const selectTrack = useStore((s) => s.selectTrack);
  const updateTrack = useStore((s) => s.updateTrack);
  const removeTrack = useStore((s) => s.removeTrack);
  const setView = useStore((s) => s.setView);

  return (
    <div
      onClick={() => selectTrack(track.id)}
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
        contain: 'layout style',
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
          onChange={(e) => updateTrack(track.id, { name: e.target.value })}
          onClick={(e) => e.stopPropagation()}
        />
        {track.kind === 'audio' ? (
          <AudioImportButton trackId={track.id} />
        ) : (
          <button
            className="nerv-btn nerv-btn--icon"
            onClick={(e) => {
              e.stopPropagation();
              selectTrack(track.id);
              setView(track.kind === 'drum' ? 'sequencer' : 'instrument');
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
            if (confirm(`Delete track "${track.name}"?`)) removeTrack(track.id);
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
            updateTrack(track.id, { mute: !track.mute });
          }}
          style={{ minWidth: 28, padding: '4px 6px', fontSize: 9 }}
        >
          M
        </button>
        <button
          className={`nerv-btn nerv-btn--green nerv-btn--icon ${track.solo ? 'is-active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            updateTrack(track.id, { solo: !track.solo });
          }}
          style={{ minWidth: 28, padding: '4px 6px', fontSize: 9 }}
        >
          S
        </button>
        <button
          className={`nerv-btn nerv-btn--rec nerv-btn--icon ${track.arm ? 'is-active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            updateTrack(track.id, { arm: !track.arm });
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
          onChange={(e) => updateTrack(track.id, { volume: parseFloat(e.target.value) })}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          style={{ flex: 1, height: 6 }}
        />
        {!compact && (
          <span className="hud-readout" style={{ fontSize: 8, width: 28, textAlign: 'right' }}>
            {track.volume.toFixed(0)}
          </span>
        )}
      </div>
    </div>
  );
});

/**
 * Memoized lane — re-renders only when this track's clip list / colour
 * changes, NOT when the track's mute/volume/synth params change.
 */
const TrackLane = memo(function TrackLane({
  trackId,
  clips,
  color,
}: {
  trackId: string;
  clips: Clip[];
  color: string;
}) {
  const addClip = useStore((s) => s.addClip);
  const selectTrack = useStore((s) => s.selectTrack);

  return (
    <div
      style={{
        position: 'relative',
        height: ROW_H,
        borderBottom: '1px solid rgba(255,106,0,0.18)',
        background: `linear-gradient(180deg, ${color}10, transparent)`,
        contain: 'layout style',
      }}
      onDoubleClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const beat = Math.max(0, Math.floor((e.clientX - r.left) / BEAT_W));
        selectTrack(trackId);
        addClip(trackId, beat, 4);
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'linear-gradient(90deg, rgba(255,106,0,0.18) 1px, transparent 1px)',
          backgroundSize: `${BEAT_W * 4}px 100%`,
          pointerEvents: 'none',
        }}
      />
      {clips.map((c) => (
        <ClipBlock key={c.id} clip={c} color={color} />
      ))}
    </div>
  );
});

/** Memoized clip. Drag/resize happens via direct DOM mutation — zero React renders mid-drag. */
const ClipBlock = memo(function ClipBlock({ clip, color }: { clip: Clip; color: string }) {
  const selected = useStore((s) => s.selectedClipId === clip.id);
  const selectClip = useStore((s) => s.selectClip);
  const selectTrack = useStore((s) => s.selectTrack);
  const setView = useStore((s) => s.setView);
  const moveClip = useStore((s) => s.moveClip);
  const resizeClip = useStore((s) => s.resizeClip);
  const removeClip = useStore((s) => s.removeClip);

  const elRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: 'move' | 'resize'; startX: number; baseStart: number; baseLen: number } | null>(
    null,
  );

  function down(e: React.PointerEvent, mode: 'move' | 'resize') {
    e.stopPropagation();
    selectClip(clip.id);
    elRef.current?.setPointerCapture(e.pointerId);
    drag.current = { mode, startX: e.clientX, baseStart: clip.start, baseLen: clip.length };
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    const el = elRef.current;
    if (!d || !el) return;
    const dBeats = Math.round((e.clientX - d.startX) / BEAT_W);
    if (d.mode === 'move') {
      el.style.left = `${Math.max(0, d.baseStart + dBeats) * BEAT_W}px`;
    } else {
      el.style.width = `${Math.max(0.5, d.baseLen + dBeats) * BEAT_W - 2}px`;
    }
  }
  function up(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dBeats = Math.round((e.clientX - d.startX) / BEAT_W);
    if (d.mode === 'move') moveClip(clip.id, Math.max(0, d.baseStart + dBeats));
    else resizeClip(clip.id, Math.max(0.5, d.baseLen + dBeats));
    drag.current = null;
    elRef.current?.releasePointerCapture(e.pointerId);
  }

  return (
    <div
      ref={elRef}
      onPointerDown={(e) => down(e, 'move')}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={(e) => {
        e.stopPropagation();
        selectTrack(clip.trackId);
        setView(clip.kind === 'pattern' ? 'sequencer' : clip.kind === 'midi' ? 'pianoroll' : 'arrange');
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
        touchAction: 'none',
        contain: 'layout style paint',
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
          removeClip(clip.id);
        }}
        onPointerDown={(e) => e.stopPropagation()}
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
          width: 10,
          cursor: 'ew-resize',
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2))',
          touchAction: 'none',
        }}
      />
    </div>
  );
});

const ClipPreview = memo(function ClipPreview({ clip }: { clip: Clip }) {
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
});

function AudioWaveform({ sampleId, width }: { sampleId: string; width: number }) {
  const buffer = audioEngine.getSample(sampleId);
  if (!buffer) {
    return (
      <div
        className="hud-readout--dim hud-readout"
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 8,
        }}
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
            const { id, duration } = await importSample(file);
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

/** Leaf — the only thing that re-renders as the playhead moves. */
const Playhead = memo(function Playhead({ height }: { height: number }) {
  const positionBeats = usePlayhead();
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: 2,
        height,
        background: 'var(--nerv-green)',
        boxShadow: '0 0 6px var(--nerv-green)',
        pointerEvents: 'none',
        zIndex: 10,
        transform: `translateX(${positionBeats * BEAT_W}px)`,
        willChange: 'transform',
      }}
    />
  );
});
