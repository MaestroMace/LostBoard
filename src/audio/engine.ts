import * as Tone from 'tone';
import type {
  DrumPad,
  SynthParams,
  Track,
  Project,
  Clip,
  FxRack,
  SynthEngine,
  AutomationParam,
} from './types';

/**
 * AudioEngine — wraps Tone.js into a DAW-style engine.
 * - master limiter + reverb send + delay send + analyser/scope
 * - per-track channel strip + FX rack + instrument
 * - runtime sample bank for recorded / imported audio
 * - mic recorder + real-time master bounce-to-WAV
 * - scheduler driven by Tone.Transport
 */
class Engine {
  private inited = false;
  private master!: Tone.Limiter;
  private masterGain!: Tone.Gain;
  private reverb!: Tone.Reverb;
  private delay!: Tone.FeedbackDelay;
  private analyser!: Tone.Analyser;
  private fft!: Tone.Analyser;
  private masterMeter!: Tone.Meter;
  private trackNodes = new Map<string, TrackNode>();
  private scheduledIds: number[] = [];
  /** Per-track Tone.Loop instances driving session-view playback. */
  private sessionLoops: Map<string, Tone.Loop> = new Map();
  private metronomeSynth?: Tone.MembraneSynth;
  private metronomeEvent?: number;
  metronomeEnabled = false;

  // recording
  private mic?: Tone.UserMedia;
  private micRecorder?: Tone.Recorder;
  private masterRecorder?: Tone.Recorder;

  // runtime sample bank — recorded/imported audio buffers keyed by id
  private sampleBank = new Map<string, AudioBuffer>();

  async init() {
    if (this.inited) return;
    await Tone.start();
    Tone.getContext().lookAhead = 0.03;
    this.masterGain = new Tone.Gain(0.9);
    this.master = new Tone.Limiter(-1);
    this.analyser = new Tone.Analyser('waveform', 1024);
    this.fft = new Tone.Analyser('fft', 64);
    this.masterMeter = new Tone.Meter({ smoothing: 0.7 });
    this.reverb = new Tone.Reverb({ decay: 3, preDelay: 0.02, wet: 1 });
    this.delay = new Tone.FeedbackDelay({ delayTime: '8n', feedback: 0.35, wet: 1 });
    await this.reverb.generate();
    this.delay.connect(this.masterGain);
    this.reverb.connect(this.masterGain);
    this.masterGain.connect(this.master);
    this.master.connect(this.analyser);
    this.master.connect(this.fft);
    this.master.connect(this.masterMeter);
    this.master.toDestination();
    // Tone.Recorder wraps MediaRecorder, which doesn't exist on
    // OfflineAudioContext. Inside Tone.Offline the global context is offline
    // for the duration of the callback — skip the recorder there so a fresh
    // Engine() can be init'd offline without throwing.
    if (isRealtimeContext()) {
      this.masterRecorder = new Tone.Recorder();
      this.master.connect(this.masterRecorder);
    }
    this.inited = true;
  }

  isInited() {
    return this.inited;
  }

  getAnalyser() {
    return this.analyser;
  }

