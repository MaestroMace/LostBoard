import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  DEFAULT_SYNTH,
  DEFAULT_FX,
  DRUM_PADS,
  type AutomationCurve,
  type AutomationParam,
  type AutomationPoint,
  type Clip,
  type DrumPad,
  type DrumPattern,
  type FxRack,
  type Note,
  type Project,
  type Step,
  type SamplerZone,
  type SynthEngine,
  type SynthParams,
  type TempoEvent,
  type Track,
  type TrackKind,
} from '../audio/types';

const HUD_COLORS = ['#ff6a00', '#00ff88', '#66ccff', '#b266ff', '#ffaa00', '#ff2266', '#88ff22'];

export const newId = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 9)}`;

/**
 * Effective sampler zones for a track, migrating the legacy single-sample
 * fields (samplerSampleId / samplerRootPitch) into a one-element zone list
 * so the UI and store actions only ever deal with the array form. Returns
 * a fresh array each call — safe to mutate. The migration uses a stable
 * id (`${track.id}__legacy`) so React keys don't churn between renders
 * until the user's first edit promotes the zone into `samplerZones`.
 */
export function currentSamplerZones(track: Track): SamplerZone[] {
  if (track.samplerZones && track.samplerZones.length > 0) {
    return track.samplerZones.map((z) => ({ ...z }));
  }
  if (track.samplerSampleId) {
    return [
      {
        id: `${track.id}__legacy`,
        sampleId: track.samplerSampleId,
        rootPitch: track.samplerRootPitch ?? 60,
      },
    ];
  }
  return [];
}

/** Default scene list when a project doesn't carry one (old projects, fresh `makeProject`). */
export function defaultScenes() {
  return [{ name: 'INTRO' }, { name: 'A' }, { name: 'B' }, { name: 'DROP' }];
}

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
    name: 'DRUMS // VEGA',
    kind: 'drum',
    color: HUD_COLORS[0],
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
    name: 'BASS // ALTAIR',
    kind: 'synth',
    synthEngine: 'subtractive',
    color: HUD_COLORS[1],
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
    name: 'LEAD // DENEB',
    kind: 'synth',
    synthEngine: 'subtractive',
    color: HUD_COLORS[2],
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
    name: 'OPERATION DOWNBEAT',
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
  | 'session'
  | 'mixer'
  | 'instrument'
  | 'pianoroll'
  | 'sequencer'
  | 'fx'
  | 'automation'
  | 'project';

type State = {
  project: Project;
  view: View;
  selectedTrackId: string | null;
  /** Selected clips, in selection order. The first id is the "primary" used by per-clip editors. */
  selectedClipIds: string[];
  /** Selected MIDI note ids (in the currently-open piano-roll clip). Not persisted — UI state for selection-aware actions like per-note humanise / quantise. */
  selectedNoteIds: string[];
  /** In-memory clip clipboard for copy/paste/duplicate. Not part of the persisted project. */
  clipboard: Clip[];
  isPlaying: boolean;
  metronome: boolean;
  /** mic recording in progress */
  micRecording: boolean;
  /** master bounce in progress */
  bouncing: boolean;
  /** Help overlay visibility, toggled via `?` or the in-app button. */
  helpOpen: boolean;
  /** Count-in bars for a punch-in MIDI recording. 0 = punch with no pre-roll. Not persisted. */
  countInBars: number;
  /** When true, the engine sends MIDI clock + transport messages to the selected output port. Not persisted. */
  midiClockOut: boolean;
  /** When true, the transport locks to an incoming external MIDI clock. Not persisted. */
  midiClockIn: boolean;
  /** When true the engine schedules session loops instead of the arrangement. */
  sessionMode: boolean;
  /** Runtime map of trackId → currently-playing session clipId. Not part of the project. */
  sessionPlaying: Record<string, string>;
  /** undo / redo history of full project snapshots */
  past: Project[];
  future: Project[];
};

type Actions = {
  setView(v: View): void;
  selectTrack(id: string): void;
  selectClip(id: string | null): void;
  toggleClipSelected(id: string): void;
  clearClipSelection(): void;
  moveClipsBy(ids: string[], deltaBeats: number): void;
  copySelectedClips(): void;
  cutSelectedClips(): void;
  pasteClipboard(deltaBeats: number): void;
  duplicateSelectedClips(): void;
  deleteSelectedClips(): void;

  setBpm(bpm: number): void;
  setTimeSig(n: number, d: number): void;
  addTempoEvent(beat: number, bpm: number): TempoEvent;
  updateTempoEvent(id: string, patch: Partial<Pick<TempoEvent, 'beat' | 'bpm' | 'curve'>>): void;
  removeTempoEvent(id: string): void;
  clearTempoMap(): void;
  setSwing(amount: number, subdivision?: string): void;
  setMasterVolume(db: number): void;
  setLoop(enabled: boolean, start?: number, end?: number): void;
  setMetronome(b: boolean): void;
  setPlaying(b: boolean): void;
  setCountInBars(n: number): void;
  setMidiClockOut(on: boolean): void;
  setMidiClockIn(on: boolean): void;

  setSessionMode(on: boolean): void;
  setHelpOpen(open: boolean): void;
  launchSessionClip(trackId: string, clipId: string | null): void;
  launchScene(sceneIndex: number): void;
  stopAllSessionClips(): void;
  setSessionSlot(trackId: string, sceneIndex: number, clipId: string | null): void;
  addScene(): void;
  removeScene(sceneIndex: number): void;
  setSceneName(sceneIndex: number, name: string): void;

  undo(): void;
  redo(): void;

  addTrack(kind: TrackKind): Track;
  removeTrack(id: string): void;
  updateTrack(id: string, patch: Partial<Track>): void;
  updateSynth(id: string, patch: Partial<SynthParams>): void;
  setSynthEngine(id: string, engine: SynthEngine): void;
  addSamplerZone(trackId: string, sampleId: string, rootPitch?: number): void;
  updateSamplerZone(trackId: string, zoneId: string, patch: Partial<Pick<SamplerZone, 'sampleId' | 'rootPitch' | 'velMin' | 'velMax'>>): void;
  removeSamplerZone(trackId: string, zoneId: string): void;

  addAutomationPoint(trackId: string, param: AutomationParam, beat: number, value: number): AutomationPoint | null;
  updateAutomationPoint(trackId: string, param: AutomationParam, pointId: string, patch: Partial<Pick<AutomationPoint, 'beat' | 'value' | 'curve'>>): void;
  setAutomationPointCurve(trackId: string, param: AutomationParam, pointId: string, curve: AutomationCurve): void;
  removeAutomationPoint(trackId: string, param: AutomationParam, pointId: string): void;
  removeAutomationLane(trackId: string, param: AutomationParam): void;
  updateFx(id: string, patch: Partial<FxRack>): void;

  addClip(trackId: string, atBeat: number, lengthBeats?: number): Clip | null;
  addAudioClip(trackId: string, atBeat: number, sampleId: string, durationSec: number, name?: string): Clip | null;
  removeClip(clipId: string): void;
  moveClip(clipId: string, newStart: number): void;
  resizeClip(clipId: string, newLength: number): void;
  updateAudioClip(clipId: string, patch: { sourceBpm?: number; warp?: boolean; gain?: number; offset?: number; stretchMode?: 'pitch' | 'time' }): void;

  setMicRecording(b: boolean): void;
  setBouncing(b: boolean): void;

  toggleStep(trackId: string, clipId: string, pad: DrumPad, step: number): void;
  setStepVelocity(trackId: string, clipId: string, pad: DrumPad, step: number, v: number): void;
  setStepProbability(trackId: string, clipId: string, pad: DrumPad, step: number, p: number): void;
  setPadSample(trackId: string, pad: DrumPad, sampleId: string | null): void;
  setPatternLength(trackId: string, clipId: string, newLength: number): void;
  quantizeClip(trackId: string, clipId: string, gridBeats: number, noteIds?: string[]): void;
  humanizeClip(trackId: string, clipId: string, amount: number, noteIds?: string[]): void;

  selectNote(noteId: string | null): void;
  toggleNoteSelected(noteId: string): void;
  clearNoteSelection(): void;

  addNote(trackId: string, clipId: string, note: Omit<Note, 'id'>): string;
  removeNote(trackId: string, clipId: string, noteId: string): void;
  updateNote(trackId: string, clipId: string, noteId: string, patch: Partial<Note>): void;
  /** Move a set of notes in one atomic, history-tracked edit. Deltas can be negative; positions and pitches are clamped at 0 / [0,127]. */
  moveNotesBy(trackId: string, clipId: string, noteIds: string[], deltaStart: number, deltaPitch: number): void;
  /** Set the same velocity on every note in `noteIds` (or all notes in the clip if empty). */
  setNotesVelocity(trackId: string, clipId: string, noteIds: string[], velocity: number): void;
  /** Per-note velocity write, used by velocity-lane drags that preserve relative dynamics. */
  setNoteVelocities(trackId: string, clipId: string, valuesById: Record<string, number>): void;

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
    selectedClipIds: [],
    selectedNoteIds: [],
    clipboard: [],
    isPlaying: false,
    metronome: false,
    micRecording: false,
    bouncing: false,
    countInBars: 1,
    midiClockOut: false,
    midiClockIn: false,
    sessionMode: false,
    sessionPlaying: {},
    helpOpen: false,
    past: [],
    future: [],

    setView: (v) => set({ view: v }),
    selectTrack: (id) => set({ selectedTrackId: id }),
    selectClip: (id) => set({ selectedClipIds: id ? [id] : [] }),
    toggleClipSelected: (id) => {
      const cur = get().selectedClipIds;
      set({ selectedClipIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
    },
    clearClipSelection: () => set({ selectedClipIds: [] }),
    moveClipsBy: (ids, deltaBeats) => {
      if (ids.length === 0 || deltaBeats === 0) return;
      const idSet = new Set(ids);
      // clamp the delta once for the whole group — clamping each clip
      // independently at beat 0 would collapse their relative spacing
      const moving = get().project.tracks.flatMap((t) => t.clips.filter((c) => idSet.has(c.id)));
      if (moving.length === 0) return;
      const d = Math.max(deltaBeats, -Math.min(...moving.map((c) => c.start)));
      if (d === 0) return;
      const tracks = get().project.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => (idSet.has(c.id) ? { ...c, start: c.start + d } : c)),
      }));
      commit({ ...get().project, tracks, updatedAt: Date.now() });
    },
    copySelectedClips: () => {
      const ids = new Set(get().selectedClipIds);
      const clips: Clip[] = [];
      get().project.tracks.forEach((t) => t.clips.forEach((c) => ids.has(c.id) && clips.push(c)));
      set({ clipboard: clips });
    },
    cutSelectedClips: () => {
      const s = get();
      const ids = new Set(s.selectedClipIds);
      const clips: Clip[] = [];
      s.project.tracks.forEach((t) => t.clips.forEach((c) => ids.has(c.id) && clips.push(c)));
      const tracks = s.project.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !ids.has(c.id)) }));
      set({ clipboard: clips });
      commit({ ...s.project, tracks, updatedAt: Date.now() }, { selectedClipIds: [] });
    },
    deleteSelectedClips: () => {
      const ids = new Set(get().selectedClipIds);
      if (ids.size === 0) return;
      const tracks = get().project.tracks.map((t) => ({
        ...t,
        clips: t.clips.filter((c) => !ids.has(c.id)),
      }));
      commit({ ...get().project, tracks, updatedAt: Date.now() }, { selectedClipIds: [] });
    },
    pasteClipboard: (deltaBeats) => {
      const clips = get().clipboard;
      if (clips.length === 0) return;
      const minStart = clips.reduce((m, c) => Math.min(m, c.start), Infinity);
      const newClips: Clip[] = clips.map((c) => ({
        ...c,
        id: newId('clp'),
        start: Math.max(0, c.start - minStart + deltaBeats),
      }));
      const byTrack = new Map<string, Clip[]>();
      newClips.forEach((c) => {
        const arr = byTrack.get(c.trackId) ?? [];
        arr.push(c);
        byTrack.set(c.trackId, arr);
      });
      const tracks = get().project.tracks.map((t) =>
        byTrack.has(t.id) ? { ...t, clips: [...t.clips, ...byTrack.get(t.id)!] } : t,
      );
      commit(
        { ...get().project, tracks, updatedAt: Date.now() },
        { selectedClipIds: newClips.map((c) => c.id) },
      );
    },
    duplicateSelectedClips: () => {
      const s = get();
      const ids = new Set(s.selectedClipIds);
      const sel: Clip[] = [];
      s.project.tracks.forEach((t) => t.clips.forEach((c) => ids.has(c.id) && sel.push(c)));
      if (sel.length === 0) return;
      const minStart = sel.reduce((m, c) => Math.min(m, c.start), Infinity);
      const maxEnd = sel.reduce((m, c) => Math.max(m, c.start + c.length), 0);
      const delta = Math.max(0.25, maxEnd - minStart);
      const newClips: Clip[] = sel.map((c) => ({
        ...c,
        id: newId('clp'),
        start: c.start + delta,
      }));
      const byTrack = new Map<string, Clip[]>();
      newClips.forEach((c) => {
        const arr = byTrack.get(c.trackId) ?? [];
        arr.push(c);
        byTrack.set(c.trackId, arr);
      });
      const tracks = s.project.tracks.map((t) =>
        byTrack.has(t.id) ? { ...t, clips: [...t.clips, ...byTrack.get(t.id)!] } : t,
      );
      commit(
        { ...s.project, tracks, updatedAt: Date.now() },
        { selectedClipIds: newClips.map((c) => c.id) },
      );
    },

    setBpm: (bpm) => {
      const p = { ...get().project, bpm, updatedAt: Date.now() };
      set({ project: p });
    },
    setTimeSig: (n, d) => {
      // a cleared number input parses to NaN — storing it poisons every
      // bar/beat computation in the app (ruler, playhead, automation SVGs)
      if (!Number.isFinite(n) || !Number.isFinite(d)) return;
      const numerator = Math.max(1, Math.min(32, Math.round(n)));
      const denominator = Math.max(1, Math.min(32, Math.round(d)));
      set({ project: { ...get().project, numerator, denominator, updatedAt: Date.now() } });
    },
    addTempoEvent: (beat, bpm) => {
      const ev: TempoEvent = { id: newId('tmp'), beat: Math.max(0, beat), bpm: Math.max(20, Math.min(400, bpm)) };
      const map = [...(get().project.tempoMap ?? []), ev].sort((a, b) => a.beat - b.beat);
      commit({ ...get().project, tempoMap: map, updatedAt: Date.now() });
      return ev;
    },
    updateTempoEvent: (id, patch) => {
      const map = (get().project.tempoMap ?? []).map((ev) =>
        ev.id !== id
          ? ev
          : {
              ...ev,
              beat: patch.beat !== undefined ? Math.max(0, patch.beat) : ev.beat,
              bpm: patch.bpm !== undefined ? Math.max(20, Math.min(400, patch.bpm)) : ev.bpm,
              curve: patch.curve !== undefined ? patch.curve : ev.curve,
            },
      );
      map.sort((a, b) => a.beat - b.beat);
      // not history-tracked — treat tempo-event tweaks like knob drags
      set({ project: { ...get().project, tempoMap: map, updatedAt: Date.now() } });
    },
    removeTempoEvent: (id) => {
      const map = (get().project.tempoMap ?? []).filter((ev) => ev.id !== id);
      commit({ ...get().project, tempoMap: map.length > 0 ? map : undefined, updatedAt: Date.now() });
    },
    clearTempoMap: () => {
      commit({ ...get().project, tempoMap: undefined, updatedAt: Date.now() });
    },
    setSwing: (amount, subdivision) => {
      const p = get().project;
      set({
        project: {
          ...p,
          swing: Math.max(0, Math.min(1, amount)),
          swingSubdivision: subdivision ?? p.swingSubdivision ?? '8n',
          updatedAt: Date.now(),
        },
      });
    },
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
    setCountInBars: (n) => set({ countInBars: Math.max(0, Math.min(8, Math.round(n))) }),
    setMidiClockOut: (on) => set({ midiClockOut: on }),
    setMidiClockIn: (on) => set({ midiClockIn: on }),
    setMicRecording: (b) => set({ micRecording: b }),
    setBouncing: (b) => set({ bouncing: b }),

    setSessionMode: (on) => set({ sessionMode: on }),
    setHelpOpen: (open) => set({ helpOpen: open }),
    launchSessionClip: (trackId, clipId) => {
      const next = { ...get().sessionPlaying };
      if (clipId === null) delete next[trackId];
      else next[trackId] = clipId;
      set({ sessionPlaying: next, sessionMode: true });
    },
    launchScene: (sceneIndex) => {
      const next: Record<string, string> = {};
      for (const t of get().project.tracks) {
        const clipId = t.sessionSlots?.[sceneIndex] ?? null;
        if (clipId && t.clips.some((c) => c.id === clipId)) next[t.id] = clipId;
      }
      set({ sessionPlaying: next, sessionMode: true });
    },
    stopAllSessionClips: () => set({ sessionPlaying: {} }),
    setSessionSlot: (trackId, sceneIndex, clipId) => {
      const tracks = get().project.tracks.map((t) => {
        if (t.id !== trackId) return t;
        const slots = [...(t.sessionSlots ?? [])];
        while (slots.length <= sceneIndex) slots.push(null);
        slots[sceneIndex] = clipId;
        return { ...t, sessionSlots: slots };
      });
      // not history-tracked — assigning a slot is like adjusting a UI knob
      set({ project: { ...get().project, tracks, updatedAt: Date.now() } });
    },
    addScene: () => {
      const p = get().project;
      const scenes = [...(p.scenes ?? defaultScenes()), { name: `SCENE ${(p.scenes?.length ?? 4) + 1}` }];
      const tracks = p.tracks.map((t) => ({ ...t, sessionSlots: [...(t.sessionSlots ?? []), null] }));
      set({ project: { ...p, scenes, tracks, updatedAt: Date.now() } });
    },
    removeScene: (idx) => {
      const p = get().project;
      const scenes = (p.scenes ?? defaultScenes()).filter((_, i) => i !== idx);
      const tracks = p.tracks.map((t) => ({
        ...t,
        sessionSlots: (t.sessionSlots ?? []).filter((_, i) => i !== idx),
      }));
      set({ project: { ...p, scenes, tracks, updatedAt: Date.now() } });
    },
    setSceneName: (idx, name) => {
      const p = get().project;
      const scenes = (p.scenes ?? defaultScenes()).map((s, i) => (i === idx ? { ...s, name } : s));
      set({ project: { ...p, scenes, updatedAt: Date.now() } });
    },

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
      const color = HUD_COLORS[tracks.length % HUD_COLORS.length];
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
    addAutomationPoint: (trackId, param, beat, value) => {
      const trackIdx = get().project.tracks.findIndex((t) => t.id === trackId);
      if (trackIdx < 0) return null;
      const pt: AutomationPoint = { id: newId('ap'), beat: Math.max(0, beat), value };
      const tracks = get().project.tracks.map((t) => {
        if (t.id !== trackId) return t;
        const lanes = [...(t.automation ?? [])];
        const li = lanes.findIndex((l) => l.param === param);
        if (li < 0) {
          lanes.push({ param, points: [pt] });
        } else {
          const points = [...lanes[li].points, pt].sort((a, b) => a.beat - b.beat);
          lanes[li] = { ...lanes[li], points };
        }
        return { ...t, automation: lanes };
      });
      commit({ ...get().project, tracks, updatedAt: Date.now() });
      return pt;
    },
    updateAutomationPoint: (trackId, param, pointId, patch) => {
      const tracks = get().project.tracks.map((t) => {
        if (t.id !== trackId) return t;
        const lanes = (t.automation ?? []).map((lane) => {
          if (lane.param !== param) return lane;
          const points = lane.points
            .map((p) =>
              p.id !== pointId
                ? p
                : {
                    ...p,
                    beat: patch.beat !== undefined ? Math.max(0, patch.beat) : p.beat,
                    value: patch.value !== undefined ? patch.value : p.value,
                    curve: patch.curve !== undefined ? patch.curve : p.curve,
                  },
            )
            .sort((a, b) => a.beat - b.beat);
          return { ...lane, points };
        });
        return { ...t, automation: lanes };
      });
      // not history-tracked — point drags are knob-like
      set({ project: { ...get().project, tracks, updatedAt: Date.now() } });
    },
    setAutomationPointCurve: (trackId, param, pointId, curve) => {
      const tracks = get().project.tracks.map((t) => {
        if (t.id !== trackId) return t;
        const lanes = (t.automation ?? []).map((lane) =>
          lane.param !== param
            ? lane
            : {
                ...lane,
                points: lane.points.map((p) => (p.id === pointId ? { ...p, curve } : p)),
              },
        );
        return { ...t, automation: lanes };
      });
      commit({ ...get().project, tracks, updatedAt: Date.now() });
    },
    removeAutomationPoint: (trackId, param, pointId) => {
      const tracks = get().project.tracks.map((t) => {
        if (t.id !== trackId) return t;
        const lanes = (t.automation ?? [])
          .map((lane) =>
            lane.param !== param
              ? lane
              : { ...lane, points: lane.points.filter((p) => p.id !== pointId) },
          )
          .filter((lane) => lane.points.length > 0);
        return { ...t, automation: lanes.length > 0 ? lanes : undefined };
      });
      commit({ ...get().project, tracks, updatedAt: Date.now() });
    },
    removeAutomationLane: (trackId, param) => {
      const tracks = get().project.tracks.map((t) => {
        if (t.id !== trackId) return t;
        const lanes = (t.automation ?? []).filter((lane) => lane.param !== param);
        return { ...t, automation: lanes.length > 0 ? lanes : undefined };
      });
      commit({ ...get().project, tracks, updatedAt: Date.now() });
    },

    addSamplerZone: (trackId, sampleId, rootPitch) => {
      const tracks = get().project.tracks.map((t) => {
        if (t.id !== trackId) return t;
        const zones = currentSamplerZones(t);
        zones.push({ id: newId('zn'), sampleId, rootPitch: rootPitch ?? 60 });
        return { ...t, samplerZones: zones, samplerSampleId: undefined, samplerRootPitch: undefined };
      });
      set({ project: { ...get().project, tracks, updatedAt: Date.now() } });
    },
    updateSamplerZone: (trackId, zoneId, patch) => {
      const tracks = get().project.tracks.map((t) => {
        if (t.id !== trackId) return t;
        const zones = currentSamplerZones(t).map((z) =>
          z.id === zoneId ? { ...z, ...patch } : z,
        );
        return { ...t, samplerZones: zones, samplerSampleId: undefined, samplerRootPitch: undefined };
      });
      set({ project: { ...get().project, tracks, updatedAt: Date.now() } });
    },
    removeSamplerZone: (trackId, zoneId) => {
      const tracks = get().project.tracks.map((t) => {
        if (t.id !== trackId) return t;
        const zones = currentSamplerZones(t).filter((z) => z.id !== zoneId);
        return {
          ...t,
          samplerZones: zones.length > 0 ? zones : undefined,
          samplerSampleId: undefined,
          samplerRootPitch: undefined,
        };
      });
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
      commit({ ...get().project, tracks, updatedAt: Date.now() }, { selectedClipIds: [clip.id] });
      return clip;
    },

    addAudioClip: (trackId, atBeat, sampleId, durationSec, name) => {
      const track = get().project.tracks.find((t) => t.id === trackId);
      if (!track) return null;
      const bpm = get().project.bpm;
      const bps = bpm / 60;
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
        // capture the tempo at import/record time so the clip can warp later
        sourceBpm: bpm,
        warp: true,
        color: track.color,
        name: name ?? `AUD-${track.clips.length + 1}`,
      };
      const tracks = get().project.tracks.map((t) =>
        t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t,
      );
      commit({ ...get().project, tracks, updatedAt: Date.now() }, { selectedClipIds: [clip.id] });
      return clip;
    },

    removeClip: (clipId) => {
      // bail when the id doesn't match anything — an unconditional commit
      // would push a do-nothing snapshot onto the undo stack
      if (!get().project.tracks.some((t) => t.clips.some((c) => c.id === clipId))) return;
      const tracks = get().project.tracks.map((t) => ({
        ...t,
        clips: t.clips.filter((c) => c.id !== clipId),
      }));
      commit({ ...get().project, tracks, updatedAt: Date.now() });
    },

    moveClip: (clipId, newStart) => {
      const start = Math.max(0, newStart);
      const cur = get().project.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
      // a plain click on a clip ends in a zero-distance "move" — don't let
      // it burn an undo-history slot
      if (!cur || cur.start === start) return;
      const tracks = get().project.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => (c.id === clipId ? { ...c, start } : c)),
      }));
      commit({ ...get().project, tracks, updatedAt: Date.now() });
    },

    resizeClip: (clipId, newLength) => {
      const length = Math.max(0.25, newLength);
      const cur = get().project.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
      if (!cur || cur.length === length) return;
      const tracks = get().project.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => (c.id === clipId ? { ...c, length } : c)),
      }));
      commit({ ...get().project, tracks, updatedAt: Date.now() });
    },

    /** Patch fields on an audio clip. Not history-tracked — these are param tweaks (warp, gain, offset, source bpm). */
    updateAudioClip: (clipId, patch) => {
      const tracks = get().project.tracks.map((t) => {
        const idx = t.clips.findIndex((c) => c.id === clipId && c.kind === 'audio');
        if (idx < 0) return t;
        const next = [...t.clips];
        next[idx] = { ...next[idx], ...patch };
        return { ...t, clips: next };
      });
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

    setPadSample: (trackId, pad, sampleId) => {
      const tracks = get().project.tracks.map((t) => {
        if (t.id !== trackId) return t;
        const next = { ...(t.padSamples ?? {}) };
        if (sampleId) next[pad] = sampleId;
        else delete next[pad];
        return { ...t, padSamples: next };
      });
      // not history-tracked — pad sample swap is a setup tweak like a knob
      set({ project: { ...get().project, tracks, updatedAt: Date.now() } });
    },

    setStepProbability: (trackId, clipId, pad, step, p) => {
      const tracks = get().project.tracks.map((t) =>
        t.id !== trackId
          ? t
          : {
              ...t,
              clips: t.clips.map((c) => {
                if (c.id !== clipId || c.kind !== 'pattern') return c;
                const nextSteps = { ...c.pattern.steps };
                const arr = [...nextSteps[pad]];
                // store undefined for p === 1 so it doesn't bloat JSON
                arr[step] = { ...arr[step], probability: p >= 1 ? undefined : p };
                nextSteps[pad] = arr;
                return { ...c, pattern: { ...c.pattern, steps: nextSteps } };
              }),
            },
      );
      set({ project: { ...get().project, tracks, updatedAt: Date.now() } });
    },

    /**
     * Resize a pattern, preserving beat positions. Old steps map to
     * `floor(i * newLen / oldLen)` in the new array, so doubling spreads
     * existing hits out (filling gaps with empty) and halving collapses
     * neighbours (last "on" wins). The clip's beat length is left alone.
     */
    setPatternLength: (trackId, clipId, newLength) => {
      const clamped = Math.max(2, Math.min(128, Math.floor(newLength)));
      const tracks = get().project.tracks.map((t) =>
        t.id !== trackId
          ? t
          : {
              ...t,
              clips: t.clips.map((c) => {
                if (c.id !== clipId || c.kind !== 'pattern') return c;
                const oldLen = c.pattern.length;
                if (oldLen === clamped) return c;
                const nextSteps: Record<DrumPad, Step[]> = {} as Record<DrumPad, Step[]>;
                for (const pad of Object.keys(c.pattern.steps) as DrumPad[]) {
                  const src = c.pattern.steps[pad];
                  const dst: Step[] = Array.from({ length: clamped }, () => ({ on: false, velocity: 0.9 }));
                  for (let i = 0; i < oldLen; i++) {
                    const j = Math.floor((i * clamped) / oldLen);
                    if (j < clamped && src[i].on) dst[j] = { ...src[i] };
                  }
                  nextSteps[pad] = dst;
                }
                return { ...c, pattern: { length: clamped, steps: nextSteps } };
              }),
            },
      );
      commit({ ...get().project, tracks, updatedAt: Date.now() });
    },

    /**
     * Snap notes' starts in a MIDI clip to the nearest `gridBeats` boundary.
     * If `noteIds` is provided, only those notes are quantized; otherwise the
     * whole clip is. Same shape as `humanizeClip` so selection-aware UI can
     * pass through the active set from the piano roll.
     */
    quantizeClip: (trackId, clipId, gridBeats, noteIds) => {
      if (gridBeats <= 0) return;
      const idSet = noteIds && noteIds.length > 0 ? new Set(noteIds) : null;
      const tracks = get().project.tracks.map((t) =>
        t.id !== trackId
          ? t
          : {
              ...t,
              clips: t.clips.map((c) =>
                c.id !== clipId || c.kind !== 'midi'
                  ? c
                  : {
                      ...c,
                      notes: c.notes.map((n) => {
                        if (idSet && !idSet.has(n.id)) return n;
                        let start = Math.max(0, Math.round(n.start / gridBeats) * gridBeats);
                        // a note near the clip edge can round to start === length,
                        // landing outside the clip — snap it to the last grid line inside
                        if (start >= c.length) start = Math.max(0, c.length - gridBeats);
                        return { ...n, start };
                      }),
                    },
              ),
            },
      );
      commit({ ...get().project, tracks, updatedAt: Date.now() });
    },

    /**
     * Randomly perturb notes in a clip — velocity by ±amount, start by
     * ±amount*0.08 beats. Mechanical loops sound more played when humanised
     * a touch; over-humanising starts to feel sloppy. `amount` is 0..1.
     * If `noteIds` is provided, only those notes are perturbed.
     */
    humanizeClip: (trackId, clipId, amount, noteIds) => {
      const a = Math.max(0, Math.min(1, amount));
      if (a === 0) return;
      const idSet = noteIds && noteIds.length > 0 ? new Set(noteIds) : null;
      const tracks = get().project.tracks.map((t) =>
        t.id !== trackId
          ? t
          : {
              ...t,
              clips: t.clips.map((c) =>
                c.id !== clipId || c.kind !== 'midi'
                  ? c
                  : {
                      ...c,
                      notes: c.notes.map((n) =>
                        idSet && !idSet.has(n.id)
                          ? n
                          : {
                              ...n,
                              velocity: Math.max(0.05, Math.min(1, n.velocity + (Math.random() - 0.5) * 2 * a * 0.3)),
                              start: Math.max(0, n.start + (Math.random() - 0.5) * 2 * a * 0.08),
                            },
                      ),
                    },
              ),
            },
      );
      commit({ ...get().project, tracks, updatedAt: Date.now() });
    },

    selectNote: (noteId) => set({ selectedNoteIds: noteId ? [noteId] : [] }),
    toggleNoteSelected: (noteId) => {
      const cur = get().selectedNoteIds;
      set({ selectedNoteIds: cur.includes(noteId) ? cur.filter((x) => x !== noteId) : [...cur, noteId] });
    },
    clearNoteSelection: () => set({ selectedNoteIds: [] }),

    addNote: (trackId, clipId, note) => {
      const noteId = newId('n');
      const tracks = get().project.tracks.map((t) =>
        t.id !== trackId
          ? t
          : {
              ...t,
              clips: t.clips.map((c) =>
                c.id !== clipId || c.kind !== 'midi'
                  ? c
                  : { ...c, notes: [...c.notes, { ...note, id: noteId }] },
              ),
            },
      );
      commit({ ...get().project, tracks, updatedAt: Date.now() });
      return noteId;
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

    moveNotesBy: (trackId, clipId, noteIds, deltaStart, deltaPitch) => {
      if (noteIds.length === 0) return;
      if (deltaStart === 0 && deltaPitch === 0) return;
      const idSet = new Set(noteIds);
      // clamp the deltas once for the whole selection — per-note clamping
      // at the edges would collapse chord voicings / rhythmic spacing
      const clip = get()
        .project.tracks.find((t) => t.id === trackId)
        ?.clips.find((c) => c.id === clipId);
      if (!clip || clip.kind !== 'midi') return;
      const moving = clip.notes.filter((n) => idSet.has(n.id));
      if (moving.length === 0) return;
      const dStart = Math.max(deltaStart, -Math.min(...moving.map((n) => n.start)));
      let dPitch = Math.max(deltaPitch, -Math.min(...moving.map((n) => n.pitch)));
      dPitch = Math.min(dPitch, 127 - Math.max(...moving.map((n) => n.pitch)));
      if (dStart === 0 && dPitch === 0) return;
      const tracks = get().project.tracks.map((t) =>
        t.id !== trackId
          ? t
          : {
              ...t,
              clips: t.clips.map((c) =>
                c.id !== clipId || c.kind !== 'midi'
                  ? c
                  : {
                      ...c,
                      notes: c.notes.map((n) =>
                        idSet.has(n.id)
                          ? { ...n, start: n.start + dStart, pitch: n.pitch + dPitch }
                          : n,
                      ),
                    },
              ),
            },
      );
      commit({ ...get().project, tracks, updatedAt: Date.now() });
    },

    setNotesVelocity: (trackId, clipId, noteIds, velocity) => {
      const v = Math.max(0.05, Math.min(1, velocity));
      const idSet = noteIds.length > 0 ? new Set(noteIds) : null;
      const tracks = get().project.tracks.map((t) =>
        t.id !== trackId
          ? t
          : {
              ...t,
              clips: t.clips.map((c) =>
                c.id !== clipId || c.kind !== 'midi'
                  ? c
                  : {
                      ...c,
                      notes: c.notes.map((n) => (!idSet || idSet.has(n.id) ? { ...n, velocity: v } : n)),
                    },
              ),
            },
      );
      // not history-tracked — velocity drags are knob-like
      set({ project: { ...get().project, tracks, updatedAt: Date.now() } });
    },

    setNoteVelocities: (trackId, clipId, valuesById) => {
      const tracks = get().project.tracks.map((t) =>
        t.id !== trackId
          ? t
          : {
              ...t,
              clips: t.clips.map((c) =>
                c.id !== clipId || c.kind !== 'midi'
                  ? c
                  : {
                      ...c,
                      notes: c.notes.map((n) =>
                        valuesById[n.id] === undefined
                          ? n
                          : { ...n, velocity: Math.max(0.05, Math.min(1, valuesById[n.id])) },
                      ),
                    },
              ),
            },
      );
      set({ project: { ...get().project, tracks, updatedAt: Date.now() } });
    },

    loadProject: (p) =>
      set({
        project: p,
        selectedClipIds: [],
        selectedTrackId: null,
        selectedNoteIds: [],
        sessionPlaying: {},
        past: [],
        future: [],
      }),

    newProject: () =>
      set({
        project: makeProject(),
        selectedClipIds: [],
        selectedTrackId: null,
        selectedNoteIds: [],
        sessionPlaying: {},
        past: [],
        future: [],
      }),

    exportProject: () => JSON.stringify(get().project, null, 2),
    importProject: (json) => {
      try {
        const p = JSON.parse(json) as Project;
        // a wrong file picked in the import dialog is still valid JSON —
        // without a shape check it white-screens the first tracks selector
        if (!p || !Array.isArray(p.tracks) || typeof p.bpm !== 'number') {
          throw new Error('not a LostBoard project (missing tracks/bpm)');
        }
        get().loadProject(p);
      } catch (e) {
        console.error('Failed to import project', e);
        if (typeof alert !== 'undefined') alert('Import failed: not a valid LostBoard project file.');
      }
    },
    };
  }),
);

export const PROJECT_STORAGE_KEY = 'lostboard.project.v1';

export function saveProjectToStorage(): boolean {
  try {
    const p = useStore.getState().project;
    localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(p));
    return true;
  } catch (e) {
    // quota exceeded or storage unavailable (private browsing) — autosave
    // runs on a 20s timer, so this must never become an uncaught throw
    console.warn('Project save to localStorage failed', e);
    return false;
  }
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
