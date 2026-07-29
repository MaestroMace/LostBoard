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
  AUTOMATION_PARAM_META,
} from '../audio/types';

/* ------------------------------------------------------------------ *
 * Value guards
 *
 * Every one of these exists because the store used to accept the value it
 * rejects. A cleared number input yields NaN; an imported file carries
 * whatever the file says; a drag can hand over any float. Nothing downstream
 * copes: NaN reaches SVG geometry as `x="NaN"`, and a null volume throws
 * inside Web Audio's setValueAtTime, which kills the effect that pushes
 * transport state to the engine.
 * ------------------------------------------------------------------ */

/** Finite number or the fallback. Rejects NaN, Infinity, null, undefined, strings. */
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Finite, clamped, with a fallback for junk. */
const numIn = (v: unknown, lo: number, hi: number, fallback: number) => clamp(num(v, fallback), lo, hi);

const intIn = (v: unknown, lo: number, hi: number, fallback: number) =>
  Math.round(clamp(num(v, fallback), lo, hi));

/** Shortest note or clip we allow. A zero-length note is silence that still
 *  occupies a grid cell you cannot click; a zero-length clip is invisible. */
export const MIN_NOTE_LEN = 1 / 16;
const MIN_CLIP_LEN = 0.25;

/** Snap a value onto a parameter's declared range so automation cannot ask the
 *  engine for a pan of 9 or a cutoff of -400 Hz. */
const clampParam = (param: AutomationParam, value: unknown): number => {
  const meta = AUTOMATION_PARAM_META[param];
  if (!meta) return num(value, 0);
  return numIn(value, meta.min, meta.max, meta.min);
};

/**
 * A note the project can actually play, given the clip it lives in.
 * Pitch is an integer in MIDI range, start sits inside the clip, and length is
 * at least MIN_NOTE_LEN and never runs past the clip's end.
 */
function coerceNote(note: Omit<Note, 'id'>, clipLength: number): Omit<Note, 'id'> {
  const maxStart = Math.max(0, clipLength - MIN_NOTE_LEN);
  const start = numIn(note.start, 0, maxStart, 0);
  const maxLen = Math.max(MIN_NOTE_LEN, clipLength - start);
  return {
    pitch: intIn(note.pitch, 0, 127, 60),
    start,
    length: numIn(note.length, MIN_NOTE_LEN, maxLen, MIN_NOTE_LEN),
    velocity: numIn(note.velocity, 0, 1, 0.9),
  };
}

/**
 * Resolve note collisions on one pitch the way a DAW does.
 *
 * Two notes at the same pitch and the same beat are not a chord, they are the
 * same note twice: the second note-on retriggers and the first note-off cuts
 * the pair short. Tapping the same grid cell repeatedly used to stack them
 * without limit, so a clip could hold twenty invisible copies of one note.
 *
 * `incoming` wins. An existing note starting at the same beat is dropped; one
 * that merely overlaps is trimmed to end where the new note begins, and
 * dropped if that leaves it shorter than MIN_NOTE_LEN.
 */
function resolvePitchCollisions(notes: Note[], incoming: Note): Note[] {
  const out: Note[] = [];
  for (const n of notes) {
    // `incoming` IS this note's new state — pushing the stale copy as well is
    // how an edit turned one note into two with the same id, which React then
    // reported as a duplicate key.
    if (n.id === incoming.id) continue;
    if (n.pitch !== incoming.pitch) {
      out.push(n);
      continue;
    }
    const sameStart = Math.abs(n.start - incoming.start) < 1e-6;
    if (sameStart) continue; // the incoming note replaces it
    if (n.start < incoming.start && n.start + n.length > incoming.start + 1e-9) {
      const trimmed = incoming.start - n.start;
      if (trimmed >= MIN_NOTE_LEN) out.push({ ...n, length: trimmed });
      continue;
    }
    // An existing note that starts later and is swallowed by the incoming one
    // is left alone: the user placed it, and cutting the NEW note instead
    // would contradict "the thing you just did wins".
    out.push(n);
  }
  out.push(incoming);
  out.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return out;
}

/**
 * Trim clips already on a track so a new or moved clip does not overlap them.
 *
 * Two clips covering the same beats both schedule, so every note in the overlap
 * fires twice — audible, and invisible in a view that draws clips side by side.
 * Dropping a clip onto another trims the one underneath, which is what every
 * timeline does; `commit` records it, so undo puts it back.
 */
function trimOverlaps(clips: Clip[], moved: Clip): Clip[] {
  const a0 = moved.start;
  const a1 = moved.start + moved.length;
  const out: Clip[] = [];
  for (const c of clips) {
    if (c.id === moved.id) { out.push(moved); continue; }
    const b0 = c.start;
    const b1 = c.start + c.length;
    if (b1 <= a0 + 1e-9 || b0 >= a1 - 1e-9) { out.push(c); continue; } // disjoint
    if (b0 >= a0 - 1e-9 && b1 <= a1 + 1e-9) continue;                  // fully covered
    if (b0 < a0) {
      const len = a0 - b0;
      if (len >= MIN_CLIP_LEN) out.push({ ...c, length: len });
      // A clip whose head is also covered would need splitting; trimming the
      // tail and dropping the remainder keeps one clip per region.
      continue;
    }
    const len = b1 - a1;
    if (len >= MIN_CLIP_LEN) out.push({ ...c, start: a1, length: len });
  }
  out.sort((x, y) => x.start - y.start);
  return out;
}

