import { memo } from 'react';
import { useIsMobile } from '../../hooks/useLayoutMode';

type ShortcutGroup = { title: string; items: [string, string][] };

const KEY_GROUPS: ShortcutGroup[] = [
  {
    title: 'TRANSPORT',
    items: [
      ['Space', 'Play / pause'],
      ['Enter', 'Stop & rewind'],
      ['L', 'Toggle loop'],
      ['M', 'Toggle metronome'],
      ['◉ TAP', 'Tap-tempo (4-tap rolling average)'],
      ['⏺ PUNCH', 'Record MIDI into the armed synth track with a CI-bar pre-roll'],
    ],
  },
  {
    title: 'EDITING',
    items: [
      ['⌘ / Ctrl + Z', 'Undo'],
      ['⌘ / Ctrl + ⇧ + Z', 'Redo (also Ctrl+Y)'],
      ['⌘ / Ctrl + C / X / V', 'Copy / cut / paste at playhead'],
      ['⌘ / Ctrl + D', 'Duplicate selection'],
      ['Backspace / Delete', 'Delete selected clips'],
    ],
  },
  {
    title: 'ARRANGE',
    items: [
      ['Double-click lane', 'New 4-beat clip at that beat'],
      ['Double-click clip', 'Open the right editor (piano roll / sequencer)'],
      ['Drag clip', 'Move; drag right edge to resize'],
      ['Shift-click clip', 'Add to / remove from multi-selection'],
      ['"A" in track header', 'Toggle inline automation lanes for that track'],
      ['Drag strip under ruler', 'Set loop region'],
      ['⌘ / Ctrl + wheel · pinch', 'Zoom timeline'],
    ],
  },
  {
    title: 'PIANO ROLL',
    items: [
      ['DRAW + drag grid', 'Draw a note whose length follows the pointer'],
      ['SELECT + drag grid', 'Marquee — select every note inside the rect'],
      ['Click a note', 'Select it (Cmd/Ctrl-click toggles multi)'],
      ['Drag a selected note', 'Moves the whole selection in lockstep'],
      ['Drag right edge', 'Resize (single note)'],
      ['Drag velocity bar', 'Set velocity (drags every selected together)'],
      ['Shift-click note', 'Delete it (or use ERASE tool)'],
      ['QUANTIZE / HUMANIZE', 'Honours the note selection when non-empty'],
    ],
  },
  {
    title: 'AUTOMATION',
    items: [
      ['Click empty lane', 'Drop a breakpoint at that beat / value'],
      ['Drag a point', 'Move it (in both the tab and the arrange overlay)'],
      ['Double-click point', 'Remove it'],
      ['Curve dropdown', 'linear / exponential / hold / step into a point'],
      ['Targets', 'volume · pan · cutoff · sends · EQ · comp · bitcrush'],
    ],
  },
  {
    title: 'SEQUENCER',
    items: [
      ['NORM tap', 'Toggle a step on/off'],
      ['NORM drag up/down', 'Set step velocity (commits on release)'],
      ['PROB tap (lit step)', 'Cycle trigger chance 100/75/50/25%'],
      ['STEPS dropdown', 'Resize pattern (preserves beat positions)'],
    ],
  },
  {
    title: 'SESSION',
    items: [
      ['Tap slot', 'Launch its clip on that track (MIDI / pattern / audio)'],
      ['Tap ▶ in scene header', 'Launch every clip in that scene'],
      ['ARRANGEMENT', 'Swap the engine back to the timeline'],
    ],
  },
  {
    title: 'INSTRUMENTS',
    items: [
      ['SUBTRACTIVE / FM', 'Classic engines with osc / harmonicity controls'],
      ['WAVETABLE', 'POSITION morphs through frames; LOAD WAVETABLE imports a sample'],
      ['SAMPLER', 'Multi-zone key + velocity layered Tone.Sampler'],
      ['MIDI OUT panel', 'Route a track\'s notes to external hardware'],
    ],
  },
  {
    title: 'MIXER + TEMPO',
    items: [
      ['PAN / SWING knobs', 'Per-track pan and per-track swing override'],
      ['Project SWING slider', 'Global swing default (8n or 16n)'],
      ['Project TEMPO MAP', 'Sparse (beat, BPM) events with step or ramp'],
      ['MIDI SYNC panel', 'CLOCK IN / OUT — sync to or from external gear'],
    ],
  },
  {
    title: 'MUSICAL INPUT',
    items: [
      ['A W S E D F T G Y H U J K…', 'Synth keys (chromatic, octave 4 by default)'],
      ['Z / X', 'Shift octave down / up'],
      ['A..K on drum track', 'Trigger pads 1..8'],
      ['Connect MIDI controller', 'Arm a synth track (●) to record incoming notes'],
    ],
  },
  {
    title: 'OUTPUT + BOUNCE',
    items: [
      ['⚡ BOUNCE WAV', 'Render the project to a WAV faster-than-realtime'],
      ['⚡⬇ OFFLINE STEMS', 'Per-track WAVs in one pass-per-track'],
      ['⬇⬇ STEMS', 'Real-time stem playthrough (legacy)'],
      ['⌫ GC SAMPLES', 'Drop audio nothing in any slot references'],
    ],
  },
];


