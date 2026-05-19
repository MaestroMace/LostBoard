import { useMemo, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { HexFrame } from '../hud/HexFrame';
import {
  AUTOMATION_PARAM_META,
  type AutomationCurve,
  type AutomationLane,
  type AutomationParam,
  type Track,
} from '../../audio/types';

const CURVE_MODES: AutomationCurve[] = ['linear', 'exponential', 'hold', 'step'];
const CURVE_GLYPH: Record<AutomationCurve, string> = {
  linear: '╱',
  exponential: '⌒',
  hold: '⎺',
  step: '⌐',
};

const ALL_PARAMS: AutomationParam[] = [
  'volume',
  'pan',
  'cutoff',
  'reverb',
  'delay',
  'eqLow',
  'eqMid',
  'eqHigh',
  'compThreshold',
  'compRatio',
];

/**
 * AutomationView — per-track, per-parameter sparse breakpoint editor.
 *
 * UX: pick a track on the left, see one lane per param it currently
 * automates on the right. Each lane has a click-to-add-point sparkline
 * (drag a point to move, double-click to delete) and a points table for
 * exact numeric editing. Engine scheduling chains
 * `linearRampToValueAtTime` between consecutive points so the param glides
 * smoothly across the arrangement.
 *
 * "+ ADD LANE" attaches a new lane for any param the track doesn't yet
 * automate, seeded with a single point at beat 0 holding the current
 * value of that param.
 */
export function AutomationView() {
  const tracks = useStore((s) => s.project.tracks);
  const selectedId = useStore((s) => s.selectedTrackId);
  const selectTrack = useStore((s) => s.selectTrack);

  const active = useMemo(
    () => tracks.find((t) => t.id === selectedId) ?? tracks[0],
    [tracks, selectedId],
  );

  if (!active) {
    return (
      <div style={{ padding: 16 }}>
        <HexFrame title="N/A">No tracks. Add one from the Arrange view.</HexFrame>
      </div>
    );
  }

  const lanes = active.automation ?? [];
  const automatedParams = new Set(lanes.map((l) => l.param));
  const unusedParams = ALL_PARAMS.filter((p) => !automatedParams.has(p));

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
      className="hex-grid-bg"
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="hud-label">AUTOMATION // M.A.G.I. PARAM RAMPS</span>
        <select
          className="display"
          value={active.id}
          onChange={(e) => selectTrack(e.target.value)}
        >
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        {unusedParams.length > 0 && (
          <AddLaneMenu track={active} unusedParams={unusedParams} />
        )}
      </div>

      {lanes.length === 0 ? (
        <HexFrame title="NO AUTOMATION">
          <p className="hud-readout--dim hud-readout" style={{ margin: 0, fontSize: 11 }}>
            No automation lanes on this track yet. Use + ADD LANE above to start automating volume,
            pan, filter cutoff, or a send.
          </p>
        </HexFrame>
      ) : (
        lanes.map((lane) => (
          <LaneEditor key={lane.param} track={active} lane={lane} />
        ))
      )}
    </div>
  );
}

function currentValueFor(track: Track, param: AutomationParam): number {
  switch (param) {
    case 'volume':
      return track.volume;
    case 'pan':
      return track.pan;
    case 'cutoff':
      return track.synth?.cutoff ?? 1800;
    case 'reverb':
      return track.synth?.reverb ?? 0.15;
    case 'delay':
      return track.synth?.delay ?? 0.1;
    case 'eqLow':
      return track.fx?.eqLow ?? 0;
    case 'eqMid':
      return track.fx?.eqMid ?? 0;
    case 'eqHigh':
      return track.fx?.eqHigh ?? 0;
    case 'compThreshold':
      return track.fx?.compThreshold ?? -18;
    case 'compRatio':
      return track.fx?.compRatio ?? 3;
  }
}

