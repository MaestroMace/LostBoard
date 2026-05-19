import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import {
  AUTOMATION_PARAM_META,
  type AutomationCurve,
  type AutomationLane,
  type AutomationParam,
  type Clip,
  type Track,
} from '../../audio/types';
import { audioEngine } from '../../audio/engine';
import { usePlayhead } from '../../state/transportClock';
import { useIsMobile } from '../../hooks/useIsMobile';
import { usePinchZoom } from '../../hooks/usePinchZoom';
import { importSample } from '../../state/samples';
import { EditorTip } from '../hud/EditorTip';

const ROW_H = 64;
const AUTO_LANE_H = 56;
/** Default px per beat at zoom = 1×. Consumers read the current value through BeatWidthContext. */
const BASE_BEAT_W = 24;
const BeatWidthContext = createContext(BASE_BEAT_W);
const useBeatWidth = () => useContext(BeatWidthContext);

/**
 * AutomationOverlayContext — transient per-track UI state for the arrange
 * automation overlay. Maps trackId → param being displayed underneath that
 * track's clip lane. `null` (or missing) means hidden. Not persisted —
 * it's a view toggle, not a property of the project.
 */
type AutomationOverlayState = {
  visible: Record<string, AutomationParam | null>;
  toggle(trackId: string, available: AutomationParam[]): void;
  setParam(trackId: string, param: AutomationParam | null): void;
};
const AutomationOverlayContext = createContext<AutomationOverlayState>({
  visible: {},
  toggle: () => {},
  setParam: () => {},
});
const useAutomationOverlay = () => useContext(AutomationOverlayContext);

