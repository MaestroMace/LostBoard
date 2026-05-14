import * as Tone from 'tone';
import type { DrumPad, SynthParams, Track, Project, Clip, Note } from './types';

/**
 * AudioEngine — wraps Tone.js into a DAW-style engine.
 * - master limiter + reverb send + delay send
 * - per-track channel strip + instrument
 * - scheduler driven by Tone.Transport
 */
class Engine {
  private inited = false;
  private master!: Tone.Limiter;
  private masterGain!: Tone.Gain;
  private reverb!: Tone.Reverb;
  private delay!: Tone.FeedbackDelay;
  private analyser!: Tone.Analyser;
  private trackNodes = new Map<string, TrackNode>();
  private scheduledIds: number[] = [];
  private metronomeSynth?: Tone.MembraneSynth;
  private metronomeEvent?: number;
  metronomeEnabled = false;

  async init() {
    if (this.inited) return;
    await Tone.start();
    Tone.getContext().lookAhead = 0.03;
    this.masterGain = new Tone.Gain(0.9);
    this.master = new Tone.Limiter(-1);
    this.analyser = new Tone.Analyser('waveform', 1024);
    this.reverb = new Tone.Reverb({ decay: 3, preDelay: 0.02, wet: 1 });
    this.delay = new Tone.FeedbackDelay({ delayTime: '8n', feedback: 0.35, wet: 1 });
    await this.reverb.generate();
    this.delay.connect(this.masterGain);
    this.reverb.connect(this.masterGain);
    this.masterGain.connect(this.master);
    this.master.connect(this.analyser);
    this.master.toDestination();
    this.inited = true;
  }

  isInited() {
    return this.inited;
  }

  getAnalyser() {
    return this.analyser;
  }

  setBpm(bpm: number) {
    Tone.getTransport().bpm.value = bpm;
  }

  setTimeSig(num: number, den: number) {
    Tone.getTransport().timeSignature = [num, den];
  }

  setMasterVolume(db: number) {
    if (!this.inited) return;
    const v = Tone.dbToGain(db);
    this.masterGain.gain.rampTo(v, 0.02);
  }

  setLoop(enabled: boolean, startBeats: number, endBeats: number) {
    const transport = Tone.getTransport();
    transport.loop = enabled;
    transport.loopStart = beatsToBarsBeats(startBeats);
    transport.loopEnd = beatsToBarsBeats(endBeats);
  }

  startMetronome(enabled: boolean) {
    this.metronomeEnabled = enabled;
    if (!this.inited) return;
    if (!this.metronomeSynth) {
      this.metronomeSynth = new Tone.MembraneSynth({
        pitchDecay: 0.008,
        octaves: 2,
        envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
      }).toDestination();
      this.metronomeSynth.volume.value = -10;
    }
    if (this.metronomeEvent !== undefined) {
      Tone.getTransport().clear(this.metronomeEvent);
      this.metronomeEvent = undefined;
    }
    if (enabled) {
      this.metronomeEvent = Tone.getTransport().scheduleRepeat((time) => {
        const pos = Tone.getTransport().position.toString();
        const beat = parseInt(pos.split(':')[1] ?? '0', 10);
        const pitch = beat === 0 ? 'C5' : 'C4';
        this.metronomeSynth?.triggerAttackRelease(pitch, '32n', time, 0.9);
      }, '4n');
    }
  }

  async play() {
    if (!this.inited) await this.init();
    Tone.getTransport().start('+0.05');
  }

  pause() {
    Tone.getTransport().pause();
  }

  stop() {
    Tone.getTransport().stop();
    Tone.getTransport().position = 0;
  }

  setPosition(beats: number) {
    Tone.getTransport().position = beatsToBarsBeats(beats);
  }

  getPositionBeats(): number {
    return Tone.getTransport().ticks / Tone.getTransport().PPQ;
  }

  isPlaying() {
    return Tone.getTransport().state === 'started';
  }

  // ---------- TRACK MANAGEMENT ----------

