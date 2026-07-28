import { memo } from 'react';
import { useStore } from '../../state/store';
import type { Track } from '../../audio/types';
import { LiveMeter } from '../hud/Meter';
import { Knob } from '../hud/Knob';

export function MixerView() {
  const tracks = useStore((s) => s.project.tracks);
  const masterVolume = useStore((s) => s.project.master.volume);
  const setMasterVolume = useStore((s) => s.setMasterVolume);

  return (
    <div
      // overflowY matters as much as overflowX here: a channel strip is a fixed
      // ~320px vertical stack, so on a short landscape viewport the bottom of
      // every fader was clipped with no way to scroll down to it.
      style={{
        flex: 1,
        minHeight: 0,
        padding: 12,
        display: 'flex',
        gap: 8,
        overflowX: 'auto',
        overflowY: 'auto',
        alignItems: 'flex-start',
        contain: 'layout style',
      }}
      className="hex-grid-bg"
    >
      {tracks.map((t) => (
        <ChannelStrip key={t.id} track={t} />
      ))}
      <MasterStrip volume={masterVolume} onVolume={setMasterVolume} />
    </div>
  );
}

const ChannelStrip = memo(function ChannelStrip({ track }: { track: Track }) {
  const selected = useStore((s) => s.selectedTrackId === track.id);
  const selectTrack = useStore((s) => s.selectTrack);
  const updateTrack = useStore((s) => s.updateTrack);
  const projectSwing = useStore((s) => s.project.swing ?? 0);

  return (
    <div
      onClick={() => selectTrack(track.id)}
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
        contain: 'layout style',
      }}
    >
      <div style={{ width: '100%', height: 4, background: track.color, opacity: 0.7 }} />
      <div className="hud-label" style={{ fontSize: 8, textAlign: 'center' }}>
        {track.name}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <Knob
          value={track.pan}
          min={-1}
          max={1}
          size={36}
          label="PAN"
          display={(v) => (v === 0 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)}
          onChange={(v) => updateTrack(track.id, { pan: v })}
        />
        <Knob
          value={track.swing ?? projectSwing}
          min={0}
          max={1}
          size={36}
          label="SWING"
          display={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => updateTrack(track.id, { swing: v })}
        />
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          className={`hud-btn hud-btn--icon ${track.mute ? 'is-active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            updateTrack(track.id, { mute: !track.mute });
          }}
          style={{ fontSize: 9, minWidth: 28, padding: '2px 4px' }}
        >
          M
        </button>
        <button
          className={`hud-btn hud-btn--green hud-btn--icon ${track.solo ? 'is-active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            updateTrack(track.id, { solo: !track.solo });
          }}
          style={{ fontSize: 9, minWidth: 28, padding: '2px 4px' }}
        >
          S
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 150 }}>
        <input
          type="range"
          className="hud-slider hud-fader"
          min={-48}
          max={6}
          step={0.5}
          value={track.volume}
          onChange={(e) => updateTrack(track.id, { volume: parseFloat(e.target.value) })}
          onClick={(e) => e.stopPropagation()}
          style={{ width: 22, height: 140 }}
        />
        <LiveMeter meterKey={track.id} height={140} />
      </div>
      <div className="display" style={{ fontSize: 10, width: '100%', justifyContent: 'center' }}>
        {track.volume.toFixed(1)} dB
      </div>
    </div>
  );
});

const MasterStrip = memo(function MasterStrip({
  volume,
  onVolume,
}: {
  volume: number;
  onVolume: (v: number) => void;
}) {
  return (
    <div
      style={{
        width: 130,
        flexShrink: 0,
        padding: 8,
        background: 'rgba(40,10,0,0.7)',
        border: '1px solid var(--hud-orange)',
        boxShadow: 'var(--hud-glow)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        clipPath: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
        contain: 'layout style',
      }}
    >
      <div className="hud-label" style={{ fontSize: 9 }}>MASTER // OUT</div>
      <div className="hud-readout" style={{ fontSize: 9 }}>LIMITER -1.0 dB</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 160 }}>
        <input
          type="range"
          className="hud-slider hud-fader"
          min={-48}
          max={6}
          step={0.5}
          value={volume}
          onChange={(e) => onVolume(parseFloat(e.target.value))}
          style={{ width: 22, height: 150 }}
        />
        <LiveMeter meterKey="master" height={150} />
      </div>
      <div className="display display--big" style={{ width: '100%', justifyContent: 'center' }}>
        {volume.toFixed(1)}
      </div>
      <div className="hud-readout--green hud-readout" style={{ fontSize: 9 }}>● ACTIVE</div>
    </div>
  );
});
