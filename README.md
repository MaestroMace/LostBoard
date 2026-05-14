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
- **Subtractive synth** with osc selector, detune, filter cutoff + resonance,
  ADSR envelope, drive, reverb + delay sends, and Eva-themed presets
  (`BERSERK BASS`, `LCL PAD`, `AT-FIELD LEAD`, `TANG PLUCK`, `ANGEL CHOIR`,
  `NERV ARP`)
- **Mixer** view with channel strips (volume / pan / mute / solo / meter) and
  a hot master strip with a `-1.0 dB` limiter
- **Project** view: save/load via `localStorage`, export/import JSON, BPM /
  time signature / song length editor, raw-data editor
- **PWA-ready** manifest + iOS web-app meta + safe-area inset padding so the
  notch doesn't eat your UI when added to the iPhone home screen
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

This is the meaty base. Easy next moves:

- Mic / audio-file recording → real `audio` clips on `audio` tracks
- Sample-loaded clips (drag-drop wavs)
- Per-track FX rack (EQ / compressor / chorus / phaser)
- MIDI device input via Web MIDI
- Automation lanes per parameter
- More instruments: FM synth, wavetable, sampler with chromatic playback
- Project library with multiple saved slots
- Touch-optimized piano roll with pinch-zoom
- Bounce / export to WAV using Tone.Offline
- Sync the MAGI ticker to actual engine + transport telemetry

## License

Personal/experimental. Tone.js is MIT.