  ensureTrack(track: Track) {
    if (!this.inited) return undefined;
    let node = this.trackNodes.get(track.id);
    if (!node) {
      node = new TrackNode(track, this.reverb, this.delay, this.masterGain);
      this.trackNodes.set(track.id, node);
    }
    node.update(track);
    return node;
  }

  removeTrack(id: string) {
    const node = this.trackNodes.get(id);
    if (node) {
      node.dispose();
      this.trackNodes.delete(id);
    }
  }

  trigger(trackId: string, pitch: number | DrumPad, velocity = 0.9, duration = '8n') {
    const node = this.trackNodes.get(trackId);
    node?.trigger(pitch, velocity, duration);
  }

  /** Schedule the entire project's clip content onto the transport. */
  schedule(project: Project) {
    if (!this.inited) return;
    // clear old
    const t = Tone.getTransport();
    this.scheduledIds.forEach((id) => t.clear(id));
    this.scheduledIds = [];

    for (const track of project.tracks) {
      const node = this.ensureTrack(track);
      if (!node) continue;
      for (const clip of track.clips) {
        this.scheduleClip(clip, node, project);
      }
    }
  }

  private scheduleClip(clip: Clip, node: TrackNode, project: Project) {
    const t = Tone.getTransport();
    const startBeats = clip.start;
    if (clip.kind === 'midi') {
      for (const note of clip.notes) {
        const noteStartBeats = startBeats + note.start;
        const id = t.schedule((time) => {
          const dur = note.length * (60 / project.bpm);
          node.triggerAt(note.pitch, note.velocity, dur, time);
        }, beatsToBarsBeats(noteStartBeats));
        this.scheduledIds.push(id);
      }
    } else if (clip.kind === 'pattern') {
      // 16-step grid spread over clip.length beats
      const stepsPerBeat = clip.pattern.length / clip.length;
      const stepDur = 1 / stepsPerBeat; // beats per step
      const padNames = Object.keys(clip.pattern.steps) as DrumPad[];
      for (const pad of padNames) {
        const steps = clip.pattern.steps[pad];
        if (!steps) continue;
        steps.forEach((step, i) => {
          if (!step.on) return;
          const beat = startBeats + i * stepDur;
          const id = t.schedule((time) => {
            const v = step.velocity * (step.accent ? 1.0 : 0.85);
            node.triggerAt(pad, v, 0.1, time);
          }, beatsToBarsBeats(beat));
          this.scheduledIds.push(id);
        });
      }
    }
  }
}

// -----------------------------------------------------------

class TrackNode {
  trackId: string;
  channel: Tone.Channel;
  reverbSend: Tone.Gain;
  delaySend: Tone.Gain;
  instrument: Instrument;
  meter: Tone.Meter;

  constructor(
    track: Track,
    reverb: Tone.Reverb,
    delay: Tone.FeedbackDelay,
    masterGain: Tone.Gain,
  ) {
    this.trackId = track.id;
    this.channel = new Tone.Channel({
      volume: track.volume,
      pan: track.pan,
      mute: track.mute,
      solo: track.solo,
    });
    this.meter = new Tone.Meter({ smoothing: 0.6 });
    this.reverbSend = new Tone.Gain(0);
    this.delaySend = new Tone.Gain(0);
    this.channel.connect(masterGain);
    this.channel.connect(this.meter);
    this.channel.connect(this.reverbSend);
    this.channel.connect(this.delaySend);
    this.reverbSend.connect(reverb);
    this.delaySend.connect(delay);

    this.instrument = buildInstrument(track);
    this.instrument.output.connect(this.channel);
    this.applySends(track);
  }

  update(track: Track) {
    this.channel.volume.rampTo(track.volume, 0.02);
    this.channel.pan.rampTo(track.pan, 0.02);
    this.channel.mute = track.mute;
    this.channel.solo = track.solo;
    if (track.synth && this.instrument.kind === 'synth') {
      (this.instrument as SynthInstrument).applyParams(track.synth);
    }
    this.applySends(track);
  }

  applySends(track: Track) {
    const rev = track.synth?.reverb ?? 0.15;
    const dly = track.synth?.delay ?? 0.1;
    this.reverbSend.gain.rampTo(rev, 0.05);
    this.delaySend.gain.rampTo(dly, 0.05);
  }

