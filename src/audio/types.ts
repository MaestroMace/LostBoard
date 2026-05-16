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

export type SynthEngine = 'subtractive' | 'fm';

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
};

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
  loopStart: number;
  loopEnd: number;
  loopEnabled: boolean;
  lengthBars: number;
  createdAt: number;
  updatedAt: number;
};
