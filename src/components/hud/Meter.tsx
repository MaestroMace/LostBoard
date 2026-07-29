import { useEffect, useRef } from 'react';
import { meterBus } from '../../state/meterBus';

/**
 * LiveMeter — registers its bar element with the MeterBus, which drives the
 * height directly via one shared rAF loop. No React re-renders per frame.
 */
export function LiveMeter({
  meterKey,
  height = 80,
  width,
  axis = 'y',
}: {
  meterKey: string;
  /** Number of pixels, or any CSS length — '100%' lets it stretch with a flex parent. */
  height?: number | string;
  width?: number | string;
  /** 'x' for a meter that runs along a row rather than up a strip. */
  axis?: 'x' | 'y';
}) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!barRef.current) return;
    return meterBus.register(meterKey, barRef.current);
  }, [meterKey, axis]);

  return (
    <div className={`meter${axis === 'x' ? ' meter--h' : ''}`} style={{ height, width }}>
      <div ref={barRef} className="meter__bar" data-axis={axis} />
    </div>
  );
}

/** Static meter for one-off use where there's no engine key to track. */
export function Meter({ db, height = 80 }: { db: number; height?: number }) {
  const fill = db <= -60 ? 0 : db >= 0 ? 1 : (db + 60) / 60;
  return (
    <div className="meter" style={{ height }}>
      <div className="meter__bar" style={{ transform: `scaleY(${Math.max(0, Math.min(1, fill))})` }} />
    </div>
  );
}