  trigger(pitch: number | DrumPad, vel: number, dur: string | number) {
    this.instrument.trigger(pitch, vel, dur);
  }

  triggerAt(pitch: number | DrumPad, vel: number, dur: string | number, time: number) {
    this.instrument.triggerAt(pitch, vel, dur, time);
  }

  getLevel() {
    const v = this.meter.getValue();
    return typeof v === 'number' ? v : v[0];
  }

  dispose() {
    this.instrument.dispose();
    this.channel.dispose();
    this.reverbSend.dispose();
    this.delaySend.dispose();
    this.meter.dispose();
  }
}

// -----------------------------------------------------------

type Instrument = {
  kind: 'synth' | 'drum' | 'sampler';
  output: Tone.ToneAudioNode;
  trigger(pitch: number | DrumPad, vel: number, dur: string | number): void;
  triggerAt(pitch: number | DrumPad, vel: number, dur: string | number, time: number): void;
  dispose(): void;
};

class SynthInstrument implements Instrument {
  kind = 'synth' as const;
  output: Tone.Gain;
  private poly: Tone.PolySynth;
  private filter: Tone.Filter;
  private drive: Tone.Distortion;

  constructor(params: SynthParams) {
    this.output = new Tone.Gain(1);
    this.drive = new Tone.Distortion({ distortion: params.drive, oversample: '2x' });
    this.filter = new Tone.Filter({ frequency: params.cutoff, type: 'lowpass', Q: params.resonance });
    this.poly = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: params.osc as any },
      envelope: {
        attack: params.attack,
        decay: params.decay,
        sustain: params.sustain,
        release: params.release,
      },
      detune: params.detune,
      portamento: params.glide,
    });
    this.poly.maxPolyphony = 16;
    this.poly.chain(this.filter, this.drive, this.output);
  }

  applyParams(p: SynthParams) {
    this.filter.frequency.rampTo(p.cutoff, 0.05);
    this.filter.Q.rampTo(p.resonance, 0.05);
    this.drive.distortion = p.drive;
    this.poly.set({
      oscillator: { type: p.osc as any },
      envelope: {
        attack: p.attack,
        decay: p.decay,
        sustain: p.sustain,
        release: p.release,
      },
      detune: p.detune,
      portamento: p.glide,
    });
  }

  trigger(pitch: number | DrumPad, vel: number, dur: string | number) {
    if (typeof pitch !== 'number') return;
    const freq = Tone.Frequency(pitch, 'midi').toFrequency();
    this.poly.triggerAttackRelease(freq, dur, undefined, vel);
  }

  triggerAt(pitch: number | DrumPad, vel: number, dur: string | number, time: number) {
    if (typeof pitch !== 'number') return;
    const freq = Tone.Frequency(pitch, 'midi').toFrequency();
    this.poly.triggerAttackRelease(freq, dur, time, vel);
  }

  dispose() {
    this.poly.dispose();
    this.filter.dispose();
    this.drive.dispose();
    this.output.dispose();
  }
}

class DrumInstrument implements Instrument {
  kind = 'drum' as const;
  output: Tone.Gain;
  private kick: Tone.MembraneSynth;
  private snare: Tone.NoiseSynth;
  private clap: Tone.NoiseSynth;
  private hatClosed: Tone.MetalSynth;
  private hatOpen: Tone.MetalSynth;
  private tom: Tone.MembraneSynth;
  private rim: Tone.MetalSynth;
  private cymbal: Tone.MetalSynth;

