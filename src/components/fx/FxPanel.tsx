import { useStore } from '../../state/store';
import { HexFrame } from '../hud/HexFrame';
import { Knob } from '../hud/Knob';
import { DEFAULT_FX, type FxRack } from '../../audio/types';

export function FxPanel() {
  const project = useStore((s) => s.project);
  const selectedTrackId = useStore((s) => s.selectedTrackId);
  const selectTrack = useStore((s) => s.selectTrack);
  const updateFx = useStore((s) => s.updateFx);

  const track = project.tracks.find((t) => t.id === selectedTrackId) ?? project.tracks[0];

  if (!track) {
    return (
      <div style={{ padding: 16 }}>
        <HexFrame title="N/A">No track selected.</HexFrame>
      </div>
    );
  }
  const fx: FxRack = track.fx ?? DEFAULT_FX;

  function patch(p: Partial<FxRack>) {
    if (!track) return;
    updateFx(track.id, p);
  }

  return (
    <div
      style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}
      className="hex-grid-bg"
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="hud-label">FX RACK // SIGNAL CONDITIONING</span>
        <select className="display" value={track.id} onChange={(e) => selectTrack(e.target.value)}>
          {project.tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        <button
          className={`nerv-btn ${fx.enabled ? 'is-active' : ''}`}
          aria-pressed={fx.enabled}
          onClick={() => patch({ enabled: !fx.enabled })}
        >
          {fx.enabled ? 'RACK ONLINE' : 'RACK BYPASSED'}
        </button>
        <button className="nerv-btn nerv-btn--ghost" onClick={() => patch({ ...DEFAULT_FX })}>
          RESET
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 12,
          opacity: fx.enabled ? 1 : 0.4,
          pointerEvents: fx.enabled ? 'auto' : 'none',
        }}
      >
        <HexFrame title="EQ // 3-BAND">
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-around' }}>
            <Knob
              label="LOW"
              value={fx.eqLow}
              min={-24}
              max={24}
              step={0.5}
              display={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`}
              onChange={(v) => patch({ eqLow: v })}
            />
            <Knob
              label="MID"
              value={fx.eqMid}
              min={-24}
              max={24}
              step={0.5}
              display={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`}
              onChange={(v) => patch({ eqMid: v })}
            />
            <Knob
              label="HIGH"
              value={fx.eqHigh}
              min={-24}
              max={24}
              step={0.5}
              display={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`}
              onChange={(v) => patch({ eqHigh: v })}
            />
          </div>
        </HexFrame>

        <HexFrame title="COMPRESSOR" variant={fx.compOn ? 'orange' : 'soft'}>
          <button
            className={`nerv-btn ${fx.compOn ? 'is-active' : ''}`}
            aria-pressed={fx.compOn}
            onClick={() => patch({ compOn: !fx.compOn })}
            style={{ width: '100%', marginBottom: 8 }}
          >
            {fx.compOn ? 'ENGAGED' : 'OFF'}
          </button>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-around' }}>
            <Knob
              label="THRESH"
              value={fx.compThreshold}
              min={-60}
              max={0}
              step={0.5}
              display={(v) => `${v.toFixed(1)}dB`}
              onChange={(v) => patch({ compThreshold: v })}
            />
            <Knob
              label="RATIO"
              value={fx.compRatio}
              min={1}
              max={20}
              step={0.5}
              display={(v) => `${v.toFixed(1)}:1`}
              onChange={(v) => patch({ compRatio: v })}
            />
          </div>
        </HexFrame>

        <HexFrame title="CHORUS" variant={fx.chorusOn ? 'orange' : 'soft'}>
          <button
            className={`nerv-btn ${fx.chorusOn ? 'is-active' : ''}`}
            aria-pressed={fx.chorusOn}
            onClick={() => patch({ chorusOn: !fx.chorusOn })}
            style={{ width: '100%', marginBottom: 8 }}
          >
            {fx.chorusOn ? 'ENGAGED' : 'OFF'}
          </button>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-around' }}>
            <Knob
              label="DEPTH"
              value={fx.chorusDepth}
              min={0}
              max={1}
              step={0.01}
              display={(v) => `${(v * 100).toFixed(0)}%`}
              onChange={(v) => patch({ chorusDepth: v })}
            />
          </div>
        </HexFrame>

        <HexFrame title="BITCRUSHER" variant={fx.bitcrushOn ? 'orange' : 'soft'}>
          <button
            className={`nerv-btn ${fx.bitcrushOn ? 'is-active' : ''}`}
            aria-pressed={fx.bitcrushOn}
            onClick={() => patch({ bitcrushOn: !fx.bitcrushOn })}
            style={{ width: '100%', marginBottom: 8 }}
          >
            {fx.bitcrushOn ? 'ENGAGED' : 'OFF'}
          </button>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-around' }}>
            <Knob
              label="BITS"
              value={fx.bitcrush}
              min={1}
              max={16}
              step={1}
              display={(v) => `${v.toFixed(0)}b`}
              onChange={(v) => patch({ bitcrush: v })}
            />
          </div>
        </HexFrame>
      </div>

      <HexFrame title="SIGNAL PATH" variant="green">
        <div className="hud-readout" style={{ fontSize: 10, lineHeight: 1.8 }}>
          INSTRUMENT &rarr; EQ-3 &rarr; COMP &rarr; CHORUS &rarr; CRUSH &rarr; CHANNEL &rarr; MASTER BUS
          <br />
          REVERB / DELAY SENDS TAP POST-CHANNEL. RACK STATUS:{' '}
          <span style={{ color: fx.enabled ? 'var(--nerv-green)' : 'var(--nerv-red)' }}>
            {fx.enabled ? 'ONLINE' : 'BYPASSED'}
          </span>
        </div>
      </HexFrame>
    </div>
  );
}