  getFft() {
    return this.fft;
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

  // ---------- SAMPLE BANK ----------

  registerSample(id: string, buffer: AudioBuffer) {
    this.sampleBank.set(id, buffer);
  }

  getSample(id: string): AudioBuffer | undefined {
    return this.sampleBank.get(id);
  }

  hasSample(id: string): boolean {
    return this.sampleBank.has(id);
  }

  listSampleIds(): string[] {
    return Array.from(this.sampleBank.keys());
  }

  /** Decode an arbitrary audio File/Blob into the bank under a fresh id. */
  async loadAudioFile(file: Blob): Promise<{ id: string; duration: number }> {
    const id = `smp_${Math.random().toString(36).slice(2, 10)}`;
    const duration = await this.decodeSample(id, file);
    return { id, duration };
  }

  /** Decode a blob into the bank under a KNOWN id (used to rehydrate from IndexedDB). */
  async decodeSample(id: string, blob: Blob): Promise<number> {
    const arrayBuf = await blob.arrayBuffer();
    // decodeAudioData works on a suspended context, so this is safe pre-boot
    const audioBuf = await Tone.getContext().rawContext.decodeAudioData(arrayBuf);
    this.sampleBank.set(id, audioBuf);
    return audioBuf.duration;
  }

  // ---------- MIC RECORDING ----------

  async armMic(): Promise<boolean> {
    if (!this.inited) await this.init();
    try {
      this.mic = new Tone.UserMedia();
      await this.mic.open();
      this.micRecorder = new Tone.Recorder();
      this.mic.connect(this.micRecorder);
      return true;
    } catch (e) {
      console.error('Mic access failed', e);
      return false;
    }
  }

  startMicRecording() {
    this.micRecorder?.start();
  }

  /**
   * Bounce each track to its own audio blob, post-FX-rack and pre-master.
   * Returns one blob per track keyed by track name. Real-time bounce (plays
   * the project through once) — there is no offline render yet. Reverb /
   * delay tails are NOT included in the stems since they live on the master
   * bus; the result is dry-ish stems with track FX baked in, which is
   * usually what you want when remixing in another DAW.
   */
  async bounceStems(project: Project, durationSec: number): Promise<{ name: string; blob: Blob }[]> {
    if (!this.inited) await this.init();
    const recorders: { name: string; rec: Tone.Recorder; node: TrackNode }[] = [];
    for (const track of project.tracks) {
      const node = this.trackNodes.get(track.id);
      if (!node) continue;
      const rec = new Tone.Recorder();
      node.connectTap(rec);
      recorders.push({ name: track.name || track.id, rec, node });
    }
    if (recorders.length === 0) return [];

    recorders.forEach((r) => r.rec.start());
    this.stop();
    await this.play();
    await new Promise<void>((resolve) => setTimeout(resolve, Math.max(500, durationSec * 1000)));
    this.pause();

    const out: { name: string; blob: Blob }[] = [];
    for (const r of recorders) {
      try {
        const blob = await r.rec.stop();
        out.push({ name: r.name, blob });
      } catch {
        /* recorder may have already been disposed */
      }
      r.rec.dispose();
    }
    return out;
  }

  /** Stops mic recording, decodes the result into the sample bank, returns the blob too. */
  async stopMicRecording(): Promise<{ id: string; duration: number; blob: Blob } | null> {
    if (!this.micRecorder) return null;
    const blob = await this.micRecorder.stop();
    const result = await this.loadAudioFile(blob);
    this.mic?.close();
    this.mic?.dispose();
    this.micRecorder.dispose();
    this.mic = undefined;
    this.micRecorder = undefined;
    return { ...result, blob };
  }

  isMicArmed() {
    return !!this.mic;
  }

  // ---------- MASTER BOUNCE ----------

  startMasterBounce() {
    this.masterRecorder?.start();
  }

  async stopMasterBounce(): Promise<Blob | null> {
    if (!this.masterRecorder) return null;
    return await this.masterRecorder.stop();
  }

  /**
   * Render the project faster-than-real-time via `Tone.Offline`.
   *
   * `Tone.Offline` swaps Tone's default context to an `OfflineAudioContext`
   * for the duration of the callback, so any `new Tone.*` constructed inside
   * binds to that offline graph. We exploit that by spinning up a fresh
   * `Engine` *inside* the callback, copying our sample bank into it, and
   * scheduling the project against the offline transport. AudioBuffers are
   * shareable across contexts so the sample bank copy is just reference
   * passing.
   *
   * `mutedTrackIds` is used by the stems variant to render one track at a
   * time without disposing/rebuilding the offline graph for each.
   */
  async bounceOffline(
    project: Project,
    durationSec: number,
    options?: { mutedTrackIds?: Set<string> },
  ): Promise<AudioBuffer> {
    const sampleEntries = Array.from(this.sampleBank.entries());
    const muted = options?.mutedTrackIds;
    const toneBuf = await Tone.Offline(async ({ transport }) => {
      const offline = new Engine();
      for (const [id, buf] of sampleEntries) offline.registerSample(id, buf);
      await offline.init();
      offline.setBpm(project.bpm);
      offline.setTimeSig(project.numerator, project.denominator);
      offline.setMasterVolume(project.master.volume);
      const renderedTracks = muted
        ? project.tracks.map((t) =>
            muted.has(t.id) ? { ...t, mute: true } : t,
          )
        : project.tracks;
      const renderedProject = muted ? { ...project, tracks: renderedTracks } : project;
      for (const t of renderedTracks) offline.ensureTrack(t);
      offline.applySidechains(renderedProject);
      offline.schedule(renderedProject);
      transport.start(0);
    }, durationSec);
    return toneBuf.get() as AudioBuffer;
  }

  /**
   * Offline stems: bounce each track individually by running N offline
   * renders, muting every other track. Each render is faster-than-real-time,
   * so the total wall-clock cost is roughly N × (renderRatio · projectDur)
   * — still vastly faster than the real-time `bounceStems` path on long
   * projects, and unlike the real-time path the result is a clean WAV per
   * track with no transport jitter.
   */
  async bounceStemsOffline(
    project: Project,
    durationSec: number,
    onProgress?: (i: number, total: number, name: string) => void,
  ): Promise<{ name: string; buffer: AudioBuffer }[]> {
    const out: { name: string; buffer: AudioBuffer }[] = [];
    const total = project.tracks.length;
    for (let i = 0; i < total; i++) {
      const target = project.tracks[i];
      onProgress?.(i, total, target.name || target.id);
      const muted = new Set(project.tracks.filter((t) => t.id !== target.id).map((t) => t.id));
      const buffer = await this.bounceOffline(project, durationSec, { mutedTrackIds: muted });
      out.push({ name: target.name || target.id, buffer });
    }
    onProgress?.(total, total, '');
    return out;
  }

  // ---------- TRACK MANAGEMENT ----------

  ensureTrack(track: Track) {
    if (!this.inited) return undefined;
    let node = this.trackNodes.get(track.id);
    if (!node) {
      node = new TrackNode(track, this.reverb, this.delay, this.masterGain, this.sampleBank);
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

  getTrackLevel(id: string): number {
    return this.trackNodes.get(id)?.getLevel() ?? -60;
  }

  getMasterLevel(): number {
    if (!this.inited) return -60;
    const v = this.masterMeter.getValue();
    return typeof v === 'number' ? v : v[0];
  }

  trigger(trackId: string, pitch: number | DrumPad, velocity = 0.9, duration = '8n') {
    const node = this.trackNodes.get(trackId);
    node?.trigger(pitch, velocity, duration);
  }

  /** Schedule the entire project's clip content onto the transport. */
  schedule(project: Project) {
    if (!this.inited) return;
    this.clearArrangement();

    this.scheduleTempoMap(project);

    for (const track of project.tracks) {
      const node = this.ensureTrack(track);
      if (!node) continue;
      node.clearPlayers();
      for (const clip of track.clips) {
        this.scheduleClip(clip, node, project);
      }
      this.scheduleAutomation(track, node);
    }
  }

  /**
   * Wire each automation lane onto its target AudioParam. Per breakpoint we
   * queue a transport callback at the right beat that calls either
   * `setValueAtTime` (first point) or `linearRampToValueAtTime` (subsequent
   * points). Web Audio guarantees the ramp starts from the value of the
   * previous scheduled event, so chaining linear ramps yields a piecewise-
   * linear curve that survives tempo changes too — the callback fires at
   * the right audio time regardless of how bpm shifts in between.
   *
   * Lanes with fewer than 1 point are skipped; param lookup that returns
   * undefined (e.g. cutoff on an audio track with no filter) is silently
   * ignored so projects with stale automation don't break.
   */
  private scheduleAutomation(track: Track, node: TrackNode) {
    const lanes = track.automation;
    if (!lanes || lanes.length === 0) return;
    const t = Tone.getTransport();
    for (const lane of lanes) {
      const param = node.getAutomationParam(lane.param);
      if (!param) continue;
      const points = [...lane.points].sort((a, b) => a.beat - b.beat);
      points.forEach((pt, i) => {
        const curve = pt.curve ?? 'linear';
        const prev = points[i - 1];
        const id = t.schedule((time) => {
          try {
            if (i === 0) {
              param.setValueAtTime(pt.value, time);
              return;
            }
            switch (curve) {
              case 'step':
                param.setValueAtTime(pt.value, time);
                break;
              case 'hold':
                // keep the previous value all the way until `time`, then jump
                if (prev) param.setValueAtTime(prev.value, time);
                param.setValueAtTime(pt.value, time);
                break;
              case 'exponential': {
                // exponentialRampToValueAtTime rejects 0/negative — clamp.
                const target = pt.value === 0 ? 0.00001 : Math.sign(pt.value) * Math.max(Math.abs(pt.value), 0.00001);
                param.exponentialRampToValueAtTime(target, time);
                break;
              }
              case 'linear':
              default:
                param.linearRampToValueAtTime(pt.value, time);
                break;
            }
          } catch {
            /* param may have been disposed mid-schedule */
          }
        }, beatsToBarsBeats(pt.beat));
        this.scheduledIds.push(id);
      });
    }
  }

  /**
   * Apply the project's tempo map onto the transport. The earliest event
   * (typically at beat 0) sets the starting BPM immediately; later events
   * fire as the transport reaches their beat position via
   * `Transport.bpm.setValueAtTime`, so all bar-relative scheduling beyond
   * that point automatically runs at the new tempo.
   *
   * Skips silently if the map is empty / absent — callers stick with
   * `project.bpm` set imperatively.
   */
  private scheduleTempoMap(project: Project) {
    const map = project.tempoMap;
    if (!map || map.length === 0) return;
    const sorted = [...map].sort((a, b) => a.beat - b.beat);
    const t = Tone.getTransport();
    // immediate apply for the earliest event so the first note is at the
    // right tempo even before the scheduler fires
    if (sorted[0].beat <= 0.0001) {
      t.bpm.value = sorted[0].bpm;
    }
    for (const ev of sorted) {
      if (ev.beat <= 0.0001) continue;
      const id = t.schedule((time) => {
        if (ev.curve === 'ramp') {
          // chains from whatever was scheduled before — Web Audio ramps
          // from the prior automation event's value, so consecutive ramp
          // events produce piecewise-linear BPM glides
          t.bpm.linearRampToValueAtTime(ev.bpm, time);
        } else {
          t.bpm.setValueAtTime(ev.bpm, time);
        }
      }, beatsToBarsBeats(ev.beat));
      this.scheduledIds.push(id);
    }
  }

  private clearArrangement() {
    const t = Tone.getTransport();
    this.scheduledIds.forEach((id) => t.clear(id));
    this.scheduledIds = [];
  }

  /**
   * Schedule session-view playback: a Tone.Loop per active session clip that
   * re-fires its contents every `clip.length` beats, transport-relative so it
   * follows tempo / start / stop automatically. Replaces any arrangement
   * scheduling, so callers should pick one or the other based on session mode.
   */
  scheduleSession(project: Project, playing: Map<string, string>) {
    if (!this.inited) return;
    this.clearArrangement();
    this.stopAllSessionClips();

    for (const track of project.tracks) {
      this.ensureTrack(track)?.clearPlayers();
    }

    playing.forEach((clipId, trackId) => {
      const track = project.tracks.find((t) => t.id === trackId);
      if (!track) return;
      const clip = track.clips.find((c) => c.id === clipId);
      if (!clip) return;
      const node = this.trackNodes.get(trackId);
      if (!node) return;
      const interval = `${clip.length}*4n`;
      try {
        const loop = new Tone.Loop((time) => {
          this.fireClipInstance(clip, node, time);
        }, interval).start(0);
        this.sessionLoops.set(trackId, loop);
      } catch (e) {
        console.warn('session loop create failed', e);
      }
    });
  }

  stopAllSessionClips() {
    this.sessionLoops.forEach((loop) => loop.dispose());
    this.sessionLoops.clear();
  }

  /**
   * Reconcile every track's sidechain wiring against the project. Needs every
   * TrackNode to exist first, so callers run this *after* their ensureTrack
   * pass. Cheap when nothing's changed — `setSidechain` rebuilds only when the
   * source / depth / timing actually move.
   */
  applySidechains(project: Project) {
    if (!this.inited) return;
    for (const track of project.tracks) {
      const node = this.trackNodes.get(track.id);
      if (!node) continue;
      const fx = track.fx;
      const desiredSourceId = fx?.sidechainSourceId;
      const desiredDepth = fx?.sidechainDepth ?? 0;
      const desiredAttack = fx?.sidechainAttack ?? 0.005;
      const desiredRelease = fx?.sidechainRelease ?? 0.15;
      const currentSource = node.getSidechainSourceId();
      const currentState = node.getSidechainState();
      const want = desiredSourceId && desiredDepth > 0 ? desiredSourceId : undefined;
      const same =
        want === currentSource &&
        currentState.depth === desiredDepth &&
        currentState.attack === desiredAttack &&
        currentState.release === desiredRelease;
      if (same) continue;
      const sourceNode = want ? this.trackNodes.get(want) ?? null : null;
      node.setSidechain(sourceNode, desiredDepth, desiredAttack, desiredRelease);
    }
  }

  /** Fires the contents of a clip starting at `baseTime` (seconds, transport-relative). */
  private fireClipInstance(clip: Clip, node: TrackNode, baseTime: number) {
    if (clip.kind === 'midi') {
      for (const note of clip.notes) {
        const off = Tone.Time(`${note.start}*4n`).toSeconds();
        const dur = Tone.Time(`${note.length}*4n`).toSeconds();
        node.triggerAt(note.pitch, note.velocity, dur, baseTime + off);
      }
    } else if (clip.kind === 'pattern') {
      const stepsPerBeat = clip.pattern.length / clip.length;
      const stepDurBeats = 1 / stepsPerBeat;
      for (const pad of Object.keys(clip.pattern.steps) as DrumPad[]) {
        const steps = clip.pattern.steps[pad];
        if (!steps) continue;
        steps.forEach((step, i) => {
          if (!step.on) return;
          if (step.probability !== undefined && step.probability < 1 && Math.random() > step.probability) return;
          const off = Tone.Time(`${i * stepDurBeats}*4n`).toSeconds();
          const v = step.velocity * (step.accent ? 1.0 : 0.85);
          node.triggerAt(pad, v, 0.1, baseTime + off);
        });
      }
    }
    // audio clips: not supported in session loops yet (would need a Player per cycle)
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
      const stepsPerBeat = clip.pattern.length / clip.length;
      const stepDur = 1 / stepsPerBeat;
      const padNames = Object.keys(clip.pattern.steps) as DrumPad[];
      for (const pad of padNames) {
        const steps = clip.pattern.steps[pad];
        if (!steps) continue;
        steps.forEach((step, i) => {
          if (!step.on) return;
          const beat = startBeats + i * stepDur;
          const id = t.schedule((time) => {
            // re-roll probability at fire time so each cycle is independent
            if (step.probability !== undefined && step.probability < 1 && Math.random() > step.probability) return;
            const v = step.velocity * (step.accent ? 1.0 : 0.85);
            node.triggerAt(pad, v, 0.1, time);
          }, beatsToBarsBeats(beat));
          this.scheduledIds.push(id);
        });
      }
    } else if (clip.kind === 'audio') {
      const buffer = this.sampleBank.get(clip.sampleId);
      if (!buffer) return;
      const warp = clip.warp !== false && clip.sourceBpm && clip.sourceBpm > 0;
      const player = node.addPlayer(clip.id, buffer, clip.gain, clip.stretchMode ?? 'pitch');
      // Both Tone.Player and Tone.GrainPlayer accept the same playbackRate
      // assignment — the difference is whether pitch shifts with it
      // (Player = varispeed) or stays put (GrainPlayer = granular stretch).
      player.playbackRate = warp ? project.bpm / clip.sourceBpm! : 1;
      const id = t.schedule((time) => {
        try {
          player.start(time, clip.offset);
        } catch {
          /* player may be stopped/disposed */
        }
      }, beatsToBarsBeats(startBeats));
      this.scheduledIds.push(id);
      // stop at clip end
      const endBeats = startBeats + clip.length;
      const stopId = t.schedule((time) => {
        try {
          player.stop(time);
        } catch {
          /* noop */
        }
      }, beatsToBarsBeats(endBeats));
      this.scheduledIds.push(stopId);
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

  // FX rack
  fxInput: Tone.Gain;
  eq: Tone.EQ3;
  comp: Tone.Compressor;
  chorus: Tone.Chorus;
  crusher: Tone.BitCrusher;
  /** Always-in-chain gain whose value is modulated by an external follower when sidechain is on. */
  sidechainGain: Tone.Gain;
  private sidechainFollower?: Tone.Follower;
  private sidechainScale?: Tone.Multiply;
  private sidechainSourceId?: string;
  private sidechainState: { depth: number; attack: number; release: number } = { depth: 0, attack: 0.005, release: 0.15 };

  // audio clip players — either Tone.Player (varispeed) or Tone.GrainPlayer (time-stretch)
  private players = new Map<string, Tone.Player | Tone.GrainPlayer>();
  // drum-pad sample players (per-pad one-shot, replaces the drum-synth voice for that pad when set)
  private padPlayers = new Map<DrumPad, Tone.Player>();
  private padSampleIds = new Map<DrumPad, string>();
  private sampleBank: Map<string, AudioBuffer>;

  constructor(
    track: Track,
    reverb: Tone.Reverb,
    delay: Tone.FeedbackDelay,
    masterGain: Tone.Gain,
    sampleBank: Map<string, AudioBuffer>,
  ) {
    this.trackId = track.id;
    this.sampleBank = sampleBank;
    this.channel = new Tone.Channel({
      volume: track.volume,
      pan: track.pan,
      mute: track.mute,
      solo: track.solo,
    });
    this.meter = new Tone.Meter({ smoothing: 0.7 });
    this.reverbSend = new Tone.Gain(0);
    this.delaySend = new Tone.Gain(0);

    // FX chain: fxInput -> eq -> comp -> chorus -> crusher -> channel
    this.fxInput = new Tone.Gain(1);
    this.eq = new Tone.EQ3(0, 0, 0);
    this.comp = new Tone.Compressor({ threshold: 0, ratio: 1, attack: 0.01, release: 0.1 });
    this.chorus = new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0, wet: 0 }).start();
    this.crusher = new Tone.BitCrusher(16);
    this.crusher.wet.value = 0;
    this.sidechainGain = new Tone.Gain(1);
    this.fxInput.chain(this.eq, this.comp, this.chorus, this.crusher, this.sidechainGain, this.channel);

    this.channel.connect(masterGain);
    this.channel.connect(this.meter);
    this.channel.connect(this.reverbSend);
    this.channel.connect(this.delaySend);
    this.reverbSend.connect(reverb);
    this.delaySend.connect(delay);

    this.instrument = buildInstrument(track, this.sampleBank);
    this.instrument.output.connect(this.fxInput);
    const automated = automatedParams(track);
    this.applySends(track, automated);
    this.applyFx(track.fx, automated);
  }

  update(track: Track) {
    this.channel.volume.rampTo(track.volume, 0.02);
    this.channel.pan.rampTo(track.pan, 0.02);
    this.channel.mute = track.mute;
    this.channel.solo = track.solo;

    // rebuild the instrument if the requested synth engine changed
    if (track.kind === 'synth') {
      const wantKind = synthEngineKind(track.synthEngine);
      const samplerSourceChanged =
        wantKind === 'sampler' &&
        this.instrument.kind === 'sampler' &&
        (this.instrument as SamplerInstrument).getSourceId() !== (track.samplerSampleId ?? '');
      if (this.instrument.kind !== wantKind || samplerSourceChanged) {
        this.instrument.dispose();
        this.instrument = buildInstrument(track, this.sampleBank);
        this.instrument.output.connect(this.fxInput);
      }
    }

    if (track.synth) {
      if (this.instrument.kind === 'synth') {
        (this.instrument as SynthInstrument).applyParams(track.synth);
      } else if (this.instrument.kind === 'fm') {
        (this.instrument as FmInstrument).applyParams(track.synth);
      } else if (this.instrument.kind === 'wavetable') {
        (this.instrument as WavetableInstrument).applyParams(track.synth);
      } else if (this.instrument.kind === 'sampler') {
        (this.instrument as SamplerInstrument).applyParams(track.synth, track.samplerRootPitch ?? 60);
      }
    }
    const automated = automatedParams(track);
    this.applySends(track, automated);
    this.applyFx(track.fx, automated);
    this.applyPadSamples(track);
  }

  /**
   * Reconcile the track's `padSamples` with the actual TrackNode pad players.
   * Only rebuilds players for pads whose sampleId actually changed so a
   * currently-playing pad isn't cut by an unrelated knob tweak.
   */
  applyPadSamples(track: Track) {
    if (track.kind !== 'drum') {
      if (this.padPlayers.size > 0) this.clearPadPlayers();
      return;
    }
    const desired = track.padSamples ?? {};
    const desiredPads = new Set(
      (Object.entries(desired) as [DrumPad, string | undefined][])
        .filter(([, id]) => !!id)
        .map(([pad]) => pad),
    );
    // remove pads no longer mapped
    for (const pad of [...this.padSampleIds.keys()]) {
      if (!desiredPads.has(pad)) this.setPadSample(pad, null);
    }
    // add or replace pads whose sampleId changed
    for (const pad of desiredPads) {
      const wantId = desired[pad];
      if (!wantId) continue;
      if (this.padSampleIds.get(pad) === wantId) continue;
      const buf = this.sampleBank.get(wantId);
      if (buf) this.setPadSample(pad, buf, wantId);
    }
  }

  /**
   * Apply the FX rack. `automated` carries the set of params currently
   * driven by an automation lane — those are skipped here so a stray knob
   * tweak elsewhere doesn't trigger a `rampTo` that stomps the automation's
   * scheduled values. (The automation scheduler owns the param during
   * playback; applyFx still owns it when no lane exists.)
   */
  applyFx(fx?: FxRack, automated?: Set<AutomationParam>) {
    if (!fx || !fx.enabled) {
      if (!automated?.has('eqLow')) this.eq.low.rampTo(0, 0.05);
      if (!automated?.has('eqMid')) this.eq.mid.rampTo(0, 0.05);
      if (!automated?.has('eqHigh')) this.eq.high.rampTo(0, 0.05);
      if (!automated?.has('compThreshold')) this.comp.threshold.rampTo(0, 0.05);
      if (!automated?.has('compRatio')) this.comp.ratio.rampTo(1, 0.05);
      this.chorus.wet.rampTo(0, 0.05);
      this.crusher.wet.rampTo(0, 0.05);
      return;
    }
    if (!automated?.has('eqLow')) this.eq.low.rampTo(fx.eqLow, 0.05);
    if (!automated?.has('eqMid')) this.eq.mid.rampTo(fx.eqMid, 0.05);
    if (!automated?.has('eqHigh')) this.eq.high.rampTo(fx.eqHigh, 0.05);
    if (!automated?.has('compThreshold')) {
      this.comp.threshold.rampTo(fx.compOn ? fx.compThreshold : 0, 0.05);
    }
    if (!automated?.has('compRatio')) {
      this.comp.ratio.rampTo(fx.compOn ? fx.compRatio : 1, 0.05);
    }
    this.chorus.depth = fx.chorusOn ? fx.chorusDepth : 0;
    this.chorus.wet.rampTo(fx.chorusOn ? 1 : 0, 0.05);
    this.crusher.bits.value = fx.bitcrush;
    this.crusher.wet.rampTo(fx.bitcrushOn ? 1 : 0, 0.05);
  }

  applySends(track: Track, automated?: Set<AutomationParam>) {
    const rev = track.synth?.reverb ?? 0.15;
    const dly = track.synth?.delay ?? 0.1;
    if (!automated?.has('reverb')) this.reverbSend.gain.rampTo(rev, 0.05);
    if (!automated?.has('delay')) this.delaySend.gain.rampTo(dly, 0.05);
  }

  // audio clip players
  addPlayer(
    clipId: string,
    buffer: AudioBuffer,
    gain: number,
    mode: 'pitch' | 'time' = 'pitch',
  ): Tone.Player | Tone.GrainPlayer {
    const existing = this.players.get(clipId);
    if (existing) existing.dispose();
    // GrainPlayer does real time-stretch (pitch preserved) via overlapping
    // grain windows; Player is the cheap varispeed path. We pick at build
    // time so callers can swap by disposing + re-adding.
    const player =
      mode === 'time'
        ? new Tone.GrainPlayer({ url: buffer, grainSize: 0.1, overlap: 0.05 })
        : new Tone.Player(buffer);
    player.volume.value = Tone.gainToDb(Math.max(0.0001, gain));
    player.connect(this.fxInput);
    this.players.set(clipId, player);
    return player;
  }

  clearPlayers() {
    for (const p of this.players.values()) {
      p.dispose();
    }
    this.players.clear();
  }

  trigger(pitch: number | DrumPad, vel: number, dur: string | number) {
    if (typeof pitch === 'string' && this.padPlayers.has(pitch as DrumPad)) {
      this.triggerPadSample(pitch as DrumPad, vel);
      return;
    }
    this.instrument.trigger(pitch, vel, dur);
  }

  triggerAt(pitch: number | DrumPad, vel: number, dur: string | number, time: number) {
    if (typeof pitch === 'string' && this.padPlayers.has(pitch as DrumPad)) {
      this.triggerPadSample(pitch as DrumPad, vel, time);
      return;
    }
    this.instrument.triggerAt(pitch, vel, dur, time);
  }

  hasPadSample(pad: DrumPad): boolean {
    return this.padPlayers.has(pad);
  }

  /**
   * Fire a one-shot pad sample. Velocity is applied via Tone.Player's volume
   * dB; the small (sub-frame) lag between volume set and start is imperceptible
   * for drum hits and avoids the complexity of an extra GainNode per pad.
   */
  triggerPadSample(pad: DrumPad, vel: number, time?: number) {
    const player = this.padPlayers.get(pad);
    if (!player) return;
    player.volume.value = Tone.gainToDb(Math.max(0.001, vel));
    try {
      if (time === undefined) player.start();
      else player.start(time);
    } catch {
      /* player may have been disposed mid-schedule */
    }
  }

  /** Install or replace a sample on a pad. Pass `null` to drop back to the synth voice. */
  setPadSample(pad: DrumPad, buffer: AudioBuffer | null, sampleId?: string) {
    const existing = this.padPlayers.get(pad);
    if (existing) {
      existing.dispose();
      this.padPlayers.delete(pad);
      this.padSampleIds.delete(pad);
    }
    if (!buffer || !sampleId) return;
    const player = new Tone.Player(buffer).connect(this.fxInput);
    this.padPlayers.set(pad, player);
    this.padSampleIds.set(pad, sampleId);
  }

  getPadSampleId(pad: DrumPad): string | undefined {
    return this.padSampleIds.get(pad);
  }

  /** Tap the channel output (post-FX-rack, pre-master) for stem bounce or sidechain. */
  connectTap(node: Tone.ToneAudioNode) {
    this.channel.connect(node);
  }

  /**
   * Install or update sidechain ducking. Builds an envelope follower from the
   * source's channel output, scales it by `-depth`, and sums it into this
   * track's always-in-chain `sidechainGain.gain` (intrinsic value = 1), so the
   * effective gain is `1 - depth * envelope` — louder source → more ducking.
   *
   * Passing `source = null` (or depth ≤ 0) disposes the follower path and
   * leaves the gain at 1 (transparent).
   */
  setSidechain(source: TrackNode | null, depth: number, attack: number, release: number) {
    // tear down any existing follower path
    this.sidechainFollower?.dispose();
    this.sidechainScale?.dispose();
    this.sidechainFollower = undefined;
    this.sidechainScale = undefined;
    this.sidechainSourceId = undefined;
    this.sidechainState = { depth, attack, release };

    if (!source || depth <= 0 || source === this) {
      // make sure gain is transparent
      this.sidechainGain.gain.cancelScheduledValues(0);
      this.sidechainGain.gain.value = 1;
      return;
    }

    // Tone.Follower in this Tone version takes a single smoothing time; we
    // approximate asymmetric attack/release with the geometric mean so both
    // UI knobs at least nudge behaviour. A true split would need two
    // followers averaged, which isn't worth the wiring for v1.
    const smoothing = Math.sqrt(attack * release);
    this.sidechainFollower = new Tone.Follower(smoothing);
    this.sidechainScale = new Tone.Multiply(-depth);
    source.connectTap(this.sidechainFollower);
    this.sidechainFollower.connect(this.sidechainScale);
    // Multiply output → AudioParam (gain.gain). Intrinsic value 1, summed audio-rate signal contributes -depth*env.
    this.sidechainScale.connect(this.sidechainGain.gain);
    this.sidechainGain.gain.value = 1;
    this.sidechainSourceId = source.trackId;
  }

  getSidechainSourceId(): string | undefined {
    return this.sidechainSourceId;
  }

  getSidechainState(): { depth: number; attack: number; release: number } {
    return this.sidechainState;
  }

  /**
   * Resolve an automation-lane target to the right scheduling-capable param.
   * Returns undefined for params that don't apply to this track (cutoff on
   * a drum or audio track, etc.) — the scheduler silently skips those.
   */
  getAutomationParam(param: AutomationParam): Automatable | undefined {
    switch (param) {
      case 'volume':
        return this.channel.volume as unknown as Automatable;
      case 'pan':
        return this.channel.pan as unknown as Automatable;
      case 'reverb':
        return this.reverbSend.gain as unknown as Automatable;
      case 'delay':
        return this.delaySend.gain as unknown as Automatable;
      case 'cutoff':
        return this.instrument.getFilterFreq?.();
      case 'eqLow':
        return this.eq.low as unknown as Automatable;
      case 'eqMid':
        return this.eq.mid as unknown as Automatable;
      case 'eqHigh':
        return this.eq.high as unknown as Automatable;
      case 'compThreshold':
        return this.comp.threshold as unknown as Automatable;
      case 'compRatio':
        return this.comp.ratio as unknown as Automatable;
      default:
        return undefined;
    }
  }

  clearPadPlayers() {
    for (const p of this.padPlayers.values()) p.dispose();
    this.padPlayers.clear();
    this.padSampleIds.clear();
  }

  getLevel() {
    const v = this.meter.getValue();
    return typeof v === 'number' ? v : v[0];
  }

  dispose() {
    this.instrument.dispose();
    this.clearPlayers();
    this.clearPadPlayers();
    this.sidechainFollower?.dispose();
    this.sidechainScale?.dispose();
    this.sidechainGain.dispose();
    this.channel.dispose();
    this.reverbSend.dispose();
    this.delaySend.dispose();
    this.meter.dispose();
    this.fxInput.dispose();
    this.eq.dispose();
    this.comp.dispose();
    this.chorus.dispose();
    this.crusher.dispose();
  }
}

// -----------------------------------------------------------

/**
 * Anything that exposes the four scheduling methods we need — both Web Audio
 * AudioParam and Tone's Signal/Param wrappers satisfy this shape, so the
 * automation scheduler doesn't need to care which side of the wrapper it's
 * driving.
 */
type Automatable = {
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
};

type Instrument = {
  kind: 'synth' | 'fm' | 'wavetable' | 'sampler' | 'drum' | 'null';
  output: Tone.ToneAudioNode;
  trigger(pitch: number | DrumPad, vel: number, dur: string | number): void;
  triggerAt(pitch: number | DrumPad, vel: number, dur: string | number, time: number): void;
  dispose(): void;
  /** Filter cutoff param for automation, if the instrument has one. */
  getFilterFreq?(): Automatable | undefined;
};

/** Map a SynthEngine value to its corresponding Instrument.kind. */
function synthEngineKind(engine?: SynthEngine): Instrument['kind'] {
  switch (engine) {
    case 'fm':
      return 'fm';
    case 'wavetable':
      return 'wavetable';
    case 'sampler':
      return 'sampler';
    default:
      return 'synth';
  }
}

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

  getFilterFreq(): Automatable {
    return this.filter.frequency as unknown as Automatable;
  }

  dispose() {
    this.poly.dispose();
    this.filter.dispose();
    this.drive.dispose();
    this.output.dispose();
  }
}

class FmInstrument implements Instrument {
  kind = 'fm' as const;
  output: Tone.Gain;
  private poly: Tone.PolySynth;
  private filter: Tone.Filter;

