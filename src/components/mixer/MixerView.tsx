import { memo } from 'react';
import { useStore } from '../../state/store';
import type { Track } from '../../audio/types';
import { LiveMeter } from '../hud/Meter';
import { Knob } from '../hud/Knob';
import { useLayoutMode } from '../../hooks/useLayoutMode';

/**
 * A channel strip is a tall, narrow thing, which is the wrong shape for a
 * phone held sideways: 155px of usable height cannot hold a name, two knobs,
 * two buttons, a fader and a readout, so the bottom half used to fall off the
 * screen. Landscape therefore gets rows instead of columns — same controls,
 * turned through 90°, with the slider running the long way across the screen.
 * Portrait keeps the columns, where a stretched fader now gets ~1000px of
 * travel instead of the 140px it had.
 */
export function MixerView() {
  const tracks = useStore((s) => s.project.tracks);
  const masterVolume = useStore((s) => s.project.master.volume);
  const setMasterVolume = useStore((s) => s.setMasterVolume);
  const rows = useLayoutMode() === 'phone-landscape';

  if (rows) {
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: 6,
          display: 'flex',
          flexDirection: 'row',
          gap: 6,
          contain: 'layout style',
        }}
        className="hex-grid-bg"
      >
        {/* A grid, not a column: one fader per row used 27% of the width and
            put 6 of 8 tracks off-screen. Two columns of 44px rows fit eight
            tracks in the 230px region with room to spare. */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            overflowY: 'auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gridAutoRows: `${ROW_H}px`,
            alignContent: 'start',
            gap: 4,
          }}
        >
          {tracks.map((t) => (
            <ChannelRow key={t.id} track={t} />
          ))}
        </div>
        {/* The master fader is the one you always want in reach. */}
        <MasterStrip volume={masterVolume} onVolume={setMasterVolume} compact />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', padding: 12, gap: 8, contain: 'layout style' }} className="hex-grid-bg">
      {/* Master stays pinned on the right. It used to sit at the end of the
          scroller, so on a phone it was half off-screen and easy to miss
          entirely — the one fader you always want within reach. */}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', gap: 8, overflowX: 'auto', overflowY: 'hidden', alignItems: 'stretch' }}>
        {tracks.map((t) => (
          <ChannelStrip key={t.id} track={t} />
        ))}
      </div>
      <MasterStrip volume={masterVolume} onVolume={setMasterVolume} />
    </div>
  );
}

// 44, not 56: the tallest child of a row is the Mute/Solo pair at exactly
// 44px. Zero slack — keep alignItems:'center' and never add a wrapping label.
const ROW_H = 44;

