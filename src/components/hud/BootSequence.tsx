import { useEffect, useState } from 'react';

const STAGES = [
  '> CHECKING MAGI SYSTEM .................. OK',
  '> WAKING WEB AUDIO CONTEXT .............. OK',
  '> SYNC CASPER / MELCHIOR / BALTHASAR .... OK',
  '> LOADING SAMPLE BANK / OSC PRESETS ..... OK',
  '> ROUTING MASTER BUS // LIMITER -1.0dB .. OK',
  '> A.T. FIELD ENGAGED .................... OK',
  '> CLEAR FOR LAUNCH ......................',
];

export function BootSequence({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (step < STAGES.length) {
      const t = setTimeout(() => setStep(step + 1), 220);
      return () => clearTimeout(t);
    }
    setDone(true);
  }, [step]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'radial-gradient(circle at 50% 30%, #1a0a00, #050505 70%)',
        zIndex: 5000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        gap: 18,
      }}
    >
      <div className="warning-stripe" style={{ position: 'absolute', top: 0, left: 0, right: 0 }} />
      <div className="warning-stripe" style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }} />
      <div className="at-field" style={{ position: 'absolute', inset: 0, opacity: 0.2 }} />

      <NervSeal />
      <div className="hud-big" style={{ fontSize: 28, letterSpacing: '0.4em' }}>N.E.R.V.</div>
      <div className="hud-label" style={{ fontSize: 11 }}>M.A.G.I. SYSTEM // LOSTBOARD DAW</div>

      <div
        style={{
          minWidth: 320,
          maxWidth: 520,
          width: '90vw',
          background: 'rgba(0,0,0,0.7)',
          border: '1px solid rgba(255,106,0,0.5)',
          padding: 16,
          fontFamily: 'var(--font-data)',
          fontSize: 11,
          color: 'var(--nerv-orange-bright)',
          lineHeight: 1.6,
        }}
      >
        {STAGES.slice(0, step + 1).map((line, i) => (
          <div key={i} style={{ opacity: i === step ? 1 : 0.7 }}>{line}</div>
        ))}
        {!done && <div className="blink">_</div>}
      </div>

      {done && (
        <button
          className="nerv-btn nerv-btn--green pulse"
          onClick={() => {
            setAcknowledged(true);
            onDone();
          }}
          disabled={acknowledged}
          style={{ minWidth: 220 }}
        >
          ACKNOWLEDGE & ENGAGE
        </button>
      )}
      <div className="hud-readout--dim hud-readout" style={{ fontSize: 9 }}>
        AUTHORIZATION: COMMANDER IKARI
      </div>
    </div>
  );
}

function NervSeal() {
  return (
    <svg viewBox="0 0 200 200" width="120" height="120" className="pulse">
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
      <polygon
        points="100,30 162,67 162,133 100,170 38,133 38,67"
        fill="none"
        stroke="#ff6600"
        strokeWidth="1"
        opacity="0.8"
      />
      <path d="M48 90 L152 90 L100 178 Z" fill="url(#seal)" />
      <text
        x="100"
        y="78"
        textAnchor="middle"
        fontFamily="Orbitron"
        fontWeight="900"
        fontSize="22"
        fill="#0a0a0a"
      >
        NERV
      </text>
    </svg>
  );
}