/**
 * Repair a project loaded from storage or a file.
 *
 * The mutator guards stop the app creating nonsense from here on, but every
 * project already saved on a device may hold it, and an imported file can say
 * anything. This runs on every load path so the rest of the app can assume its
 * invariants hold rather than defending against them one component at a time.
 */
/**
 * Selection state that survives a time-travel step.
 *
 * `project` is the only thing undo/redo swapped, so after undoing the add that
 * created a clip the selection still named it — the ring drew over empty
 * timeline and "delete selected" did nothing. Selections are ids into the
 * project, so they have to travel with it.
 */
/**
 * One note per pitch and beat, keeping the last one written.
 *
 * Quantising is the quiet way to create the duplicate the draw tool used to
 * allow: two notes on one pitch a hair apart both snap onto the same grid line,
 * and the result is two note-ons at the same instant where the first note-off
 * cuts both. Also used after humanise, which can move notes onto each other.
 */
function dedupeNotes(notes: Note[]): Note[] {
  const byKey = new Map<string, Note>();
  for (const n of notes) byKey.set(`${n.pitch}|${n.start.toFixed(6)}`, n);
  const out = [...byKey.values()].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  // Identical starts are not the only collision: humanising nudges notes into
  // each other, and one note-off then cuts the pair. Trim each note so it ends
  // where the next one on its pitch begins.
  const byPitch = new Map<number, Note[]>();
  for (const n of out) {
    if (!byPitch.has(n.pitch)) byPitch.set(n.pitch, []);
    byPitch.get(n.pitch)!.push(n);
  }
  const trimmed: Note[] = [];
  for (const list of byPitch.values()) {
    for (let i = 0; i < list.length; i++) {
      const next = list[i + 1];
      const gap = next ? next.start - list[i].start : Infinity;
      // Two notes closer together than this cannot be articulated separately,
      // so the earlier one is dropped rather than left overlapping. Above it,
      // trim to the gap: a grace note is a note, and clamping the trim to
      // MIN_NOTE_LEN would keep the overlap it was meant to remove.
      if (gap < 1 / 128) continue;
      trimmed.push(list[i].length > gap ? { ...list[i], length: gap } : list[i]);
    }
  }
  return trimmed.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

/** Whether a clip's kind can live on a track — a drum pattern cannot play
 *  through a synth, and an audio clip needs an audio track. */
function clipFitsTrack(c: Clip, t: Track): boolean {
  if (c.kind === 'pattern') return t.kind === 'drum';
  if (c.kind === 'audio') return t.kind === 'audio';
  return t.kind === 'synth' || t.kind === 'sampler';
}

function pruneSelection(
  p: Project,
  s: { selectedTrackId: string | null; selectedClipIds: string[]; selectedNoteIds: string[]; sessionPlaying: Record<string, string> },
) {
  const trackIds = new Set(p.tracks.map((t) => t.id));
  const clipIds = new Set<string>();
  const noteIds = new Set<string>();
  for (const t of p.tracks)
    for (const c of t.clips) {
      clipIds.add(c.id);
      if (c.kind === 'midi') for (const n of c.notes) noteIds.add(n.id);
    }
  const playing: Record<string, string> = {};
  for (const [tid, cid] of Object.entries(s.sessionPlaying))
    if (trackIds.has(tid) && clipIds.has(cid)) playing[tid] = cid;
  return {
    selectedTrackId: s.selectedTrackId && trackIds.has(s.selectedTrackId) ? s.selectedTrackId : null,
    selectedClipIds: s.selectedClipIds.filter((id) => clipIds.has(id)),
    selectedNoteIds: s.selectedNoteIds.filter((id) => noteIds.has(id)),
    sessionPlaying: playing,
  };
}

export function sanitizeProject(input: Project): Project {
  const p = { ...input };
  p.bpm = numIn(p.bpm, 20, 400, 120);
  p.numerator = intIn(p.numerator, 1, 32, 4);
  p.denominator = intIn(p.denominator, 1, 32, 4);
  p.lengthBars = intIn(p.lengthBars, 1, 4096, 16);
  p.swing = p.swing === undefined ? undefined : numIn(p.swing, 0, 1, 0);
  p.master = {
    volume: numIn(p.master?.volume, -60, 6, -3),
    limiter: p.master?.limiter !== false,
  };

  // A loop whose end is at or before its start cannot advance the transport.
  const ls = Math.max(0, num(p.loopStart, 0));
  const le = num(p.loopEnd, ls + p.numerator * 4);
  p.loopStart = ls;
  p.loopEnd = le > ls ? le : ls + p.numerator;

  const seenIds = new Set<string>();
  /** Ids are how everything refers to everything; a collision makes an edit
   *  land on the wrong object. Re-mint duplicates rather than dropping data. */
  const freshId = (id: unknown, prefix: string): string => {
    const s = typeof id === 'string' && id.length > 0 ? id : newId(prefix);
    if (!seenIds.has(s)) { seenIds.add(s); return s; }
    let next = newId(prefix);
    while (seenIds.has(next)) next = newId(prefix);
    seenIds.add(next);
    return next;
  };

  const tempoBeats = new Set<number>();
  p.tempoMap = (Array.isArray(p.tempoMap) ? p.tempoMap : [])
    .map((ev) => ({
      id: freshId(ev?.id, 'tmp'),
      beat: Math.max(0, num(ev?.beat, 0)),
      bpm: numIn(ev?.bpm, 20, 400, 120),
      curve: ev?.curve === 'ramp' ? ('ramp' as const) : ('step' as const),
    }))
    // Two tempo events on one beat leave it undefined which BPM applies;
    // the later one in file order wins, as it would in the engine.
    .filter((ev) => {
      if (tempoBeats.has(ev.beat)) return false;
      tempoBeats.add(ev.beat);
      return true;
    })
    .sort((a, b) => a.beat - b.beat);
  if (p.tempoMap.length === 0) delete p.tempoMap;

  const scenes = Array.isArray(p.scenes) && p.scenes.length > 0 ? p.scenes : defaultScenes();
  p.scenes = scenes.map((sc) => ({ name: typeof sc?.name === 'string' ? sc.name : 'Scene' }));

  const trackIds = new Set((Array.isArray(p.tracks) ? p.tracks : []).map((t) => t?.id).filter(Boolean));

  p.tracks = (Array.isArray(p.tracks) ? p.tracks : []).map((tIn) => {
    const t = { ...tIn };
    t.id = freshId(t.id, 't');
    t.volume = numIn(t.volume, -60, 6, -6);
    t.pan = numIn(t.pan, -1, 1, 0);
    t.mute = !!t.mute;
    t.solo = !!t.solo;
    t.arm = !!t.arm;
    if (t.midiOutChannel !== undefined) t.midiOutChannel = intIn(t.midiOutChannel, 1, 16, 1);
    if (t.swing !== undefined) t.swing = numIn(t.swing, 0, 1, 0);

    if (t.fx?.sidechainSourceId) {
      // Ducking under yourself is a feedback loop on your own envelope, and
      // ducking under a deleted track is a reference to nothing.
      const src = t.fx.sidechainSourceId;
      if (src === t.id || !trackIds.has(src)) {
        const { sidechainSourceId: _drop, ...rest } = t.fx;
        t.fx = rest as FxRack;
      }
    }

    const laneParams = new Set<AutomationParam>();
    t.automation = (t.automation ?? [])
      .filter((l) => {
        if (!l || !AUTOMATION_PARAM_META[l.param] || laneParams.has(l.param)) return false;
        laneParams.add(l.param);
        return true;
      })
      .map((lane) => {
        const beats = new Set<number>();
        const points = (lane.points ?? [])
          .map((pt) => ({
            id: freshId(pt?.id, 'ap'),
            beat: Math.max(0, num(pt?.beat, 0)),
            value: clampParam(lane.param, pt?.value),
            ...(pt?.curve ? { curve: pt.curve } : {}),
          }))
          .sort((a, b) => a.beat - b.beat)
          // Two points on one beat make the ramp between them undefined.
          .filter((pt) => {
            if (beats.has(pt.beat)) return false;
            beats.add(pt.beat);
            return true;
          });
        return { param: lane.param, points };
      })
      .filter((l) => l.points.length > 0);
    if (t.automation.length === 0) delete t.automation;

    if (t.samplerZones) {
      t.samplerZones = t.samplerZones
        .filter((z) => z && typeof z.sampleId === 'string')
        .map((z) => {
          const lo = numIn(z.velMin ?? 0, 0, 1, 0);
          const hi = numIn(z.velMax ?? 1, 0, 1, 1);
          return {
            id: freshId(z.id, 'zone'),
            sampleId: z.sampleId,
            rootPitch: intIn(z.rootPitch, 0, 127, 60),
            ...(lo > 0 || hi < 1 ? { velMin: Math.min(lo, hi), velMax: Math.max(lo, hi) } : {}),
          };
        });
    }

    let clips = (t.clips ?? [])
      .filter((c) => c && (c.kind === 'midi' || c.kind === 'pattern' || c.kind === 'audio'))
      .map((cIn) => {
        const c = { ...cIn } as Clip;
        c.id = freshId(c.id, 'clp');
        c.trackId = t.id; // the track it sits on is the truth, not what it claims
        c.start = Math.max(0, num(c.start, 0));
        c.length = Math.max(MIN_CLIP_LEN, num(c.length, 4));
        if (c.kind === 'midi') {
          const seen = new Set<string>();
          c.notes = (c.notes ?? [])
            .map((n) => ({ ...coerceNote(n, c.length), id: freshId(n?.id, 'n') }))
            .sort((a, b) => a.start - b.start || a.pitch - b.pitch)
            // Same pitch, same beat: one note, not a stack.
            .filter((n) => {
              const k = `${n.pitch}|${n.start.toFixed(6)}`;
              if (seen.has(k)) return false;
              seen.add(k);
              return true;
            });
          // Trim a note that runs into the next one on its pitch.
          const byPitch = new Map<number, Note[]>();
          for (const n of c.notes) {
            if (!byPitch.has(n.pitch)) byPitch.set(n.pitch, []);
            byPitch.get(n.pitch)!.push(n);
          }
          for (const list of byPitch.values()) {
            for (let i = 0; i < list.length - 1; i++) {
              const gap = list[i + 1].start - list[i].start;
              if (list[i].length > gap) list[i].length = Math.max(MIN_NOTE_LEN, gap);
            }
          }
        } else if (c.kind === 'pattern') {
          const len = intIn(c.pattern?.length, 1, 128, 16);
          const steps = {} as Record<DrumPad, Step[]>;
          for (const pad of DRUM_PADS) {
            const src = c.pattern?.steps?.[pad] ?? [];
            steps[pad] = Array.from({ length: len }, (_, i) => {
              const st = src[i];
              const out: Step = { on: !!st?.on, velocity: numIn(st?.velocity, 0, 1, 0.9) };
              if (st?.accent) out.accent = true;
              if (st?.probability !== undefined) out.probability = numIn(st.probability, 0, 1, 1);
              return out;
            });
          }
          c.pattern = { length: len, steps };
        } else {
          c.gain = numIn(c.gain, 0, 4, 1);
          c.offset = Math.max(0, num(c.offset, 0));
          if (c.sourceBpm !== undefined) c.sourceBpm = numIn(c.sourceBpm, 20, 400, 120);
        }
        return c;
      })
      .sort((a, b) => a.start - b.start);

    // Overlapping clips on one track both schedule. Trim left to right so the
    // earlier clip yields; dropping the later one would lose the newer edit.
    const kept: Clip[] = [];
    for (const c of clips) {
      const prev = kept[kept.length - 1];
      if (prev && c.start < prev.start + prev.length - 1e-9) {
        const len = c.start - prev.start;
        if (len >= MIN_CLIP_LEN) prev.length = len;
        else kept.pop();
      }
      kept.push(c);
    }
    clips = kept;
    t.clips = clips;

    const clipIds = new Set(clips.map((c) => c.id));
    if (t.sessionSlots) {
      // A slot pointing at a deleted clip is a pad that plays nothing, and one
      // past the scene count is unreachable.
      t.sessionSlots = Array.from({ length: p.scenes!.length }, (_, i) => {
        const id = t.sessionSlots![i];
        return id && clipIds.has(id) ? id : null;
      });
    }
    return t;
  });

  return p;
}

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
  return [{ name: 'Intro' }, { name: 'A' }, { name: 'B' }, { name: 'Drop' }];
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
    name: 'Drums',
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
    name: 'Bass',
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
    name: 'Lead',
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
    name: 'Beat',
  });

  drumTrack.clips.push({
    id: newId('clp'),
    kind: 'pattern',
    trackId: drumTrack.id,
    start: 4,
    length: 4,
    pattern: defaultDrumPattern(),
    color: drumTrack.color,
    name: 'Beat',
  });

  bassTrack.clips.push({
    id: newId('clp'),
    kind: 'midi',
    trackId: bassTrack.id,
    start: 0,
    length: 8,
    notes: defaultMelody(8).map((n) => ({ ...n, pitch: n.pitch - 12 })),
    color: bassTrack.color,
    name: 'Bass 1',
  });

  leadTrack.clips.push({
    id: newId('clp'),
    kind: 'midi',
    trackId: leadTrack.id,
    start: 4,
    length: 4,
    notes: defaultMelody(4),
    color: leadTrack.color,
    name: 'Lead 1',
  });

  return {
    id: newId('proj'),
    name: 'Untitled Song',
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
      const merged = { ...s, ...extra } as Store;
      set({
        project: next,
        past: [...s.past, s.project].slice(-HISTORY_LIMIT),
        future: [],
        ...extra,
        // Anything that removes an object has to remove the references to it,
        // and there are more ways to remove one than there are delete actions:
        // trimming an overlap, quantising two notes together, undoing an add.
        // Pruning here covers every path at once, including ones added later.
        ...pruneSelection(next, merged),
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
      const d = Math.max(num(deltaBeats, 0), -Math.min(...moving.map((c) => c.start)));
      if (d === 0) return;
      const tracks = get().project.tracks.map((t) => {
        if (!t.clips.some((c) => idSet.has(c.id))) return t;
        let clips = t.clips.map((c) => (idSet.has(c.id) ? { ...c, start: c.start + d } : c));
        // Same reason a single move trims: two clips over the same beats both
        // schedule, and nothing on screen shows which notes are doubled.
        for (const c of clips.filter((x) => idSet.has(x.id))) clips = trimOverlaps(clips, c);
        return { ...t, clips };
      });
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
        ...(t.sessionSlots
          ? { sessionSlots: t.sessionSlots.map((id) => (id && ids.has(id) ? null : id)) }
          : {}),
      }));
      const playing = { ...get().sessionPlaying };
      for (const [tid, cid] of Object.entries(playing)) if (cid && ids.has(cid)) delete playing[tid];
      commit({ ...get().project, tracks, updatedAt: Date.now() }, {
        selectedClipIds: [],
        sessionPlaying: playing,
      });
    },
    pasteClipboard: (deltaBeatsRaw) => {
      const clips = get().clipboard;
      if (clips.length === 0) return;
      const deltaBeats = Math.max(0, num(deltaBeatsRaw, 0));
      const minStart = clips.reduce((m, c) => Math.min(m, c.start), Infinity);
      // A clip copied from a track that has since been deleted used to be
      // dropped without a word, so paste appeared to do nothing. Send it to
      // the selected track, or the first track that can hold its kind.
      const live = new Set(get().project.tracks.map((t) => t.id));
      const fallback = (c: Clip) =>
        get().project.tracks.find((t) => t.id === get().selectedTrackId && clipFitsTrack(c, t))?.id ??
        get().project.tracks.find((t) => clipFitsTrack(c, t))?.id ??
        null;
      const newClips: Clip[] = [];
      for (const c of clips) {
        const trackId = live.has(c.trackId) ? c.trackId : fallback(c);
        if (!trackId) continue;
        newClips.push({ ...c, id: newId('clp'), trackId, start: Math.max(0, c.start - minStart + deltaBeats) });
      }
      if (newClips.length === 0) return;
      const byTrack = new Map<string, Clip[]>();
      newClips.forEach((c) => {
        const arr = byTrack.get(c.trackId) ?? [];
        arr.push(c);
        byTrack.set(c.trackId, arr);
      });
      const tracks = get().project.tracks.map((t) => {
        const incoming = byTrack.get(t.id);
        if (!incoming) return t;
        let clips = [...t.clips, ...incoming];
        for (const c of incoming) clips = trimOverlaps(clips, c);
        return { ...t, clips };
      });
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
      const tracks = s.project.tracks.map((t) => {
        const incoming = byTrack.get(t.id);
        if (!incoming) return t;
        let clips = [...t.clips, ...incoming];
        for (const c of incoming) clips = trimOverlaps(clips, c);
        return { ...t, clips };
      });
      commit(
        { ...s.project, tracks, updatedAt: Date.now() },
        { selectedClipIds: newClips.map((c) => c.id) },
      );
    },

    setBpm: (bpmRaw) => {
      // addTempoEvent has always clamped to 20..400; setBpm accepted anything,
      // so a cleared field or an imported file could set 0 or NaN and every
      // beats-to-seconds computation downstream returned Infinity or NaN.
      const bpm = numIn(bpmRaw, 20, 400, get().project.bpm);
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
      const ev: TempoEvent = {
        id: newId('tmp'),
        beat: Math.max(0, num(beat, 0)),
        bpm: numIn(bpm, 20, 400, get().project.bpm),
      };
      // One tempo per beat: two events on the same beat leave it undefined
      // which BPM the transport takes, and the loser is invisible in the list.
      const map = [
        ...(get().project.tempoMap ?? []).filter((e) => Math.abs(e.beat - ev.beat) > 1e-6),
        ev,
      ].sort((a, b) => a.beat - b.beat);
      commit({ ...get().project, tempoMap: map, updatedAt: Date.now() });
      return ev;
    },
    updateTempoEvent: (id, patch) => {
      const map = (get().project.tempoMap ?? []).map((ev) =>
        ev.id !== id
          ? ev
          : {
              ...ev,
              beat: patch.beat !== undefined ? Math.max(0, num(patch.beat, ev.beat)) : ev.beat,
              bpm: patch.bpm !== undefined ? numIn(patch.bpm, 20, 400, ev.bpm) : ev.bpm,
              curve: patch.curve !== undefined ? patch.curve : ev.curve,
            },
      );
      map.sort((a, b) => a.beat - b.beat);
      const movedEv = map.find((e) => e.id === id);
      if (movedEv) {
        for (let i = map.length - 1; i >= 0; i--)
          if (map[i].id !== id && Math.abs(map[i].beat - movedEv.beat) <= 1e-6) map.splice(i, 1);
      }
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
          // Math.max(0, Math.min(1, NaN)) is NaN — clamping does not validate.
          swing: numIn(amount, 0, 1, p.swing ?? 0),
          swingSubdivision: subdivision ?? p.swingSubdivision ?? '8n',
          updatedAt: Date.now(),
        },
      });
    },
    setMasterVolume: (db) =>
      // A null or NaN here reached Web Audio's setValueAtTime and threw inside
      // the effect that pushes transport state to the engine, so master
      // volume, tempo and loop all silently stopped being applied.
      set({
        project: {
          ...get().project,
          master: { ...get().project.master, volume: numIn(db, -60, 6, get().project.master.volume) },
          updatedAt: Date.now(),
        },
      }),
    setLoop: (enabled, start, end) => {
      const cur = get().project;
      const s0 = Math.max(0, num(start ?? cur.loopStart, 0));
      const e0 = num(end ?? cur.loopEnd, s0 + cur.numerator);
      // An end at or before the start is a loop of zero or negative length:
      // the transport either freezes on one beat or refuses to loop at all,
      // with the toggle still showing "on". Give it at least a bar.
      const e1 = e0 > s0 ? e0 : s0 + Math.max(1, cur.numerator);
      set({
        project: { ...cur, loopEnabled: enabled, loopStart: s0, loopEnd: e1, updatedAt: Date.now() },
      });
    },
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
      if (!Number.isInteger(sceneIndex) || sceneIndex < 0) return;
      const owner = get().project.tracks.find((t) => t.id === trackId);
      // A slot can only hold one of its own track's clips. Anything else is a
      // pad that either plays nothing or plays another track's material
      // through this track's instrument.
      if (!owner) return;
      if (clipId !== null && !owner.clips.some((c) => c.id === clipId)) return;
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
      const cur = p.scenes ?? defaultScenes();
      // "SCENE 5" was the last shouted default name in the app, and numbering
      // from the list length repeats a name after a removal.
      const used = new Set(cur.map((sc) => sc.name));
      let n = cur.length + 1;
      while (used.has(`Scene ${n}`)) n++;
      const scenes = [...cur, { name: `Scene ${n}` }];
      const tracks = p.tracks.map((t) => ({ ...t, sessionSlots: [...(t.sessionSlots ?? []), null] }));
      set({ project: { ...p, scenes, tracks, updatedAt: Date.now() } });
    },
    removeScene: (idx) => {
      const p = get().project;
      const cur = p.scenes ?? defaultScenes();
      // Removing the last scene leaves the launcher with no columns at all and
      // no control that can add one back.
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length || cur.length <= 1) return;
      const scenes = cur.filter((_, i) => i !== idx);
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
        // Undoing the add that created a clip or note left the selection
        // holding an id that no longer exists, so the next "delete selected"
        // or drag operated on nothing while the UI still drew a selection.
        ...pruneSelection(prev, s),
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
        ...pruneSelection(next, s),
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
      const gone = get().project.tracks.find((t) => t.id === id);
      if (!gone) return;
      const goneClips = new Set(gone.clips.map((c) => c.id));
      // Anything still naming this track is now naming nothing: another
      // track's ducking source, the session's playing map, the current
      // selection. Sweep them here rather than teaching every reader to
      // tolerate a dangling id.
      const tracks = get().project.tracks.filter((t) => t.id !== id).map((t) => {
        if (t.fx?.sidechainSourceId !== id) return t;
        const { sidechainSourceId: _drop, ...fx } = t.fx;
        return { ...t, fx: fx as FxRack };
      });
      const playing = { ...get().sessionPlaying };
      delete playing[id];
      const noteIds = new Set<string>();
      for (const c of gone.clips) if (c.kind === 'midi') for (const n of c.notes) noteIds.add(n.id);
      commit({ ...get().project, tracks, updatedAt: Date.now() }, {
        sessionPlaying: playing,
        selectedTrackId: get().selectedTrackId === id ? null : get().selectedTrackId,
        selectedClipIds: get().selectedClipIds.filter((cid) => !goneClips.has(cid)),
        selectedNoteIds: get().selectedNoteIds.filter((nid) => !noteIds.has(nid)),
      });
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
      // The graph hands over whatever beat the pointer was over, and the value
      // came from a pixel height — neither is guaranteed to be in range.
      const pt: AutomationPoint = {
        id: newId('ap'),
        beat: Math.max(0, num(beat, 0)),
        value: clampParam(param, value),
      };
      const tracks = get().project.tracks.map((t) => {
        if (t.id !== trackId) return t;
        const lanes = [...(t.automation ?? [])];
        const li = lanes.findIndex((l) => l.param === param);
        if (li < 0) {
          lanes.push({ param, points: [pt] });
        } else {
          // One point per beat. Two at the same beat leave the ramp between
          // them undefined and the engine schedules both, so the second
          // silently wins — a value you cannot see and cannot delete.
          const points = [...lanes[li].points.filter((q) => Math.abs(q.beat - pt.beat) > 1e-6), pt].sort(
            (a, b) => a.beat - b.beat,
          );
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
                    beat: patch.beat !== undefined ? Math.max(0, num(patch.beat, p.beat)) : p.beat,
                    value: patch.value !== undefined ? clampParam(param, patch.value) : p.value,
                    curve: patch.curve !== undefined ? patch.curve : p.curve,
                  },
            )
            .sort((a, b) => a.beat - b.beat);
          // Dragging one point onto another must not leave two on one beat.
          const moved = points.find((q) => q.id === pointId);
          const deduped = moved
            ? points.filter((q) => q.id === pointId || Math.abs(q.beat - moved.beat) > 1e-6)
            : points;
          return { ...lane, points: deduped };
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
    updateFx: (id, patchIn) => {
      const patch = { ...patchIn };
      // Ducking under yourself is an envelope follower feeding its own gain,
      // and ducking under a track that no longer exists silently does nothing
      // while the panel still names it.
      if (patch.sidechainSourceId !== undefined && patch.sidechainSourceId !== '') {
        const ok =
          patch.sidechainSourceId !== id &&
          get().project.tracks.some((t) => t.id === patch.sidechainSourceId);
        if (!ok) patch.sidechainSourceId = undefined;
      }
      const tracks = get().project.tracks.map((t) =>
        t.id === id ? { ...t, fx: { ...(t.fx ?? DEFAULT_FX), ...patch } } : t,
      );
      set({ project: { ...get().project, tracks, updatedAt: Date.now() } });
    },

    addClip: (trackId, atBeatRaw, lengthRaw = 4) => {
      const track = get().project.tracks.find((t) => t.id === trackId);
      if (!track) return null;
      const atBeat = Math.max(0, num(atBeatRaw, 0));
      const lengthBeats = Math.max(MIN_CLIP_LEN, num(lengthRaw, 4));
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
        t.id === trackId ? { ...t, clips: trimOverlaps([...t.clips, clip], clip) } : t,
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
      // Deleting the clip used to leave its id behind in every session slot
      // that referenced it and in sessionPlaying, so the launcher kept a lit
      // pad that triggered nothing and the transport thought it was playing.
      const tracks = get().project.tracks.map((t) => ({
        ...t,
        clips: t.clips.filter((c) => c.id !== clipId),
        ...(t.sessionSlots ? { sessionSlots: t.sessionSlots.map((id) => (id === clipId ? null : id)) } : {}),
      }));
      const playing = { ...get().sessionPlaying };
      for (const [tid, cid] of Object.entries(playing)) if (cid === clipId) delete playing[tid];
      commit({ ...get().project, tracks, updatedAt: Date.now() }, {
        sessionPlaying: playing,
        selectedClipIds: get().selectedClipIds.filter((id) => id !== clipId),
      });
    },

    moveClip: (clipId, newStart) => {
      const cur = get().project.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
      if (!cur) return;
      const start = Math.max(0, num(newStart, cur.start));
      // a plain click on a clip ends in a zero-distance "move" — don't let
      // it burn an undo-history slot
      if (cur.start === start) return;
      const moved = { ...cur, start };
      const tracks = get().project.tracks.map((t) => ({
        ...t,
        // Dropping a clip onto another used to leave both scheduling the same
        // beats, so notes in the overlap fired twice with nothing on screen to
        // show why. The clip underneath yields; undo restores it.
        clips: t.clips.some((c) => c.id === clipId)
          ? trimOverlaps(t.clips.map((c) => (c.id === clipId ? moved : c)), moved)
          : t.clips,
      }));
      commit({ ...get().project, tracks, updatedAt: Date.now() });
    },

    resizeClip: (clipId, newLength) => {
      const cur = get().project.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
      if (!cur) return;
      const length = Math.max(MIN_CLIP_LEN, num(newLength, cur.length));
      if (cur.length === length) return;
      const resized = { ...cur, length };
      const tracks = get().project.tracks.map((t) => ({
        ...t,
        clips: t.clips.some((c) => c.id === clipId)
          ? trimOverlaps(t.clips.map((c) => (c.id === clipId ? resized : c)), resized)
          : t.clips,
      }));
      commit({ ...get().project, tracks, updatedAt: Date.now() });
    },

    /** Patch fields on an audio clip. Not history-tracked — these are param tweaks (warp, gain, offset, source bpm). */
    updateAudioClip: (clipId, patchIn) => {
      const tracks = get().project.tracks.map((t) => {
        const idx = t.clips.findIndex((c) => c.id === clipId && c.kind === 'audio');
        if (idx < 0) return t;
        const cur = t.clips[idx] as Extract<Clip, { kind: 'audio' }>;
        // Gain drives a Web Audio gain node and sourceBpm divides into the
        // playback rate: a NaN in either is silence or a thrown range error.
        const patch = { ...patchIn };
        if (patch.gain !== undefined) patch.gain = numIn(patch.gain, 0, 4, cur.gain);
        if (patch.offset !== undefined) patch.offset = Math.max(0, num(patch.offset, cur.offset));
        if (patch.sourceBpm !== undefined) patch.sourceBpm = numIn(patch.sourceBpm, 20, 400, cur.sourceBpm ?? 120);
        const next = [...t.clips];
        next[idx] = { ...cur, ...patch };
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
                // `arr[step].on` on an out-of-range index threw a TypeError,
                // and the velocity/probability setters silently grew the array
                // past pattern.length instead.
                if (!Number.isInteger(step) || step < 0 || step >= arr.length) return c;
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
                if (!Number.isInteger(step) || step < 0 || step >= arr.length) return c;
                arr[step] = { ...arr[step], velocity: numIn(v, 0, 1, arr[step]?.velocity ?? 0.9) };
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
                if (!Number.isInteger(step) || step < 0 || step >= arr.length) return c;
                // store undefined for p === 1 so it doesn't bloat JSON
                const prob = numIn(p, 0, 1, 1);
                arr[step] = { ...arr[step], probability: prob >= 1 ? undefined : prob };
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
      // NaN <= 0 is false, so an unguarded NaN grid used to pass this check and
      // turn every quantised start into NaN.
      if (!Number.isFinite(gridBeats) || gridBeats <= 0) return;
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
                      notes: dedupeNotes(c.notes.map((n) => {
                        if (idSet && !idSet.has(n.id)) return n;
                        let start = Math.max(0, Math.round(n.start / gridBeats) * gridBeats);
                        // a note near the clip edge can round to start === length,
                        // landing outside the clip — snap it to the last grid line inside
                        if (start >= c.length) start = Math.max(0, c.length - gridBeats);
                        return { ...n, start };
                      })),
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
                      // Several notes near the clip's end all clamp to the same
                      // last position, which is a stack of note-ons on one beat.
                      notes: dedupeNotes(c.notes.map((n) =>
                        idSet && !idSet.has(n.id)
                          ? n
                          : {
                              ...n,
                              velocity: Math.max(0.05, Math.min(1, n.velocity + (Math.random() - 0.5) * 2 * a * 0.3)),
                              // clamped at both ends: the upper bound was
                              // missing, so humanising a note at the clip's
                              // last beat could nudge it outside and silence it
                              start: Math.min(
                                Math.max(0, n.start + (Math.random() - 0.5) * 2 * a * 0.08),
                                Math.max(0, c.length - MIN_NOTE_LEN),
                              ),
                            },
                      )),
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
      const clip = get()
        .project.tracks.find((t) => t.id === trackId)
        ?.clips.find((c) => c.id === clipId);
      if (!clip || clip.kind !== 'midi') return '';
      const coerced = coerceNote(note, clip.length);
      // Tapping a cell that already holds this note is not a request for a
      // second one. Return the note already there so callers that keep the id
      // (drag-to-length, select-after-draw) still work, and no duplicate is
      // created no matter how many times the tap repeats.
      const existing = clip.notes.find(
        (n) => n.pitch === coerced.pitch && Math.abs(n.start - coerced.start) < 1e-6,
      );
      if (existing) return existing.id;
      const noteId = newId('n');
      const incoming: Note = { ...coerced, id: noteId };
      const tracks = get().project.tracks.map((t) =>
        t.id !== trackId
          ? t
          : {
              ...t,
              clips: t.clips.map((c) =>
                c.id !== clipId || c.kind !== 'midi'
                  ? c
                  : { ...c, notes: resolvePitchCollisions(c.notes, incoming) },
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
      // A drag hands over whatever the pointer maths produced, and a cleared
      // field hands over NaN. Coerce against the clip before it lands.
      const tracks = get().project.tracks.map((t) =>
        t.id !== trackId
          ? t
          : {
              ...t,
              clips: t.clips.map((c) => {
                if (c.id !== clipId || c.kind !== 'midi') return c;
                const cur = c.notes.find((n) => n.id === noteId);
                if (!cur) return c;
                const next: Note = { ...coerceNote({ ...cur, ...patch }, c.length), id: noteId };
                return { ...c, notes: resolvePitchCollisions(c.notes, next) };
              }),
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
      let dStart = Math.max(num(deltaStart, 0), -Math.min(...moving.map((n) => n.start)));
      // The right edge was never clamped, so a drag could push notes to beat
      // 500 of a 4-beat clip: still in the file, still counted, permanently
      // silent and off-screen. Stop at the last position that can still sound.
      const lastStart = Math.max(0, clip.length - MIN_NOTE_LEN);
      dStart = Math.min(dStart, lastStart - Math.max(...moving.map((n) => n.start)));
      let dPitch = Math.max(Math.round(num(deltaPitch, 0)), -Math.min(...moving.map((n) => n.pitch)));
      dPitch = Math.min(dPitch, 127 - Math.max(...moving.map((n) => n.pitch)));
      if (dStart === 0 && dPitch === 0) return;
      const tracks = get().project.tracks.map((t) =>
        t.id !== trackId
          ? t
          : {
              ...t,
              clips: t.clips.map((c) => {
                if (c.id !== clipId || c.kind !== 'midi') return c;
                const stationary = c.notes.filter((n) => !idSet.has(n.id));
                const shifted = c.notes
                  .filter((n) => idSet.has(n.id))
                  .map((n) => ({
                    ...n,
                    start: n.start + dStart,
                    pitch: n.pitch + dPitch,
                    length: Math.min(n.length, Math.max(MIN_NOTE_LEN, c.length - (n.start + dStart))),
                  }));
                // Landing on a note that is already there must not stack two on
                // one pitch and beat; the moved note wins, as in any editor.
                let next = stationary;
                for (const n of shifted) next = resolvePitchCollisions(next, n);
                return { ...c, notes: next };
              }),
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
        // Every project the app did not just create in memory goes through
        // sanitizeProject: a device restores from storage rather than
        // re-seeding, and an imported file can say anything at all.
        project: sanitizeProject(p),
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
        get().loadProject(migrateNames(p));
      } catch (e) {
        console.error('Failed to import project', e);
        if (typeof alert !== 'undefined') alert('Import failed: not a valid LostBoard project file.');
      }
    },
    };
  }),
);

/**
 * Dev-only handle for the test harnesses.
 *
 * The behavioural suite used to reach the project through
 * `localStorage.getItem('lostboard.project')` — a key that has never existed,
 * since the real one is versioned. Two "a swipe does not edit the project"
 * checks were therefore comparing null to null and asserting nothing at all.
 * Exposing the store directly removes both the guesswork and the 20s autosave
 * delay. `import.meta.env.DEV` is statically false in a production build, so
 * this block is dropped from the bundle rather than shipped.
 */
if (import.meta.env.DEV) {
  (globalThis as unknown as Record<string, unknown>).__lostboard = {
    get project() {
      return useStore.getState().project;
    },
    get state() {
      return useStore.getState();
    },
    act: useStore.getState,
  };
}

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

/**
 * Legacy codenames, mapped to what things are actually called.
 *
 * Renaming the defaults only affects projects created afterwards — anyone who
 * already opened the app has these strings saved in their project and would
 * keep seeing them forever. Matching exact legacy strings means a track the
 * user renamed themselves is never touched.
 */
const LEGACY_NAMES: Record<string, string> = {
  'OPERATION DOWNBEAT': 'Untitled Song',
  'DRUMS // VEGA': 'Drums',
  'BASS // ALTAIR': 'Bass',
  'LEAD // DENEB': 'Lead',
  'PTN-A': 'Beat',
  'BASS-1': 'Bass 1',
  'LEAD-1': 'Lead 1',
  'MIC TAKE': 'Mic take',
  INTRO: 'Intro',
  DROP: 'Drop',
};

function renameLegacy<T extends { name?: string }>(item: T): T {
  const next = item.name ? LEGACY_NAMES[item.name] : undefined;
  return next ? { ...item, name: next } : item;
}

/** Rewrite a loaded project's legacy codenames in place. */
export function migrateNames(p: Project): Project {
  return {
    ...renameLegacy(p),
    // Scenes too. Renaming only the defaults leaves every already-saved
    // project on the old names, which is exactly the bug this function exists
    // to fix -- the device restores from storage, it does not re-seed.
    scenes: p.scenes?.map((sc) => renameLegacy(sc)),
    tracks: p.tracks.map((t) => ({
      ...renameLegacy(t),
      clips: t.clips.map((c) => renameLegacy(c)),
    })),
  };
}

export function loadProjectFromStorage(): boolean {
  const raw = localStorage.getItem(PROJECT_STORAGE_KEY);
  if (!raw) return false;
  try {
    const p = JSON.parse(raw) as Project;
    useStore.getState().loadProject(migrateNames(p));
    return true;
  } catch {
    return false;
  }
}