export function ArrangeView() {
  const tracks = useStore((s) => s.project.tracks);
  const totalBeats = useStore((s) => s.project.lengthBars * s.project.numerator);
  const addTrack = useStore((s) => s.addTrack);
  const isMobile = useIsMobile();
  const headW = isMobile ? 144 : 196;

  const [zoom, setZoom] = useState(1);
  const beatW = BASE_BEAT_W * zoom;
  const timelineW = totalBeats * beatW;
  const scrollRef = useRef<HTMLDivElement>(null);

  const [overlayVisible, setOverlayVisible] = useState<Record<string, AutomationParam | null>>({});
  const overlayCtx: AutomationOverlayState = useMemo(
    () => ({
      visible: overlayVisible,
      toggle: (trackId, available) => {
        setOverlayVisible((cur) => {
          const next = { ...cur };
          if (next[trackId]) delete next[trackId];
          else if (available.length > 0) next[trackId] = available[0];
          return next;
        });
      },
      setParam: (trackId, param) => {
        setOverlayVisible((cur) => {
          const next = { ...cur };
          if (param === null) delete next[trackId];
          else next[trackId] = param;
          return next;
        });
      },
    }),
    [overlayVisible],
  );

  // Cmd/Ctrl + wheel zooms. Native wheel listener so we can preventDefault
  // and stop the browser from zooming the whole page.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setZoom((z) => Math.max(0.25, Math.min(4, z * (e.deltaY < 0 ? 1.12 : 1 / 1.12))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  usePinchZoom(scrollRef, setZoom);

  return (
    <BeatWidthContext.Provider value={beatW}>
    <AutomationOverlayContext.Provider value={overlayCtx}>
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <div className="warning-stripe--thin warning-stripe" />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* Track headers */}
        <div
          style={{
            width: headW,
            flexShrink: 0,
            background: 'rgba(0,0,0,0.7)',
            borderRight: '1px solid rgba(255,106,0,0.4)',
            display: 'flex',
            flexDirection: 'column',
            contain: 'layout style',
          }}
        >
          <div
            style={{
              height: 32,
              padding: '4px 6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 4,
              borderBottom: '1px solid rgba(255,106,0,0.4)',
            }}
          >
            {!isMobile && <span className="hud-label">TRACKS</span>}
            <div style={{ display: 'flex', gap: 3 }}>
              <button
                className="nerv-btn nerv-btn--icon"
                onClick={() => addTrack('synth')}
                title="Add synth track"
                style={{ minWidth: 0, padding: '4px 5px', fontSize: 9 }}
              >
                +SYN
              </button>
              <button
                className="nerv-btn nerv-btn--icon"
                onClick={() => addTrack('drum')}
                title="Add drum track"
                style={{ minWidth: 0, padding: '4px 5px', fontSize: 9 }}
              >
                +DRM
              </button>
              <button
                className="nerv-btn nerv-btn--icon"
                onClick={() => addTrack('audio')}
                title="Add audio track"
                style={{ minWidth: 0, padding: '4px 5px', fontSize: 9 }}
              >
                +AUD
              </button>
            </div>
          </div>
          <div style={{ overflow: 'auto', flex: 1 }}>
            {tracks.map((t) => {
              const param = overlayVisible[t.id];
              const lane = param ? t.automation?.find((l) => l.param === param) : undefined;
              return (
                <div key={t.id}>
                  <TrackHeader track={t} compact={isMobile} />
                  {param && (
                    <AutomationOverlayHeader track={t} param={param} hasLane={!!lane} compact={isMobile} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Timeline */}
        <div
          ref={scrollRef}
          style={{ flex: 1, overflow: 'auto', position: 'relative', contain: 'layout style' }}
          className="hex-grid-bg"
        >
          <Ruler beats={totalBeats} />
          <div style={{ position: 'relative', width: timelineW, minWidth: '100%' }}>
            {tracks.map((t) => {
              const param = overlayVisible[t.id];
              const lane = param ? t.automation?.find((l) => l.param === param) : undefined;
              return (
                <div key={t.id}>
                  <TrackLane trackId={t.id} clips={t.clips} color={t.color} />
                  {param && (
                    <AutomationOverlayLane
                      trackId={t.id}
                      param={param}
                      lane={lane}
                      totalBeats={totalBeats}
                    />
                  )}
                </div>
              );
            })}
            <Playhead
              height={
                tracks.reduce((s, t) => s + ROW_H + (overlayVisible[t.id] ? AUTO_LANE_H : 0), 0) + 34
              }
            />
          </div>
        </div>
      </div>
      <AudioClipInspector />
      <EditorTip>
        double-click a lane to add a clip · double-click a clip to edit it · drag to move, drag the right edge to
        resize · shift-click to multi-select · ⌘C / ⌘V / ⌘D / Del · ⌘+wheel to zoom · drag the strip under the
        ruler to set the loop
      </EditorTip>
      <ZoomFloater zoom={zoom} setZoom={setZoom} />
    </div>
    </AutomationOverlayContext.Provider>
    </BeatWidthContext.Provider>
  );
}

/** Floating zoom indicator + buttons over the timeline (bottom-right). */
const ZoomFloater = memo(function ZoomFloater({
  zoom,
  setZoom,
}: {
  zoom: number;
  setZoom: (updater: (z: number) => number) => void;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        right: 12,
        bottom: 28,
        display: 'flex',
        gap: 2,
        background: 'rgba(0,0,0,0.85)',
        border: '1px solid rgba(255,106,0,0.4)',
        padding: 2,
        zIndex: 6,
      }}
    >
      <button
        className="nerv-btn nerv-btn--icon"
        title="Zoom out"
        onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))}
        style={{ minWidth: 24, padding: '2px 6px', fontSize: 11 }}
      >
        −
      </button>
      <button
        className="nerv-btn nerv-btn--icon"
        title="Reset zoom to 1×"
        onClick={() => setZoom(() => 1)}
        style={{ minWidth: 38, padding: '2px 4px', fontSize: 9 }}
      >
        {zoom.toFixed(2)}×
      </button>
      <button
        className="nerv-btn nerv-btn--icon"
        title="Zoom in"
        onClick={() => setZoom((z) => Math.min(4, z * 1.25))}
        style={{ minWidth: 24, padding: '2px 6px', fontSize: 11 }}
      >
        ＋
      </button>
    </div>
  );
});