  constructor() {
    this.output = new Tone.Gain(1);
    this.kick = new Tone.MembraneSynth({
      pitchDecay: 0.04,
      octaves: 6,
      envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.1 },
    });
    this.snare = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.18, sustain: 0 },
    });
    this.clap = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.003, decay: 0.25, sustain: 0 },
    });
    this.hatClosed = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.04, release: 0.02 },
      harmonicity: 5.1,
      modulationIndex: 32,
      resonance: 4000,
      octaves: 1.5,
    });
    this.hatOpen = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.3, release: 0.2 },
      harmonicity: 5.1,
      modulationIndex: 32,
      resonance: 4000,
      octaves: 1.5,
    });
    this.tom = new Tone.MembraneSynth({
      pitchDecay: 0.06,
      octaves: 3,
      envelope: { attack: 0.005, decay: 0.3, sustain: 0, release: 0.2 },
    });
    this.rim = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.02, release: 0.01 },
      harmonicity: 12,
      modulationIndex: 16,
      resonance: 7000,
      octaves: 0.5,
    });
    this.cymbal = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 1.5, release: 1.5 },
      harmonicity: 8,
      modulationIndex: 64,
      resonance: 6000,
      octaves: 1.2,
    });

    this.kick.connect(this.output);
    this.snare.connect(this.output);
    this.clap.connect(this.output);
    this.hatClosed.connect(this.output);
    this.hatOpen.connect(this.output);
    this.tom.connect(this.output);
    this.rim.connect(this.output);
    this.cymbal.connect(this.output);
  }

  triggerAt(pad: number | DrumPad, vel: number, _dur: string | number, time: number) {
    const v = Math.max(0.05, vel);
    const pp = typeof pad === 'string' ? pad : 'kick';
    switch (pp) {
      case 'kick':
        this.kick.triggerAttackRelease('C1', '8n', time, v);
        break;
      case 'snare':
        this.snare.triggerAttackRelease('16n', time, v);
        break;
      case 'clap':
        this.clap.triggerAttackRelease('16n', time, v * 0.9);
        break;
      case 'hatClosed':
        this.hatClosed.triggerAttackRelease('32n', time, v * 0.4);
        break;
      case 'hatOpen':
        this.hatOpen.triggerAttackRelease('8n', time, v * 0.35);
        break;
      case 'tom':
        this.tom.triggerAttackRelease('G2', '8n', time, v);
        break;
      case 'rim':
        this.rim.triggerAttackRelease('32n', time, v * 0.45);
        break;
      case 'cymbal':
        this.cymbal.triggerAttackRelease('2n', time, v * 0.35);
        break;
    }
  }

  trigger(pad: number | DrumPad, vel: number, dur: string | number) {
    this.triggerAt(pad, vel, dur, Tone.now());
  }

  dispose() {
    this.kick.dispose();
    this.snare.dispose();
    this.clap.dispose();
    this.hatClosed.dispose();
    this.hatOpen.dispose();
    this.tom.dispose();
    this.rim.dispose();
    this.cymbal.dispose();
    this.output.dispose();
  }
}

function buildInstrument(track: Track): Instrument {
  if (track.kind === 'drum') return new DrumInstrument();
  if (track.kind === 'synth' && track.synth) return new SynthInstrument(track.synth);
  if (track.kind === 'synth')
    return new SynthInstrument({
      osc: 'sawtooth',
      detune: 0,
      cutoff: 1800,
      resonance: 1,
      attack: 0.01,
      decay: 0.2,
      sustain: 0.6,
      release: 0.6,
      glide: 0,
      unison: 1,
      fmDepth: 0,
      reverb: 0.15,
      delay: 0.1,
      delayTime: '8n',
      drive: 0,
    });
  return new SynthInstrument({
    osc: 'sine',
    detune: 0,
    cutoff: 2000,
    resonance: 1,
    attack: 0.01,
    decay: 0.2,
    sustain: 0.5,
    release: 0.4,
    glide: 0,
    unison: 1,
    fmDepth: 0,
    reverb: 0.1,
    delay: 0.05,
    delayTime: '8n',
    drive: 0,
  });
}

function beatsToBarsBeats(beats: number): string {
  const t = Tone.getTransport();
  const tsNumerator = Array.isArray(t.timeSignature) ? t.timeSignature[0] : t.timeSignature;
  const bars = Math.floor(beats / tsNumerator);
  const beatRemainder = beats - bars * tsNumerator;
  const beat = Math.floor(beatRemainder);
  const sixteenths = (beatRemainder - beat) * 4;
  return `${bars}:${beat}:${sixteenths}`;
}

export const audioEngine = new Engine();
export { TrackNode };
