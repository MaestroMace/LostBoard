type Props = {
  /** -60..6 dB */
  db: number;
  height?: number;
};

/** Returns 0..1 representation of dB for visual meter. */
function dbToFill(db: number) {
  if (db <= -60) return 0;
  if (db >= 0) return 1;
  return (db + 60) / 60;
}

export function Meter({ db, height = 80 }: Props) {
  const fill = Math.max(0, Math.min(1, dbToFill(db)));
  return (
    <div className="meter" style={{ height }}>
      <div className="meter__bar" style={{ height: `${fill * 100}%` }} />
    </div>
  );
}