const Ruler = memo(function Ruler({ beats }: { beats: number }) {
  const BEAT_W = useBeatWidth();
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 5,
        height: 34,
        background: 'linear-gradient(180deg, rgba(255,106,0,0.18), rgba(0,0,0,0.85))',
        borderBottom: '1px solid rgba(255,106,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end' }}>
        {Array.from({ length: beats + 1 }).map((_, i) => {
          const isBar = i % 4 === 0;
          return (
            <div
              key={i}
              style={{
                width: BEAT_W,
                borderLeft: '1px solid rgba(255,106,0,0.4)',
                height: isBar ? 15 : 7,
                alignSelf: 'flex-end',
                position: 'relative',
              }}
            >
              {isBar && (
                <span className="hud-label" style={{ position: 'absolute', top: -14, left: 2, fontSize: 9 }}>
                  {i / 4 + 1}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <LoopLane beats={beats} />
    </div>
  );
});

/** Draggable loop-region strip along the bottom of the ruler. */
const LoopLane = memo(function LoopLane({ beats }: { beats: number }) {
  const BEAT_W = useBeatWidth();
  const loopEnabled = useStore((s) => s.project.loopEnabled);
  const loopStart = useStore((s) => s.project.loopStart);
  const loopEnd = useStore((s) => s.project.loopEnd);
  const setLoop = useStore((s) => s.setLoop);
  const laneRef = useRef<HTMLDivElement>(null);
  const drag = useRef<
    { mode: 'new' | 'move' | 'l' | 'r'; baseStart: number; baseEnd: number; downBeat: number } | null
  >(null);

  function beatAt(clientX: number): number {
    const r = laneRef.current?.getBoundingClientRect();
    if (!r) return 0;
    return Math.max(0, Math.min(beats, Math.round((clientX - r.left) / BEAT_W)));
  }
  function begin(e: React.PointerEvent, mode: 'new' | 'move' | 'l' | 'r') {
    if (mode !== 'new') e.stopPropagation();
    laneRef.current?.setPointerCapture(e.pointerId);
    drag.current = { mode, baseStart: loopStart, baseEnd: loopEnd, downBeat: beatAt(e.clientX) };
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const b = beatAt(e.clientX);
    if (d.mode === 'new') {
      const lo = Math.min(d.downBeat, b);
      const hi = Math.max(d.downBeat, b);
      if (hi > lo) setLoop(true, lo, hi);
    } else if (d.mode === 'move') {
      const len = d.baseEnd - d.baseStart;
      let ns = Math.max(0, Math.min(beats - len, d.baseStart + (b - d.downBeat)));
      setLoop(true, ns, ns + len);
    } else if (d.mode === 'l') {
      setLoop(true, Math.min(b, d.baseEnd - 1), d.baseEnd);
    } else {
      setLoop(true, d.baseStart, Math.max(b, d.baseStart + 1));
    }
  }
  function end(e: React.PointerEvent) {
    drag.current = null;
    laneRef.current?.releasePointerCapture(e.pointerId);
  }

  const x = loopStart * BEAT_W;
  const w = Math.max(2, (loopEnd - loopStart) * BEAT_W);

  return (
    <div
      ref={laneRef}
      onPointerDown={(e) => begin(e, 'new')}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      title="Drag to set the loop region"
      style={{
        position: 'relative',
        height: 13,
        background: 'rgba(0,0,0,0.5)',
        borderTop: '1px solid rgba(255,106,0,0.25)',
        cursor: 'crosshair',
        touchAction: 'none',
      }}
    >
      <div
        onPointerDown={(e) => begin(e, 'move')}
        style={{
          position: 'absolute',
          left: x,
          width: w,
          top: 0,
          bottom: 0,
          background: loopEnabled ? 'rgba(255,106,0,0.4)' : 'rgba(255,106,0,0.12)',
          border: `1px solid ${loopEnabled ? 'var(--nerv-orange)' : 'rgba(255,106,0,0.4)'}`,
          boxShadow: loopEnabled ? '0 0 6px rgba(255,106,0,0.5)' : 'none',
          cursor: 'grab',
          touchAction: 'none',
        }}
      >
        <div
          onPointerDown={(e) => begin(e, 'l')}
          style={{ position: 'absolute', left: -3, top: 0, bottom: 0, width: 8, cursor: 'ew-resize', touchAction: 'none' }}
        />
        <div
          onPointerDown={(e) => begin(e, 'r')}
          style={{ position: 'absolute', right: -3, top: 0, bottom: 0, width: 8, cursor: 'ew-resize', touchAction: 'none' }}
        />
      </div>
    </div>
  );
});

/** Memoized track header — only re-renders when ITS track object changes. */
const TrackHeader = memo(function TrackHeader({ track, compact }: { track: Track; compact: boolean }) {
  const selected = useStore((s) => s.selectedTrackId === track.id);
  const selectTrack = useStore((s) => s.selectTrack);
  const updateTrack = useStore((s) => s.updateTrack);
  const removeTrack = useStore((s) => s.removeTrack);
  const setView = useStore((s) => s.setView);
  const overlay = useAutomationOverlay();
  const overlayActive = !!overlay.visible[track.id];
  const availableParams: AutomationParam[] = (track.automation ?? []).map((l) => l.param);

  return (
    <div
      onClick={() => selectTrack(track.id)}
      style={{
        height: ROW_H,
        padding: '4px 6px',
        borderBottom: '1px solid rgba(255,106,0,0.25)',
        background: selected ? 'rgba(255,106,0,0.12)' : 'transparent',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        cursor: 'pointer',
        contain: 'layout style',
      }}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: track.color }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          className="hud-value"
          style={{
            flex: 1,
            fontSize: 11,
            background: 'transparent',
            border: '1px solid transparent',
            padding: '2px 4px',
            color: 'var(--nerv-orange-bright)',
            minWidth: 0,
          }}
          value={track.name}
          onChange={(e) => updateTrack(track.id, { name: e.target.value })}
          onClick={(e) => e.stopPropagation()}
        />
        {track.kind === 'audio' ? (
          <AudioImportButton trackId={track.id} />
        ) : (
          <button
            className="nerv-btn nerv-btn--icon"
            onClick={(e) => {
              e.stopPropagation();
              selectTrack(track.id);
              setView(track.kind === 'drum' ? 'sequencer' : 'pianoroll');
            }}
            title={track.kind === 'drum' ? 'Edit pattern' : 'Edit notes'}
          >
            ✎
          </button>
        )}
        <button
          className={`nerv-btn nerv-btn--icon ${overlayActive ? 'is-active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            if (availableParams.length === 0) {
              selectTrack(track.id);
              useStore.getState().setView('automation');
              return;
            }
            overlay.toggle(track.id, availableParams);
          }}
          title={
            availableParams.length === 0
              ? 'No automation lanes — opens AUTOMATION tab'
              : overlayActive
                ? 'Hide automation lane'
                : 'Show automation lane'
          }
        >
          A
        </button>
        <button
          className="nerv-btn nerv-btn--icon"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Delete track "${track.name}"?`)) removeTrack(track.id);
          }}
          title="Delete track"
        >
          ✕
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 'auto' }}>
        <button
          className={`nerv-btn nerv-btn--icon ${track.mute ? 'is-active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            updateTrack(track.id, { mute: !track.mute });
          }}
          style={{ minWidth: 28, padding: '4px 6px', fontSize: 9 }}
        >
          M
        </button>
        <button
          className={`nerv-btn nerv-btn--green nerv-btn--icon ${track.solo ? 'is-active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            updateTrack(track.id, { solo: !track.solo });
          }}
          style={{ minWidth: 28, padding: '4px 6px', fontSize: 9 }}
        >
          S
        </button>
        <button
          className={`nerv-btn nerv-btn--rec nerv-btn--icon ${track.arm ? 'is-active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            updateTrack(track.id, { arm: !track.arm });
          }}
          style={{ minWidth: 28, padding: '4px 6px', fontSize: 9 }}
          title={
            track.kind === 'synth'
              ? 'Arm — route MIDI input here and record while transport rolls'
              : track.kind === 'audio'
                ? 'Arm — receive mic recording'
                : 'Arm'
          }
        >
          ●
        </button>
        <input
          type="range"
          className="nerv-slider"
          min={-48}
          max={6}
          step={0.5}
          value={track.volume}
          onChange={(e) => updateTrack(track.id, { volume: parseFloat(e.target.value) })}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          style={{ flex: 1, height: 6 }}
        />
        {!compact && (
          <span className="hud-readout" style={{ fontSize: 8, width: 28, textAlign: 'right' }}>
            {track.volume.toFixed(0)}
          </span>
        )}
      </div>
    </div>
  );
});

/**
 * Memoized lane — re-renders only when this track's clip list / colour
 * changes, NOT when the track's mute/volume/synth params change.
 */
const TrackLane = memo(function TrackLane({
  trackId,
  clips,
  color,
}: {
  trackId: string;
  clips: Clip[];
  color: string;
}) {
  const BEAT_W = useBeatWidth();
  const addClip = useStore((s) => s.addClip);
  const selectTrack = useStore((s) => s.selectTrack);

  return (
    <div
      style={{
        position: 'relative',
        height: ROW_H,
        borderBottom: '1px solid rgba(255,106,0,0.18)',
        background: `linear-gradient(180deg, ${color}10, transparent)`,
        contain: 'layout style',
      }}
      onDoubleClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const beat = Math.max(0, Math.floor((e.clientX - r.left) / BEAT_W));
        selectTrack(trackId);
        addClip(trackId, beat, 4);
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'linear-gradient(90deg, rgba(255,106,0,0.18) 1px, transparent 1px)',
          backgroundSize: `${BEAT_W * 4}px 100%`,
          pointerEvents: 'none',
        }}
      />
      {clips.map((c) => (
        <ClipBlock key={c.id} clip={c} color={color} />
      ))}
    </div>
  );
});

/**
 * AutomationOverlayHeader — left-column counterpart to AutomationOverlayLane.
 * Lives directly under the track's main header row so the heights stay
 * aligned with the timeline column. Lets the user switch which param this
 * track's overlay shows.
 */
function AutomationOverlayHeader({
  track,
  param,
  hasLane,
  compact,
}: {
  track: Track;
  param: AutomationParam;
  hasLane: boolean;
  compact: boolean;
}) {
  const overlay = useAutomationOverlay();
  const setView = useStore((s) => s.setView);
  const selectTrack = useStore((s) => s.selectTrack);
  const params: AutomationParam[] = (track.automation ?? []).map((l) => l.param);
  return (
    <div
      style={{
        height: AUTO_LANE_H,
        padding: '2px 6px 4px',
        background: 'rgba(0,0,0,0.55)',
        borderBottom: '1px solid rgba(255,106,0,0.25)',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        justifyContent: 'center',
      }}
    >
      <span className="hud-readout--dim hud-readout" style={{ fontSize: 9, letterSpacing: 1 }}>
        AUTO {hasLane ? '●' : '○'}
      </span>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <select
          className="display"
          value={param}
          onChange={(e) => overlay.setParam(track.id, e.target.value as AutomationParam)}
          style={{ flex: 1, fontSize: 9, minWidth: 0 }}
        >
          {params.map((p) => (
            <option key={p} value={p}>
              {AUTOMATION_PARAM_META[p].label}
            </option>
          ))}
        </select>
        {!compact && (
          <button
            className="nerv-btn nerv-btn--icon"
            onClick={(e) => {
              e.stopPropagation();
              selectTrack(track.id);
              setView('automation');
            }}
            title="Open AUTOMATION tab for this track"
            style={{ minWidth: 0, padding: '2px 4px', fontSize: 9 }}
          >
            ⇲
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * AutomationOverlayLane — timeline-aligned strip showing the selected
 * param's curve for this track. Click empty space to drop a point, drag
 * to move a point, double-click to delete. Same data + scheduling path
 * as the AUTOMATION tab; this is purely a placement convenience so the
 * user doesn't have to context-switch while arranging.
 *
 * Curve rendering mirrors `LaneEditor`: linear → straight, step/hold →
 * right-angle, exponential → quadratic bezier.
 */
function AutomationOverlayLane({
  trackId,
  param,
  lane,
  totalBeats,
}: {
  trackId: string;
  param: AutomationParam;
  lane: AutomationLane | undefined;
  totalBeats: number;
}) {
  const BEAT_W = useBeatWidth();
  const addAutomationPoint = useStore((s) => s.addAutomationPoint);
  const updateAutomationPoint = useStore((s) => s.updateAutomationPoint);
  const removeAutomationPoint = useStore((s) => s.removeAutomationPoint);
  const meta = AUTOMATION_PARAM_META[param];
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<string | null>(null);

  const width = Math.max(1, totalBeats * BEAT_W);

  function clientToData(clientX: number, clientY: number): { beat: number; value: number } | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    const beat = Math.max(0, Math.min(totalBeats, (x / r.width) * totalBeats));
    const t = 1 - y / r.height;
    const value = meta.min + Math.max(0, Math.min(1, t)) * (meta.max - meta.min);
    return { beat, value };
  }

  function background(e: React.PointerEvent<SVGSVGElement>) {
    if (e.target !== e.currentTarget) return;
    const d = clientToData(e.clientX, e.clientY);
    if (!d) return;
    addAutomationPoint(trackId, param, d.beat, d.value);
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
    updateAutomationPoint(trackId, param, dragging.current, d);
  }
  function pointUp() {
    dragging.current = null;
  }

  const xFor = (beat: number) => (beat / totalBeats) * 100;
  const yFor = (value: number) => {
    const t = (value - meta.min) / (meta.max - meta.min);
    return (1 - Math.max(0, Math.min(1, t))) * 100;
  };

  const sorted = [...(lane?.points ?? [])].sort((a, b) => a.beat - b.beat);
  const pathD = (() => {
    if (sorted.length === 0) return '';
    const segs: string[] = [`M ${xFor(sorted[0].beat)} ${yFor(sorted[0].value)}`];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const pt = sorted[i];
      const x1 = xFor(pt.beat);
      const y0 = yFor(prev.value);
      const y1 = yFor(pt.value);
      const curve: AutomationCurve = pt.curve ?? 'linear';
      if (curve === 'step' || curve === 'hold') {
        segs.push(`L ${x1} ${y0}`, `L ${x1} ${y1}`);
      } else if (curve === 'exponential') {
        segs.push(`Q ${x1} ${y0} ${x1} ${y1}`);
      } else {
        segs.push(`L ${x1} ${y1}`);
      }
    }
    return segs.join(' ');
  })();

  return (
    <div
      style={{
        position: 'relative',
        height: AUTO_LANE_H,
        width,
        borderBottom: '1px solid rgba(255,106,0,0.18)',
        background: 'rgba(0,0,0,0.35)',
        contain: 'layout style',
      }}
    >
      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        width="100%"
        height={AUTO_LANE_H}
        onPointerDown={background}
        onPointerMove={pointMove}
        onPointerUp={pointUp}
        onPointerCancel={pointUp}
        style={{ display: 'block', cursor: 'crosshair', touchAction: 'none' }}
      >
        <line x1={0} y1={50} x2={100} y2={50} stroke="rgba(255,106,0,0.15)" strokeWidth={0.2} strokeDasharray="1 1" />
        {sorted.length > 1 && (
          <path d={pathD} fill="none" stroke="var(--nerv-orange-bright)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
        )}
        {sorted.map((pt) => (
          <circle
            key={pt.id}
            cx={xFor(pt.beat)}
            cy={yFor(pt.value)}
            r={1.8}
            fill="var(--nerv-orange-bright)"
            stroke="#000"
            strokeWidth={0.3}
            vectorEffect="non-scaling-stroke"
            style={{ cursor: 'grab', touchAction: 'none' }}
            onPointerDown={(e) => pointDown(e, pt.id)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              removeAutomationPoint(trackId, param, pt.id);
            }}
          />
        ))}
      </svg>
    </div>
  );
}

/** Memoized clip. Drag/resize happens via direct DOM mutation — zero React renders mid-drag. */
const ClipBlock = memo(function ClipBlock({ clip, color }: { clip: Clip; color: string }) {
  const BEAT_W = useBeatWidth();
  const selected = useStore((s) => s.selectedClipIds.includes(clip.id));
  const selectClip = useStore((s) => s.selectClip);
  const toggleClipSelected = useStore((s) => s.toggleClipSelected);
  const selectTrack = useStore((s) => s.selectTrack);
  const setView = useStore((s) => s.setView);
  const moveClip = useStore((s) => s.moveClip);
  const moveClipsBy = useStore((s) => s.moveClipsBy);
  const resizeClip = useStore((s) => s.resizeClip);
  const removeClip = useStore((s) => s.removeClip);

  const elRef = useRef<HTMLDivElement>(null);
  /** During a multi-clip drag we translate every selected clip's DOM node. */
  const drag = useRef<
    | {
        mode: 'move' | 'resize';
        startX: number;
        baseStart: number;
        baseLen: number;
        groupIds: string[] | null;
        groupEls: HTMLElement[];
      }
    | null
  >(null);

  function down(e: React.PointerEvent, mode: 'move' | 'resize') {
    e.stopPropagation();
    if (e.shiftKey && mode === 'move') {
      toggleClipSelected(clip.id);
      return;
    }
    // pick up an existing multi-selection if this clip is part of it, else
    // narrow to just this clip
    const cur = useStore.getState().selectedClipIds;
    const inGroup = cur.includes(clip.id) && cur.length > 1;
    if (!inGroup) selectClip(clip.id);
    const groupIds = inGroup && mode === 'move' ? cur : null;
    const groupEls: HTMLElement[] = groupIds
      ? groupIds
          .map((id) => document.querySelector<HTMLElement>(`[data-clip-id="${id}"]`))
          .filter((el): el is HTMLElement => !!el)
      : [];
    elRef.current?.setPointerCapture(e.pointerId);
    drag.current = {
      mode,
      startX: e.clientX,
      baseStart: clip.start,
      baseLen: clip.length,
      groupIds,
      groupEls,
    };
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    const el = elRef.current;
    if (!d || !el) return;
    const dBeats = Math.round((e.clientX - d.startX) / BEAT_W);
    if (d.mode === 'move') {
      if (d.groupIds) {
        // group drag — translate every selected clip's DOM element together
        const tx = `translateX(${dBeats * BEAT_W}px)`;
        d.groupEls.forEach((g) => (g.style.transform = tx));
      } else {
        el.style.left = `${Math.max(0, d.baseStart + dBeats) * BEAT_W}px`;
      }
    } else {
      el.style.width = `${Math.max(0.5, d.baseLen + dBeats) * BEAT_W - 2}px`;
    }
  }
  function up(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dBeats = Math.round((e.clientX - d.startX) / BEAT_W);
    if (d.mode === 'move') {
      if (d.groupIds && dBeats !== 0) {
        d.groupEls.forEach((g) => (g.style.transform = ''));
        moveClipsBy(d.groupIds, dBeats);
      } else if (d.groupIds) {
        d.groupEls.forEach((g) => (g.style.transform = ''));
      } else {
        moveClip(clip.id, Math.max(0, d.baseStart + dBeats));
      }
    } else {
      resizeClip(clip.id, Math.max(0.5, d.baseLen + dBeats));
    }
    drag.current = null;
    elRef.current?.releasePointerCapture(e.pointerId);
  }

  return (
    <div
      ref={elRef}
      data-clip-id={clip.id}
      onPointerDown={(e) => down(e, 'move')}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={(e) => {
        e.stopPropagation();
        selectTrack(clip.trackId);
        setView(clip.kind === 'pattern' ? 'sequencer' : clip.kind === 'midi' ? 'pianoroll' : 'arrange');
      }}
      style={{
        position: 'absolute',
        top: 4,
        left: clip.start * BEAT_W,
        width: clip.length * BEAT_W - 2,
        height: ROW_H - 8,
        background: `linear-gradient(180deg, ${color}66, ${color}22)`,
        border: `1px solid ${selected ? '#fff' : color}`,
        clipPath: 'polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)',
        cursor: 'grab',
        boxShadow: selected ? `0 0 12px ${color}` : 'none',
        overflow: 'hidden',
        userSelect: 'none',
        touchAction: 'none',
        contain: 'layout style paint',
      }}
    >
      <div
        className="hud-label"
        style={{
          position: 'absolute',
          top: 4,
          left: 8,
          fontSize: 8,
          letterSpacing: '0.2em',
          color: '#fff',
          textShadow: '0 0 4px #000',
        }}
      >
        {clip.name ?? clip.kind.toUpperCase()}
      </div>
      <ClipPreview clip={clip} />
      <button
        className="nerv-btn nerv-btn--icon"
        onClick={(e) => {
          e.stopPropagation();
          removeClip(clip.id);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        style={{ position: 'absolute', top: 2, right: 2, minWidth: 0, padding: '2px 4px', fontSize: 9 }}
      >
        ✕
      </button>
      <div
        onPointerDown={(e) => down(e, 'resize')}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 10,
          cursor: 'ew-resize',
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2))',
          touchAction: 'none',
        }}
      />
    </div>
  );
});

const ClipPreview = memo(function ClipPreview({ clip }: { clip: Clip }) {
  const BEAT_W = useBeatWidth();
  if (clip.kind === 'midi') {
    if (clip.notes.length === 0) return null;
    const lo = Math.min(...clip.notes.map((n) => n.pitch));
    const hi = Math.max(...clip.notes.map((n) => n.pitch));
    const range = Math.max(1, hi - lo);
    return (
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${clip.length * BEAT_W} ${ROW_H - 8}`}
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, opacity: 0.85 }}
      >
        {clip.notes.map((n) => {
          const y = ((hi - n.pitch) / range) * (ROW_H - 18) + 14;
          return (
            <rect
              key={n.id}
              x={n.start * BEAT_W}
              y={y}
              width={Math.max(2, n.length * BEAT_W)}
              height={3}
              fill="#fff"
              opacity={0.7}
            />
          );
        })}
      </svg>
    );
  }
  if (clip.kind === 'audio') {
    return <AudioWaveform sampleId={clip.sampleId} width={clip.length * BEAT_W} />;
  }
  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${clip.pattern.length} 8`}
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, opacity: 0.7 }}
    >
      {Object.entries(clip.pattern.steps).map(([pad, steps], ri) =>
        steps.map((s, i) =>
          s.on ? <rect key={`${pad}${i}`} x={i + 0.05} y={ri + 0.05} width={0.9} height={0.9} fill="#fff" /> : null,
        ),
      )}
    </svg>
  );
});

function AudioWaveform({ sampleId, width }: { sampleId: string; width: number }) {
  const buffer = audioEngine.getSample(sampleId);
  if (!buffer) {
    return (
      <div
        className="hud-readout--dim hud-readout"
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 8,
        }}
      >
        SAMPLE NOT LOADED
      </div>
    );
  }
  const data = buffer.getChannelData(0);
  const cols = Math.max(8, Math.min(400, Math.floor(width)));
  const block = Math.floor(data.length / cols) || 1;
  const peaks: number[] = [];
  for (let i = 0; i < cols; i++) {
    let max = 0;
    for (let j = 0; j < block; j++) {
      const v = Math.abs(data[i * block + j] ?? 0);
      if (v > max) max = v;
    }
    peaks.push(max);
  }
  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${cols} 100`}
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, opacity: 0.85 }}
    >
      {peaks.map((p, i) => (
        <rect key={i} x={i} y={50 - p * 48} width={0.9} height={Math.max(0.5, p * 96)} fill="#fff" />
      ))}
    </svg>
  );
}

