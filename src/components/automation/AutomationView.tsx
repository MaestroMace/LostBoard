import { useMemo, useRef, useState, type CSSProperties } from 'react';
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
/** What the shape does, not what the code calls it. Kept short — this sits in
 *  a ~96px column on a phone, and "Hold, then jump" truncated to "Hold, t…". */
const CURVE_LABEL: Record<AutomationCurve, string> = {
  linear: 'Slide',
  exponential: 'Curve',
  hold: 'Hold',
  step: 'Jump',
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
  'bitcrush',
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
        <HexFrame title="Nothing here yet">No tracks. Add one from the Song tab.</HexFrame>
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
        <span className="hud-label">Automate</span>
        <select
          className="display"
          value={active.id}
          onChange={(e) => selectTrack(e.target.value)}
          aria-label="Track to automate"
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
        <HexFrame title="Automation">
          <p className="hud-readout--dim hud-readout" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
            Automation makes a control move on its own as the song plays &mdash; a filter opening up
            over four bars, a fade at the end. Tap <b>Add</b> to pick what should move, then tap the
            lane to place points.
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
    case 'bitcrush':
      return track.fx?.bitcrush ?? 8;
  }
}

function AddLaneMenu({ track, unusedParams }: { track: Track; unusedParams: AutomationParam[] }) {
  const addAutomationPoint = useStore((s) => s.addAutomationPoint);
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <button
        className="hud-btn hud-btn--green"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Choose a control to automate on this track"
      >
        + Add
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
            background: '#0a0705',
            border: '1px solid rgba(255,106,0,0.5)',
            padding: 6,
            zIndex: 10,
            minWidth: 160,
          }}
        >
          {unusedParams.map((p) => (
            <button
              key={p}
              className="hud-btn"
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

/** Midpoint of the widest gap between existing points. Pressing "+ Point"
 *  twice used to stack two points on the identical pixel, after which neither
 *  could be dragged off the other. */
function nextGapBeat(sorted: { beat: number }[], projectBeats: number): number {
  if (sorted.length === 0) return projectBeats / 2;
  const edges = [0, ...sorted.map((p) => p.beat), projectBeats];
  let best = projectBeats / 2;
  let span = -1;
  for (let i = 1; i < edges.length; i++) {
    const d = edges[i] - edges[i - 1];
    if (d > span) {
      span = d;
      best = edges[i - 1] + d / 2;
    }
  }
  return best;
}

const POINT_ROW: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '22px 1fr 1fr 96px 44px',
  gap: 6,
  padding: '2px 6px',
  background: 'rgba(0,0,0,0.4)',
  border: '1px solid rgba(255,106,0,0.2)',
  alignItems: 'center',
};

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

  /**
   * Adding a point is a TAP, resolved on pointerup, not a pointerdown.
   * As a pointerdown handler on a touchAction:'none' surface, every attempt to
   * scroll the view moved it 0px and wrote a junk point into the project
   * instead — measured: scrollTop 0 -> 0, points 1 -> 2, on every try.
   */
  const tapStart = useRef<{ x: number; y: number; t: number } | null>(null);
  function background(e: React.PointerEvent<SVGSVGElement>) {
    if (e.target !== e.currentTarget) return;
    tapStart.current = { x: e.clientX, y: e.clientY, t: performance.now() };
  }
  function backgroundUp(e: React.PointerEvent<SVGSVGElement>) {
    const st = tapStart.current;
    tapStart.current = null;
    if (!st || e.target !== e.currentTarget) return;
    const moved = Math.hypot(e.clientX - st.x, e.clientY - st.y);
    if (moved > 8 || performance.now() - st.t > 400) return;
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
    <HexFrame title={`${meta.label}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="hud-readout--dim hud-readout" style={{ fontSize: 12 }}>
            {meta.min.toFixed(meta.step >= 1 ? 0 : 2)}{meta.unit} … {meta.max.toFixed(meta.step >= 1 ? 0 : 2)}{meta.unit}
          </span>
          <div style={{ flex: 1 }} />
          <button
            className="hud-btn hud-btn--ghost"
            onClick={() => addAutomationPoint(track.id, lane.param, nextGapBeat(sorted, projectBeats), currentValueFor(track, lane.param))}
            title="Drop a point in the largest empty stretch"
          >
            + Point
          </button>
          <button
            className="hud-btn hud-btn--rec"
            onClick={() => {
              if (confirm(`Stop automating ${meta.label.toLowerCase()}? The points you placed will be lost.`)) {
                removeAutomationLane(track.id, lane.param);
              }
            }}
            title={`Stop automating ${meta.label.toLowerCase()}`}
          >
            Remove
          </button>
        </div>

        {/* The svg keeps drawing the curve; the draggable points are HTML
            buttons layered over it. As SVG circles under
            preserveAspectRatio="none", r=1.4 rendered as a 24.7 x 2.7px
            target — dragging a point is this view's primary interaction and it
            was physically impossible. */}
        <div style={{ position: 'relative' }}>
        <svg
          ref={svgRef}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          width="100%"
          height={LANE_HEIGHT}
          onPointerDown={background}
          onPointerMove={pointMove}
          onPointerUp={(e) => {
            pointUp();
            backgroundUp(e);
          }}
          onPointerCancel={pointUp}
          style={{
            background: 'linear-gradient(180deg, rgba(255,106,0,0.04), rgba(255,106,0,0.10))',
            border: '1px solid rgba(255,106,0,0.35)',
            cursor: 'crosshair',
            // pan-y so the page can still scroll under a vertical swipe; the
            // point handles below keep 'none' because dragging one is a real
            // two-axis gesture.
            touchAction: 'pan-y',
          }}
        >
          {/* bar gridlines */}
          {Array.from({ length: project.lengthBars + 1 }).map((_, b) => {
            const x = (b * project.numerator * 100) / projectBeats;
            return (
              <line key={b} x1={x} y1={0} x2={x} y2={100} stroke="rgba(255,106,0,0.15)" strokeWidth={0.2} pointerEvents="none" />
            );
          })}
          {/* horizontal mid line */}
          {/* decoration only — `background` bails when e.target is not the svg
              itself, so anything drawn here silently eats taps */}
          <line x1={0} y1={50} x2={100} y2={50} stroke="rgba(255,106,0,0.18)" strokeWidth={0.2} strokeDasharray="1 1" pointerEvents="none" />
          {sorted.length > 1 && (
            <path d={pathD} fill="none" stroke="var(--hud-orange-bright)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" pointerEvents="none" />
          )}
          {sorted.map((pt) => (
            <circle
              key={pt.id}
              cx={xFor(pt.beat)}
              cy={yFor(pt.value)}
              r={1.4}
              fill="var(--hud-orange-bright)"
              stroke="#000"
              strokeWidth={0.3}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ))}
        </svg>
        {sorted.map((pt, i) => (
          <button
            key={pt.id}
            aria-label={`Point ${i + 1}: beat ${pt.beat.toFixed(2)}, ${pt.value.toFixed(2)}${meta.unit}`}
            title="Drag to move · double-tap to delete"
            onPointerDown={(e) => pointDown(e, pt.id)}
            onPointerMove={pointMove}
            onPointerUp={pointUp}
            onPointerCancel={pointUp}
            onDoubleClick={(e) => {
              e.stopPropagation();
              removeAutomationPoint(track.id, lane.param, pt.id);
            }}
            style={{
              position: 'absolute',
              left: `${xFor(pt.beat)}%`,
              top: `${yFor(pt.value)}%`,
              width: 44,
              height: 44,
              marginLeft: -22,
              marginTop: -22,
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'grab',
              touchAction: 'none',
              zIndex: 2,
            }}
          />
        ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 180, overflow: 'auto' }}>
          {sorted.length === 0 && (
            <p className="hud-readout--dim hud-readout" style={{ margin: 0, fontSize: 12 }}>
              Tap anywhere on the lane above to place a point.
            </p>
          )}
          {/* A row of bare number boxes tells you nothing about what it holds;
              the header names the columns once instead of per row. */}
          {sorted.length > 0 && (
            <div style={{ ...POINT_ROW, background: 'transparent', border: 'none', paddingBottom: 0 }}>
              <span className="hud-label" style={{ fontSize: 11 }}>#</span>
              <span className="hud-label" style={{ fontSize: 11 }}>Beat</span>
              <span className="hud-label" style={{ fontSize: 11 }}>{meta.unit ? `Value (${meta.unit})` : 'Value'}</span>
              <span className="hud-label" style={{ fontSize: 11 }}>Shape</span>
              <span />
            </div>
          )}
          {sorted.map((pt, i) => (
            <div
              key={pt.id}
              style={POINT_ROW}
            >
              <span className="hud-value" style={{ fontSize: 12 }}>{i + 1}</span>
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
                aria-label={`Shape into point ${i + 1}`}
                title={i === 0 ? 'Nothing comes before the first point' : 'How the value moves from the point before'}
                style={{ width: '100%' }}
              >
                {CURVE_MODES.map((m) => (
                  <option key={m} value={m}>
                    {CURVE_GLYPH[m]} {CURVE_LABEL[m]}
                  </option>
                ))}
              </select>
              <button
                className="hud-btn hud-btn--icon hud-btn--rec"
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
