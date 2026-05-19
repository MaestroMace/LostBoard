import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { HexFrame } from '../hud/HexFrame';
import { Knob } from '../hud/Knob';
import { DEFAULT_SYNTH, type SynthParams, type SynthEngine } from '../../audio/types';
import { audioEngine } from '../../audio/engine';
import { useActiveTrack } from '../../hooks/useActiveTrack';
import { importSample } from '../../state/samples';

const OSCS: SynthParams['osc'][] = ['sine', 'triangle', 'square', 'sawtooth', 'fatsawtooth', 'pwm'];

const PRESETS: Record<string, Partial<SynthParams>> = {
  'BERSERK BASS': { osc: 'square', cutoff: 500, resonance: 8, attack: 0.005, decay: 0.2, sustain: 0.5, release: 0.2, drive: 0.25, reverb: 0.05, delay: 0.0 },
  'LCL PAD': { osc: 'fatsawtooth', cutoff: 2400, resonance: 1.2, attack: 0.6, decay: 1, sustain: 0.8, release: 1.5, drive: 0, reverb: 0.6, delay: 0.25 },
  'AT-FIELD LEAD': { osc: 'sawtooth', cutoff: 3600, resonance: 4, attack: 0.005, decay: 0.15, sustain: 0.7, release: 0.4, drive: 0.15, reverb: 0.3, delay: 0.4 },
  'TANG PLUCK': { osc: 'triangle', cutoff: 1800, resonance: 1, attack: 0.001, decay: 0.18, sustain: 0, release: 0.3, drive: 0, reverb: 0.2, delay: 0.15 },
  'ANGEL CHOIR': { osc: 'sine', cutoff: 3200, resonance: 0.7, attack: 0.8, decay: 1.5, sustain: 0.9, release: 2.2, drive: 0, reverb: 0.7, delay: 0.2 },
  'NERV ARP': { osc: 'square', cutoff: 2800, resonance: 5, attack: 0.001, decay: 0.05, sustain: 0.3, release: 0.1, drive: 0.1, reverb: 0.15, delay: 0.45 },
};

