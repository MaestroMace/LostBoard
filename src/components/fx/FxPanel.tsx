import { useStore } from '../../state/store';
import { HexFrame } from '../hud/HexFrame';
import { Knob } from '../hud/Knob';
import { DEFAULT_FX, type FxRack, type Track } from '../../audio/types';
import { useActiveTrack } from '../../hooks/useActiveTrack';

export function FxPanel() {
  const selectTrack = useStore((s) => s.selectTrack);
  const updateFx = useStore((s) => s.updateFx);

  const { pool: tracks, active: track } = useActiveTrack('any');

  if (!track) {
    return (
      <div style={{ padding: 16 }}>
        <HexFrame title="N/A">No tracks. Add one from the Arrange view.</HexFrame>
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
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        <button
          className={`hud-btn ${fx.enabled ? 'is-active' : ''}`}
          aria-pressed={fx.enabled}
          onClick={() => patch({ enabled: !fx.enabled })}
        >
          {fx.enabled ? 'RACK ONLINE' : 'RACK BYPASSED'}
        </button>
        <button className="hud-btn hud-btn--ghost" onClick={() => patch({ ...DEFAULT_FX })}>
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
            className={`hud-btn ${fx.compOn ? 'is-active' : ''}`}
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
            className={`hud-btn ${fx.chorusOn ? 'is-active' : ''}`}
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
            className={`hud-btn ${fx.bitcrushOn ? 'is-active' : ''}`}
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

        <SidechainPanel track={track} fx={fx} onPatch={patch} />
      </div>

      <HexFrame title="SIGNAL PATH" variant="green">
        <div className="hud-readout" style={{ fontSize: 10, lineHeight: 1.8 }}>
          INSTRUMENT &rarr; EQ-3 &rarr; COMP &rarr; CHORUS &rarr; CRUSH &rarr; SIDECHAIN &rarr; CHANNEL &rarr; MASTER
          BUS
          <br />
          REVERB / DELAY SENDS TAP POST-CHANNEL. RACK STATUS:{' '}
          <span style={{ color: fx.enabled ? 'var(--hud-green)' : 'var(--hud-red)' }}>
            {fx.enabled ? 'ONLINE' : 'BYPASSED'}
          </span>
        </div>
      </HexFrame>
    </div>
  );
}

/**
 * SidechainPanel — envelope-follower ducking driven by another track's
 * channel output. Web Audio's native compressor has no real sidechain
 * input, so the engine builds this as `gain = 1 - depth * follower(source)`.
 *
 * Source dropdown lists every other track (self-routing would feedback);
 * depth / attack / release knobs control the duck.
 */
function SidechainPanel({
  track,
  fx,
  onPatch,
}: {
  track: Track;
  fx: FxRack;
  onPatch: (p: Partial<FxRack>) => void;
}) {
  const allTracks = useStore((s) => s.project.tracks);
  const candidates = allTracks.filter((t) => t.id !== track.id);
  const active = !!fx.sidechainSourceId && (fx.sidechainDepth ?? 0) > 0;

  return (
    <HexFrame title="SIDECHAIN" variant={active ? 'orange' : 'soft'}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
        <span className="hud-readout" style={{ fontSize: 9 }}>SOURCE</span>
        <select
          className="display"
          value={fx.sidechainSourceId ?? ''}
          onChange={(e) => onPatch({ sidechainSourceId: e.target.value || undefined })}
          style={{ flex: 1, fontSize: 10 }}
          title="Track whose envelope ducks this one"
        >
          <option value="">OFF</option>
          {candidates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-around' }}>
        <Knob
          label="DEPTH"
          value={fx.sidechainDepth ?? 0}
          min={0}
          max={1}
          step={0.01}
          display={(v) => `${(v * 100).toFixed(0)}%`}
          onChange={(v) => onPatch({ sidechainDepth: v })}
        />
        <Knob
          label="ATK"
          value={fx.sidechainAttack ?? 0.005}
          min={0.001}
          max={0.05}
          step={0.001}
          display={(v) => `${(v * 1000).toFixed(0)}ms`}
          onChange={(v) => onPatch({ sidechainAttack: v })}
        />
        <Knob
          label="REL"
          value={fx.sidechainRelease ?? 0.15}
          min={0.01}
          max={0.5}
          step={0.005}
          display={(v) => `${(v * 1000).toFixed(0)}ms`}
          onChange={(v) => onPatch({ sidechainRelease: v })}
        />
      </div>
    </HexFrame>
  );
}