const ChannelRow = memo(function ChannelRow({ track }: { track: Track }) {
  const selected = useStore((s) => s.selectedTrackId === track.id);
  const selectTrack = useStore((s) => s.selectTrack);
  const updateTrack = useStore((s) => s.updateTrack);

  return (
    <div
      onClick={() => selectTrack(track.id)}
      style={{
        height: ROW_H,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 6px',
        background: 'rgba(0,0,0,0.6)',
        border: selected ? '1px solid #fff' : `1px solid ${track.color}88`,
        contain: 'layout style',
      }}
    >
      <div style={{ width: 4, height: '70%', background: track.color, flex: '0 0 auto' }} />
      <div
        className="hud-label"
        style={{ width: 64, fontSize: 11, flex: '0 0 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={track.name}
      >
        {track.name}
      </div>
      <MuteSolo track={track} />
      <input
        type="range"
        min={-48}
        max={6}
        step={0.5}
        value={track.volume}
        onChange={(e) => updateTrack(track.id, { volume: parseFloat(e.target.value) })}
        onClick={(e) => e.stopPropagation()}
        aria-label={`${track.name} volume`}
        className="hud-slider hud-slider--row"
        style={{ flex: 1, minWidth: 0 }}
      />
      <div className="hud-value" style={{ width: 46, textAlign: 'right', flex: '0 0 auto', fontSize: 11, whiteSpace: 'nowrap' }}>
        {track.volume.toFixed(1)}
      </div>
      <LiveMeter meterKey={track.id} axis="x" width={28} height={5} />
    </div>
  );
});

/** Shared by the column and row layouts so the wording can never drift apart. */
function MuteSolo({ track }: { track: Track }) {
  const updateTrack = useStore((s) => s.updateTrack);
  return (
    <div style={{ display: 'flex', gap: 4, flex: '0 0 auto' }}>
      <button
        className={`hud-btn hud-btn--tight ${track.mute ? 'is-active' : ''}`}
        aria-pressed={track.mute}
        onClick={(e) => {
          e.stopPropagation();
          updateTrack(track.id, { mute: !track.mute });
        }}
        title={track.mute ? `Unmute ${track.name}` : `Mute ${track.name}`}
      >
        Mute
      </button>
      <button
        className={`hud-btn hud-btn--tight ${track.solo ? 'hud-btn--green is-active' : ''}`}
        aria-pressed={track.solo}
        onClick={(e) => {
          e.stopPropagation();
          updateTrack(track.id, { solo: !track.solo });
        }}
        title={track.solo ? `Stop soloing ${track.name}` : `Hear only ${track.name}`}
      >
        Solo
      </button>
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
        minHeight: 0,
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
      <div className="hud-label" style={{ fontSize: 11, textAlign: 'center' }}>
        {track.name}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <Knob
          value={track.pan}
          min={-1}
          max={1}
          size={36}
          label="Pan"
          display={(v) => (v === 0 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)}
          onChange={(v) => updateTrack(track.id, { pan: v })}
        />
        <Knob
          value={track.swing ?? projectSwing}
          min={0}
          max={1}
          size={36}
          label="Swing"
          display={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => updateTrack(track.id, { swing: v })}
        />
      </div>
      {/* "M" and "S" are only obvious once someone has already told you. */}
      <MuteSolo track={track} />
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 6, flex: 1, minHeight: 80, width: '100%', justifyContent: 'center' }}>
        <input
          type="range"
          className="hud-slider hud-fader"
          min={-48}
          max={6}
          step={0.5}
          value={track.volume}
          onChange={(e) => updateTrack(track.id, { volume: parseFloat(e.target.value) })}
          onClick={(e) => e.stopPropagation()}
          aria-label={`${track.name} volume`}
          style={{ width: 22, height: '100%' }}
        />
        <LiveMeter meterKey={track.id} height="100%" />
      </div>
      <div className="display" style={{ fontSize: 12, width: '100%', justifyContent: 'center', flex: '0 0 auto' }}>
        {track.volume.toFixed(1)} dB
      </div>
    </div>
  );
});

const MasterStrip = memo(function MasterStrip({
  volume,
  onVolume,
  compact = false,
}: {
  volume: number;
  onVolume: (v: number) => void;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        width: compact ? 104 : 130,
        flexShrink: 0,
        minHeight: 0,
        padding: compact ? 6 : 8,
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
      <div className="hud-label" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>Master</div>
      <div
        className="hud-readout--dim hud-readout"
        style={{ fontSize: 11, whiteSpace: 'nowrap' }}
        title="A limiter catches the last 1 dB so the whole mix can't clip"
      >
        {compact ? 'Limit −1 dB' : 'Limited to −1 dB'}
      </div>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 6, flex: 1, minHeight: 80, width: '100%', justifyContent: 'center' }}>
        <input
          type="range"
          className="hud-slider hud-fader"
          min={-48}
          max={6}
          step={0.5}
          value={volume}
          onChange={(e) => onVolume(parseFloat(e.target.value))}
          aria-label="Master volume"
          style={{ width: 22, height: '100%' }}
        />
        <LiveMeter meterKey="master" height="100%" />
      </div>
      <div className="display display--big" style={{ width: '100%', justifyContent: 'center', flex: '0 0 auto' }}>
        {volume.toFixed(1)}
      </div>
    </div>
  );
});