export function SynthPanel() {
  const selectTrack = useStore((s) => s.selectTrack);
  const updateSynth = useStore((s) => s.updateSynth);
  const setSynthEngine = useStore((s) => s.setSynthEngine);

  const { pool: synthTracks, active } = useActiveTrack('synth');

  if (!active || !active.synth) {
    return (
      <div style={{ padding: 16 }}>
        <HexFrame title="N/A">No synth track. Add one from the Arrange view.</HexFrame>
      </div>
    );
  }
  const s = active.synth;
  const engine = active.synthEngine ?? 'subtractive';

  function patch(p: Partial<SynthParams>) {
    if (!active) return;
    updateSynth(active.id, p);
  }

  function preview(pitch: number) {
    if (!active) return;
    audioEngine.trigger(active.id, pitch, 0.9, '8n');
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }} className="hex-grid-bg">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="hud-label">INSTRUMENT // M.A.G.I. CASPER</span>
        <select
          className="display"
          value={active.id}
          onChange={(e) => selectTrack(e.target.value)}
        >
          {synthTracks.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <span className="hud-readout">ENGINE:</span>
        {(['subtractive', 'fm', 'wavetable', 'sampler'] as SynthEngine[]).map((e) => (
          <button
            key={e}
            className={`nerv-btn ${engine === e ? 'is-active' : ''}`}
            onClick={() => setSynthEngine(active.id, e)}
          >
            {e === 'subtractive' ? 'SUBTRACTIVE' : e === 'fm' ? 'FM' : e === 'wavetable' ? 'WAVETABLE' : 'SAMPLER'}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <span className="hud-readout">PRESET:</span>
        {Object.keys(PRESETS).map((k) => (
          <button key={k} className="nerv-btn" onClick={() => patch(PRESETS[k])}>{k}</button>
        ))}
        <button className="nerv-btn nerv-btn--ghost" onClick={() => patch(DEFAULT_SYNTH)}>RESET</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        {engine === 'fm' ? (
          <HexFrame title="FM CORE">
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-around' }}>
              <Knob
                label="HARMONIC"
                value={s.harmonicity}
                min={0.25}
                max={12}
                step={0.25}
                display={(v) => `${v.toFixed(2)}`}
                onChange={(v) => patch({ harmonicity: v })}
              />
              <Knob
                label="MOD IDX"
                value={s.fmDepth}
                min={0}
                max={40}
                step={0.5}
                display={(v) => `${v.toFixed(1)}`}
                onChange={(v) => patch({ fmDepth: v })}
              />
              <Knob
                label="DETUNE"
                value={s.detune}
                min={-100}
                max={100}
                step={1}
                display={(v) => `${v.toFixed(0)}c`}
                onChange={(v) => patch({ detune: v })}
              />
              <Knob
                label="GLIDE"
                value={s.glide}
                min={0}
                max={0.5}
                step={0.005}
                display={(v) => `${(v * 1000).toFixed(0)}ms`}
                onChange={(v) => patch({ glide: v })}
              />
            </div>
          </HexFrame>
        ) : engine === 'wavetable' ? (
          <HexFrame title="WAVETABLE">
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-around' }}>
              <Knob
                label="POSITION"
                value={s.wavePosition ?? 0.33}
                min={0}
                max={1}
                step={0.01}
                display={(v) => `${(v * 100).toFixed(0)}%`}
                onChange={(v) => patch({ wavePosition: v })}
              />
              <Knob label="DETUNE" value={s.detune} min={-100} max={100} step={1} display={(v) => `${v.toFixed(0)}c`} onChange={(v) => patch({ detune: v })} />
              <Knob label="GLIDE" value={s.glide} min={0} max={0.5} step={0.005} display={(v) => `${(v * 1000).toFixed(0)}ms`} onChange={(v) => patch({ glide: v })} />
            </div>
            <p className="hud-readout--dim hud-readout" style={{ fontSize: 9, margin: '8px 0 0' }}>
              POSITION morphs sine → hollow → bright → saw.
            </p>
          </HexFrame>
        ) : engine === 'sampler' ? (
          <SamplerSource trackId={active.id} />
        ) : (
        <HexFrame title="OSC">
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {OSCS.map((o) => (
              <button
                key={o}
                className={`nerv-btn ${s.osc === o ? 'is-active' : ''}`}
                onClick={() => patch({ osc: o })}
                style={{ flex: '1 1 auto' }}
              >
                {o}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-around', marginTop: 12 }}>
            <Knob label="DETUNE" value={s.detune} min={-100} max={100} step={1} display={(v) => `${v.toFixed(0)}c`} onChange={(v) => patch({ detune: v })} />
            <Knob label="UNISON" value={s.unison} min={1} max={7} step={1} display={(v) => `${v.toFixed(0)}`} onChange={(v) => patch({ unison: v })} />
            <Knob label="GLIDE" value={s.glide} min={0} max={0.5} step={0.005} display={(v) => `${(v * 1000).toFixed(0)}ms`} onChange={(v) => patch({ glide: v })} />
          </div>
        </HexFrame>
        )}

        <HexFrame title="FILTER">
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-around' }}>
            <Knob label="CUTOFF" value={s.cutoff} min={50} max={18000} step={1} log display={(v) => `${v < 1000 ? v.toFixed(0) : (v / 1000).toFixed(1) + 'k'}Hz`} onChange={(v) => patch({ cutoff: v })} />
            <Knob label="RES" value={s.resonance} min={0.1} max={20} step={0.1} display={(v) => `Q${v.toFixed(1)}`} onChange={(v) => patch({ resonance: v })} />
            <Knob label="DRIVE" value={s.drive} min={0} max={1} step={0.01} display={(v) => `${(v * 100).toFixed(0)}%`} onChange={(v) => patch({ drive: v })} />
          </div>
        </HexFrame>

        <HexFrame title="ENVELOPE">
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-around' }}>
            <Knob label="A" value={s.attack} min={0.001} max={3} step={0.005} display={(v) => `${(v * 1000).toFixed(0)}ms`} onChange={(v) => patch({ attack: v })} log />
            <Knob label="D" value={s.decay} min={0.001} max={3} step={0.005} display={(v) => `${(v * 1000).toFixed(0)}ms`} onChange={(v) => patch({ decay: v })} log />
            <Knob label="S" value={s.sustain} min={0} max={1} step={0.01} display={(v) => `${(v * 100).toFixed(0)}%`} onChange={(v) => patch({ sustain: v })} />
            <Knob label="R" value={s.release} min={0.001} max={5} step={0.005} display={(v) => `${(v * 1000).toFixed(0)}ms`} onChange={(v) => patch({ release: v })} log />
          </div>
        </HexFrame>

        <HexFrame title="FX SENDS">
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-around' }}>
            <Knob label="REVERB" value={s.reverb} min={0} max={1} step={0.01} display={(v) => `${(v * 100).toFixed(0)}%`} onChange={(v) => patch({ reverb: v })} />
            <Knob label="DELAY" value={s.delay} min={0} max={1} step={0.01} display={(v) => `${(v * 100).toFixed(0)}%`} onChange={(v) => patch({ delay: v })} />
          </div>
        </HexFrame>
      </div>

      <HexFrame title="KEYBOARD // TAP">
        <Keyboard onTrigger={preview} />
      </HexFrame>
    </div>
  );
}

function Keyboard({ onTrigger }: { onTrigger: (midi: number) => void }) {
  const [octave, setOctave] = useState(4);
  const whites = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const whiteOffsets = [0, 2, 4, 5, 7, 9, 11];
  const blackOffsets = [1, 3, undefined, 6, 8, 10, undefined];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button className="nerv-btn nerv-btn--icon" onClick={() => setOctave((o) => Math.max(1, o - 1))}>OCT -</button>
        <div className="display">OCT {octave}</div>
        <button className="nerv-btn nerv-btn--icon" onClick={() => setOctave((o) => Math.min(8, o + 1))}>OCT +</button>
      </div>
      <div style={{ display: 'flex', position: 'relative', height: 120, userSelect: 'none' }}>
        {Array.from({ length: 14 }).map((_, i) => {
          const base = octave * 12 + 12;
          const midi = base + whiteOffsets[i % 7] + Math.floor(i / 7) * 12;
          return (
            <button
              key={i}
              onPointerDown={() => onTrigger(midi)}
              style={{
                flex: 1,
                background: 'linear-gradient(180deg, #1a0a05, #0a0502)',
                border: '1px solid rgba(255,106,0,0.45)',
                color: 'var(--nerv-orange-bright)',
                fontFamily: 'var(--font-data)',
                fontSize: 9,
                padding: '4px 0 8px',
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'center',
              }}
            >
              {whites[i % 7]}{Math.floor((octave * 12 + 12 + whiteOffsets[i % 7] + Math.floor(i / 7) * 12) / 12) - 1}
            </button>
          );
        })}
        {Array.from({ length: 14 }).map((_, i) => {
          const off = blackOffsets[i % 7];
          if (off === undefined) return null;
          const base = octave * 12 + 12;
          const midi = base + off + Math.floor(i / 7) * 12;
          return (
            <button
              key={`b${i}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                onTrigger(midi);
              }}
              style={{
                position: 'absolute',
                top: 0,
                height: 70,
                width: `${100 / 14 * 0.6}%`,
                left: `${(i + 1) * (100 / 14) - (100 / 14) * 0.3}%`,
                background: 'linear-gradient(180deg, #060606, #1a0500)',
                border: '1px solid var(--nerv-orange)',
                color: 'var(--nerv-orange-bright)',
                zIndex: 2,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function midiToName(m: number) {
  return `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
}

/**
 * SamplerSource — UI for the sampler engine. Picks/loads the source sample
 * and the MIDI pitch the buffer represents at unity playback rate. The
 * sample picker pulls from the engine's runtime bank so anything already
 * imported elsewhere in the project (audio clips, pad samples) shows up
 * here too.
 *
 * Re-reads the bank when the track changes or when an upload completes —
 * the bank itself isn't a React store, so we poll on a tiny interval
 * while mounted to catch background-rehydrated samples.
 */
function SamplerSource({ trackId }: { trackId: string }) {
  const track = useStore((s) => s.project.tracks.find((t) => t.id === trackId));
  const setSamplerSample = useStore((s) => s.setSamplerSample);
  const [sampleIds, setSampleIds] = useState<string[]>(audioEngine.listSampleIds());
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const refresh = () => setSampleIds(audioEngine.listSampleIds());
    refresh();
    const tick = window.setInterval(refresh, 1000);
    return () => clearInterval(tick);
  }, []);

  const currentId = track?.samplerSampleId;
  const root = track?.samplerRootPitch ?? 60;

  async function handleUpload(file: File) {
    try {
      const { id } = await importSample(file);
      setSampleIds(audioEngine.listSampleIds());
      setSamplerSample(trackId, id, root);
    } catch (e) {
      console.error('Sample import failed', e);
      alert('Could not import sample.');
    }
  }

  return (
    <HexFrame title="SAMPLER SOURCE">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="nerv-btn nerv-btn--green" onClick={() => fileRef.current?.click()}>
            ⬆ LOAD SAMPLE
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
              e.target.value = '';
            }}
          />
          {currentId && (
            <button
              className="nerv-btn nerv-btn--ghost"
              onClick={() => setSamplerSample(trackId, null)}
            >
              ✕ CLEAR
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="hud-readout" style={{ fontSize: 10 }}>SAMPLE:</span>
          <select
            className="display"
            value={currentId ?? ''}
            onChange={(e) => setSamplerSample(trackId, e.target.value || null, root)}
            style={{ minWidth: 180 }}
          >
            <option value="">— none —</option>
            {sampleIds.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-around' }}>
          <Knob
            label="ROOT"
            value={root}
            min={24}
            max={96}
            step={1}
            display={(v) => midiToName(Math.round(v))}
            onChange={(v) => setSamplerSample(trackId, currentId ?? null, Math.round(v))}
          />
        </div>
        <p className="hud-readout--dim hud-readout" style={{ fontSize: 9, margin: 0 }}>
          ROOT = MIDI pitch the sample plays at unity rate. Notes above transpose up by resampling.
        </p>
      </div>
    </HexFrame>
  );
}
