import { memo, useEffect, useState } from 'react';
import { shallow } from 'zustand/shallow';
import { useStore } from '../../state/store';
import { usePlayhead } from '../../state/transportClock';
import { Scope } from './Scope';

const MESSAGES = [
  'MAGI SYSTEM ONLINE',
  'A.T. FIELD STABLE',
  'PATTERN BLUE NOT DETECTED',
  'SYNC RATIO NOMINAL',
  'ROUTING: BUS 01 / 02 / 03',
  'LCL PRESSURE NORMAL',
  'NEURAL INTERFACE ACTIVE',
  'ENGINE: WEB AUDIO OK',
  'EVA UNIT READY FOR LAUNCH',
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <NervMark />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span className="hud-label" style={{ fontSize: 8 }}>NERV / M.A.G.I.</span>
          <span className="hud-value" style={{ fontSize: 12 }}>LOSTBOARD // {name}</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Indicator label="PLAY" on={playing} color="green" />
        <Indicator label="REC" on={recording} color="red" />
        <PositionReadout numerator={numerator} />
        <div className="display" style={{ fontSize: 11 }}>
          <span className="hud-label" style={{ fontSize: 8 }}>BPM</span>
          <span style={{ color: 'var(--nerv-orange-bright)' }}>{bpm.toFixed(1)}</span>
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
      <span style={{ color: 'var(--nerv-orange-bright)' }}>{String(bar).padStart(3, '0')}</span>
      <span style={{ color: 'rgba(255,106,0,0.5)' }}>:</span>
      <span>{String(beat).padStart(2, '0')}</span>
      <span style={{ color: 'rgba(255,106,0,0.5)' }}>:</span>
      <span style={{ color: 'var(--nerv-amber)' }}>{String(sixteenth).padStart(2, '0')}</span>
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

function NervMark() {
  return (
    <div style={{ width: 28, height: 28, position: 'relative' }}>
      <svg viewBox="0 0 100 100" width="28" height="28">
        <polygon
          points="50,4 92,28 92,72 50,96 8,72 8,28"
          fill="none"
          stroke="var(--nerv-orange)"
          strokeWidth="3"
        />
        <path d="M22 44 L78 44 L50 88 Z" fill="var(--nerv-orange)" />
      </svg>
    </div>
  );
}

function Ticker() {
  const [msg, setMsg] = useState(MESSAGES[0]);
  useEffect(() => {
    let i = 0;
    const t = setInterval(() => {
      i = (i + 1) % MESSAGES.length;
      setMsg(MESSAGES[i]);
    }, 3200);
    return () => clearInterval(t);
  }, []);
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
