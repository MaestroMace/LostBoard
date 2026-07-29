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
        <HexFrame title="Nothing here yet">No tracks. Add one from the Song tab.</HexFrame>
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
        <span className="hud-label">Track</span>
        <select
          className="display"
          value={track.id}
          onChange={(e) => selectTrack(e.target.value)}
          aria-label="Track to edit effects for"
        >
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
          title="Bypass every effect on this track without losing the settings"
        >
          {fx.enabled ? 'Effects on' : 'Effects bypassed'}
        </button>
        <button
          className="hud-btn hud-btn--ghost"
          onClick={() => patch({ ...DEFAULT_FX })}
          title="Return every effect on this track to its default setting"
        >
          Reset
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          // 180 rather than 240: at 240 a 411px-wide phone got one card per row,
          // so four two-knob effects became four full screens of scrolling.
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          opacity: fx.enabled ? 1 : 0.4,
          pointerEvents: fx.enabled ? 'auto' : 'none',
        }}
      >
        <HexFrame title="Tone">
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-around' }}>
            <Knob
              label="Low"
              value={fx.eqLow}
              min={-24}
              max={24}
              step={0.5}
              display={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`}
              onChange={(v) => patch({ eqLow: v })}
            />
            <Knob
              label="Mid"
              value={fx.eqMid}
              min={-24}
              max={24}
              step={0.5}
              display={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`}
              onChange={(v) => patch({ eqMid: v })}
            />
            <Knob
              label="High"
              value={fx.eqHigh}
              min={-24}
              max={24}
              step={0.5}
              display={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`}
              onChange={(v) => patch({ eqHigh: v })}
            />
          </div>
        </HexFrame>

        <HexFrame
          title="Compressor"
          variant={fx.compOn ? 'orange' : 'soft'}
          action={<SectionToggle on={fx.compOn} label="Compressor" onToggle={() => patch({ compOn: !fx.compOn })} />}
        >
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-around', opacity: fx.compOn ? 1 : 0.45 }}>
            <Knob
              label="Threshold"
              value={fx.compThreshold}
              min={-60}
              max={0}
              step={0.5}
              display={(v) => `${v.toFixed(1)}dB`}
              onChange={(v) => patch({ compThreshold: v })}
            />
            <Knob
              label="Ratio"
              value={fx.compRatio}
              min={1}
              max={20}
              step={0.5}
              display={(v) => `${v.toFixed(1)}:1`}
              onChange={(v) => patch({ compRatio: v })}
            />
          </div>
        </HexFrame>

        <HexFrame
          title="Chorus"
          variant={fx.chorusOn ? 'orange' : 'soft'}
          action={<SectionToggle on={fx.chorusOn} label="Chorus" onToggle={() => patch({ chorusOn: !fx.chorusOn })} />}
        >
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-around', opacity: fx.chorusOn ? 1 : 0.45 }}>
            <Knob
              label="Depth"
              value={fx.chorusDepth}
              min={0}
              max={1}
              step={0.01}
              display={(v) => `${(v * 100).toFixed(0)}%`}
              onChange={(v) => patch({ chorusDepth: v })}
            />
          </div>
        </HexFrame>

        <HexFrame
          title="Bit crusher"
          variant={fx.bitcrushOn ? 'orange' : 'soft'}
          action={
            <SectionToggle on={fx.bitcrushOn} label="Bit crusher" onToggle={() => patch({ bitcrushOn: !fx.bitcrushOn })} />
          }
        >
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-around', opacity: fx.bitcrushOn ? 1 : 0.45 }}>
            <Knob
              label="Bits"
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

      {/* One line, in the order sound actually travels — enough to predict what
          a change will do. The old version restated the on/off state that the
          button two inches away already shows. */}
      <div className="hud-readout--dim hud-readout" style={{ fontSize: 12, lineHeight: 1.6 }}>
        Sound passes through these in order: tone &rarr; compressor &rarr; chorus &rarr; bit crusher &rarr; ducking
        &rarr; track volume &rarr; master. Reverb and delay sends are taken after the track volume.
      </div>
    </div>
  );
}

/** Compact on/off pinned to a section heading. */
function SectionToggle({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      className={`hud-btn hud-btn--tight ${on ? 'is-active' : ''}`}
      aria-pressed={on}
      aria-label={`${label} ${on ? 'on' : 'off'}`}
      onClick={onToggle}
      style={{ flex: '0 0 auto' }}
    >
      {on ? 'On' : 'Off'}
    </button>
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
    <HexFrame title="Ducking" variant={active ? 'orange' : 'soft'}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
        <span className="hud-label">Duck under</span>
        <select
          className="display"
          value={fx.sidechainSourceId ?? ''}
          onChange={(e) => onPatch({ sidechainSourceId: e.target.value || undefined })}
          style={{ flex: 1, fontSize: 12 }}
          aria-label="Track that ducks this one"
          title="Turn this track down whenever the chosen track plays — the usual kick-and-bass pump"
        >
          <option value="">Nothing</option>
          {candidates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-around', opacity: active ? 1 : 0.45 }}>
        <Knob
          label="Amount"
          value={fx.sidechainDepth ?? 0}
          min={0}
          max={1}
          step={0.01}
          display={(v) => `${(v * 100).toFixed(0)}%`}
          onChange={(v) => onPatch({ sidechainDepth: v })}
        />
        <Knob
          label="Attack"
          value={fx.sidechainAttack ?? 0.005}
          min={0.001}
          max={0.05}
          step={0.001}
          display={(v) => `${(v * 1000).toFixed(0)}ms`}
          onChange={(v) => onPatch({ sidechainAttack: v })}
        />
        <Knob
          label="Release"
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