  constructor(params: SynthParams) {
    this.output = new Tone.Gain(1);
    this.filter = new Tone.Filter({ frequency: params.cutoff, type: 'lowpass', Q: params.resonance });
    this.poly = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: params.harmonicity,
      modulationIndex: params.fmDepth,
      detune: params.detune,
      portamento: params.glide,
      envelope: {
        attack: params.attack,
        decay: params.decay,
        sustain: params.sustain,
        release: params.release,
      },
      modulationEnvelope: {
        attack: params.attack * 1.5,
        decay: params.decay,
        sustain: params.sustain,
        release: params.release,
      },
    });
    this.poly.maxPolyphony = 12;
    this.poly.chain(this.filter, this.output);
  }

  applyParams(p: SynthParams) {
    this.filter.frequency.rampTo(p.cutoff, 0.05);
    this.filter.Q.rampTo(p.resonance, 0.05);
    this.poly.set({
      harmonicity: p.harmonicity,
      modulationIndex: p.fmDepth,
      detune: p.detune,
      portamento: p.glide,
      envelope: {
        attack: p.attack,
        decay: p.decay,
        sustain: p.sustain,
        release: p.release,
      },
    } as any);
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

  getFilterFreq(): Automatable {
    return this.filter.frequency as unknown as Automatable;
  }

  dispose() {
    this.poly.dispose();
    this.filter.dispose();
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

/**
 * Wavetable instrument — a PolySynth whose oscillator type is a `custom`
 * partials array. The `wavePosition` param (0..1) interpolates linearly
 * between 4 preset wave frames, so a single knob sweeps the timbre from
 * pure sine → hollow → bright → saw-ish. Cheap (no extra audio nodes)
 * and reuses the same filter + ADSR + FX sends as the subtractive engine.
 *
 * Frames are stored as length-8 harmonic-amplitude arrays. Tone's Synth
 * accepts `oscillator: { type: 'custom', partials: [...] }` and rebuilds
 * the underlying PeriodicWave on assignment.
 */
const WAVE_FRAMES: number[][] = [
  // sine — fundamental only
  [1, 0, 0, 0, 0, 0, 0, 0],
  // hollow — odd partials, square-ish
  [1, 0, 0.55, 0, 0.33, 0, 0.22, 0],
  // bright — all partials, decaying slowly
  [1, 0.85, 0.7, 0.55, 0.45, 0.35, 0.27, 0.2],
  // saw-ish — 1/n falloff
  [1, 0.5, 0.33, 0.25, 0.2, 0.166, 0.143, 0.125],
];

function morphPartials(pos: number): number[] {
  const clamped = Math.max(0, Math.min(1, pos));
  const segments = WAVE_FRAMES.length - 1;
  const scaled = clamped * segments;
  const i = Math.min(segments - 1, Math.floor(scaled));
  const t = scaled - i;
  const a = WAVE_FRAMES[i];
  const b = WAVE_FRAMES[i + 1];
  const out: number[] = new Array(a.length);
  for (let k = 0; k < a.length; k++) out[k] = a[k] * (1 - t) + b[k] * t;
  return out;
}

class WavetableInstrument implements Instrument {
  kind = 'wavetable' as const;
  output: Tone.Gain;
  private poly: Tone.PolySynth;
  private filter: Tone.Filter;
  private drive: Tone.Distortion;

  constructor(params: SynthParams) {
    this.output = new Tone.Gain(1);
    this.drive = new Tone.Distortion({ distortion: params.drive, oversample: '2x' });
    this.filter = new Tone.Filter({ frequency: params.cutoff, type: 'lowpass', Q: params.resonance });
    this.poly = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'custom', partials: morphPartials(params.wavePosition ?? 0.33) } as any,
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
      oscillator: { type: 'custom', partials: morphPartials(p.wavePosition ?? 0.33) } as any,
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

  getFilterFreq(): Automatable {
    return this.filter.frequency as unknown as Automatable;
  }

  dispose() {
    this.poly.dispose();
    this.filter.dispose();
    this.drive.dispose();
    this.output.dispose();
  }
}

/**
 * Chromatic sampler — Tone.Sampler plays a single source buffer at every
 * pitch by resampling. The buffer's "root" pitch (samplerRootPitch on the
 * Track, default C4 / MIDI 60) is the unity-rate note; every other pitch
 * shifts playback rate up or down. Useful for one-shot piano hits, vocal
 * chops, melodic stab samples, etc.
 *
 * Reuses the shared filter / ADSR-shaped amplitude envelope so the same
 * SynthParams knobs still mean something. ADSR maps onto Tone.Sampler's
 * built-in attack/release; sustain/decay aren't exposed on Sampler so they
 * fold into release (still musical for one-shots).
 *
 * If the referenced sampleId isn't present in the bank (e.g. project
 * loaded before audio rehydrates), the instrument outputs silence rather
 * than throwing — the engine update pass rebuilds it once the sample lands.
 */
class SamplerInstrument implements Instrument {
  kind = 'sampler' as const;
  output: Tone.Gain;
  private sampler?: Tone.Sampler;
  private filter: Tone.Filter;
  private sourceId: string;

  constructor(params: SynthParams, rootPitch: number, sampleId: string | undefined, sampleBank: Map<string, AudioBuffer>) {
    this.output = new Tone.Gain(1);
    this.filter = new Tone.Filter({ frequency: params.cutoff, type: 'lowpass', Q: params.resonance });
    this.filter.connect(this.output);
    this.sourceId = sampleId ?? '';
    if (sampleId) {
      const buf = sampleBank.get(sampleId);
      if (buf) {
        const rootName = Tone.Frequency(rootPitch, 'midi').toNote();
        this.sampler = new Tone.Sampler({
          urls: { [rootName]: new Tone.ToneAudioBuffer(buf) },
          attack: params.attack,
          release: Math.max(params.release, params.decay),
        });
        this.sampler.connect(this.filter);
      }
    }
  }

  getSourceId(): string {
    return this.sourceId;
  }

  applyParams(p: SynthParams, _rootPitch: number) {
    this.filter.frequency.rampTo(p.cutoff, 0.05);
    this.filter.Q.rampTo(p.resonance, 0.05);
    if (this.sampler) {
      this.sampler.attack = p.attack;
      this.sampler.release = Math.max(p.release, p.decay);
    }
  }

  trigger(pitch: number | DrumPad, vel: number, dur: string | number) {
    if (!this.sampler || typeof pitch !== 'number') return;
    const note = Tone.Frequency(pitch, 'midi').toNote();
    this.sampler.triggerAttackRelease(note, dur, undefined, vel);
  }

  triggerAt(pitch: number | DrumPad, vel: number, dur: string | number, time: number) {
    if (!this.sampler || typeof pitch !== 'number') return;
    const note = Tone.Frequency(pitch, 'midi').toNote();
    this.sampler.triggerAttackRelease(note, dur, time, vel);
  }

  getFilterFreq(): Automatable {
    return this.filter.frequency as unknown as Automatable;
  }

  dispose() {
    this.sampler?.dispose();
    this.filter.dispose();
    this.output.dispose();
  }
}

/** Pass-through instrument for audio tracks (no synthesis — players feed FX directly). */
class NullInstrument implements Instrument {
  kind = 'null' as const;
  output: Tone.Gain;
  constructor() {
    this.output = new Tone.Gain(1);
  }
  trigger() {}
  triggerAt() {}
  dispose() {
    this.output.dispose();
  }
}

const FALLBACK_SYNTH: SynthParams = {
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
  fmDepth: 4,
  harmonicity: 3,
  reverb: 0.15,
  delay: 0.1,
  delayTime: '8n',
  drive: 0,
};

function buildInstrument(track: Track, sampleBank?: Map<string, AudioBuffer>): Instrument {
  if (track.kind === 'drum') return new DrumInstrument();
  if (track.kind === 'audio') return new NullInstrument();
  if (track.kind === 'synth') {
    const params = track.synth ?? FALLBACK_SYNTH;
    if (track.synthEngine === 'fm') return new FmInstrument(params);
    if (track.synthEngine === 'wavetable') return new WavetableInstrument(params);
    if (track.synthEngine === 'sampler') {
      return new SamplerInstrument(
        params,
        track.samplerRootPitch ?? 60,
        track.samplerSampleId,
        sampleBank ?? new Map(),
      );
    }
    return new SynthInstrument(params);
  }
  return new SynthInstrument(FALLBACK_SYNTH);
}

/** Set of automation params with at least one non-empty lane on a track. */
function automatedParams(track: Track): Set<AutomationParam> {
  const set = new Set<AutomationParam>();
  for (const lane of track.automation ?? []) {
    if (lane.points.length > 0) set.add(lane.param);
  }
  return set;
}

function isRealtimeContext(): boolean {
  const raw = Tone.getContext().rawContext as unknown as { constructor: { name: string } };
  return raw.constructor.name !== 'OfflineAudioContext';
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
