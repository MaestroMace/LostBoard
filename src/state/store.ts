import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  DEFAULT_SYNTH,
  DRUM_PADS,
  type Clip,
  type DrumPad,
  type DrumPattern,
  type Note,
  type Project,
  type Step,
  type SynthParams,
  type Track,
  type TrackKind,
} from '../audio/types';

const NERV_COLORS = ['#ff6a00', '#00ff88', '#66ccff', '#b266ff', '#ffaa00', '#ff2266', '#88ff22'];

const newId = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 9)}`;

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
    clips: [],
  };
  const bassTrack: Track = {
    id: newId('trk'),
    name: 'MAGI-02 // CASPER',
    kind: 'synth',
    color: NERV_COLORS[1],
    volume: -10,
    pan: -0.15,
    mute: false,
    solo: false,
    arm: false,
    synth: { ...DEFAULT_SYNTH, osc: 'square', cutoff: 600, resonance: 6, drive: 0.15, reverb: 0.1, delay: 0.05 },
    clips: [],
  };
  const leadTrack: Track = {
    id: newId('trk'),
    name: 'MAGI-03 // MELCHIOR',
    kind: 'synth',
    color: NERV_COLORS[2],
    volume: -12,
    pan: 0.15,
    mute: false,
    solo: false,
    arm: false,
    synth: { ...DEFAULT_SYNTH, osc: 'fatsawtooth', cutoff: 3200, resonance: 1.5, reverb: 0.35, delay: 0.25 },
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

export type View = 'arrange' | 'mixer' | 'instrument' | 'pianoroll' | 'sequencer' | 'project';

type State = {
  project: Project;
  view: View;
  selectedTrackId: string | null;
  selectedClipId: string | null;
  isPlaying: boolean;
  isRecording: boolean;
  metronome: boolean;
  positionBeats: number;
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
  setPosition(beats: number): void;
  setPlaying(b: boolean): void;
  setRecording(b: boolean): void;

  addTrack(kind: TrackKind): Track;
  removeTrack(id: string): void;
  updateTrack(id: string, patch: Partial<Track>): void;
  updateSynth(id: string, patch: Partial<SynthParams>): void;

  addClip(trackId: string, atBeat: number, lengthBeats?: number): Clip | null;
  removeClip(clipId: string): void;
  moveClip(clipId: string, newStart: number): void;
  resizeClip(clipId: string, newLength: number): void;

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

export const useStore = create<Store>()(
  subscribeWithSelector((set, get) => ({
    project: makeProject(),
    view: 'arrange',
    selectedTrackId: null,
    selectedClipId: null,
    isPlaying: false,
    isRecording: false,
    metronome: false,
    positionBeats: 0,

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
    setPosition: (beats) => set({ positionBeats: beats }),
    setPlaying: (b) => set({ isPlaying: b }),
    setRecording: (b) => set({ isRecording: b }),

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
        clips: [],
      };
      set({
        project: { ...get().project, tracks: [...tracks, t], updatedAt: Date.now() },
        selectedTrackId: t.id,
      });
      return t;
    },
    removeTrack: (id) => {
      const tracks = get().project.tracks.filter((t) => t.id !== id);
      set({ project: { ...get().project, tracks, updatedAt: Date.now() } });
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
      set({
        project: { ...get().project, tracks, updatedAt: Date.now() },
        selectedClipId: clip.id,
      });
      return clip;
    },

    removeClip: (clipId) => {
      const tracks = get().project.tracks.map((t) => ({
        ...t,
        clips: t.clips.filter((c) => c.id !== clipId),
      }));
      set({ project: { ...get().project, tracks, updatedAt: Date.now() } });
    },

    moveClip: (clipId, newStart) => {
      const tracks = get().project.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => (c.id === clipId ? { ...c, start: Math.max(0, newStart) } : c)),
      }));
      set({ project: { ...get().project, tracks, updatedAt: Date.now() } });
    },

    resizeClip: (clipId, newLength) => {
      const tracks = get().project.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => (c.id === clipId ? { ...c, length: Math.max(0.25, newLength) } : c)),
      }));
      set({ project: { ...get().project, tracks, updatedAt: Date.now() } });
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
      set({ project: { ...get().project, tracks, updatedAt: Date.now() } });
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
      set({ project: { ...get().project, tracks, updatedAt: Date.now() } });
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
      set({ project: { ...get().project, tracks, updatedAt: Date.now() } });
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
      set({ project: { ...get().project, tracks, updatedAt: Date.now() } });
    },

    loadProject: (p) => set({ project: p, selectedClipId: null, selectedTrackId: null }),

    newProject: () => set({ project: makeProject(), selectedClipId: null, selectedTrackId: null }),

    exportProject: () => JSON.stringify(get().project, null, 2),
    importProject: (json) => {
      try {
        const p = JSON.parse(json) as Project;
        set({ project: p });
      } catch (e) {
        console.error('Failed to import project', e);
      }
    },
  })),
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
