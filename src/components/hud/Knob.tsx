import { useRef } from 'react';

type Props = {
  value: number;
  min: number;
  max: number;
  step?: number;
  size?: number;
  label?: string;
  /** Full-word name for the hover tooltip (e.g. "Attack" for a knob labelled "A"). */
  title?: string;
  unit?: string;
  display?: (v: number) => string;
  onChange: (v: number) => void;
  log?: boolean;
};

export function Knob({
  value,
  min,
  max,
  step = 0.01,
  size = 48,
  label,
  title,
  unit,
  display,
  onChange,
  log = false,
}: Props) {
  const startX = useRef(0);
  const startY = useRef(0);
  const startV = useRef(0);
  const dragging = useRef(false);

  const norm = log
    ? (Math.log(Math.max(value, min)) - Math.log(min)) / (Math.log(max) - Math.log(min))
    : (value - min) / (max - min);
  const angle = -135 + norm * 270;

  function setFromNorm(n: number) {
    n = Math.max(0, Math.min(1, n));
    let v: number;
    if (log) {
      v = Math.exp(Math.log(min) + n * (Math.log(max) - Math.log(min)));
    } else {
      v = min + n * (max - min);
    }
    if (step) v = Math.round(v / step) * step;
    onChange(Math.max(min, Math.min(max, v)));
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragging.current = true;
    startX.current = e.clientX;
    startY.current = e.clientY;
    startV.current = norm;
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    // respond to up-OR-right drag (whichever the user reaches for) instead of
    // vertical only — a knob that ignores horizontal motion feels stuck.
    // ~150px is a full sweep; Shift drags ~3.5× finer for precision.
    const delta = startY.current - e.clientY + (e.clientX - startX.current);
    const sens = e.shiftKey ? 520 : 150;
    setFromNorm(startV.current + delta / sens);
  }
  function onPointerUp(e: React.PointerEvent) {
    dragging.current = false;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }
  function onDoubleClick() {
    setFromNorm(0.5);
  }

  const shown = display ? display(value) : `${value.toFixed(2)}${unit ?? ''}`;
  // Hover/long-press help: full-word name when given, plus the live value and
  // range, and a hint that double-click resets and Shift drags finely.
  const name = title ?? label;
  const tip = `${name ? name + ' — ' : ''}${shown}  ·  range ${display ? display(min) + '…' + display(max) : `${min}…${max}`}  ·  double-click to centre, Shift-drag for fine`;

  return (
    <div
      title={tip}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: size + 8 }}
    >
      <div
        className="knob"
        style={{ width: size, height: size }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <div className="knob__ring" />
        <div
          className="knob__indicator"
          style={{ transform: `translateX(-50%) rotate(${angle}deg)` }}
        />
      </div>
      {label && <div className="hud-label" style={{ fontSize: 11 }}>{label}</div>}
      <div className="hud-value" style={{ fontSize: 12 }}>{shown}</div>
    </div>
  );
}
