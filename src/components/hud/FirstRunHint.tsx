import { useState } from 'react';
import { useIsMobile } from '../../hooks/useLayoutMode';

const KEY = 'lostboard.hintDismissed';

/**
 * First-run guidance.
 *
 * The app opens straight onto a timeline with a song already in it, and until
 * now said nothing about what any of it was or what to do — the only in-app
 * hint was the editor tip strip, which is written around double-click and drag
 * handles and is hidden on touch. Three sentences, dismissible, shown once.
 */
export function FirstRunHint() {
  const isMobile = useIsMobile();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });
  if (dismissed) return null;

  const close = () => {
    setDismissed(true);
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* private mode — it simply shows again */
    }
  };

  const steps = isMobile
    ? [
        ['Play', 'Hit Play to hear the song that’s already loaded.'],
        ['Change a sound', 'Tap a track name — Drums, Bass, Lead — for volume, pan and its instrument.'],
        ['Add music', 'Drag across an empty lane to draw a clip, then tap Edit to write notes.'],
      ]
    : [
        ['Play', 'Press Space or hit Play to hear the loaded song.'],
        ['Change a sound', 'Click a track, then Edit for its notes, instrument and effects.'],
        ['Add music', 'Drag across an empty lane to draw a clip; double-click it to edit.'],
      ];

  return (
    <div
      style={{
        position: 'fixed',
        left: 12,
        right: 12,
        bottom: 'calc(12px + env(safe-area-inset-bottom))',
        zIndex: 45,
        maxWidth: 460,
        margin: '0 auto',
        background: 'rgba(10,6,3,0.97)',
        border: '1px solid rgba(255,106,0,0.55)',
        boxShadow: '0 8px 30px rgba(0,0,0,0.7)',
        padding: '12px 14px',
      }}
      role="note"
      aria-label="Getting started"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span className="hud-label" style={{ fontSize: 12, flex: 1 }}>
          Getting started
        </span>
        <button
          className="hud-btn hud-btn--ghost"
          onClick={close}
          aria-label="Dismiss getting started"
          style={{ minHeight: 36, minWidth: 64, fontSize: 12 }}
        >
          Got it
        </button>
      </div>
      {steps.map(([title, body]) => (
        <div
          key={title}
          style={{ marginBottom: 6, fontSize: 13, lineHeight: 1.45, color: 'rgba(255,170,90,0.85)' }}
        >
          <b style={{ color: 'var(--hud-orange-bright)', fontWeight: 700 }}>{title}.</b>{' '}
          {body}
        </div>
      ))}
    </div>
  );
}
