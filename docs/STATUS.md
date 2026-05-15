# LostBoard — branch status & handoff notes

Branch: `claude/evangelion-daw-app-tdqb7` (PR #1)

A running record of what's been built on this branch, what's known to be
incomplete or rough, and where to pick up next. Update this file when you
push a meaningful change so the next person (or session) lands oriented.

## What's on this branch

Commits are listed in landing order, oldest first. Anything not crossed
out here is wired into the running app — type-check + build pass clean.

### Foundation

- **Scaffold** (`84b591f`) — Vite + React + TypeScript, Tone.js engine,
  Zustand store, NERV / MAGI Evangelion HUD aesthetic, iOS PWA meta, safe
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
  empty-state copy, MAGI codename added to the Synth panel for parity.

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

- **Audio clip warp is varispeed.** Pitch shifts with tempo because we set
  `player.playbackRate` directly. True time-stretch needs `Tone.GrainPlayer`
  or a custom phase-vocoder.
- **Sidechain attack/release are merged.** `Tone.Follower` in the version
  we pin takes a single `smoothing` arg, so the two UI knobs feed
  `sqrt(attack·release)`. State shape already carries both for forward
  compatibility — a real split would chain two followers with `Tone.Max`.
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
- **No automation lanes.** Continuous param edits (volume, cutoff, etc.)
  don't record or play back as automation.
- **Stem export is real-time.** No `Tone.Offline` bounce yet; long
  projects bounce in their own length.

## Roadmap — what's next, ranked

Highest-leverage to lowest, based on what I'd reach for after this:

1. **Automation lanes per parameter.** The single biggest missing DAW
   feature. Would need a per-track automation model, a curve UI in Arrange,
   and engine `scheduleAutomation` that ramps params over time.
2. **Offline bounce via `Tone.Offline`.** Faster-than-real-time master and
   stem export. Mostly mechanical given the existing recorder paths.
3. **Tempo automation / tempo map.** BPM changes over time.
4. **Wavetable instrument + chromatic sampler.** Round out the synth side
   beyond subtractive and FM.
5. **Note humanise/quantise per-note, not whole-clip.** Honour
   `selectedNoteIds` (which doesn't exist yet — would mirror the clip
   selection refactor we did).
6. **Audio time-stretch (real, not varispeed).** Drop in `GrainPlayer` or
   build a small offline-resampled cache per source-BPM.
7. **MIDI clip from arrange recording.** Today the MIDI bridge writes into
   the armed synth track's active clip — wire a dedicated punch-in mode
   with a pre-roll countdown.
8. **Web MIDI output / external sync.** Send notes to a hardware synth
   over MIDI; sync transport to MIDI clock.
9. **Sidechain attack/release split.** Replace the geometric-mean follower
   with two followers fed through `Tone.Max`.
10. **PWA install prompt + iOS silent-audio hack.** For lock-screen
    transport on iOS specifically.

## Repo layout cheatsheet

```
src/
  App.tsx                          # top-level shell, boot, tabs, help overlay mount
  audio/
    engine.ts                      # AudioEngine + TrackNode + Instrument
    midiInput.ts                   # Web MIDI bridge (singleton)
    types.ts                       # Project / Track / Clip / FxRack / SynthParams
  components/
    arrange/ArrangeView.tsx        # timeline, clips, loop region, AudioClipInspector
    session/SessionView.tsx        # scenes × tracks launcher
    sequencer/StepSequencer.tsx    # pad rows, prob mode, pad sample swap
    pianoroll/PianoRoll.tsx        # notes, scale lock, quantize, humanize
    instrument/SynthPanel.tsx      # subtractive + FM editors
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
