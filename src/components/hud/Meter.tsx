import { useEffect, useRef } from 'react';
import { meterBus } from '../../state/meterBus';

/**
 * LiveMeter — registers its bar element with the MeterBus, which drives the
 * height directly via one shared rAF loop. No React re-renders per frame.
 */
export function LiveMeter({ meterKey, height = 80 }: { meterKey: string; height?: number }) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!barRef.current) return;
    return meterBus.register(meterKey, barRef.current);
  }, [meterKey]);

  return (
    <div className="meter" style={{ height }}>
      <div ref={barRef} className="meter__bar" style={{ height: '0%' }} />
    </div>
  );
}

/** Static meter for one-off use where there's no engine key to track. */
export function Meter({ db, height = 80 }: { db: number; height?: number }) {
  const fill = db <= -60 ? 0 : db >= 0 ? 1 : (db + 60) / 60;
  return (
    <div className="meter" style={{ height }}>
      <div className="meter__bar" style={{ height: `${Math.max(0, Math.min(1, fill)) * 100}%` }} />
    </div>
  );
}
