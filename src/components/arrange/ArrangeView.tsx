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
/** Plain-language name for a track kind, shown as a badge so the codename isn't the only label. */
const TRACK_KIND_LABEL: Record<Track['kind'], string> = {
  drum: 'DRUMS',
  synth: 'SYNTH',
  sampler: 'SAMPLER',
  audio: 'AUDIO',
};
/** Default px per beat at zoom = 1×. Consumers read the current value through BeatWidthContext. */
const BASE_BEAT_W = 24;
const BeatWidthContext = createContext(BASE_BEAT_W);
const useBeatWidth = () => useContext(BeatWidthContext);

/**
 * Active snap grid for the timeline, in BEATS. 0 means "free" — we still
 * round to a fine 1/16-beat so drags feel controlled without locking to the
 * grid. Provided by ArrangeView and consumed by every lane / clip / loop
 * drag handler so placement always matches the grid the toolbar advertises.
 */
const SnapContext = createContext(1);
const useSnap = () => useContext(SnapContext);
type SnapMode = 'bar' | 'beat' | 'half' | 'off';
/** Resolve a snap mode to a beat grid given the project's beats-per-bar. */
function snapBeatsFor(mode: SnapMode, numerator: number): number {
  return mode === 'bar' ? numerator : mode === 'beat' ? 1 : mode === 'half' ? 0.5 : 0;
}
/** Round a beat position/length onto the active snap grid. */
function snapTo(beats: number, snap: number): number {
  const g = snap > 0 ? snap : 0.0625;
  return Math.round(beats / g) * g;
}

/**
 * AutomationOverlayContext — transient per-track UI state for the arrange
 * automation overlay. `visible[trackId] === true` shows every automation
 * lane the track owns, stacked under its clip row. Not persisted — it's a
 * view toggle, not a property of the project.
 */
type AutomationOverlayState = {
  visible: Record<string, boolean>;
  toggle(trackId: string): void;
};
const AutomationOverlayContext = createContext<AutomationOverlayState>({
  visible: {},
  toggle: () => {},
});
const useAutomationOverlay = () => useContext(AutomationOverlayContext);