function AddLaneMenu({ track, unusedParams }: { track: Track; unusedParams: AutomationParam[] }) {
  const addAutomationPoint = useStore((s) => s.addAutomationPoint);
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <button className="nerv-btn nerv-btn--green" onClick={() => setOpen((v) => !v)}>
        + ADD LANE
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: '110%',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            background: 'rgba(0,0,0,0.95)',
            border: '1px solid rgba(255,106,0,0.5)',
            padding: 6,
            zIndex: 10,
            minWidth: 160,
          }}
        >
          {unusedParams.map((p) => (
            <button
              key={p}
              className="nerv-btn"
              onClick={() => {
                addAutomationPoint(track.id, p, 0, currentValueFor(track, p));
                setOpen(false);
              }}
            >
              {AUTOMATION_PARAM_META[p].label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const LANE_HEIGHT = 100;

/**
 * LaneEditor — one parameter's breakpoints, rendered as both a clickable
 * sparkline and a numeric table. Sparkline: x = beat (0..projectBeats),
 * y = value (param's min..max). Click empty area to add a point; drag a
 * point to move; double-click a point to delete it.
 */
function LaneEditor({ track, lane }: { track: Track; lane: AutomationLane }) {
  const project = useStore((s) => s.project);
  const addAutomationPoint = useStore((s) => s.addAutomationPoint);
  const updateAutomationPoint = useStore((s) => s.updateAutomationPoint);
  const setAutomationPointCurve = useStore((s) => s.setAutomationPointCurve);
  const removeAutomationPoint = useStore((s) => s.removeAutomationPoint);
  const removeAutomationLane = useStore((s) => s.removeAutomationLane);

  const meta = AUTOMATION_PARAM_META[lane.param];
  const projectBeats = Math.max(1, project.lengthBars * project.numerator);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<string | null>(null);

  function clientToData(clientX: number, clientY: number): { beat: number; value: number } | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    const beat = Math.max(0, Math.min(projectBeats, (x / r.width) * projectBeats));
    const t = 1 - y / r.height;
    const value = meta.min + Math.max(0, Math.min(1, t)) * (meta.max - meta.min);
    return { beat, value };
  }

  function background(e: React.PointerEvent<SVGSVGElement>) {
    if (e.target !== e.currentTarget) return;
    const d = clientToData(e.clientX, e.clientY);
    if (!d) return;
    addAutomationPoint(track.id, lane.param, d.beat, d.value);
  }

  function pointDown(e: React.PointerEvent, pointId: string) {
    e.stopPropagation();
    dragging.current = pointId;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function pointMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    const d = clientToData(e.clientX, e.clientY);
    if (!d) return;
    updateAutomationPoint(track.id, lane.param, dragging.current, d);
  }
  function pointUp() {
    dragging.current = null;
  }

  const xFor = (beat: number) => (beat / projectBeats) * 100;
  const yFor = (value: number) => {
    const t = (value - meta.min) / (meta.max - meta.min);
    return (1 - Math.max(0, Math.min(1, t))) * 100;
  };

  const sorted = [...lane.points].sort((a, b) => a.beat - b.beat);

  // Build the path so each segment reflects its destination point's curve:
  // linear → straight line, step → vertical jump at the new point, hold →
  // horizontal then vertical at the new point, exponential → quadratic
  // bezier biased toward the destination y.
  const pathD = (() => {
    if (sorted.length === 0) return '';
    const segs: string[] = [`M ${xFor(sorted[0].beat)} ${yFor(sorted[0].value)}`];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const pt = sorted[i];
      const x0 = xFor(prev.beat);
      const y0 = yFor(prev.value);
      const x1 = xFor(pt.beat);
      const y1 = yFor(pt.value);
      const curve = pt.curve ?? 'linear';
      switch (curve) {
        case 'step':
          segs.push(`L ${x1} ${y0}`, `L ${x1} ${y1}`);
          break;
        case 'hold':
          segs.push(`L ${x1} ${y0}`, `L ${x1} ${y1}`);
          break;
        case 'exponential':
          // bezier with control point on the destination's vertical line
          segs.push(`Q ${x1} ${y0} ${x1} ${y1}`);
          break;
        case 'linear':
        default:
          segs.push(`L ${x1} ${y1}`);
          break;
      }
    }
    return segs.join(' ');
  })();

  return (
    <HexFrame title={`LANE // ${meta.label}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="hud-readout--dim hud-readout" style={{ fontSize: 9 }}>
            {meta.min.toFixed(meta.step >= 1 ? 0 : 2)}{meta.unit} … {meta.max.toFixed(meta.step >= 1 ? 0 : 2)}{meta.unit}
          </span>
          <div style={{ flex: 1 }} />
          <button
            className="nerv-btn nerv-btn--ghost"
            onClick={() => addAutomationPoint(track.id, lane.param, projectBeats / 2, currentValueFor(track, lane.param))}
          >
            + POINT
          </button>
          <button
            className="nerv-btn nerv-btn--rec"
            onClick={() => {
              if (confirm(`Remove the ${meta.label} automation lane?`)) {
                removeAutomationLane(track.id, lane.param);
              }
            }}
          >
            ✕ REMOVE LANE
          </button>
        </div>

        <svg
          ref={svgRef}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          width="100%"
          height={LANE_HEIGHT}
          onPointerDown={background}
          onPointerMove={pointMove}
          onPointerUp={pointUp}
          onPointerCancel={pointUp}
          style={{
            background: 'linear-gradient(180deg, rgba(255,106,0,0.04), rgba(255,106,0,0.10))',
            border: '1px solid rgba(255,106,0,0.35)',
            cursor: 'crosshair',
            touchAction: 'none',
          }}
        >
          {/* bar gridlines */}
          {Array.from({ length: project.lengthBars + 1 }).map((_, b) => {
            const x = (b * project.numerator * 100) / projectBeats;
            return <line key={b} x1={x} y1={0} x2={x} y2={100} stroke="rgba(255,106,0,0.15)" strokeWidth={0.2} />;
          })}
          {/* horizontal mid line */}
          <line x1={0} y1={50} x2={100} y2={50} stroke="rgba(255,106,0,0.18)" strokeWidth={0.2} strokeDasharray="1 1" />
          {sorted.length > 1 && (
            <path d={pathD} fill="none" stroke="var(--nerv-orange-bright)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
          )}
          {sorted.map((pt) => (
            <circle
              key={pt.id}
              cx={xFor(pt.beat)}
              cy={yFor(pt.value)}
              r={1.4}
              fill="var(--nerv-orange-bright)"
              stroke="#000"
              strokeWidth={0.3}
              vectorEffect="non-scaling-stroke"
              style={{ cursor: 'grab', touchAction: 'none' }}
              onPointerDown={(e) => pointDown(e, pt.id)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                removeAutomationPoint(track.id, lane.param, pt.id);
              }}
            />
          ))}
        </svg>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 180, overflow: 'auto' }}>
          {sorted.length === 0 && (
            <p className="hud-readout--dim hud-readout" style={{ margin: 0, fontSize: 10 }}>
              Click anywhere on the lane above to drop a breakpoint.
            </p>
          )}
          {sorted.map((pt, i) => (
            <div
              key={pt.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '60px 1fr 1fr 110px 50px',
                gap: 6,
                padding: '2px 6px',
                background: 'rgba(0,0,0,0.4)',
                border: '1px solid rgba(255,106,0,0.2)',
                alignItems: 'center',
              }}
            >
              <span className="hud-value" style={{ fontSize: 10 }}>PT-{String(i + 1).padStart(2, '0')}</span>
              <input
                className="display"
                type="number"
                step={0.25}
                min={0}
                value={pt.beat}
                onChange={(e) => updateAutomationPoint(track.id, lane.param, pt.id, { beat: parseFloat(e.target.value) || 0 })}
                style={{ width: '100%' }}
              />
              <input
                className="display"
                type="number"
                step={meta.step}
                min={meta.min}
                max={meta.max}
                value={pt.value}
                onChange={(e) =>
                  updateAutomationPoint(track.id, lane.param, pt.id, {
                    value: parseFloat(e.target.value) || 0,
                  })
                }
                style={{ width: '100%' }}
              />
              <select
                className="display"
                value={pt.curve ?? 'linear'}
                onChange={(e) =>
                  setAutomationPointCurve(track.id, lane.param, pt.id, e.target.value as AutomationCurve)
                }
                disabled={i === 0}
                title={i === 0 ? 'First point — no curve into it' : 'Curve from previous point'}
                style={{ width: '100%' }}
              >
                {CURVE_MODES.map((m) => (
                  <option key={m} value={m}>
                    {CURVE_GLYPH[m]} {m}
                  </option>
                ))}
              </select>
              <button
                className="nerv-btn nerv-btn--icon nerv-btn--rec"
                onClick={() => removeAutomationPoint(track.id, lane.param, pt.id)}
                title="Remove point"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>
    </HexFrame>
  );
}
