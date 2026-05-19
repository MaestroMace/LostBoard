export type TrackKind = 'synth' | 'drum' | 'sampler' | 'audio';

export type SynthParams = {
  osc: 'sine' | 'square' | 'sawtooth' | 'triangle' | 'fatsawtooth' | 'pwm';
  detune: number;
  cutoff: number; // Hz
  resonance: number; // Q
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  glide: number;
  unison: number; // 1..7
  fmDepth: number; // 0..1 (FM engine: modulation index)
  harmonicity: number; // FM engine: carrier:modulator ratio
  reverb: number; // 0..1
  delay: number; // 0..1
  delayTime: string;
  drive: number; // 0..1
  /** Wavetable engine: 0..1 morphs through preset wave frames. */
  wavePosition?: number;
};

export const DEFAULT_SYNTH: SynthParams = {
  osc: 'fatsawtooth',
  detune: 8,
  cutoff: 1800,
  resonance: 2,
  attack: 0.01,
  decay: 0.2,
  sustain: 0.6,
  release: 0.6,
  glide: 0,
  unison: 3,
  fmDepth: 4,
  harmonicity: 3,
  reverb: 0.18,
  delay: 0.12,
  delayTime: '8n',
  drive: 0.0,
  wavePosition: 0.33,
};

export type DrumPad =
  | 'kick'
  | 'snare'
  | 'clap'
  | 'hatClosed'
  | 'hatOpen'
  | 'tom'
  | 'rim'
  | 'cymbal';

export const DRUM_PADS: DrumPad[] = [
  'kick',
  'snare',
  'clap',
  'hatClosed',
  'hatOpen',
  'tom',
  'rim',
  'cymbal',
];

export const DRUM_LABELS: Record<DrumPad, string> = {
  kick: 'KICK',
  snare: 'SNR',
  clap: 'CLP',
  hatClosed: 'HHC',
  hatOpen: 'HHO',
  tom: 'TOM',
  rim: 'RIM',
  cymbal: 'CYM',
};

export type Note = {
  id: string;
  pitch: number; // MIDI 0..127
  start: number; // beats
  length: number; // beats
  velocity: number; // 0..1
};

export type Step = {
  on: boolean;
  velocity: number; // 0..1
  accent?: boolean;
  /** 0..1 chance of firing on each cycle. Undefined or 1 = always plays. */
  probability?: number;
};

export type DrumPattern = {
  // pad -> steps
  steps: Record<DrumPad, Step[]>;
  length: number; // number of steps (16 typical)
};

export type Clip =
  | {
      id: string;
      kind: 'midi';
      trackId: string;
      start: number; // beats
      length: number; // beats
      notes: Note[];
      color?: string;
      name?: string;
    }
  | {
      id: string;
      kind: 'pattern';
      trackId: string;
      start: number;
      length: number;
      pattern: DrumPattern;
      color?: string;
      name?: string;
    }
  | {
      id: string;
      kind: 'audio';
      trackId: string;
      start: number; // beats
      length: number; // beats
      sampleId: string; // key into the runtime sample bank
      gain: number; // 0..2
      offset: number; // seconds into the sample
      /** BPM the sample was recorded/imported at. Playback rate adjusts to current tempo when `warp` is on. */
      sourceBpm?: number;
      /** When true, clip plays back at currentBpm/sourceBpm so it stays in tempo. */
      warp?: boolean;
      /**
       * How warp is achieved:
       *  - 'pitch' (default): Tone.Player + playbackRate — fast, pitch follows tempo (varispeed).
       *  - 'time': Tone.GrainPlayer — granular time-stretch, pitch is preserved across tempo changes.
       * Only meaningful when `warp` is on.
       */
      stretchMode?: 'pitch' | 'time';
      color?: string;
      name?: string;
    };

