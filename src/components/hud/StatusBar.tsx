import { memo, useEffect, useState, useSyncExternalStore } from 'react';
import { shallow } from 'zustand/shallow';
import { useStore } from '../../state/store';
import { usePlayhead } from '../../state/transportClock';
import { useLayoutMode } from '../../hooks/useLayoutMode';
import { Scope } from './Scope';
import { getMidiSnapshot, subscribeMidi } from '../../audio/midiInput';
import { audioEngine } from '../../audio/engine';

/** Flavor lines that get mixed into the live telemetry rotation. */
/**
 * Ticker filler lines. Mostly turned into actual tips (the ticker is prime
 * real estate for teaching the UI) with a couple of atmospheric lines kept
 * for flavor.
 */
const FLAVOR = [
  'TIP — DOUBLE-CLICK A TIMELINE LANE TO ADD A CLIP',
  'TIP — PRESS ? FOR THE FULL KEYBOARD / GESTURE LIST',
  'TIP — ARM A SYNTH TRACK (●) TO RECORD MIDI',
  'TIP — DOUBLE-CLICK A CLIP TO OPEN ITS EDITOR',
  'HEX FIELD STABLE — ALL DECKS READY',
];

export function StatusBar() {
  const { name, bpm, numerator, denominator } = useStore(
    (s) => ({
      name: s.project.name,
      bpm: s.project.bpm,
      numerator: s.project.numerator,
      denominator: s.project.denominator,
    }),
    shallow,
  );
  const playing = useStore((s) => s.isPlaying);
  const micRecording = useStore((s) => s.micRecording);
  const bouncing = useStore((s) => s.bouncing);
  const recording = micRecording || bouncing;
  const midi = useSyncExternalStore(subscribeMidi, getMidiSnapshot, getMidiSnapshot);
  const mode = useLayoutMode();

  if (mode !== 'desktop') {
    // Landscape is the working orientation but only ~411px tall, so every
    // pixel of header height is bought out of the timeline: shrink the mark,
    // flatten the padding, and drop the project name entirely.
    const tight = mode === 'phone-landscape';
    return (
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: tight ? 6 : 8,
          padding: tight ? '2px 8px' : '5px 8px',
          background: 'linear-gradient(180deg, rgba(255,106,0,0.18), rgba(0,0,0,0.85))',
          borderBottom: '1px solid rgba(255,106,0,0.5)',
          contain: 'layout style',
          flex: '0 0 auto',
        }}
      >
        <TriadMark size={tight ? 20 : 28} />
        {!tight && (
          <span
            className="hud-value"
            style={{ fontSize: 11, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {name}
          </span>
        )}
        {tight && <div style={{ flex: 1, minWidth: 0 }} />}
        <Indicator label="PL" on={playing} color="green" />
        <Indicator label="REC" on={recording} color="red" />
        {midi.connected && <Indicator label="MIDI" on color="green" />}
        <PositionReadout numerator={numerator} />
        <div className="display" style={{ fontSize: 10 }}>
          <span style={{ color: 'var(--hud-orange-bright)' }}>{bpm.toFixed(0)}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '6px 12px',
        background: 'linear-gradient(180deg, rgba(255,106,0,0.18), rgba(0,0,0,0.85))',
        borderBottom: '1px solid rgba(255,106,0,0.5)',
        contain: 'layout style',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flexShrink: 1 }}>
        <TriadMark />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, minWidth: 0 }}>
          <span className="hud-label" style={{ fontSize: 8 }}>T.R.I.A.D. SYSTEM</span>
          {/* one line + ellipsis — long project names used to wrap to 3 lines
              and shove the bar taller at medium widths */}
          <span
            className="hud-value"
            style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 }}
            title={`LOSTBOARD // ${name}`}
          >
            LOSTBOARD // {name}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Indicator label="PLAY" on={playing} color="green" />
        <Indicator label="REC" on={recording} color="red" />
        <MidiIndicator midi={midi} />
        <PositionReadout numerator={numerator} />
        <div className="display" style={{ fontSize: 11 }}>
          <span className="hud-label" style={{ fontSize: 8 }}>BPM</span>
          <span style={{ color: 'var(--hud-orange-bright)' }}>{bpm.toFixed(1)}</span>
        </div>
        <div className="display" style={{ fontSize: 11 }}>
          <span className="hud-label" style={{ fontSize: 8 }}>SIG</span>
          <span>
            {numerator}/{denominator}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Scope width={140} height={38} mode="wave" />
        <Scope width={90} height={38} mode="fft" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Ticker />
          <HudClock />
        </div>
      </div>
    </div>
  );
}

/** Leaf: only this re-renders as the playhead moves. */
const PositionReadout = memo(function PositionReadout({ numerator }: { numerator: number }) {
  const positionBeats = usePlayhead();
  const bar = Math.floor(positionBeats / numerator) + 1;
  const beat = Math.floor(positionBeats % numerator) + 1;
  const sixteenth = Math.floor((positionBeats % 1) * 4) + 1;
  return (
    <div className="display display--big" style={{ minWidth: 110 }}>
      <span style={{ color: 'var(--hud-orange-bright)' }}>{String(bar).padStart(3, '0')}</span>
      <span style={{ color: 'rgba(255,106,0,0.5)' }}>:</span>
      <span>{String(beat).padStart(2, '0')}</span>
      <span style={{ color: 'rgba(255,106,0,0.5)' }}>:</span>
      <span style={{ color: 'var(--hud-amber)' }}>{String(sixteenth).padStart(2, '0')}</span>
    </div>
  );
});

function HudClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, []);
  return (
    <div className="hud-readout">
      <span className="glyph-cross" style={{ marginRight: 6 }} />
      {now.toTimeString().slice(0, 8)}
    </div>
  );
}

function Indicator({ label, on, color }: { label: string; on: boolean; color: 'green' | 'red' | 'amber' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <span className={`led ${color} ${on ? 'on' : ''}`} />
      <span className="hud-label" style={{ fontSize: 7 }}>{label}</span>
    </div>
  );
}

function MidiIndicator({ midi }: { midi: { supported: boolean; connected: boolean; device: string } }) {
  if (!midi.supported) return null;
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
      title={midi.connected ? `MIDI: ${midi.device}` : 'No MIDI device connected'}
    >
      <span className={`led ${midi.connected ? 'green' : 'amber'} ${midi.connected ? 'on' : ''}`} />
      <span className="hud-label" style={{ fontSize: 7 }}>
        {midi.connected ? (midi.device.slice(0, 10).toUpperCase() || 'MIDI') : 'MIDI'}
      </span>
    </div>
  );
}

function TriadMark({ size = 28 }: { size?: number }) {
  return (
    <div style={{ width: size, height: size, position: 'relative', flex: '0 0 auto' }}>
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <polygon
          points="50,4 92,28 92,72 50,96 8,72 8,28"
          fill="none"
          stroke="var(--hud-orange)"
          strokeWidth="3"
        />
        <path d="M50 12 L82 68 L18 68 Z" fill="var(--hud-orange)" />
        <circle cx="50" cy="80" r="7" fill="var(--hud-orange)" />
      </svg>
    </div>
  );
}

/**
 * Ticker — rotates through live engine + transport telemetry mixed with
 * console flavor lines. Pulls a fresh snapshot every cycle so what scrolls
 * past reflects what the engine actually sees (master peak dB, transport
 * state, MIDI device, track / clip counts) rather than canned strings.
 */
function Ticker() {
  const trackCount = useStore((s) => s.project.tracks.length);
  const clipCount = useStore((s) => s.project.tracks.reduce((n, t) => n + t.clips.length, 0));
  const automationLanes = useStore((s) =>
    s.project.tracks.reduce((n, t) => n + (t.automation?.length ?? 0), 0),
  );
  const tempoEvents = useStore((s) => s.project.tempoMap?.length ?? 0);
  const playing = useStore((s) => s.isPlaying);
  const sessionMode = useStore((s) => s.sessionMode);
  const micRecording = useStore((s) => s.micRecording);
  const midiClockOut = useStore((s) => s.midiClockOut);
  const midiClockIn = useStore((s) => s.midiClockIn);
  const bpm = useStore((s) => s.project.bpm);
  const midi = useSyncExternalStore(subscribeMidi, getMidiSnapshot, getMidiSnapshot);
  const [msg, setMsg] = useState('TRIAD SYSTEM ONLINE');

  useEffect(() => {
    const sample = () => {
      const lines: string[] = [];
      // Live engine telemetry first — pulled fresh so each cycle is current.
      if (audioEngine.isInited()) {
        const peak = audioEngine.getMasterLevel();
        lines.push(`MASTER ${peak > -60 ? peak.toFixed(1) + ' dB' : '—∞ dB'}`);
      } else {
        lines.push('ENGINE WARMING UP');
      }
      lines.push(`TRANSPORT ${playing ? 'ROLLING' : 'HALTED'} @ ${bpm.toFixed(1)} BPM`);
      lines.push(`MODE ${sessionMode ? 'SESSION' : 'ARRANGEMENT'}`);
      lines.push(`TRACKS ${String(trackCount).padStart(2, '0')} / CLIPS ${String(clipCount).padStart(3, '0')}`);
      if (automationLanes > 0) lines.push(`AUTO LANES ${automationLanes}`);
      if (tempoEvents > 0) lines.push(`TEMPO MAP ${tempoEvents} EV`);
      if (micRecording) lines.push('MIC RECORDING — ARMED');
      if (midiClockOut) lines.push('MIDI CLOCK OUT ACTIVE');
      if (midiClockIn) lines.push('MIDI CLOCK IN — TRANSPORT SLAVED');
      if (midi.supported) {
        lines.push(midi.connected ? `MIDI IN: ${midi.device.toUpperCase()}` : 'MIDI BUS IDLE');
      }
      // Sprinkle in flavor every few cycles.
      lines.push(FLAVOR[Math.floor(Math.random() * FLAVOR.length)]);
      return lines;
    };
    let i = 0;
    let lines = sample();
    setMsg(lines[0]);
    const t = setInterval(() => {
      i = (i + 1) % lines.length;
      if (i === 0) lines = sample();
      setMsg(lines[i]);
    }, 2200);
    return () => clearInterval(t);
  }, [playing, sessionMode, micRecording, midiClockOut, midiClockIn, bpm, trackCount, clipCount, automationLanes, tempoEvents, midi.supported, midi.connected, midi.device]);

  return (
    <div
      className="hud-readout--green hud-readout"
      style={{ minWidth: 220, textAlign: 'right', overflow: 'hidden' }}
    >
      <span className="blink" style={{ marginRight: 6 }}>●</span>
      {msg}
    </div>
  );
}
