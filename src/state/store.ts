import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  DEFAULT_SYNTH,
  DEFAULT_FX,
  DRUM_PADS,
  type Clip,
  type DrumPad,
  type DrumPattern,
  type FxRack,
  type Note,
  type Project,
  type Step,
  type SynthEngine,
  type SynthParams,
  type Track,
  type TrackKind,
} from '../audio/types';

const NERV_COLORS = ['#ff6a00', '#00ff88', '#66ccff', '#b266ff', '#ffaa00', '#ff2266', '#88ff22'];

export const newId = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 9)}`;

function emptyPattern(length = 16): DrumPattern {
  const steps: Record<DrumPad, Step[]> = {} as any;
  for (const pad of DRUM_PADS) {
    steps[pad] = Array.from({ length }, () => ({ on: false, velocity: 0.9 }));
  }
  return { steps, length };
}

function defaultDrumPattern(): DrumPattern {
  const p = emptyPattern(16);
  // four-on-the-floor kick
  [0, 4, 8, 12].forEach((i) => (p.steps.kick[i].on = true));
  // snare on 5 and 13
  [4, 12].forEach((i) => (p.steps.snare[i].on = true));
  // closed hat off-beats
  [0, 2, 4, 6, 8, 10, 12, 14].forEach((i) => {
    p.steps.hatClosed[i].on = true;
    p.steps.hatClosed[i].velocity = 0.6;
  });
  [7, 15].forEach((i) => (p.steps.hatOpen[i].on = true));
  return p;
}

function defaultMelody(lengthBeats: number): Note[] {
  const notes: Note[] = [];
  const scale = [60, 62, 63, 65, 67, 68, 70, 72];
  for (let i = 0; i < lengthBeats * 2; i++) {
    notes.push({
      id: newId('n'),
      pitch: scale[(i * 3) % scale.length] - 12,
      start: i * 0.5,
      length: 0.45,
      velocity: 0.8,
    });
  }
  return notes;
}

function makeProject(): Project {
  const drumTrack: Track = {
    id: newId('trk'),
    name: 'MAGI-01 // BALTHASAR',
    kind: 'drum',
    color: NERV_COLORS[0],
    volume: -6,
    pan: 0,
    mute: false,
    solo: false,
    arm: false,
    fx: { ...DEFAULT_FX, compOn: true, compThreshold: -16, compRatio: 4 },
    clips: [],
  };
  const bassTrack: Track = {
    id: newId('trk'),
    name: 'MAGI-02 // CASPER',
    kind: 'synth',
    synthEngine: 'subtractive',
    color: NERV_COLORS[1],
    volume: -10,
    pan: -0.15,
    mute: false,
    solo: false,
    arm: false,
    synth: { ...DEFAULT_SYNTH, osc: 'square', cutoff: 600, resonance: 6, drive: 0.15, reverb: 0.1, delay: 0.05 },
    fx: { ...DEFAULT_FX, eqLow: 3 },
    clips: [],
  };
  const leadTrack: Track = {
    id: newId('trk'),
    name: 'MAGI-03 // MELCHIOR',
    kind: 'synth',
    synthEngine: 'subtractive',
    color: NERV_COLORS[2],
    volume: -12,
    pan: 0.15,
    mute: false,
    solo: false,
    arm: false,
    synth: { ...DEFAULT_SYNTH, osc: 'fatsawtooth', cutoff: 3200, resonance: 1.5, reverb: 0.35, delay: 0.25 },
    fx: { ...DEFAULT_FX, chorusOn: true, chorusDepth: 0.6 },
    clips: [],
  };

  drumTrack.clips.push({
    id: newId('clp'),
    kind: 'pattern',
    trackId: drumTrack.id,
    start: 0,
    length: 4,
    pattern: defaultDrumPattern(),
    color: drumTrack.color,
    name: 'PTN-A',
  });

  drumTrack.clips.push({
    id: newId('clp'),
    kind: 'pattern',
    trackId: drumTrack.id,
    start: 4,
    length: 4,
    pattern: defaultDrumPattern(),
    color: drumTrack.color,
    name: 'PTN-A',
  });

  bassTrack.clips.push({
    id: newId('clp'),
    kind: 'midi',
    trackId: bassTrack.id,
    start: 0,
    length: 8,
    notes: defaultMelody(8).map((n) => ({ ...n, pitch: n.pitch - 12 })),
    color: bassTrack.color,
    name: 'BASS-1',
  });

  leadTrack.clips.push({
    id: newId('clp'),
    kind: 'midi',
    trackId: leadTrack.id,
    start: 4,
    length: 4,
    notes: defaultMelody(4),
    color: leadTrack.color,
    name: 'LEAD-1',
  });

  return {
    id: newId('proj'),
    name: 'OPERATION YASHIMA',
    bpm: 124,
    numerator: 4,
    denominator: 4,
    master: { volume: -3, limiter: true },
    tracks: [drumTrack, bassTrack, leadTrack],
    loopStart: 0,
    loopEnd: 8,
    loopEnabled: false,
    lengthBars: 16,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export type View =
  | 'arrange'
  | 'mixer'
  | 'instrument'
  | 'pianoroll'
  | 'sequencer'
  | 'fx'
  | 'project';

type State = {
  project: Project;
  view: View;
  selectedTrackId: string | null;
  selectedClipId: string | null;
  isPlaying: boolean;
  metronome: boolean;
  /** mic recording in progress */
  micRecording: boolean;
  /** master bounce in progress */
  bouncing: boolean;
  /** undo / redo history of full project snapshots */
  past: Project[];
  future: Project[];
};

type Actions = {
  setView(v: View): void;
  selectTrack(id: string): void;
  selectClip(id: string | null): void;

  setBpm(bpm: number): void;
  setTimeSig(n: number, d: number): void;
  setMasterVolume(db: number): void;
  setLoop(enabled: boolean, start?: number, end?: number): void;
  setMetronome(b: boolean): void;
  setPlaying(b: boolean): void;

  undo(): void;
  redo(): void;

  addTrack(kind: TrackKind): Track;
  removeTrack(id: string): void;
  updateTrack(id: string, patch: Partial<Track>): void;
  updateSynth(id: string, patch: Partial<SynthParams>): void;
  setSynthEngine(id: string, engine: SynthEngine): void;
  updateFx(id: string, patch: Partial<FxRack>): void;

  addClip(trackId: string, atBeat: number, lengthBeats?: number): Clip | null;
  addAudioClip(trackId: string, atBeat: number, sampleId: string, durationSec: number, name?: string): Clip | null;
  removeClip(clipId: string): void;
  moveClip(clipId: string, newStart: number): void;
  resizeClip(clipId: string, newLength: number): void;

  setMicRecording(b: boolean): void;
  setBouncing(b: boolean): void;

  toggleStep(trackId: string, clipId: string, pad: DrumPad, step: number): void;
  setStepVelocity(trackId: string, clipId: string, pad: DrumPad, step: number, v: number): void;

  addNote(trackId: string, clipId: string, note: Omit<Note, 'id'>): void;
  removeNote(trackId: string, clipId: string, noteId: string): void;
  updateNote(trackId: string, clipId: string, noteId: string, patch: Partial<Note>): void;

  loadProject(p: Project): void;
  newProject(): void;
  exportProject(): string;
  importProject(json: string): void;
};

type Store = State & Actions;

const HISTORY_LIMIT = 80;

export const useStore = create<Store>()(
  subscribeWithSelector((set, get) => {
    /**
     * commit — apply a new project AND record the previous one onto the undo
     * stack. Used by structural / musical edits (clips, notes, steps, tracks).
     * Continuous param tweaks (volume, pan, synth/fx knobs, bpm slider) call
     * plain `set` so they don't flood the history.
     */
    const commit = (next: Project, extra?: Partial<Store>) => {
      const s = get();
      set({
        project: next,
        past: [...s.past, s.project].slice(-HISTORY_LIMIT),
        future: [],
        ...extra,
      } as Partial<Store>);
    };

    return {
    project: makeProject(),
    view: 'arrange',
    selectedTrackId: null,
    selectedClipId: null,
    isPlaying: false,
    metronome: false,
    micRecording: false,
    bouncing: false,
    past: [],
    future: [],

    setView: (v) => set({ view: v }),
    selectTrack: (id) => set({ selectedTrackId: id }),
    selectClip: (id) => set({ selectedClipId: id }),

    setBpm: (bpm) => {
      const p = { ...get().project, bpm, updatedAt: Date.now() };
      set({ project: p });
    },
    setTimeSig: (n, d) => set({ project: { ...get().project, numerator: n, denominator: d, updatedAt: Date.now() } }),
    setMasterVolume: (db) =>
      set({ project: { ...get().project, master: { ...get().project.master, volume: db }, updatedAt: Date.now() } }),
    setLoop: (enabled, start, end) =>
      set({
        project: {
          ...get().project,
          loopEnabled: enabled,
          loopStart: start ?? get().project.loopStart,
          loopEnd: end ?? get().project.loopEnd,
          updatedAt: Date.now(),
        },
      }),
    setMetronome: (b) => set({ metronome: b }),
    setPlaying: (b) => set({ isPlaying: b }),
    setMicRecording: (b) => set({ micRecording: b }),
    setBouncing: (b) => set({ bouncing: b }),

    undo: () => {
      const s = get();
      if (s.past.length === 0) return;
      const prev = s.past[s.past.length - 1];
      set({
        project: prev,
        past: s.past.slice(0, -1),
        future: [s.project, ...s.future].slice(0, HISTORY_LIMIT),
      });
    },
    redo: () => {
      const s = get();
      if (s.future.length === 0) return;
      const next = s.future[0];
      set({
        project: next,
        past: [...s.past, s.project].slice(-HISTORY_LIMIT),
        future: s.future.slice(1),
      });
    },

    addTrack: (kind) => {
      const tracks = get().project.tracks;
      const color = NERV_COLORS[tracks.length % NERV_COLORS.length];
      const name = `TRK ${String(tracks.length + 1).padStart(2, '0')} // ${kind.toUpperCase()}`;
      const t: Track = {
        id: newId('trk'),
        name,
        kind,
        color,
        volume: -10,
        pan: 0,
        mute: false,
        solo: false,
        arm: false,
        synth: kind === 'synth' ? { ...DEFAULT_SYNTH } : undefined,
        synthEngine: kind === 'synth' ? 'subtractive' : undefined,
        fx: { ...DEFAULT_FX },
        clips: [],
      };
      commit({ ...get().project, tracks: [...tracks, t], updatedAt: Date.now() }, { selectedTrackId: t.id });
      return t;
    },
    removeTrack: (id) => {
      const tracks = get().project.tracks.filter((t) => t.id !== id);
      commit({ ...get().project, tracks, updatedAt: Date.now() });
    },
    updateTrack: (id, patch) => {
      const tracks = get().project.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t));
      set({ project: { ...get().project, tracks, updatedAt: Date.now() } });
    },
    updateSynth: (id, patch) => {
      const tracks = get().project.tracks.map((t) =>
        t.id === id ? { ...t, synth: { ...(t.synth ?? DEFAULT_SYNTH), ...patch } } : t,
      );
      set({ project: { ...get().project, tracks, updatedAt: Date.now() } });
    },
    setSynthEngine: (id, engine) => {
      const tracks = get().project.tracks.map((t) =>
        t.id === id ? { ...t, synthEngine: engine } : t,
      );
      set({ project: { ...get().project, tracks, updatedAt: Date.now() } });
    },
    updateFx: (id, patch) => {
      const tracks = get().project.tracks.map((t) =>
        t.id === id ? { ...t, fx: { ...(t.fx ?? DEFAULT_FX), ...patch } } : t,
      );
      set({ project: { ...get().project, tracks, updatedAt: Date.now() } });
    },

    addClip: (trackId, atBeat, lengthBeats = 4) => {
      const track = get().project.tracks.find((t) => t.id === trackId);
      if (!track) return null;
      let clip: Clip;
      if (track.kind === 'drum') {
        clip = {
          id: newId('clp'),
          kind: 'pattern',
          trackId,
          start: atBeat,
          length: lengthBeats,
          pattern: emptyPattern(16),
          color: track.color,
          name: `PTN-${track.clips.length + 1}`,
        };
      } else if (track.kind === 'audio') {
        // empty audio track clip not meaningful — skip
        return null;
      } else {
        clip = {
          id: newId('clp'),
          kind: 'midi',
          trackId,
          start: atBeat,
          length: lengthBeats,
          notes: [],
          color: track.color,
          name: `CLP-${track.clips.length + 1}`,
        };
      }
      const tracks = get().project.tracks.map((t) =>
        t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t,
      );
      commit({ ...get().project, tracks, updatedAt: Date.now() }, { selectedClipId: clip.id });
      return clip;
    },

    addAudioClip: (trackId, atBeat, sampleId, durationSec, name) => {
      const track = get().project.tracks.find((t) => t.id === trackId);
      if (!track) return null;
      const bps = get().project.bpm / 60;
      const lengthBeats = Math.max(0.25, durationSec * bps);
      const clip: Clip = {
        id: newId('clp'),
        kind: 'audio',
        trackId,
        start: atBeat,
        length: lengthBeats,
        sampleId,
        gain: 1,
        offset: 0,
        color: track.color,
        name: name ?? `AUD-${track.clips.length + 1}`,
      };
      const tracks = get().project.tracks.map((t) =>
        t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t,
      );
      commit({ ...get().project, tracks, updatedAt: Date.now() }, { selectedClipId: clip.id });
      return clip;
    },

    removeClip: (clipId) => {
      const tracks = get().project.tracks.map((t) => ({
        ...t,
        clips: t.clips.filter((c) => c.id !== clipId),
      }));
      commit({ ...get().project, tracks, updatedAt: Date.now() });
    },

    moveClip: (clipId, newStart) => {
      const tracks = get().project.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => (c.id === clipId ? { ...c, start: Math.max(0, newStart) } : c)),
      }));
      commit({ ...get().project, tracks, updatedAt: Date.now() });
    },

    resizeClip: (clipId, newLength) => {
      const tracks = get().project.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => (c.id === clipId ? { ...c, length: Math.max(0.25, newLength) } : c)),
      }));
      commit({ ...get().project, tracks, updatedAt: Date.now() });
    },

    toggleStep: (trackId, clipId, pad, step) => {
      const tracks = get().project.tracks.map((t) =>
        t.id !== trackId
          ? t
          : {
              ...t,
              clips: t.clips.map((c) => {
                if (c.id !== clipId || c.kind !== 'pattern') return c;
                const nextSteps = { ...c.pattern.steps };
                const arr = [...nextSteps[pad]];
                arr[step] = { ...arr[step], on: !arr[step].on };
                nextSteps[pad] = arr;
                return { ...c, pattern: { ...c.pattern, steps: nextSteps } };
              }),
            },
      );
      commit({ ...get().project, tracks, updatedAt: Date.now() });
    },

    setStepVelocity: (trackId, clipId, pad, step, v) => {
      const tracks = get().project.tracks.map((t) =>
        t.id !== trackId
          ? t
          : {
              ...t,
              clips: t.clips.map((c) => {
                if (c.id !== clipId || c.kind !== 'pattern') return c;
                const nextSteps = { ...c.pattern.steps };
                const arr = [...nextSteps[pad]];
                arr[step] = { ...arr[step], velocity: v };
                nextSteps[pad] = arr;
                return { ...c, pattern: { ...c.pattern, steps: nextSteps } };
              }),
            },
      );
      set({ project: { ...get().project, tracks, updatedAt: Date.now() } });
    },

    addNote: (trackId, clipId, note) => {
      const tracks = get().project.tracks.map((t) =>
        t.id !== trackId
          ? t
          : {
              ...t,
              clips: t.clips.map((c) =>
                c.id !== clipId || c.kind !== 'midi'
                  ? c
                  : { ...c, notes: [...c.notes, { ...note, id: newId('n') }] },
              ),
            },
      );
      commit({ ...get().project, tracks, updatedAt: Date.now() });
    },

    removeNote: (trackId, clipId, noteId) => {
      const tracks = get().project.tracks.map((t) =>
        t.id !== trackId
          ? t
          : {
              ...t,
              clips: t.clips.map((c) =>
                c.id !== clipId || c.kind !== 'midi' ? c : { ...c, notes: c.notes.filter((n) => n.id !== noteId) },
              ),
            },
      );
      commit({ ...get().project, tracks, updatedAt: Date.now() });
    },

    updateNote: (trackId, clipId, noteId, patch) => {
      const tracks = get().project.tracks.map((t) =>
        t.id !== trackId
          ? t
          : {
              ...t,
              clips: t.clips.map((c) =>
                c.id !== clipId || c.kind !== 'midi'
                  ? c
                  : { ...c, notes: c.notes.map((n) => (n.id === noteId ? { ...n, ...patch } : n)) },
              ),
            },
      );
      commit({ ...get().project, tracks, updatedAt: Date.now() });
    },

    loadProject: (p) => set({ project: p, selectedClipId: null, selectedTrackId: null, past: [], future: [] }),

    newProject: () =>
      set({ project: makeProject(), selectedClipId: null, selectedTrackId: null, past: [], future: [] }),

    exportProject: () => JSON.stringify(get().project, null, 2),
    importProject: (json) => {
      try {
        const p = JSON.parse(json) as Project;
        set({ project: p, past: [], future: [] });
      } catch (e) {
        console.error('Failed to import project', e);
      }
    },
    };
  }),
);

export const PROJECT_STORAGE_KEY = 'lostboard.project.v1';

export function saveProjectToStorage() {
  const p = useStore.getState().project;
  localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(p));
}

export function loadProjectFromStorage(): boolean {
  const raw = localStorage.getItem(PROJECT_STORAGE_KEY);
  if (!raw) return false;
  try {
    const p = JSON.parse(raw) as Project;
    useStore.getState().loadProject(p);
    return true;
  } catch {
    return false;
  }
}
