import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useStore, currentSamplerZones } from '../../state/store';
import { HexFrame } from '../hud/HexFrame';
import { Knob } from '../hud/Knob';
import { DEFAULT_SYNTH, type SynthParams, type SynthEngine } from '../../audio/types';
import { audioEngine } from '../../audio/engine';
import { midiOutput, subscribeMidiOut, getMidiOutSnapshot } from '../../audio/midiOutput';
import { useActiveTrack } from '../../hooks/useActiveTrack';
import { importSample } from '../../state/samples';
import { useLayoutMode } from '../../hooks/useLayoutMode';

const OSCS: SynthParams['osc'][] = ['sine', 'triangle', 'square', 'sawtooth', 'fatsawtooth', 'pwm'];

/** Waveform names as people say them, not as Tone.js spells them. */
const OSC_LABEL: Record<SynthParams['osc'], string> = {
  sine: 'Sine',
  triangle: 'Triangle',
  square: 'Square',
  sawtooth: 'Saw',
  fatsawtooth: 'Fat saw',
  pwm: 'Pulse',
};

const ENGINES: { id: SynthEngine; label: string; hint: string }[] = [
  { id: 'subtractive', label: 'Classic', hint: 'A waveform run through a filter — the familiar analogue sound' },
  { id: 'fm', label: 'FM', hint: 'One tone bending another: bells, metallic and electric-piano sounds' },
  { id: 'wavetable', label: 'Wavetable', hint: 'Draw your own waveform from harmonics' },
  { id: 'sampler', label: 'Sampler', hint: 'Play a recording of your own back across the keyboard' },
];

const PRESETS: Record<string, Partial<SynthParams>> = {
  'Bass': { osc: 'square', cutoff: 500, resonance: 8, attack: 0.005, decay: 0.2, sustain: 0.5, release: 0.2, drive: 0.25, reverb: 0.05, delay: 0.0 },
  'Pad': { osc: 'fatsawtooth', cutoff: 2400, resonance: 1.2, attack: 0.6, decay: 1, sustain: 0.8, release: 1.5, drive: 0, reverb: 0.6, delay: 0.25 },
  'Lead': { osc: 'sawtooth', cutoff: 3600, resonance: 4, attack: 0.005, decay: 0.15, sustain: 0.7, release: 0.4, drive: 0.15, reverb: 0.3, delay: 0.4 },
  'Pluck': { osc: 'triangle', cutoff: 1800, resonance: 1, attack: 0.001, decay: 0.18, sustain: 0, release: 0.3, drive: 0, reverb: 0.2, delay: 0.15 },
  'Choir': { osc: 'sine', cutoff: 3200, resonance: 0.7, attack: 0.8, decay: 1.5, sustain: 0.9, release: 2.2, drive: 0, reverb: 0.7, delay: 0.2 },
  'Arp': { osc: 'square', cutoff: 2800, resonance: 5, attack: 0.001, decay: 0.05, sustain: 0.3, release: 0.1, drive: 0.1, reverb: 0.15, delay: 0.45 },
};