function AudioImportButton({ trackId }: { trackId: string }) {
  const addAudioClip = useStore((s) => s.addAudioClip);
  return (
    <label
      className="nerv-btn nerv-btn--icon"
      title="Import audio file"
      onClick={(e) => e.stopPropagation()}
      style={{ cursor: 'pointer' }}
    >
      ⬆
      <input
        type="file"
        accept="audio/*"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            const { id, duration } = await importSample(file);
            addAudioClip(trackId, 0, id, duration, file.name.slice(0, 14).toUpperCase());
          } catch (err) {
            console.error(err);
            alert('Could not decode that audio file.');
          }
          e.target.value = '';
        }}
      />
    </label>
  );
}

/** Leaf — the only thing that re-renders as the playhead moves. */
const Playhead = memo(function Playhead({ height }: { height: number }) {
  const BEAT_W = useBeatWidth();
  const positionBeats = usePlayhead();
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: 2,
        height,
        background: 'var(--nerv-green)',
        boxShadow: '0 0 6px var(--nerv-green)',
        pointerEvents: 'none',
        zIndex: 10,
        transform: `translateX(${positionBeats * BEAT_W}px)`,
        willChange: 'transform',
      }}
    />
  );
});

/**
 * AudioClipInspector — appears under the timeline when the primary selected
 * clip is an audio clip. Exposes warp toggle, source BPM, and gain so the
 * user can fix tempo drift on imported / recorded audio. Hidden otherwise.
 */
