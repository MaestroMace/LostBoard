import { memo } from 'react';

type ShortcutGroup = { title: string; items: [string, string][] };

const GROUPS: ShortcutGroup[] = [
  {
    title: 'TRANSPORT',
    items: [
      ['Space', 'Play / pause'],
      ['Enter', 'Stop & rewind'],
      ['L', 'Toggle loop'],
      ['M', 'Toggle metronome'],
      ['◉ TAP', 'Tap-tempo (4-tap rolling average)'],
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
      ['Drag strip under ruler', 'Set loop region'],
      ['⌘ / Ctrl + wheel · pinch', 'Zoom timeline'],
    ],
  },
  {
    title: 'PIANO ROLL',
    items: [
      ['DRAW + tap grid', 'Add a note (snapped to scale)'],
      ['ERASE + tap note', 'Delete a note (or shift-click in DRAW)'],
      ['Drag note', 'Move (pitch snaps to scale); drag right edge to resize'],
      ['SCALE / SNAP', 'Per-editor scale lock + quantize grid'],
      ['QUANTIZE', 'Snap every note start to current SNAP'],
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
      ['Tap slot', 'Launch its clip on that track'],
      ['Tap ▶ in scene header', 'Launch every clip in that scene'],
      ['ARRANGEMENT', 'Swap the engine back to the timeline'],
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
];

export const HelpOverlay = memo(function HelpOverlay({ onClose }: { onClose: () => void }) {
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
          border: '1px solid var(--nerv-orange)',
          boxShadow: 'var(--hud-glow)',
          padding: 18,
          clipPath: 'polygon(14px 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%, 0 14px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <span className="hud-label" style={{ fontSize: 12 }}>
            MAGI HELP // KEYBOARD &amp; GESTURE REFERENCE
          </span>
          <div style={{ flex: 1 }} />
          <span className="hud-readout--dim hud-readout" style={{ fontSize: 9 }}>
            ESC or ? to close
          </span>
          <button
            className="nerv-btn nerv-btn--icon"
            onClick={onClose}
            title="Close"
            style={{ minWidth: 32 }}
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
              <div className="hud-label" style={{ fontSize: 10, marginBottom: 6 }}>
                {g.title}
              </div>
              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                <tbody>
                  {g.items.map(([key, desc]) => (
                    <tr key={key}>
                      <td
                        className="hud-value"
                        style={{
                          padding: '2px 8px 2px 0',
                          whiteSpace: 'nowrap',
                          fontFamily: 'var(--font-data)',
                          color: 'var(--nerv-orange-bright)',
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
