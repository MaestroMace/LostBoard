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
  fmDepth: number; // 0..1
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
  fmDepth: 0,
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
    };

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
  clips: Clip[];
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
  loopStart: number;
  loopEnd: number;
  loopEnabled: boolean;
  lengthBars: number;
  createdAt: number;
  updatedAt: number;
};
