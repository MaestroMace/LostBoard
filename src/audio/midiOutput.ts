import * as Tone from 'tone';

/**
 * midiOutput — Web MIDI output bridge.
 *
 * Enumerates connected MIDI output ports and lets a track drive external
 * hardware: when a track carries a `midiOutChannel`, the engine routes its
 * notes here instead of (well, in addition to skipping) the internal synth
 * voice.
 *
 * Scheduling: Tone gives us note times in the AudioContext clock; Web MIDI
 * `send` wants timestamps in the `performance.now()` domain. We capture the
 * offset between the two clocks once per call and shift accordingly, so a
 * note scheduled for audio-time T fires on the wire at the matching wall
 * time.
 *
 * Status is exposed through a tiny external-store contract so UI can show
 * the device list and current selection without prop-drilling.
 */

export type MidiOutStatus = {
  supported: boolean;
  /** Connected output ports: id + display name. */
  ports: { id: string; name: string }[];
  /** Currently selected output port id, or '' for none. */
  selectedId: string;
};

let snapshot: MidiOutStatus = { supported: false, ports: [], selectedId: '' };
const subscribers = new Set<() => void>();

function publish(next: MidiOutStatus) {
  snapshot = next;
  subscribers.forEach((cb) => cb());
}

export function subscribeMidiOut(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

export function getMidiOutSnapshot(): MidiOutStatus {
  return snapshot;
}

class MidiOutput {
  private access?: MIDIAccess;
  private selectedId = '';

  async init(): Promise<void> {
    if (typeof navigator === 'undefined' || !('requestMIDIAccess' in navigator)) {
      publish({ supported: false, ports: [], selectedId: '' });
      return;
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      publish({ supported: false, ports: [], selectedId: '' });
      return;
    }
    this.access.onstatechange = () => this.refresh();
    this.refresh();
  }

  private refresh() {
    if (!this.access) return;
    const ports = Array.from(this.access.outputs.values()).map((o) => ({
      id: o.id,
      name: o.name ?? o.id,
    }));
    // keep the current selection if it's still present, else default to the first
    if (!ports.some((p) => p.id === this.selectedId)) {
      this.selectedId = ports[0]?.id ?? '';
    }
    publish({ supported: true, ports, selectedId: this.selectedId });
  }

  selectOutput(id: string) {
    this.selectedId = id;
    publish({ ...snapshot, selectedId: id });
  }

  private port(): MIDIOutput | undefined {
    if (!this.access || !this.selectedId) return undefined;
    return this.access.outputs.get(this.selectedId) ?? undefined;
  }

  /**
   * Schedule a note-on now-or-future and a matching note-off `durationSec`
   * later. `audioTime` is in the Tone/AudioContext clock; we rebase it onto
   * the `performance.now()` clock that Web MIDI timestamps use.
   */
  scheduleNote(channel: number, pitch: number, velocity: number, audioTime: number, durationSec: number) {
    const port = this.port();
    if (!port) return;
    const ch = Math.max(0, Math.min(15, channel - 1));
    const vel = Math.max(1, Math.min(127, Math.round(velocity * 127)));
    const note = Math.max(0, Math.min(127, Math.round(pitch)));
    // offset between the two clocks, sampled per call
    const perfNow = performance.now();
    const audioNow = Tone.now();
    const onMs = perfNow + Math.max(0, audioTime - audioNow) * 1000;
    const offMs = onMs + Math.max(0.02, durationSec) * 1000;
    try {
      port.send([0x90 | ch, note, vel], onMs);
      port.send([0x80 | ch, note, 0], offMs);
    } catch {
      /* port may have disconnected mid-schedule */
    }
  }

  /** Fire a note immediately (live preview / monitoring). */
  sendNoteNow(channel: number, pitch: number, velocity: number, durationSec = 0.25) {
    this.scheduleNote(channel, pitch, velocity, Tone.now(), durationSec);
  }

  /** Panic — all-notes-off on every channel of the selected port. */
  allNotesOff() {
    const port = this.port();
    if (!port) return;
    for (let ch = 0; ch < 16; ch++) {
      try {
        port.send([0xb0 | ch, 0x7b, 0]);
      } catch {
        /* noop */
      }
    }
  }
}

export const midiOutput = new MidiOutput();
