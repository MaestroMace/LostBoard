import { useStore } from '../state/store';
import { audioEngine } from './engine';
import { transportClock } from '../state/transportClock';
import type { Track } from './types';

/**
 * midiInput — Web MIDI bridge.
 *
 * - Forwards incoming note-on/off from any connected MIDI device to the first
 *   *armed* synth track, so playing a controller monitors live like the
 *   on-screen keyboard does.
 * - While the transport is rolling, also captures those notes into a MIDI
 *   clip on that armed track (creating one at the current bar if none
 *   intersects the playhead). Note length is the actual on-to-off duration.
 *
 * Status is exposed via a tiny external-store contract so the StatusBar
 * indicator can render the connected device name without prop-drilling.
 */

export type MidiStatus = {
  supported: boolean;
  connected: boolean;
  device: string;
};

let snapshot: MidiStatus = { supported: false, connected: false, device: '' };
const subscribers = new Set<() => void>();

function setSnapshot(next: MidiStatus) {
  // only replace the reference when something actually changed so
  // useSyncExternalStore can bail out on identity checks
  if (
    next.supported === snapshot.supported &&
    next.connected === snapshot.connected &&
    next.device === snapshot.device
  ) {
    return;
  }
  snapshot = next;
  subscribers.forEach((cb) => cb());
}