export type FxRack = {
  enabled: boolean;
  eqLow: number; // dB  -24..24
  eqMid: number; // dB
  eqHigh: number; // dB
  compThreshold: number; // dB -60..0
  compRatio: number; // 1..20
  compOn: boolean;
  chorusDepth: number; // 0..1
  chorusOn: boolean;
  bitcrush: number; // 1..16 bits, 16 = off
  bitcrushOn: boolean;
  /** Sidechain source track id (envelope-follower-based ducking). Omitted = off. */
  sidechainSourceId?: string;
  /** Ducking depth, 0..1. 0 = no ducking, 1 = full ducking to silence at source peak. */
  sidechainDepth?: number;
  /** Envelope follower attack in seconds (how fast ducking engages). */
  sidechainAttack?: number;
  /** Envelope follower release in seconds (how fast level recovers). */
  sidechainRelease?: number;
};

export const DEFAULT_FX: FxRack = {
  enabled: true,
  eqLow: 0,
  eqMid: 0,
  eqHigh: 0,
  compThreshold: -18,
  compRatio: 3,
  compOn: false,
  chorusDepth: 0.5,
  chorusOn: false,
  bitcrush: 8,
  bitcrushOn: false,
};

export type SynthEngine = 'subtractive' | 'fm' | 'wavetable' | 'sampler';

export type Track = {
  id: string;
  name: string;
  kind: TrackKind;
  color: string;
  volume: number; // dB
  pan: number; // -1..1
  mute: boolean;
  solo: boolean;
  arm: boolean;
  synth?: SynthParams;
  synthEngine?: SynthEngine;
  fx?: FxRack;
  clips: Clip[];
  /** Per-scene clip references for the session view. Index = scene number; value is a clip id from this track's `clips`, or null for an empty slot. */
  sessionSlots?: (string | null)[];
  /** For drum tracks: map of pad → sampleId. When set, the pad fires that sample instead of the built-in drum synth voice. */
  padSamples?: Partial<Record<DrumPad, string>>;
  /** Per-track automation lanes. Each lane targets one parameter and stores a sorted list of (beat, value) breakpoints; the engine queues linear ramps between consecutive points so the param moves smoothly across the arrangement. */
  automation?: AutomationLane[];
  /** For the sampler synth-engine: id of the sample to play chromatically. The sample is treated as the "root" pitch (samplerRootPitch) and resampled for other notes. */
  samplerSampleId?: string;
  /** MIDI pitch the sample was recorded at; other pitches are resampled from there. Defaults to 60 (middle C). */
  samplerRootPitch?: number;
};

/**
 * Automation lanes — per-track, per-parameter sparse breakpoint lists.
 * Each lane targets one parameter on the track; the engine queues linear
 * ramps between consecutive points using Web Audio AudioParam scheduling.
 *
 * Supported params and their unit conventions:
 *   - volume:        dB, suggested range -60..+6
 *   - pan:           -1..+1 (linear)
 *   - cutoff:        Hz (50..18000), applied to the instrument's lowpass
 *   - reverb:        0..1 send level
 *   - delay:         0..1 send level
 *   - eqLow/Mid/High: dB (-24..+24), FX-rack 3-band EQ
 *   - compThreshold: dB (-60..0), FX-rack compressor
 *   - compRatio:     1..20, FX-rack compressor
 */
export type AutomationParam =
  | 'volume'
  | 'pan'
  | 'cutoff'
  | 'reverb'
  | 'delay'
  | 'eqLow'
  | 'eqMid'
  | 'eqHigh'
  | 'compThreshold'
  | 'compRatio';

/**
 * Curve mode controls how the param reaches a point's value:
 *  - 'linear':      linearRampToValueAtTime — straight line from the previous point
 *  - 'exponential': exponentialRampToValueAtTime — curve hugging the next value
 *  - 'hold':        setValueAtTime — keep the previous value, then jump at this point
 *  - 'step':        setValueAtTime at this point — jump to the new value immediately
 * The first point always uses setValueAtTime regardless of mode (no prior anchor).
 * Exponential ramps clamp to a tiny positive minimum because Web Audio rejects
 * 0 / negative targets.
 */
export type AutomationCurve = 'linear' | 'exponential' | 'hold' | 'step';

