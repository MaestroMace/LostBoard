# LostBoard — branch status & handoff notes

Branch: `claude/plan-next-features-UGd6m` (post-PR-#1 follow-up round)

A running record of what's been built on this branch, what's known to be
incomplete or rough, and where to pick up next. Update this file when you
push a meaningful change so the next person (or session) lands oriented.

## What's on this branch

Commits are listed in landing order, oldest first. Anything not crossed
out here is wired into the running app — type-check + build pass clean.

### Foundation

- **Scaffold** (`84b591f`) — Vite + React + TypeScript, Tone.js engine,
  Zustand store, tactical command-console HUD aesthetic, iOS PWA meta, safe
  Tailscale dev binding.
- **FX rack, audio tracks, FM synth, scopes, hotkeys** (`778dbd5`) — second
  big scaffolding round; first cut of the FX rack lived here before the
  fuller implementation later in the branch.

### Performance + correctness

- **Responsiveness pass** (`bc9dc84`) — drag clips / notes via direct DOM
  mutation, fine-grained engine sync (`useEngineSync`) so a knob tweak
  doesn't re-schedule the transport, memoised leaf components.
- **Mobile + touch pass** (`b0e777c`) — `useIsMobile` hook + `<=720px`
  media query, compact StatusBar, icon-only Transport, swipeable tab bar.
  Step-sequencer cells go tap-to-toggle / drag-for-velocity; Piano Roll
  gets a working ERASE tool.
- **Audio persistence, undo/redo, loop region** (`2a9c5f9`) — recorded /
  imported audio persisted in IndexedDB and rehydrated on app start;
  80-deep undo history via a `commit` helper in the store; draggable loop
  strip in the arrange ruler.
- **Selection coherence refactor** (`7172f56`) — new `useActiveTrack` hook
  syncs the editors' fallback track choice back to the global selection so
  the Arrange highlight and the editors can never disagree.
- **Consistency pass** (`840ed4f`) — shared `EditorTip` component, unified
  empty-state copy, TRIAD codename added to the Synth panel for parity.

### Feature rounds (this branch, recent → older)

| Commit | Feature | Notes |
| --- | --- | --- |
| `4052116` | **MIDI clock input** | Transport locks to an external clock — BPM re-derived per quarter from a 24-pulse average; start/continue/stop drive the transport. CLOCK IN toggle in the MIDI SYNC panel. |
| `f0a4f10` | **User-loadable wavetables** | `partialsFromBuffer` DFTs an imported sample's most energetic window into a 32-harmonic series; POSITION morphs sine → that wave. LOAD WAVETABLE button + live spectrum view. |
| `65c50a6` | **iOS lock-screen transport** | Muted looping silent `<audio>` keep-alive so iOS Safari surfaces MediaSession play/pause/stop while the transport rolls. |
| `9580b96` | **Session-view audio clips** | Audio clips fire from session cells — scheduleSession pre-builds a Player and the cell loop restarts it each cycle. |
| `a2711c3` | **Per-track swing** | Swing moved off Tone.Transport's global swing to a per-note offset baked at schedule time; per-track override via a SWING knob in the mixer strip. |
| `292fabe` | **Stacked arrange automation overlay** | The arrange "A" toggle now reveals every automation lane a track owns, stacked under the clip row, instead of one param at a time. |
| `27ce3d1` | **MIDI clock output** | Engine sends 24-PPQN timing clock + start/continue/stop realtime messages to the selected Web MIDI port. MIDI SYNC panel in the PROJECT view. |
| `67bd7a6` | **Bit-crusher automation** | `crusher.bits` is a real Param, so 'bitcrush' joins the automation targets (1..16 bits, smooth ramps). |
| `b2f428e` | **Sidechain attack/release split** | Two Tone.Followers (fast/slow) combined by a signal-domain max — genuinely asymmetric attack vs release, replacing the geometric-mean compromise. |
| `ccea615` | **Web MIDI output** | midiOutput bridge schedules note-on/off to an external port (audio→performance.now clock rebase). Per-track midiOutChannel routes notes to hardware instead of the internal voice. SynthPanel MIDI OUT panel. |
| `20ac147` | **MIDI punch-in record** | ⏺ PUNCH transport button with a 0/1/2/4-bar count-in pre-roll; midiInput gates capture at the playhead so pre-roll bars monitor without recording. PRE-ROLL countdown indicator. |
| `a42bacb` | **Sampler velocity layers** | SamplerZone gains velMin/velMax; zones sharing a range form a layer, one Tone.Sampler each, picked by note velocity on trigger. |
| `d2cc938` | **Multi-zone sampler** | Sampler engine takes a SamplerZone[] (sampleId + rootPitch); Tone.Sampler interpolates between zones. Legacy single-sample fields migrate on the fly. Zone-table UI. |
| `6401c4f` | **Global swing / groove** | Project.swing (0..1) + swingSubdivision drive Tone.Transport's built-in swing; applies live to scheduled events. SWING slider in PROJECT settings. |
| `49ad6c8` | **Tempo curve preview + sample GC** | Read-only BPM sparkline above the tempo events table. `gcOrphanedSamples` deletes IndexedDB blobs no slot/project references (⌫ GC SAMPLES button). |
| `c5c6cfc` | **FX-rack automation targets** | eqLow/Mid/High + compThreshold/Ratio added to AutomationParam; applyFx/applySends skip params under automation so a knob tweak can't stomp scheduled values. |
| `1527d59` | **Status ticker telemetry + PWA install** | Ticker rotates through live engine readings (master peak dB, transport state, BPM, mode, track/clip/automation/tempo counts, MIDI device) plus a smaller pool of flavor lines. PROJECT view captures `beforeinstallprompt` and surfaces a ⬇ INSTALL TO HOME button on Chromium PWAs. |
| `901a267` | **Per-note humanise/quantise + audio time-stretch** | Piano-roll notes are selectable (click / Cmd+click toggles / shift still deletes); QUANTIZE / HUMANIZE honour the selection. Audio clips gain `stretchMode: 'pitch' \| 'time'` — 'time' builds a Tone.GrainPlayer so pitch is preserved across tempo changes. |
| `2caf4db` | **Curve modes + tempo ramps + arrange-view automation overlay** | AutomationPoint.curve dispatches setValueAtTime / linear / exponential / hold/step ramps. TempoEvent.curve adds 'ramp' (linear BPM glides via Transport.bpm.linearRampToValueAtTime). Each track in Arrange gets an "A" toggle that opens an inline lane with the same click/drag/dbl-click semantics as the AUTOMATION tab. |
| `3f144ba` | **Automation lanes** | Per-track AutomationLane[] for volume / pan / cutoff / reverb / delay; engine chains `linearRampToValueAtTime` between points so the curve survives tempo changes. AUTOMATION tab: SVG sparkline (click-add, drag, dbl-click delete) + numeric points table. |
| `4acf052` | **Tempo map** | Optional Project.tempoMap of (beat, bpm) events; engine queues `Transport.bpm.setValueAtTime` per event. PROJECT view sparse table editor. Offline bounce duration walks the map. |
| `9a63ca4` | **Wavetable + chromatic sampler** | Two new SynthEngine values plugged into the synth track. Wavetable morphs partials across 4 frames via a POSITION knob; sampler uses Tone.Sampler over the runtime bank with a root-pitch knob and upload picker. |
| `f1647c0` | **Offline bounce** | `Engine.bounceOffline` builds a parallel Engine inside `Tone.Offline` so the global Tone context swap binds new nodes to the offline destination. Master + per-track offline stems (16-bit PCM WAV). Tone.Recorder skipped when context isn't realtime. |

### Feature rounds (PR #1, recent → older)

| Commit | Feature | Notes |
| --- | --- | --- |
| `37f008b` | **Sidechain compression** | Envelope-follower → gain-mod (`gain = 1 − depth·env`), source picker + DEPTH/ATK/REL knobs in FxPanel. Single-smoothing follower; attack/release are geometric-meaned today. |
| `021652e` | **Drag-drop file → drum pad** | Drop `audio/*` from desktop onto a pad to import + assign in one motion. |
| `c492d64` | **Stem export** | Real-time playthrough, one `Tone.Recorder` per track tapped post-FX, pre-master. Dry-ish (reverb/delay live on master). |
| `45bb2fe` | **MIDI HUMANIZE** | Piano-roll button: ± velocity, ± start-time wobble. History-tracked. |
| `7e08ef6` | **Per-pad sample swap (drum)** | Any imported sample can replace a drum pad's synth voice. Engine routes `trigger`/`triggerAt` through `padPlayers` first. |
| `9caf53a` | **Help overlay (`?`)** | One-screen keyboard + gesture cheatsheet, opened via `?` or tab-bar button. |
| `13a2ec8` | **Pinch-to-zoom** | Touch counterpart to Cmd+wheel, shares the same `setZoom` updater. |
| `a86a386` | **MediaSession transport** | Play/pause/stop from lock screen / AirPods / BT (browsers that surface Web-Audio media sessions). |
| `41cbf2f` | **Multi-slot project library** | `src/state/idb.ts` (DB v2: `samples` + `projects`), `projectSlots.ts` CRUD, PROJECT-view SlotLibrary. |
| `c053a13` | **Audio clips warp to tempo** | `sourceBpm` + `warp` captured on import/record. AudioClipInspector strip in Arrange. Varispeed (pitch follows tempo). |
| `0d6db09` | **Piano-roll scale lock + QUANTIZE** | Scale + root dropdowns snap new/dragged notes; QUANTIZE button uses current SNAP. |
| `77a85a4` | **Variable pattern length** | 8 / 16 / 32 / 64 steps; resize preserves beat positions. |
| `68c98c7` | **Tap-tempo** | `◉ TAP` button; 4-tap rolling average; 2 s timeout. |
| `d2c30c8` | **Per-step probability** | PROB mode cycles 100/75/50/25%; re-rolled every cycle. |
| `0b05b44` | **Session view** | Scenes × tracks launcher. Engine `scheduleSession` + `Tone.Loop` per active cell. |
| `c77cb42` | **Zoom on Arrange + Piano Roll** | `BeatWidthContext`, Cmd+wheel, floating −/×/＋ controls. |
| `760add8` | **Multi-select clips + clipboard** | Shift-click, atomic `moveClipsBy`, ⌘C/X/V/D, Delete. |
| `9690f90` | **Web MIDI input + record** | Routes to first armed synth track; transport-aware recording. StatusBar LED. |

## Known limitations / rough edges

Things that work but have a trade-off worth flagging:

- **Audio clip warp defaults to varispeed.** `stretchMode: 'pitch'` sets
  `player.playbackRate` directly (pitch follows tempo). `stretchMode:
  'time'` switches to `Tone.GrainPlayer` for pitch-preserving granular
  stretch — pick it per clip in the AudioClipInspector.
- **Stems don't include reverb/delay tails.** Those processors live on the
  master bus, so per-track taps capture the dry-with-FX signal. Usually
  what you want when remixing, but worth knowing.
- **MediaSession on iOS Safari.** It requires an HTMLMediaElement to
  surface controls; the in-app transport works there but the lock-screen
  controls won't appear without a silent-audio hack we chose to skip.
- **Session view audio clips.** Session loops support MIDI and pattern
  clips. Audio clips can be in the slot list but won't fire from a session
  cell (would need per-cycle `Player.start`).
- **Pad sample velocity scheduling.** Velocity is applied via
  `player.volume.value` set imperatively in the schedule callback. Slight
  (sub-frame) lag before `player.start(time)`; imperceptible in practice
  but worth knowing if you ever see velocity cross-talk on rapid hits.
- **Undo history can fill quickly during a MIDI record session** since
  every `addNote` is its own commit. The 80-deep cap protects memory but
  you may want a "merge MIDI take into one history entry" pass later.
## Known limitations / rough edges on the new round

- **Chorus depth isn't automatable.** `chorus.depth` is a plain setter,
  not a signal — unlike the EQ / comp / bitcrush params it can't take
  AudioParam ramps. Everything else in the FX rack is automatable.
- **Wavetable import is a spectral reinterpretation.** `partialsFromBuffer`
  treats an FFT window's magnitude spectrum as a harmonic series rather
  than extracting a literal single cycle — characterful but not a faithful
  reproduction of the source waveform.
- **MIDI clock-in is BPM-follow, not a PLL.** The transport matches the
  external tempo and start/stop, but there's no sample-accurate phase
  lock, so long sessions can drift slightly in phase.
- **Sampler decay folds into release.** Tone.Sampler exposes only
  attack/release, so the ADSR decay/sustain knobs don't fully apply.
  Key zones + velocity layers both work.
- **GrainPlayer time-stretch isn't free.** The granular path has more
  CPU cost than the varispeed Player and audible grain artifacts on
  large stretch ratios. Default stretchMode stays 'pitch'.
- **Offline render rebuilds the full graph per stem.** N stems = N
  separate Tone.Offline passes (one per track, others muted). Still
  much faster than realtime on any non-trivial project, but a
  single-pass multi-channel renderer would be cheaper.
- **Per-clip swing.** Swing is global + per-track today; per-clip
  groove would need a clip inspector for MIDI / pattern clips.

## Roadmap — what's next, ranked

The original ranked roadmap is fully cleared. Remaining nice-to-haves,
highest-leverage to lowest:

1. **Per-clip groove.** A clip inspector for MIDI / pattern clips would
   let a single part swing independently of its track.
2. **Single-pass multi-channel offline stems.** One Tone.Offline render
   with a per-track channel split instead of N passes — needs raw
   Web Audio multi-channel routing.
3. **Sampler decay/sustain.** Tone.Sampler exposes only attack/release —
   a custom amp envelope would restore the full ADSR.
4. **MIDI clock-in phase lock.** Current sync-in is BPM-follow; a true
   PLL would hold phase over long sessions.
5. **Wavetable cycle extraction.** Detect a true single cycle from an
   imported sample instead of the spectral reinterpretation.

### Done on this branch

Offline bounce, wavetable + sampler engines, tempo map (+ ramps), full
automation lanes (curve modes, FX-rack targets, arrange overlay),
per-note humanise/quantise, audio time-stretch, status ticker telemetry,
PWA install, tempo curve preview, orphaned-sample GC, global + per-track
swing, multi-zone sampler with velocity layers, MIDI punch-in with
pre-roll, Web MIDI note output, MIDI clock in + out, sidechain
attack/release split, session-view audio clips, iOS lock-screen
transport, and user-loadable wavetables.

## Repo layout cheatsheet

```
src/
  App.tsx                          # top-level shell, boot, tabs, help overlay mount
  audio/
    engine.ts                      # AudioEngine + TrackNode + Instrument (+ offline bounce)
    midiInput.ts                   # Web MIDI input bridge (singleton)
    midiOutput.ts                  # Web MIDI output bridge (singleton)
    wav.ts                         # AudioBuffer → 16-bit PCM WAV encoder
    types.ts                       # Project / Track / Clip / FxRack / SynthParams / automation
  components/
    arrange/ArrangeView.tsx        # timeline, clips, loop region, automation overlay
    automation/AutomationView.tsx  # per-track automation lane editor
    session/SessionView.tsx        # scenes × tracks launcher
    sequencer/StepSequencer.tsx    # pad rows, prob mode, pad sample swap
    pianoroll/PianoRoll.tsx        # notes, scale lock, quantize, humanize, selection
    instrument/SynthPanel.tsx      # subtractive / FM / wavetable / sampler editors
    fx/FxPanel.tsx                 # EQ / comp / chorus / crush / sidechain
    mixer/MixerView.tsx            # channel strips + master
    project/ProjectView.tsx        # project settings, SlotLibrary, stem export
    hud/                           # shared HUD primitives (HexFrame, Knob, Meter, EditorTip, HelpOverlay, …)
    transport/Transport.tsx        # playhead, undo/redo, tap tempo, save
  hooks/
    useEngineSync.ts               # diffs project state into the engine
    useGlobalKeys.ts               # keyboard shortcuts
    useActiveTrack.ts              # editor track-of-correct-kind resolver
    useIsMobile.ts / usePinchZoom.ts / useMediaSession.ts
  state/
    store.ts                       # Zustand store, commit helper, undo/redo
    idb.ts                         # shared IndexedDB connection
    sampleDB.ts / samples.ts       # sample persistence + rehydration
    projectSlots.ts                # multi-slot save library
    transportClock.ts              # Tone.Transport → React clock
```

## Quick commands

```bash
npm install            # one-time
npm run dev            # Vite dev server (binds 0.0.0.0:5173 for Tailscale)
npx tsc --noEmit       # type-check
npm run build          # production build
```