export function subscribeMidi(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

export function getMidiSnapshot(): MidiStatus {
  return snapshot;
}

class MidiInput {
  private access?: MIDIAccess;
  /** Per-pitch open-note state, used to compute a note's length on note-off. */
  private pending = new Map<number, { startBeat: number; velocity: number; trackId: string }>();
  /** Most recently created clip per track during a recording session — keeps takes contiguous. */
  private liveClipByTrack = new Map<string, string>();
  /**
   * Punch-in gate: notes that begin before this beat are monitored live but
   * not captured. -Infinity means "no gate" (normal record-everything mode).
   * Set by a punch-record take so the pre-roll bars don't capture anything.
   */
  private recordGateBeat = -Infinity;

  /** Set the punch-in record gate (beat). Pass null to clear it. */
  setRecordGate(beat: number | null) {
    this.recordGateBeat = beat ?? -Infinity;
  }

  getRecordGate(): number {
    return this.recordGateBeat;
  }

  async init(): Promise<void> {
    if (typeof navigator === 'undefined' || !('requestMIDIAccess' in navigator)) {
      setSnapshot({ supported: false, connected: false, device: '' });
      return;
    }
    setSnapshot({ supported: true, connected: false, device: '' });
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      // user denied permission, or running in an insecure context
      return;
    }
    this.refresh();
    this.access.onstatechange = () => this.refresh();
  }

  private refresh() {
    if (!this.access) return;
    const inputs = Array.from(this.access.inputs.values());
    inputs.forEach((inp) => {
      // re-binding is harmless — Web MIDI replaces the handler
      inp.onmidimessage = this.onMessage;
    });
    setSnapshot({
      supported: true,
      connected: inputs.length > 0,
      device: inputs[0]?.name ?? '',
    });
  }

  private onMessage = (e: MIDIMessageEvent) => {
    if (!e.data || e.data.length === 0) return;
    const status = e.data[0];
    // realtime messages are single-byte, 0xF8+ — handled before the
    // note-message length guard
    if (status >= 0xf8) {
      if (!this.clockSyncEnabled) return;
      if (status === 0xf8) this.onClockPulse();
      else if (status === 0xfa) this.onClockStart();
      else if (status === 0xfb) this.onClockContinue();
      else if (status === 0xfc) this.onClockStop();
      return;
    }
    if (e.data.length < 2) return;
    const cmd = status & 0xf0;
    const note = e.data[1];
    const vel = e.data[2] ?? 0;
    if (cmd === 0x90 && vel > 0) {
      this.noteOn(note, vel / 127);
    } else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) {
      this.noteOff(note);
    }
  };

  // ---------- MIDI CLOCK INPUT (sync-in) ----------

  private clockSyncEnabled = false;
  private lastPulseMs = 0;
  private pulseIntervals: number[] = [];
  private pulseCount = 0;

  /** Toggle locking the transport to an incoming external MIDI clock. */
  setClockSync(on: boolean) {
    this.clockSyncEnabled = on;
    this.lastPulseMs = 0;
    this.pulseIntervals = [];
    this.pulseCount = 0;
  }

  isClockSyncEnabled() {
    return this.clockSyncEnabled;
  }

  /**
   * One 0xF8 pulse — 24 per quarter note. We average the inter-pulse
   * interval over a rolling quarter-note window and re-derive BPM once
   * per quarter, which is stable against the few-ms jitter of MIDI + JS
   * timers without a full phase-locked loop.
   */
  private onClockPulse() {
    const now = performance.now();
    if (this.lastPulseMs > 0) {
      this.pulseIntervals.push(now - this.lastPulseMs);
      if (this.pulseIntervals.length > 24) this.pulseIntervals.shift();
    }
    this.lastPulseMs = now;
    this.pulseCount++;
    if (this.pulseCount % 24 === 0 && this.pulseIntervals.length >= 12) {
      const mean =
        this.pulseIntervals.reduce((a, b) => a + b, 0) / this.pulseIntervals.length;
      const bpm = 60000 / (mean * 24);
      if (bpm >= 20 && bpm <= 400) audioEngine.setBpm(bpm);
    }
  }

  private onClockStart() {
    this.lastPulseMs = 0;
    this.pulseIntervals = [];
    this.pulseCount = 0;
    audioEngine.stop();
    audioEngine.play().then(() => useStore.getState().setPlaying(true));
  }

  private onClockContinue() {
    audioEngine.play().then(() => useStore.getState().setPlaying(true));
  }

  private onClockStop() {
    audioEngine.pause();
    useStore.getState().setPlaying(false);
  }

  private armedSynth(): Track | undefined {
    return useStore.getState().project.tracks.find((t) => t.kind === 'synth' && t.arm);
  }

  private noteOn(pitch: number, velocity: number) {
    const track = this.armedSynth();
    if (!track) return;
    // monitor immediately — short voice; the recorded clip's notes are what
    // actually play during transport, this is just the live-monitor tail
    audioEngine.trigger(track.id, pitch, velocity, '8n');
    const pos = transportClock.getSnapshot();
    // capture only while rolling AND past the punch-in gate (pre-roll bars
    // monitor live but don't record)
    if (audioEngine.isPlaying() && pos >= this.recordGateBeat) {
      this.pending.set(pitch, { startBeat: pos, velocity, trackId: track.id });
    }
  }

  private noteOff(pitch: number) {
    const p = this.pending.get(pitch);
    if (!p) return;
    this.pending.delete(pitch);
    const length = Math.max(0.0625, transportClock.getSnapshot() - p.startBeat);
    this.commitNote(p.trackId, p.startBeat, pitch, p.velocity, length);
  }

  private commitNote(trackId: string, startBeat: number, pitch: number, velocity: number, length: number) {
    const st = useStore.getState();
    const track = st.project.tracks.find((t) => t.id === trackId);
    if (!track) return;

    // prefer a remembered clip from this take if it still contains the start
    const liveId = this.liveClipByTrack.get(trackId);
    let clip = liveId ? track.clips.find((c) => c.id === liveId) : undefined;
    if (!clip || clip.kind !== 'midi' || startBeat < clip.start || startBeat >= clip.start + clip.length) {
      // fall back to any midi clip that intersects the playhead
      clip = track.clips.find(
        (c) => c.kind === 'midi' && c.start <= startBeat && c.start + c.length > startBeat,
      );
    }
    if (!clip) {
      // create a fresh 4-beat clip on the bar so subsequent notes land in it
      const created = st.addClip(trackId, Math.floor(startBeat / 4) * 4, 4);
      if (!created || created.kind !== 'midi') return;
      clip = created;
    }
    this.liveClipByTrack.set(trackId, clip.id);

    st.addNote(trackId, clip.id, {
      pitch,
      start: startBeat - clip.start,
      length,
      velocity,
    });
  }
}

export const midiInput = new MidiInput();