export type AutomationPoint = {
  id: string;
  beat: number;
  value: number;
  /** Curve into this point (from the previous point). Defaults to 'linear'. */
  curve?: AutomationCurve;
};

export type AutomationLane = {
  param: AutomationParam;
  points: AutomationPoint[];
};

export const AUTOMATION_PARAM_META: Record<AutomationParam, { label: string; min: number; max: number; step: number; unit: string }> = {
  volume: { label: 'VOLUME', min: -60, max: 6, step: 0.5, unit: 'dB' },
  pan: { label: 'PAN', min: -1, max: 1, step: 0.05, unit: '' },
  cutoff: { label: 'CUTOFF', min: 50, max: 18000, step: 10, unit: 'Hz' },
  reverb: { label: 'REVERB', min: 0, max: 1, step: 0.01, unit: '' },
  delay: { label: 'DELAY', min: 0, max: 1, step: 0.01, unit: '' },
  eqLow: { label: 'EQ LOW', min: -24, max: 24, step: 0.5, unit: 'dB' },
  eqMid: { label: 'EQ MID', min: -24, max: 24, step: 0.5, unit: 'dB' },
  eqHigh: { label: 'EQ HIGH', min: -24, max: 24, step: 0.5, unit: 'dB' },
  compThreshold: { label: 'COMP THRES', min: -60, max: 0, step: 0.5, unit: 'dB' },
  compRatio: { label: 'COMP RATIO', min: 1, max: 20, step: 0.5, unit: '' },
};

/**
 * Tempo-map event — step change in BPM at a given beat position. Engine
 * applies these via `Transport.bpm.setValueAtTime` so subsequent
 * bar-relative events automatically run at the new tempo. Events are
 * sorted by beat; the first one (typically at beat 0) acts as the
 * starting tempo.
 */
export type TempoEvent = {
  id: string;
  beat: number;
  bpm: number;
  /**
   * How BPM moves from the previous event TO this one. 'step' (default)
   * jumps; 'ramp' linearly interpolates via `Transport.bpm.linearRampToValueAtTime`.
   * Ignored on the first event since there's nothing prior to ramp from.
   */
  curve?: 'step' | 'ramp';
};

/**
 * Sum wall-clock seconds across a beat range, walking through tempo
 * events. Step segments contribute `(beats / bpm) * 60`; ramp segments
 * use `(beats / avgBpm) * 60` because a linear BPM ramp from `a` to `b`
 * across N beats lasts `N * 60 / ((a + b) / 2)` seconds.
 * `endBeat` exclusive. Empty tempo map → just uses `project.bpm`.
 */
export function projectDurationSec(project: Project, endBeat: number): number {
  const map = (project.tempoMap ?? []).slice().sort((a, b) => a.beat - b.beat);
  let bpm = map.length > 0 && map[0].beat <= 0 ? map[0].bpm : project.bpm;
  let cursor = 0;
  let total = 0;
  for (const ev of map) {
    if (ev.beat <= 0) continue;
    if (ev.beat >= endBeat) break;
    const segBeats = ev.beat - cursor;
    if (ev.curve === 'ramp') {
      const avg = (bpm + ev.bpm) / 2;
      total += (segBeats / avg) * 60;
    } else {
      total += (segBeats / bpm) * 60;
    }
    cursor = ev.beat;
    bpm = ev.bpm;
  }
  total += ((endBeat - cursor) / bpm) * 60;
  return total;
}

export type Project = {
  id: string;
  name: string;
  bpm: number;
  numerator: number;
  denominator: number;
  master: {
    volume: number;
    limiter: boolean;
  };
  tracks: Track[];
  /** Scene names for the session view. Sessions are columns in the launcher grid; each track's sessionSlots indexes into this array. */
  scenes?: { name: string }[];
  /** Optional tempo automation. When present and non-empty, the project's `bpm` is treated as the fallback for the very start, with events overriding from their beat onward. */
  tempoMap?: TempoEvent[];
  loopStart: number;
  loopEnd: number;
  loopEnabled: boolean;
  lengthBars: number;
  createdAt: number;
  updatedAt: number;
};
