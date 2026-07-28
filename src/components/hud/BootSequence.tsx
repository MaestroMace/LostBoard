import { useState } from 'react';

/**
 * Start screen.
 *
 * Browsers will not start audio without a user gesture, so one tap is
 * genuinely required. Everything beyond that tap was ceremony: seven fake
 * status lines animating for a second and a half, with the only real control
 * hidden until they finished. What is left says what it is and gets out of the
 * way.
 */
export function BootSequence({ onDone }: { onDone: () => void }) {
  const [starting, setStarting] = useState(false);

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

      <button
        className="hud-btn hud-btn--green"
        onClick={() => {
          setStarting(true);
          onDone();
        }}
        disabled={starting}
        style={{ minWidth: 220, minHeight: 52, fontSize: 14, letterSpacing: '0.08em' }}
      >
        {starting ? 'Starting…' : 'Start'}
      </button>

      <div style={{ fontSize: 14, color: 'rgba(255,140,60,0.6)', maxWidth: 300 }}>
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