/**
 * Touch help.
 *
 * The keyboard list below is genuinely useless on a phone — 21 of its entries
 * reference Space, ⌘, Shift or double-click. This is the same information
 * expressed as what you tap, plus what each tab is actually for, because
 * "where do I do X" was the harder question.
 */
const TOUCH_GROUPS: ShortcutGroup[] = [
  {
    title: 'The five tabs',
    items: [
      ['Song', 'Your timeline — arrange clips across tracks and time'],
      ['Clips', 'Launch loops live instead of following the timeline'],
      ['Edit', 'Everything about the selected track: notes, sound, effects, automation'],
      ['Mix', 'Levels, pan, mute and solo for every track'],
      ['Project', 'Tempo, time signature, saving and export'],
    ],
  },
  {
    title: 'Playing',
    items: [
      ['Play', 'Start and pause the song'],
      ['Stop', 'Stop and jump back to the beginning'],
      ['⋯', 'Loop, metronome, punch record, tempo, undo, redo and save'],
    ],
  },
  {
    title: 'Tracks',
    items: [
      ['Tap a track name', 'Volume, pan, arm, edit, automation and delete'],
      ['+ Track', 'Add a synth, drum or audio track'],
      ['M / S', 'Mute or solo — in the row on landscape, in the track sheet on portrait'],
    ],
  },
  {
    title: 'Making music',
    items: [
      ['Drag an empty lane', 'Draw a new clip there'],
      ['Double-tap a clip', 'Open it in the right editor'],
      ['Drag a clip', 'Move it; drag its right edge to change the length'],
      ['✕ on a clip', 'Delete that clip'],
    ],
  },
  {
    title: 'Editing notes',
    items: [
      ['Draw + drag', 'Draw a note as long as you drag'],
      ['Select + drag', 'Select everything inside the box'],
      ['Erase', 'Tap notes to remove them'],
      ['Velocity lane', 'Drag the bar under a note to change how hard it hits'],
    ],
  },
  {
    title: 'Beats',
    items: [
      ['Tap a step', 'Turn it on or off'],
      ['Drag up / down on a step', 'Set how hard it hits'],
      ['Prob', 'Tap a lit step to cycle its chance of firing: 100/75/50/25%'],
      ['Steps', 'Change the pattern length'],
    ],
  },
];

export const HelpOverlay = memo(function HelpOverlay({ onClose }: { onClose: () => void }) {
  const isMobile = useIsMobile();
  const GROUPS = isMobile ? TOUCH_GROUPS : KEY_GROUPS;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.78)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        animation: 'fadeIn 0.15s ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="hex-grid-bg"
        style={{
          maxWidth: 880,
          width: '100%',
          maxHeight: '92vh',
          overflow: 'auto',
          background: 'rgba(10,0,0,0.95)',
          border: '1px solid var(--hud-orange)',
          boxShadow: 'var(--hud-glow)',
          padding: 18,
          clipPath: 'polygon(14px 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%, 0 14px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <span className="hud-label" style={{ fontSize: 14 }}>
            Help
          </span>
          <div style={{ flex: 1 }} />
          <span className="hud-readout--dim hud-readout" style={{ fontSize: 12 }}>
            {isMobile ? 'Tap outside to close' : 'ESC or ? to close'}
          </span>
          <button
            className="hud-btn hud-btn--icon"
            onClick={onClose}
            title="Close"
            aria-label="Close help"
            style={{}}
          >
            ✕
          </button>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 14,
          }}
        >
          {GROUPS.map((g) => (
            <div
              key={g.title}
              style={{
                background: 'rgba(0,0,0,0.55)',
                border: '1px solid rgba(255,106,0,0.35)',
                padding: '8px 10px',
              }}
            >
              <div className="hud-label" style={{ fontSize: 12, marginBottom: 6 }}>
                {g.title}
              </div>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <tbody>
                  {g.items.map(([key, desc]) => (
                    <tr key={key}>
                      <td
                        className="hud-value"
                        style={{
                          padding: '2px 8px 2px 0',
                          whiteSpace: 'nowrap',
                          fontFamily: 'var(--font-data)',
                          color: 'var(--hud-orange-bright)',
                          verticalAlign: 'top',
                        }}
                      >
                        {key}
                      </td>
                      <td style={{ padding: '2px 0', color: '#ddd', verticalAlign: 'top' }}>{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