export function SynthPanel() {
  const mode = useLayoutMode();
  /** Landscape gets one 44px row of dropdowns instead of three labelled rows
   *  of chips — the header was 144px of a 230px content region, and not one
   *  of the twelve knobs was fully visible at rest. */
  const land = mode === 'phone-landscape';
  const selectTrack = useStore((s) => s.selectTrack);
  const updateSynth = useStore((s) => s.updateSynth);
  const setSynthEngine = useStore((s) => s.setSynthEngine);

  const { pool: synthTracks, active } = useActiveTrack('synth');

  if (!active || !active.synth) {
    return (
      <div style={{ padding: 16 }}>
        <HexFrame title="No instrument track">Add a synth track from the Song tab, then come back here to shape its sound.</HexFrame>
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
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        padding: land ? 6 : 12,
        display: 'flex',
        flexDirection: 'column',
        gap: land ? 8 : 12,
      }}
      className="hex-grid-bg"
    >
      {land ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', height: 44, flex: '0 0 auto', flexWrap: 'nowrap', overflowX: 'auto' }}>
          <select
            className="display"
            value={active.id}
            onChange={(e) => selectTrack(e.target.value)}
            aria-label="Track to edit the sound of"
            style={{ maxWidth: 120 }}
          >
            {synthTracks.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <select
            className="display"
            value={engine}
            onChange={(e) => setSynthEngine(active.id, e.target.value as SynthEngine)}
            aria-label="How this instrument makes sound"
            style={{ maxWidth: 130 }}
          >
            {ENGINES.map((e) => (
              <option key={e.id} value={e.id}>{e.label}</option>
            ))}
          </select>
          {engine === 'subtractive' && (
            <select
              className="display"
              value={s.osc}
              onChange={(e) => patch({ osc: e.target.value as SynthParams['osc'] })}
              aria-label="Waveform"
              style={{ maxWidth: 120 }}
            >
              {OSCS.map((o) => (
                <option key={o} value={o}>{OSC_LABEL[o]}</option>
              ))}
            </select>
          )}
          <select
            className="display"
            value=""
            onChange={(e) => {
              const k = e.target.value;
              if (k) patch(PRESETS[k]);
              e.target.value = '';
            }}
            aria-label="Load a starting point"
            style={{ maxWidth: 130 }}
          >
            <option value="">Starting point…</option>
            {Object.keys(PRESETS).map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <button
            className="hud-btn hud-btn--ghost hud-btn--tight"
            onClick={() => patch(DEFAULT_SYNTH)}
            title="Put every control on this page back to its starting value"
          >
            Reset
          </button>
        </div>
      ) : (
      <>{/* Three separate rows, not one wrapping row. As a single flex line the
          groups interleaved once they wrapped: "Preset" ended up stranded at
          the end of the engine buttons, with its own buttons on the line
          below, so the header read as one undifferentiated wall of chips. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="hud-label" style={{ minWidth: 64 }}>Track</span>
          <select
            className="display"
            value={active.id}
            onChange={(e) => selectTrack(e.target.value)}
            aria-label="Track to edit the sound of"
            // capped: on a wide screen `flex: 1` stretched a three-item
            // dropdown across 1500px
            style={{ flex: '1 1 120px', minWidth: 0, maxWidth: 260 }}
          >
            {synthTracks.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button
            className="hud-btn hud-btn--ghost"
            onClick={() => patch(DEFAULT_SYNTH)}
            title="Put every control on this page back to its starting value"
          >
            Reset
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="hud-label" style={{ minWidth: 64 }} title="How this instrument makes sound">
            Type
          </span>
          {ENGINES.map((e) => (
            <button
              key={e.id}
              className={`hud-btn hud-btn--tight ${engine === e.id ? 'is-active' : ''}`}
              aria-pressed={engine === e.id}
              onClick={() => setSynthEngine(active.id, e.id)}
              title={e.hint}
            >
              {e.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="hud-label" style={{ minWidth: 64 }} title="A starting point you can then change">
            Starting point
          </span>
          {Object.keys(PRESETS).map((k) => (
            <button key={k} className="hud-btn hud-btn--tight" onClick={() => patch(PRESETS[k])}>
              {k}
            </button>
          ))}
        </div>
      </div>
      </>
      )}

      {/* A wrapping grid with align-items:stretch inflated every frame to the
          tallest row and left a whole empty cell; landscape lays them in one
          scrollable strip so each frame is only as tall as its contents. */}
      <div
        style={
          land
            ? { display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'nowrap', overflowX: 'auto', flex: '0 0 auto' }
            : { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, alignItems: 'flex-start' }
        }
      >
        {engine === 'fm' ? (
          <HexFrame title="FM">
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-around' }}>
              <Knob
                label="Ratio"
                value={s.harmonicity}
                min={0.25}
                max={12}
                step={0.25}
                display={(v) => `${v.toFixed(2)}`}
                onChange={(v) => patch({ harmonicity: v })}
              />
              <Knob
                label="Amount"
                value={s.fmDepth}
                min={0}
                max={40}
                step={0.5}
                display={(v) => `${v.toFixed(1)}`}
                onChange={(v) => patch({ fmDepth: v })}
              />
              <Knob
                label="Detune"
                value={s.detune}
                min={-100}
                max={100}
                step={1}
                display={(v) => `${v.toFixed(0)}c`}
                onChange={(v) => patch({ detune: v })}
              />
              <Knob
                label="Glide"
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
          <WavetablePanel trackId={active.id} synth={s} patch={patch} partials={active.wavetablePartials} />
        ) : engine === 'sampler' ? (
          <SamplerSource trackId={active.id} />
        ) : (
        <HexFrame title="Waveform">
          {/* The same choice is a dropdown in the landscape header; as buttons
              it wrapped to two 44px rows and was the sole reason this frame
              was 217px instead of 113px. */}
          <div style={{ display: land ? 'none' : 'flex', gap: 4, flexWrap: 'wrap' }}>
            {OSCS.map((o) => (
              <button
                key={o}
                className={`hud-btn hud-btn--tight ${s.osc === o ? 'is-active' : ''}`}
                aria-pressed={s.osc === o}
                onClick={() => patch({ osc: o })}
                style={{ flex: '0 1 auto' }}
              >
                {OSC_LABEL[o]}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-around', marginTop: 12 }}>
            <Knob label="Detune" value={s.detune} min={-100} max={100} step={1} display={(v) => `${v.toFixed(0)}c`} onChange={(v) => patch({ detune: v })} />
            <Knob label="Voices" value={s.unison} min={1} max={7} step={1} display={(v) => `${v.toFixed(0)}`} onChange={(v) => patch({ unison: v })} />
            <Knob label="Glide" value={s.glide} min={0} max={0.5} step={0.005} display={(v) => `${(v * 1000).toFixed(0)}ms`} onChange={(v) => patch({ glide: v })} />
          </div>
        </HexFrame>
        )}

        <HexFrame title="Filter">
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-around' }}>
            <Knob label="Cutoff" title="How much of the bright, high part of the sound gets through" value={s.cutoff} min={50} max={18000} step={1} log display={(v) => `${v < 1000 ? v.toFixed(0) : (v / 1000).toFixed(1) + 'k'}Hz`} onChange={(v) => patch({ cutoff: v })} />
            <Knob label="Resonance" title="Emphasises the frequencies right at the cutoff — the classic squelch" value={s.resonance} min={0.1} max={20} step={0.1} display={(v) => `Q${v.toFixed(1)}`} onChange={(v) => patch({ resonance: v })} />
            <Knob label="Drive" title="Pushes the sound harder, adding grit" value={s.drive} min={0} max={1} step={0.01} display={(v) => `${(v * 100).toFixed(0)}%`} onChange={(v) => patch({ drive: v })} />
          </div>
        </HexFrame>

        <HexFrame title="Shape over time">
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-around' }}>
            <Knob label="Attack" title="How long the note takes to reach full volume" value={s.attack} min={0.001} max={3} step={0.005} display={(v) => `${(v * 1000).toFixed(0)}ms`} onChange={(v) => patch({ attack: v })} log />
            <Knob label="Decay" title="How fast it falls back after the attack" value={s.decay} min={0.001} max={3} step={0.005} display={(v) => `${(v * 1000).toFixed(0)}ms`} onChange={(v) => patch({ decay: v })} log />
            <Knob label="Sustain" title="The level it holds at while the note is held" value={s.sustain} min={0} max={1} step={0.01} display={(v) => `${(v * 100).toFixed(0)}%`} onChange={(v) => patch({ sustain: v })} />
            <Knob label="Release" title="How long the sound takes to fade after the note ends" value={s.release} min={0.001} max={5} step={0.005} display={(v) => `${(v * 1000).toFixed(0)}ms`} onChange={(v) => patch({ release: v })} log />
          </div>
        </HexFrame>

        <HexFrame title="Space">
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-around' }}>
            <Knob label="Reverb" value={s.reverb} min={0} max={1} step={0.01} display={(v) => `${(v * 100).toFixed(0)}%`} onChange={(v) => patch({ reverb: v })} />
            <Knob label="Delay" value={s.delay} min={0} max={1} step={0.01} display={(v) => `${(v * 100).toFixed(0)}%`} onChange={(v) => patch({ delay: v })} />
          </div>
        </HexFrame>

        <MidiOutPanel trackId={active.id} channel={active.midiOutChannel} />
      </div>

      {/* No frame in landscape: 20px of title plus 8px of margin plus padding
          for a row of piano keys that needs no label. */}
      {land ? (
        <div style={{ flex: '0 0 auto' }}>
          <Keyboard onTrigger={preview} />
        </div>
      ) : (
        <HexFrame title="Keyboard">
          <Keyboard onTrigger={preview} />
        </HexFrame>
      )}
    </div>
  );
}

function Keyboard({ onTrigger }: { onTrigger: (midi: number) => void }) {
  // Landscape lays the octave controls beside the keys and shortens them: with
  // the keyboard stacked, there was no scroll position in the whole 754px
  // panel where a knob and a key were both visible, so you could not turn a
  // control and hear what it did.
  const land = useLayoutMode() === 'phone-landscape';
  const [octave, setOctave] = useState(4);
  const whites = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const whiteOffsets = [0, 2, 4, 5, 7, 9, 11];
  const blackOffsets = [1, 3, undefined, 6, 8, 10, undefined];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          className="hud-btn hud-btn--icon"
          onClick={() => setOctave((o) => Math.max(1, o - 1))}
          aria-label="Octave down"
          title="Move the keyboard down an octave"
        >
          &minus;
        </button>
        <div className="display">Octave {octave}</div>
        <button
          className="hud-btn hud-btn--icon"
          onClick={() => setOctave((o) => Math.min(8, o + 1))}
          aria-label="Octave up"
          title="Move the keyboard up an octave"
        >
          +
        </button>
      </div>
      {/* data-overlap-ok: black keys deliberately sit on top of the white keys —
          this is a piano, not a broken layout. */}
      <div data-overlap-ok style={{ display: 'flex', position: 'relative', flex: 1, minWidth: 0, height: land ? 96 : 120, userSelect: 'none' }}>
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
                color: 'var(--hud-orange-bright)',
                fontFamily: 'var(--font-data)',
                fontSize: 12,
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
              aria-label={midiToName(midi)}
              title={midiToName(midi)}
              onPointerDown={(e) => {
                e.stopPropagation();
                onTrigger(midi);
              }}
              style={{
                position: 'absolute',
                top: 0,
                // 58% of the container, not a hard-coded 70 against a 120px
                // box — the keyboard is shorter in landscape
                height: '58%',
                width: `${100 / 14 * 0.6}%`,
                left: `${(i + 1) * (100 / 14) - (100 / 14) * 0.3}%`,
                background: 'linear-gradient(180deg, #060606, #1a0500)',
                border: '1px solid var(--hud-orange)',
                color: 'var(--hud-orange-bright)',
                zIndex: 2,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * WavetablePanel — the wavetable engine's editor. POSITION morphs the
 * oscillator timbre; LOAD WAVETABLE imports an audio file and derives a
 * harmonic partials array from it (POSITION then morphs sine → that wave).
 * A small SVG draws the active harmonic spectrum.
 */
function WavetablePanel({
  trackId,
  synth,
  patch,
  partials,
}: {
  trackId: string;
  synth: SynthParams;
  patch: (p: Partial<SynthParams>) => void;
  partials?: number[];
}) {
  const updateTrack = useStore((s) => s.updateTrack);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function loadWavetable(file: File) {
    setBusy(true);
    try {
      const { partialsFromBuffer } = await import('../../audio/wavetable');
      const buffer = await audioEngine.decodeOnly(file);
      const p = partialsFromBuffer(buffer);
      updateTrack(trackId, { wavetablePartials: p });
    } catch (e) {
      console.error('Wavetable import failed', e);
      alert('Could not derive a wavetable from that file.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <HexFrame title="Wave">
      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-around' }}>
        <Knob
          label="Position"
          value={synth.wavePosition ?? 0.33}
          min={0}
          max={1}
          step={0.01}
          display={(v) => `${(v * 100).toFixed(0)}%`}
          onChange={(v) => patch({ wavePosition: v })}
        />
        <Knob label="Detune" value={synth.detune} min={-100} max={100} step={1} display={(v) => `${v.toFixed(0)}c`} onChange={(v) => patch({ detune: v })} />
        <Knob label="Glide" value={synth.glide} min={0} max={0.5} step={0.005} display={(v) => `${(v * 1000).toFixed(0)}ms`} onChange={(v) => patch({ glide: v })} />
      </div>

      {partials && partials.length > 0 && (
        <svg
          viewBox="0 0 100 24"
          preserveAspectRatio="none"
          width="100%"
          height={32}
          style={{ marginTop: 8, background: 'rgba(255,106,0,0.06)', border: '1px solid rgba(255,106,0,0.25)' }}
        >
          {partials.map((amp, i) => {
            const w = 100 / partials.length;
            const h = Math.max(0.5, amp * 23);
            return (
              <rect
                key={i}
                x={i * w + w * 0.15}
                y={24 - h}
                width={w * 0.7}
                height={h}
                fill="var(--hud-orange-bright)"
              />
            );
          })}
        </svg>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="hud-btn hud-btn--green" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? '⌛ ANALYSING' : '⬆ LOAD WAVETABLE'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadWavetable(f);
            e.target.value = '';
          }}
        />
        {partials && partials.length > 0 && (
          <button
            className="hud-btn hud-btn--ghost"
            onClick={() => updateTrack(trackId, { wavetablePartials: undefined })}
          >
            ✕ CLEAR
          </button>
        )}
      </div>
      <p className="hud-readout--dim hud-readout" style={{ fontSize: 12, margin: '6px 0 0' }}>
        {partials && partials.length > 0
          ? 'POSITION morphs sine → the loaded wavetable.'
          : 'POSITION morphs sine → hollow → bright → saw. Load a sample to derive a custom wave.'}
      </p>
    </HexFrame>
  );
}

/**
 * MidiOutPanel — routes a track's notes to an external Web MIDI device.
 * The output port is a global pick (one selected port for the whole app);
 * the channel is per-track. When a channel is set the engine sends MIDI
 * for that track and skips its internal voice, so the sound comes from
 * the hardware. Channel 0 (OFF) keeps the internal instrument.
 */
function MidiOutPanel({ trackId, channel }: { trackId: string; channel?: number }) {
  const updateTrack = useStore((s) => s.updateTrack);
  const midi = useSyncExternalStore(subscribeMidiOut, getMidiOutSnapshot, getMidiOutSnapshot);

  // The Android WebView has no Web MIDI, so this rendered a whole framed
  // panel containing one apologetic sentence.
  if (!midi.supported) return null;
  return (
    <HexFrame title="MIDI out">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {false ? null : (
          <>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span className="hud-label">Device</span>
              <select
                className="display"
                value={midi.selectedId}
                onChange={(e) => midiOutput.selectOutput(e.target.value)}
                style={{ flex: 1, minWidth: 0 }}
              >
                {midi.ports.length === 0 && <option value="">— no output devices —</option>}
                {midi.ports.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span className="hud-label">Channel</span>
              <select
                className="display"
                value={channel ?? 0}
                onChange={(e) => {
                  const ch = parseInt(e.target.value, 10);
                  updateTrack(trackId, { midiOutChannel: ch === 0 ? undefined : ch });
                }}
              >
                <option value={0}>Use the built-in sound</option>
                {Array.from({ length: 16 }, (_, i) => i + 1).map((ch) => (
                  <option key={ch} value={ch}>Channel {ch}</option>
                ))}
              </select>
            </div>
            <p className="hud-readout--dim hud-readout" style={{ margin: 0, fontSize: 12 }}>
              When a channel is set, this track's notes drive the hardware and the
              internal voice is silent.
            </p>
          </>
        )}
      </div>
    </HexFrame>
  );
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** A black key has no text, so without a name it is a button no screen reader can announce. */
function midiToName(m: number) {
  return `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
}

/**
 * SamplerSource — multi-zone editor for the sampler engine. Each zone is a
 * sample anchored at a root MIDI pitch; Tone.Sampler interpolates between
 * zones across the keyboard, so one zone behaves like a basic one-shot and
 * several cover a wider range cleanly.
 *
 * The sample picker pulls from the engine's runtime bank so anything
 * already imported elsewhere (audio clips, pad samples) shows up. The bank
 * isn't a React store, so we poll on a small interval while mounted to
 * catch background-rehydrated samples.
 */
function SamplerSource({ trackId }: { trackId: string }) {
  const track = useStore((s) => s.project.tracks.find((t) => t.id === trackId));
  const addSamplerZone = useStore((s) => s.addSamplerZone);
  const updateSamplerZone = useStore((s) => s.updateSamplerZone);
  const removeSamplerZone = useStore((s) => s.removeSamplerZone);
  const [sampleIds, setSampleIds] = useState<string[]>(audioEngine.listSampleIds());
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const refresh = () => setSampleIds(audioEngine.listSampleIds());
    refresh();
    const tick = window.setInterval(refresh, 1000);
    return () => clearInterval(tick);
  }, []);

  const zones = track ? currentSamplerZones(track) : [];

  async function handleUpload(file: File) {
    try {
      const { id } = await importSample(file);
      setSampleIds(audioEngine.listSampleIds());
      // new zone defaults a sensible root pitch one octave up per existing zone
      addSamplerZone(trackId, id, 60 + zones.length * 12);
    } catch (e) {
      console.error('Sample import failed', e);
      alert('Could not import sample.');
    }
  }

  return (
    <HexFrame title="Your recordings">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="hud-btn hud-btn--green" onClick={() => fileRef.current?.click()}>
            + Add a recording
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
          {sampleIds.length > 0 && (
            <button
              className="hud-btn"
              onClick={() => addSamplerZone(trackId, sampleIds[0], 60 + zones.length * 12)}
            >
              + Another layer
            </button>
          )}
        </div>

        {zones.length === 0 ? (
          <p className="hud-readout--dim hud-readout" style={{ margin: 0, fontSize: 13 }}>
            No zones yet. Load a sample to start — add more zones at different root pitches
            for a cleanly multi-sampled instrument.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {zones.map((zone, i) => (
              <div
                key={zone.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '52px 1fr 96px 120px 40px',
                  gap: 6,
                  alignItems: 'center',
                  padding: '4px 6px',
                  background: 'rgba(0,0,0,0.4)',
                  border: '1px solid rgba(255,106,0,0.2)',
                }}
              >
                <span className="hud-value" style={{ fontSize: 12 }}>ZN-{String(i + 1).padStart(2, '0')}</span>
                <select
                  className="display"
                  value={zone.sampleId}
                  onChange={(e) => updateSamplerZone(trackId, zone.id, { sampleId: e.target.value })}
                  style={{ minWidth: 0 }}
                >
                  {!sampleIds.includes(zone.sampleId) && (
                    <option value={zone.sampleId}>{zone.sampleId} (missing)</option>
                  )}
                  {sampleIds.map((id) => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </select>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span className="hud-label" style={{ fontSize: 12 }} title="The key this recording plays back at its original pitch">Root</span>
                  <input
                    className="display"
                    type="number"
                    min={12}
                    max={108}
                    value={zone.rootPitch}
                    onChange={(e) =>
                      updateSamplerZone(trackId, zone.id, {
                        rootPitch: Math.max(12, Math.min(108, parseInt(e.target.value) || 60)),
                      })
                    }
                    style={{ width: 44 }}
                  />
                  <span className="hud-readout--dim hud-readout" style={{ fontSize: 12, minWidth: 28 }}>
                    {midiToName(zone.rootPitch)}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 3 }} title="How hard you have to play for this recording to sound (%)">
                  <span className="hud-label" style={{ fontSize: 12 }}>Loud</span>
                  <input
                    className="display"
                    type="number"
                    min={0}
                    max={100}
                    value={Math.round((zone.velMin ?? 0) * 100)}
                    onChange={(e) => {
                      const v = Math.max(0, Math.min(100, parseInt(e.target.value) || 0)) / 100;
                      updateSamplerZone(trackId, zone.id, { velMin: Math.min(v, zone.velMax ?? 1) });
                    }}
                    style={{ width: 38 }}
                  />
                  <span className="hud-readout--dim hud-readout" style={{ fontSize: 12 }}>–</span>
                  <input
                    className="display"
                    type="number"
                    min={0}
                    max={100}
                    value={Math.round((zone.velMax ?? 1) * 100)}
                    onChange={(e) => {
                      const v = Math.max(0, Math.min(100, parseInt(e.target.value) || 0)) / 100;
                      updateSamplerZone(trackId, zone.id, { velMax: Math.max(v, zone.velMin ?? 0) });
                    }}
                    style={{ width: 38 }}
                  />
                </div>
                <button
                  className="hud-btn hud-btn--icon hud-btn--rec"
                  onClick={() => removeSamplerZone(trackId, zone.id)}
                  title="Remove zone"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="hud-readout--dim hud-readout" style={{ fontSize: 12, margin: 0 }}>
          ROOT = MIDI pitch a zone's sample plays at unity rate. VEL = velocity range
          (%) the zone responds to — give zones different ranges for velocity layers.
          Zones sharing a range key-map together.
        </p>
      </div>
    </HexFrame>
  );
}