export function ArrangeView() {
  const tracks = useStore((s) => s.project.tracks);
  const totalBeats = useStore((s) => s.project.lengthBars * s.project.numerator);
  const addTrack = useStore((s) => s.addTrack);
  const isMobile = useIsMobile();
  const headW = isMobile ? 144 : 196;

  const [zoom, setZoom] = useState(1);
  const numerator = useStore((s) => s.project.numerator || 4);
  const [snapMode, setSnapMode] = useState<SnapMode>('bar');
  const snapBeats = snapBeatsFor(snapMode, numerator);
  const beatW = BASE_BEAT_W * zoom;
  const timelineW = totalBeats * beatW;
  const scrollRef = useRef<HTMLDivElement>(null);

  const [overlayVisible, setOverlayVisible] = useState<Record<string, boolean>>({});
  const overlayCtx: AutomationOverlayState = useMemo(
    () => ({
      visible: overlayVisible,
      toggle: (trackId) => {
        setOverlayVisible((cur) => {
          const next = { ...cur };
          if (next[trackId]) delete next[trackId];
          else next[trackId] = true;
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
    <SnapContext.Provider value={snapBeats}>
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
                className="hud-btn hud-btn--icon"
                onClick={() => addTrack('synth')}
                title="Add synth track"
                style={{ minWidth: 0, padding: '4px 5px', fontSize: 9 }}
              >
                {isMobile ? '+SYN' : '+ SYNTH'}
              </button>
              <button
                className="hud-btn hud-btn--icon"
                onClick={() => addTrack('drum')}
                title="Add drum track"
                style={{ minWidth: 0, padding: '4px 5px', fontSize: 9 }}
              >
                {isMobile ? '+DRM' : '+ DRUMS'}
              </button>
              <button
                className="hud-btn hud-btn--icon"
                onClick={() => addTrack('audio')}
                title="Add audio track"
                style={{ minWidth: 0, padding: '4px 5px', fontSize: 9 }}
              >
                {isMobile ? '+AUD' : '+ AUDIO'}
              </button>
            </div>
          </div>
          <div style={{ overflow: 'auto', flex: 1 }}>
            {tracks.map((t) => {
              const lanes = overlayVisible[t.id] ? t.automation ?? [] : [];
              return (
                <div key={t.id}>
                  <TrackHeader track={t} compact={isMobile} />
                  {lanes.map((lane) => (
                    <AutomationOverlayHeader
                      key={lane.param}
                      track={t}
                      param={lane.param}
                      compact={isMobile}
                    />
                  ))}
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
              const lanes = overlayVisible[t.id] ? t.automation ?? [] : [];
              return (
                <div key={t.id}>
                  <TrackLane trackId={t.id} clips={t.clips} color={t.color} />
                  {lanes.map((lane) => (
                    <AutomationOverlayLane
                      key={lane.param}
                      trackId={t.id}
                      param={lane.param}
                      lane={lane}
                      totalBeats={totalBeats}
                    />
                  ))}
                </div>
              );
            })}
            <Playhead
              height={
                tracks.reduce(
                  (s, t) =>
                    s + ROW_H + (overlayVisible[t.id] ? (t.automation?.length ?? 0) * AUTO_LANE_H : 0),
                  0,
                ) + 34
              }
            />
          </div>
        </div>
      </div>
      <AudioClipInspector />
      <EditorTip>
        drag across an empty lane to draw a clip (or double-click for one bar) · double-click a clip to edit it ·
        drag to move, drag the right edge to resize · SNAP sets the grid · shift-click to multi-select · ⌘C / ⌘V /
        ⌘D / Del · ⌘+wheel to zoom · drag the strip under the ruler to set the loop
      </EditorTip>
      <ZoomFloater zoom={zoom} setZoom={setZoom} snapMode={snapMode} setSnapMode={setSnapMode} />
    </div>
    </AutomationOverlayContext.Provider>
    </SnapContext.Provider>
    </BeatWidthContext.Provider>
  );
}

/** Floating snap + zoom controls over the timeline (bottom-right). */
const ZoomFloater = memo(function ZoomFloater({
  zoom,
  setZoom,
  snapMode,
  setSnapMode,
}: {
  zoom: number;
  setZoom: (updater: (z: number) => number) => void;
  snapMode: SnapMode;
  setSnapMode: (m: SnapMode) => void;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        right: 12,
        bottom: 28,
        display: 'flex',
        gap: 4,
        alignItems: 'center',
        background: 'rgba(0,0,0,0.85)',
        border: '1px solid rgba(255,106,0,0.4)',
        padding: 2,
        zIndex: 6,
      }}
    >
      <select
        className="display"
        value={snapMode}
        onChange={(e) => setSnapMode(e.target.value as SnapMode)}
        title="Snap grid — clip moves, resizes and new clips lock to this"
        style={{ fontSize: 9, minHeight: 24, padding: '2px 4px' }}
      >
        <option value="bar">SNAP·BAR</option>
        <option value="beat">SNAP·BEAT</option>
        <option value="half">SNAP·½</option>
        <option value="off">SNAP·OFF</option>
      </select>
      <button
        className="hud-btn hud-btn--icon"
        title="Zoom out"
        onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))}
        style={{ minWidth: 24, padding: '2px 6px', fontSize: 11 }}
      >
        −
      </button>
      <button
        className="hud-btn hud-btn--icon"
        title="Reset zoom to 1×"
        onClick={() => setZoom(() => 1)}
        style={{ minWidth: 38, padding: '2px 4px', fontSize: 9 }}
      >
        {zoom.toFixed(2)}×
      </button>
      <button
        className="hud-btn hud-btn--icon"
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
  const numerator = useStore((s) => s.project.numerator || 4);
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 5,
        height: 34,
        // span the full timeline, not just the viewport — otherwise the
        // flex tick cells shrink to fit and drift out of alignment with
        // the clips below, and the loop strip is undraggable when scrolled
        width: (beats + 1) * BEAT_W,
        minWidth: '100%',
        background: 'linear-gradient(180deg, rgba(255,106,0,0.18), rgba(0,0,0,0.85))',
        borderBottom: '1px solid rgba(255,106,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end' }}>
        {Array.from({ length: beats + 1 }).map((_, i) => {
          const isBar = i % numerator === 0;
          return (
            <div
              key={i}
              style={{
                width: BEAT_W,
                flexShrink: 0,
                borderLeft: '1px solid rgba(255,106,0,0.4)',
                height: isBar ? 15 : 7,
                alignSelf: 'flex-end',
                position: 'relative',
              }}
            >
              {isBar && (
                <span className="hud-label" style={{ position: 'absolute', top: -14, left: 2, fontSize: 9 }}>
                  {i / numerator + 1}
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
  const snap = useSnap();
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
    // loop edges obey the same snap grid as clips
    return Math.max(0, Math.min(beats, snapTo((clientX - r.left) / BEAT_W, snap)));
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
          border: `1px solid ${loopEnabled ? 'var(--hud-orange)' : 'rgba(255,106,0,0.4)'}`,
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
  const laneCount = track.automation?.length ?? 0;

  return (
    <div
      onClick={() => selectTrack(track.id)}
      style={{
        height: ROW_H,
        padding: '4px 6px',
        borderBottom: '1px solid rgba(255,106,0,0.25)',
        // the selected track lights up in its OWN colour — a consistent
        // "this is the track the editors are acting on" accent
        background: selected ? `linear-gradient(90deg, ${track.color}26, ${track.color}0a)` : 'transparent',
        boxShadow: selected ? `inset 0 0 0 1px ${track.color}99` : 'none',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        cursor: 'pointer',
        contain: 'layout style',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: selected ? 5 : 3,
          background: track.color,
          boxShadow: selected ? `0 0 8px ${track.color}` : 'none',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* The narrow header column can't fit a type badge AND the name, and the
            name (now function-first: "DRUMS // VEGA", "BASS // …") is the better
            plain label — so the kind lives in the tooltip instead. */}
        <input
          className="hud-value"
          title={`${TRACK_KIND_LABEL[track.kind]} track — rename freely`}
          style={{
            flex: 1,
            fontSize: 11,
            background: 'transparent',
            border: '1px solid transparent',
            padding: '2px 4px',
            color: 'var(--hud-orange-bright)',
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
            className="hud-btn hud-btn--icon"
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
          className={`hud-btn hud-btn--icon ${overlayActive ? 'is-active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            if (laneCount === 0) {
              selectTrack(track.id);
              useStore.getState().setView('automation');
              return;
            }
            overlay.toggle(track.id);
          }}
          title={
            laneCount === 0
              ? 'No automation lanes — opens AUTOMATION tab'
              : overlayActive
                ? 'Hide automation lanes'
                : `Show ${laneCount} automation lane${laneCount === 1 ? '' : 's'}`
          }
        >
          A
        </button>
        <button
          className="hud-btn hud-btn--icon"
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
          className={`hud-btn hud-btn--icon ${track.mute ? 'is-active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            updateTrack(track.id, { mute: !track.mute });
          }}
          style={{ minWidth: 28, padding: '4px 6px', fontSize: 9 }}
          title={track.mute ? 'Muted — click to unmute' : 'Mute this track'}
        >
          M
        </button>
        <button
          className={`hud-btn hud-btn--green hud-btn--icon ${track.solo ? 'is-active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            updateTrack(track.id, { solo: !track.solo });
          }}
          style={{ minWidth: 28, padding: '4px 6px', fontSize: 9 }}
          title={track.solo ? 'Soloed — click to clear' : 'Solo — mute all other tracks'}
        >
          S
        </button>
        <button
          className={`hud-btn hud-btn--rec hud-btn--icon ${track.arm ? 'is-active' : ''}`}
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
          className="hud-slider"
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
  const snap = useSnap();
  const addClip = useStore((s) => s.addClip);
  const selectTrack = useStore((s) => s.selectTrack);
  const numerator = useStore((s) => s.project.numerator || 4);
  const laneRef = useRef<HTMLDivElement>(null);
  // drag-to-create: a draft span the user is sweeping out on the empty lane
  const [draft, setDraft] = useState<{ from: number; to: number } | null>(null);
  const drag = useRef<{ from: number; downX: number; moved: boolean; touch: boolean } | null>(null);
  // We detect double-tap ourselves: capturing the pointer on pointerdown (for
  // drag-to-create) suppresses the browser's native dblclick.
  const lastTap = useRef(0);

  // Default new-clip length when the user just clicks/double-clicks: one bar,
  // or the snap grid if that's coarser. Far more musical than a fixed 4 beats.
  const defaultLen = Math.max(snap || 0, numerator);

  function beatAt(clientX: number): number {
    const r = laneRef.current?.getBoundingClientRect();
    if (!r) return 0;
    return Math.max(0, snapTo((clientX - r.left) / BEAT_W, snap));
  }

  function onPointerDown(e: React.PointerEvent) {
    // only the lane background starts a draw — clips/handles stopPropagation
    if (e.target !== e.currentTarget) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const touch = e.pointerType === 'touch';
    // On touch we must NOT capture the pointer or draw a draft — that blocks
    // native timeline scrolling (swipe-to-scroll is essential on a phone). We
    // still record the tap so double-tap-to-create works by finger; mouse
    // gets the full sweep-to-draw with a live preview.
    if (!touch) {
      laneRef.current?.setPointerCapture(e.pointerId);
      setDraft({ from: beatAt(e.clientX), to: beatAt(e.clientX) });
    }
    drag.current = { from: beatAt(e.clientX), downX: e.clientX, moved: false, touch };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.downX) > 6) d.moved = true;
    if (d.touch) return; // let the timeline scroll; no draft on touch
    setDraft({ from: d.from, to: beatAt(e.clientX) });
  }
  function clearDrag(e: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    if (d && !d.touch) {
      setDraft(null);
      try {
        laneRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    const d = drag.current;
    clearDrag(e);
    if (!d) return;
    // mouse sweep → sized clip (touch never drag-creates, so swipes scroll)
    if (!d.touch && d.moved) {
      const to = beatAt(e.clientX);
      const lo = Math.min(d.from, to);
      const hi = Math.max(d.from, to);
      if (hi - lo >= (snap || 0.25) / 2) {
        selectTrack(trackId);
        addClip(trackId, lo, Math.max(snap || 0.25, hi - lo));
        lastTap.current = 0;
      }
      return;
    }
    if (d.moved) return; // a touch scroll, not a tap
    // second tap within 380ms → quick-add one default clip (single stray taps
    // do nothing, so the lane stays clean)
    const now = performance.now();
    if (now - lastTap.current < 380) {
      selectTrack(trackId);
      addClip(trackId, d.from, defaultLen);
      lastTap.current = 0;
    } else {
      lastTap.current = now;
    }
  }

  const draftLo = draft ? Math.min(draft.from, draft.to) : 0;
  const draftW = draft ? Math.abs(draft.to - draft.from) : 0;

  return (
    <div
      ref={laneRef}
      style={{
        position: 'relative',
        height: ROW_H,
        borderBottom: '1px solid rgba(255,106,0,0.18)',
        background: `linear-gradient(180deg, ${color}10, transparent)`,
        contain: 'layout style',
        // no touch-action:none here — the timeline must stay swipe-scrollable
        // on touch; mouse drag-create doesn't need it
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={clearDrag}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'linear-gradient(90deg, rgba(255,106,0,0.18) 1px, transparent 1px)',
          backgroundSize: `${BEAT_W * numerator}px 100%`,
          pointerEvents: 'none',
        }}
      />
      {draft && draftW > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 4,
            height: ROW_H - 8,
            left: draftLo * BEAT_W,
            width: draftW * BEAT_W,
            background: `${color}33`,
            border: `1px dashed ${color}`,
            pointerEvents: 'none',
          }}
        />
      )}
      {clips.map((c) => (
        <ClipBlock key={c.id} clip={c} color={color} />
      ))}
    </div>
  );
});

/**
 * AutomationOverlayHeader — left-column label for one stacked automation
 * lane. Lives directly under the track's main header so heights stay
 * aligned with the timeline column. Click the ⇲ to jump to the full
 * AUTOMATION tab for finer editing.
 */
function AutomationOverlayHeader({
  track,
  param,
  compact,
}: {
  track: Track;
  param: AutomationParam;
  compact: boolean;
}) {
  const setView = useStore((s) => s.setView);
  const selectTrack = useStore((s) => s.selectTrack);
  return (
    <div
      style={{
        height: AUTO_LANE_H,
        padding: '2px 6px 4px',
        background: 'rgba(0,0,0,0.55)',
        borderBottom: '1px solid rgba(255,106,0,0.25)',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <span
        className="hud-readout--dim hud-readout"
        style={{ fontSize: 9, letterSpacing: 1, flex: 1, minWidth: 0 }}
      >
        ▸ {AUTOMATION_PARAM_META[param].label}
      </span>
      {!compact && (
        <button
          className="hud-btn hud-btn--icon"
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
          <path d={pathD} fill="none" stroke="var(--hud-orange-bright)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
        )}
        {sorted.map((pt) => (
          <circle
            key={pt.id}
            cx={xFor(pt.beat)}
            cy={yFor(pt.value)}
            r={1.8}
            fill="var(--hud-orange-bright)"
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
  const snap = useSnap();
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
  // We detect double-tap-to-edit ourselves — capturing the pointer on
  // pointerdown (for drag) suppresses the browser's native dblclick.
  const lastTap = useRef(0);
  /** During a multi-clip drag we translate every selected clip's DOM node. */
  const drag = useRef<
    | {
        mode: 'move' | 'resize';
        startX: number;
        baseStart: number;
        baseLen: number;
        groupIds: string[] | null;
        groupEls: HTMLElement[];
        /** Leftmost start in the group — clamps the drag delta so the preview matches the committed move. */
        groupMinStart: number;
        /** Set once the pointer travels far enough to count as a drag (vs a tap). */
        moved: boolean;
      }
    | null
  >(null);

  function openEditor() {
    selectTrack(clip.trackId);
    setView(clip.kind === 'pattern' ? 'sequencer' : clip.kind === 'midi' ? 'pianoroll' : 'arrange');
  }

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
    const idSet = groupIds ? new Set(groupIds) : null;
    const groupStarts = idSet
      ? useStore
          .getState()
          .project.tracks.flatMap((t) => t.clips.filter((c) => idSet.has(c.id)).map((c) => c.start))
      : [];
    elRef.current?.setPointerCapture(e.pointerId);
    drag.current = {
      mode,
      startX: e.clientX,
      baseStart: clip.start,
      baseLen: clip.length,
      groupIds,
      groupEls,
      groupMinStart: groupStarts.length > 0 ? Math.min(...groupStarts) : 0,
      moved: false,
    };
  }
  const minLen = snap > 0 ? snap : 0.25;
  // Snap the drag DELTA to the grid for moves (clip start is already on-grid,
  // so start+delta stays on-grid); snap the absolute LENGTH for resizes.
  function deltaBeats(clientX: number, startX: number) {
    return snapTo((clientX - startX) / BEAT_W, snap);
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    const el = elRef.current;
    if (!d || !el) return;
    if (Math.abs(e.clientX - d.startX) > 4) d.moved = true;
    if (d.mode === 'move') {
      const dBeats = deltaBeats(e.clientX, d.startX);
      if (d.groupIds) {
        // group drag — translate every selected clip's DOM element together,
        // clamped so the leftmost clip can't preview past beat 0 (the store
        // clamps the committed delta the same way)
        const dG = Math.max(dBeats, -d.groupMinStart);
        const tx = `translateX(${dG * BEAT_W}px)`;
        d.groupEls.forEach((g) => (g.style.transform = tx));
      } else {
        el.style.left = `${Math.max(0, d.baseStart + dBeats) * BEAT_W}px`;
      }
    } else {
      const len = Math.max(minLen, snapTo(d.baseLen + (e.clientX - d.startX) / BEAT_W, snap));
      el.style.width = `${len * BEAT_W - 2}px`;
    }
  }
  function up(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    // a tap (no real drag) on the clip body: second tap within 380ms opens
    // the editor — replacing the native dblclick that pointer capture eats
    if (d.mode === 'move' && !d.moved) {
      const now = performance.now();
      if (now - lastTap.current < 380) {
        openEditor();
        lastTap.current = 0;
      } else {
        lastTap.current = now;
      }
      drag.current = null;
      elRef.current?.releasePointerCapture(e.pointerId);
      return;
    }
    if (d.mode === 'move') {
      const dBeats = deltaBeats(e.clientX, d.startX);
      if (d.groupIds && dBeats !== 0) {
        d.groupEls.forEach((g) => (g.style.transform = ''));
        moveClipsBy(d.groupIds, Math.max(dBeats, -d.groupMinStart));
      } else if (d.groupIds) {
        d.groupEls.forEach((g) => (g.style.transform = ''));
      } else {
        moveClip(clip.id, Math.max(0, d.baseStart + dBeats));
      }
    } else {
      resizeClip(clip.id, Math.max(minLen, snapTo(d.baseLen + (e.clientX - d.startX) / BEAT_W, snap)));
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
        className="hud-btn hud-btn--icon"
        onClick={(e) => {
          e.stopPropagation();
          removeClip(clip.id);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        title="Delete clip"
        style={{ position: 'absolute', top: 2, right: 2, minWidth: 0, padding: '1px 4px', fontSize: 9, zIndex: 3, lineHeight: 1 }}
      >
        ✕
      </button>
      {/* Resize handle starts BELOW the ✕ so the two no longer fight for the
          same top-right corner (you'd hit delete while trying to resize). */}
      <div
        onPointerDown={(e) => down(e, 'resize')}
        title="Drag to resize"
        style={{
          position: 'absolute',
          right: 0,
          top: 20,
          bottom: 0,
          width: 14,
          cursor: 'ew-resize',
          // visible grip so the edge reads as draggable
          background:
            'linear-gradient(90deg, transparent, rgba(255,255,255,0.18)), repeating-linear-gradient(90deg, transparent 0 3px, rgba(255,255,255,0.5) 3px 4px)',
          backgroundPosition: 'right',
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
      className="hud-btn hud-btn--icon"
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
        background: 'var(--hud-green)',
        boxShadow: '0 0 6px var(--hud-green)',
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
        className={`hud-btn ${warp ? 'is-active' : ''}`}
        onClick={() => updateAudioClip(found.id, { warp: !warp })}
        aria-pressed={warp}
        title="Warp playback rate to follow project tempo"
      >
        ⇄ WARP
      </button>
      <span className="hud-readout">MODE</span>
      <button
        className={`hud-btn ${(found.stretchMode ?? 'pitch') === 'pitch' ? 'is-active' : ''}`}
        onClick={() => updateAudioClip(found.id, { stretchMode: 'pitch' })}
        title="Varispeed — pitch follows tempo (cheap, instant)"
        disabled={!warp}
      >
        PITCH
      </button>
      <button
        className={`hud-btn ${found.stretchMode === 'time' ? 'is-active' : ''}`}
        onClick={() => updateAudioClip(found.id, { stretchMode: 'time' })}
        title="Granular time-stretch — pitch preserved across tempo changes (Tone.GrainPlayer)"
        disabled={!warp}
      >
        TIME
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
        className="hud-slider"
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
