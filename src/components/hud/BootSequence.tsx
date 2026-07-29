import { useEffect, useState } from 'react';

const STAGES = [
  'audio engine',
  'instruments',
  'samples',
  'mixer',
  'ready',
];

/**
 * Start screen.
 *
 * Browsers will not start audio without a user gesture, so the tap is real.
 * The boot readout is kept because it gives the app its character — what was
 * wrong before was that it *blocked*: seven lines at 220ms each with the Start
 * button hidden until they finished, so launch took 2.7s every time. Now the
 * lines race through in ~200ms and the button is live from the first frame, so
 * the animation is something you can watch rather than something you wait on.
 */
export function BootSequence({ onDone }: { onDone: () => void }) {
  const [starting, setStarting] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (step >= STAGES.length) return;
    const t = setTimeout(() => setStep(step + 1), 45);
    return () => clearTimeout(t);
  }, [step]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'radial-gradient(circle at 50% 35%, #17110c, #060606 70%)',
        zIndex: 5000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        gap: 20,
        textAlign: 'center',
      }}
    >
      <Mark />

      <div>
        <div className="hud-big" style={{ fontSize: 30, letterSpacing: '0.14em' }}>
          LostBoard
        </div>
        <div style={{ fontSize: 14, color: 'rgba(255,170,90,0.75)', marginTop: 6 }}>
          Music sketchpad
        </div>
      </div>

      {/* Fixed height so the button never shifts as lines land. */}
      <div
        style={{
          width: '90vw',
          maxWidth: 320,
          height: 84,
          padding: '8px 12px',
          background: 'rgba(0,0,0,0.55)',
          border: '1px solid rgba(255,106,0,0.35)',
          fontFamily: 'var(--font-data)',
          fontSize: 12,
          lineHeight: 1.5,
          textAlign: 'left',
          color: 'rgba(255,170,90,0.9)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {STAGES.slice(Math.max(0, step - 3), step).map((line, i) => (
          <div key={line} style={{ opacity: 0.45 + i * 0.18 }}>
            <span style={{ opacity: 0.5 }}>›</span> {line} <span style={{ color: 'var(--hud-green)' }}>ok</span>
          </div>
        ))}
        {step < STAGES.length && <span className="blink">▌</span>}
      </div>

      <button
        className="hud-btn hud-btn--green pulse"
        onClick={() => {
          setStarting(true);
          onDone();
        }}
        disabled={starting}
        style={{ minWidth: 220, minHeight: 52, fontSize: 14, letterSpacing: '0.08em' }}
      >
        {starting ? 'Starting…' : 'Start'}
      </button>

      <div style={{ fontSize: 13, color: 'rgba(255,140,60,0.6)', maxWidth: 300 }}>
        One tap is needed before the browser will let audio play.
      </div>
    </div>
  );
}

function Mark() {
  return (
    <svg viewBox="0 0 200 200" width="96" height="96" aria-hidden>
      <defs>
        <radialGradient id="seal" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffb347" />
          <stop offset="100%" stopColor="#ff6600" />
        </radialGradient>
      </defs>
      <polygon
        points="100,10 180,55 180,145 100,190 20,145 20,55"
        fill="none"
        stroke="url(#seal)"
        strokeWidth="3"
      />
      <path d="M100 42 L150 130 L50 130 Z" fill="url(#seal)" />
      <circle cx="100" cy="152" r="7" fill="url(#seal)" />
    </svg>
  );
}
