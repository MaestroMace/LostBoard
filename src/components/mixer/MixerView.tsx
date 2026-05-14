import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { audioEngine } from '../../audio/engine';
import { Meter } from '../hud/Meter';
import { Knob } from '../hud/Knob';

export function MixerView() {
  const project = useStore((s) => s.project);
  const updateTrack = useStore((s) => s.updateTrack);
  const setMasterVolume = useStore((s) => s.setMasterVolume);
  const selectTrack = useStore((s) => s.selectTrack);
  const selectedTrackId = useStore((s) => s.selectedTrackId);

  return (
    <div style={{ flex: 1, minHeight: 0, padding: 12, display: 'flex', gap: 8, overflowX: 'auto' }} className="hex-grid-bg">
      {project.tracks.map((t) => (
        <ChannelStrip
          key={t.id}
          track={t}
          selected={t.id === selectedTrackId}
          onSelect={() => selectTrack(t.id)}
          onUpdate={(p) => updateTrack(t.id, p)}
        />
      ))}
      <MasterStrip volume={project.master.volume} onVolume={setMasterVolume} />
    </div>
  );
}

function useMeter(trackId: string | 'master') {
  const [level, setLevel] = useState(-60);
  useEffect(() => {
    let raf = 0;
    function tick() {
      // We can't easily get per-track here without exposing trackNodes; use master analyser for now
      // Read overall by sampling analyser RMS, scaled lightly
      const analyser = audioEngine.getAnalyser();
      if (analyser) {
        const buf = analyser.getValue();
        if (Array.isArray(buf) || ArrayBuffer.isView(buf)) {
          let sum = 0;
          const arr = buf as Float32Array;
          for (let i = 0; i < arr.length; i++) sum += arr[i] * arr[i];
          const rms = Math.sqrt(sum / arr.length);
          const db = 20 * Math.log10(rms || 1e-6);
          setLevel(db);
        }
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [trackId]);
  return level;
}

function ChannelStrip({
  track,
  selected,
  onSelect,
  onUpdate,
}: {
  track: ReturnType<typeof useStore.getState>['project']['tracks'][number];
  selected: boolean;
  onSelect: () => void;
  onUpdate: (p: Partial<typeof track>) => void;
}) {
  const level = useMeter(track.id);
  return (
    <div
      onClick={onSelect}
      style={{
        width: 116,
        flexShrink: 0,
        padding: 8,
        background: 'rgba(0,0,0,0.6)',
        border: selected ? `1px solid #fff` : `1px solid ${track.color}88`,
        boxShadow: selected ? '0 0 12px #fff' : 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        clipPath: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
        cursor: 'pointer',
      }}
    >
      <div style={{ width: '100%', height: 4, background: track.color, opacity: 0.7 }} />
      <div className="hud-label" style={{ fontSize: 8, textAlign: 'center' }}>
        {track.name}
      </div>
      <Knob
        value={track.pan}
        min={-1}
        max={1}
        size={36}
        label="PAN"
        display={(v) => (v === 0 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)}
        onChange={(v) => onUpdate({ pan: v })}
      />
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          className={`nerv-btn nerv-btn--icon ${track.mute ? 'is-active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onUpdate({ mute: !track.mute });
          }}
          style={{ fontSize: 9, minWidth: 28, padding: '2px 4px' }}
        >
          M
        </button>
        <button
          className={`nerv-btn nerv-btn--green nerv-btn--icon ${track.solo ? 'is-active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onUpdate({ solo: !track.solo });
          }}
          style={{ fontSize: 9, minWidth: 28, padding: '2px 4px' }}
        >
          S
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 150 }}>
        <input
          type="range"
          className="nerv-slider"
          min={-48}
          max={6}
          step={0.5}
          value={track.volume}
          onChange={(e) => onUpdate({ volume: parseFloat(e.target.value) })}
          onClick={(e) => e.stopPropagation()}
          style={{
            WebkitAppearance: 'slider-vertical' as any,
            width: 22,
            height: 140,
          }}
        />
        <Meter db={level} height={140} />
      </div>
      <div className="display" style={{ fontSize: 10, width: '100%', justifyContent: 'center' }}>
        {track.volume.toFixed(1)} dB
      </div>
    </div>
  );
}

function MasterStrip({ volume, onVolume }: { volume: number; onVolume: (v: number) => void }) {
  const level = useMeter('master');
  return (
    <div
      style={{
        width: 130,
        flexShrink: 0,
        padding: 8,
        background: 'rgba(40,10,0,0.7)',
        border: '1px solid var(--nerv-orange)',
        boxShadow: 'var(--hud-glow)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        clipPath: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
      }}
    >
      <div className="hud-label" style={{ fontSize: 9 }}>MASTER // OUT</div>
      <div className="hud-readout" style={{ fontSize: 9 }}>LIMITER -1.0 dB</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 160 }}>
        <input
          type="range"
          className="nerv-slider"
          min={-48}
          max={6}
          step={0.5}
          value={volume}
          onChange={(e) => onVolume(parseFloat(e.target.value))}
          style={{
            WebkitAppearance: 'slider-vertical' as any,
            width: 22,
            height: 150,
          }}
        />
        <Meter db={level} height={150} />
      </div>
      <div className="display display--big" style={{ width: '100%', justifyContent: 'center' }}>
        {volume.toFixed(1)}
      </div>
      <div className="hud-readout--green hud-readout" style={{ fontSize: 9 }}>● ACTIVE</div>
    </div>
  );
}