const AudioClipInspector = memo(function AudioClipInspector() {
  const selectedId = useStore((s) => s.selectedClipIds[0] ?? null);
  const tracks = useStore((s) => s.project.tracks);
  const projectBpm = useStore((s) => s.project.bpm);
  const updateAudioClip = useStore((s) => s.updateAudioClip);

  const found = selectedId
    ? tracks
        .map((t) => t.clips.find((c) => c.id === selectedId && c.kind === 'audio'))
        .find((c): c is Extract<Clip, { kind: 'audio' }> => !!c)
    : undefined;
  if (!found) return null;

  const src = found.sourceBpm ?? projectBpm;
  const warp = found.warp !== false;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '4px 12px',
        borderTop: '1px solid rgba(255,106,0,0.25)',
        background: 'rgba(0,0,0,0.55)',
        flexWrap: 'wrap',
      }}
    >
      <span className="hud-label">CLIP // {found.name ?? found.kind.toUpperCase()}</span>
      <button
        className={`nerv-btn ${warp ? 'is-active' : ''}`}
        onClick={() => updateAudioClip(found.id, { warp: !warp })}
        aria-pressed={warp}
        title="Warp playback rate to follow project tempo"
      >
        ⇄ WARP
      </button>
      <span className="hud-readout">SRC BPM</span>
      <input
        type="number"
        className="display"
        min={30}
        max={300}
        step={0.5}
        value={src}
        onChange={(e) => updateAudioClip(found.id, { sourceBpm: parseFloat(e.target.value || '120') })}
        style={{ width: 70, padding: 3 }}
      />
      <span className="hud-readout">GAIN</span>
      <input
        type="range"
        className="nerv-slider"
        min={0}
        max={2}
        step={0.01}
        value={found.gain}
        onChange={(e) => updateAudioClip(found.id, { gain: parseFloat(e.target.value) })}
        style={{ width: 100 }}
      />
      <span className="hud-readout--dim hud-readout" style={{ fontSize: 9 }}>
        ×{(warp ? projectBpm / src : 1).toFixed(2)}
      </span>
    </div>
  );
});
