# LOSTBOARD // N.E.R.V. M.A.G.I. DAW

A browser-based Digital Audio Workstation styled after the Evangelion HUD —
intended to be reachable from an iPhone over Tailscale.

> _"Operation Yashima will commence in T-minus zero."_

## What's inside

- **Boot sequence** with NERV seal, MAGI startup checks and A.T.-field accents
- **Top HUD** with bar:beat:sixteenth display, BPM/SIG readout, MAGI status ticker
- **Transport**: play / pause / stop / record / loop / metronome / tempo
- **Arrange view** with multi-track timeline, draggable + resizable clips,
  bar/beat ruler, playhead, double-click to drop a new clip
- **Step sequencer** with 8 drum pads (kick / snare / clap / HH-C / HH-O / tom
  / rim / cymbal), per-step velocity (mouse wheel), pattern preview, live
  step-cursor highlight
- **Piano roll** with draw / move / resize / delete notes, 1/4–1/16 snap,
  preview-on-touch keyboard column
- **Dual-engine synth** — switch each synth track between a **subtractive**
  engine (osc selector, detune, filter cutoff + resonance, drive) and an
  **FM** engine (harmonicity, mod index), both with ADSR, reverb + delay
  sends, and Eva-themed presets (`BERSERK BASS`, `LCL PAD`, `AT-FIELD LEAD`,
  `TANG PLUCK`, `ANGEL CHOIR`, `NERV ARP`)
- **Per-track FX rack**: 3-band EQ, compressor, chorus and bit-crusher, each
  individually switchable, with a master rack bypass
- **Audio tracks**: import audio files or **record from the microphone**
  straight into an audio clip with a rendered waveform; clips are draggable
  and resizable like any other. Recorded/imported audio is persisted in
  IndexedDB and re-decoded on startup, so audio clips survive a reload
- **Web MIDI** — plug in a controller and the StatusBar lights up with the
  device name. Arm any synth track (`●` in the track header) and incoming
  notes monitor live; with the transport rolling they're captured into a MIDI
  clip on that track (creating one at the bar if none exists)
- **Session view** — an Ableton-style scenes × tracks launcher grid as a new
  tab. Assign any clip on a track to a scene slot and tap to loop it; tap a
  scene header to launch the whole column. Session loops are transport-
  relative (follow tempo / start / stop) and override the arrangement until
  you switch back to ARRANGEMENT mode
- **Per-step probability** — flip the sequencer to PROB mode and each lit
  step can carry a 100 / 75 / 50 / 25% chance of firing. Re-rolled
  independently every cycle so patterns breathe instead of looping
  identically
- **Undo / redo** — an 80-deep history of every structural and musical edit
  (clips, notes, steps, tracks), with `↶` / `↷` buttons and
  Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z
- **Loop region** — drag the strip along the bottom of the arrange ruler to
  set the loop in/out points; drag the band to move it or its edges to resize
- **Master bounce**: real-time capture of the master bus to a downloadable
  audio file
- **Mixer** view with channel strips (volume / pan / mute / solo / meter) and
  a hot master strip with a `-1.0 dB` limiter
- **Live HUD scopes**: oscilloscope + FFT spectrum fed from the master bus
- **Keyboard control**: Space play/pause, Enter/Backspace stop, `L` loop,
  `M` metronome; QWERTY rows play the selected instrument track (`Z`/`X`
  shift octave; drum tracks map `A`–`K` to the 8 pads)
- **Project** view: save/load via `localStorage`, export/import JSON, BPM /
  time signature / song length editor, raw-data editor
- **PWA-ready** manifest + iOS web-app meta + safe-area inset padding so the
  notch doesn't eat your UI when added to the iPhone home screen
- **Responsive + touch-native** — a phone breakpoint compacts the HUD and
  transport, makes the tab bar swipeable, and narrows the arrange headers;
  step-sequencer cells take a tap-to-toggle / drag-for-velocity gesture and
  the piano roll has a DRAW/ERASE tool, so velocity and note-delete work
  without a mouse wheel or modifier keys
- **NERV aesthetic** everywhere: scan lines, CRT flicker, hex panels,
  warning stripes, MAGI status ticker, glowing orange CRT type

## Run it

```bash
npm install
npm run dev
```

The dev server binds to `0.0.0.0:5173`, so any machine on the same
[Tailscale](https://tailscale.com/) tailnet can reach it.

From an iPhone connected to the same tailnet, open:

```
http://<your-mac-hostname>.<your-tailnet>.ts.net:5173
```

or the raw tailnet IP. Then **Share → Add to Home Screen** in Safari to install
it as a standalone app — it will respect the iOS safe-area insets, use a
black-translucent status bar, and adopt the NERV orange theme color.

## Production build

```bash
npm run build
npm run preview   # serves the built bundle on 0.0.0.0:4173
```

## File map

```
src/
  audio/
    engine.ts          # Tone.js-backed DAW engine (transport, scheduler, FX bus)
    types.ts           # Project / Track / Clip / Note / DrumPattern / SynthParams
  state/
    store.ts           # Zustand store + localStorage helpers
  components/
    hud/               # NERV HUD primitives: HexFrame, Knob, Meter, StatusBar, BootSequence
    transport/         # transport controls
    arrange/           # multi-track arrange view
    mixer/             # channel strips + master
    instrument/        # synth panel
    sequencer/         # 8-pad step sequencer
    pianoroll/         # piano roll for MIDI clip editing
    project/           # save / load / export / import
  styles/
    globals.css        # base tokens, scroll, safe-area
    nerv-hud.css       # HUD components (scanlines, hex frame, buttons, meters…)
```

## Roadmap

Done so far: full arrange/sequencer/piano-roll/mixer, dual-engine synth,
per-track FX rack, audio tracks with mic recording + file import, master
bounce, HUD scopes, keyboard control.

Next moves (top of the queue — see [`docs/STATUS.md`](docs/STATUS.md) for the
full ranked roadmap, known limitations, and per-commit changelog):

- Automation lanes per parameter
- Offline (faster-than-real-time) bounce via `Tone.Offline`
- Tempo automation / tempo map
- Wavetable instrument + chromatic sampler
- Real audio time-stretch (vs. the current varispeed warp)
- Sync the MAGI ticker to actual engine + transport telemetry
- Garbage-collect orphaned samples from IndexedDB

## Status & handoff

[`docs/STATUS.md`](docs/STATUS.md) tracks what's been built on the active
branch, known limitations and trade-offs, and the ranked roadmap. Update
it when you push something noteworthy so the next session lands oriented.

## License

Personal/experimental. Tone.js is MIT.
