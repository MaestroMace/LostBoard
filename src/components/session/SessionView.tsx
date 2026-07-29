import { memo, useMemo } from 'react';
import { shallow } from 'zustand/shallow';
import { useStore, defaultScenes } from '../../state/store';
import type { Clip, Track } from '../../audio/types';
import { audioEngine } from '../../audio/engine';
import { EditorTip } from '../hud/EditorTip';
import { useIsMobile } from '../../hooks/useLayoutMode';

const COL_W = 110;
const ROW_H = 44;
const HEAD_COL_W = 132;

/**
 * SessionView — Ableton-style scenes × tracks launcher grid.
 *
 * Each track row has an empty/assigned slot per scene. Tapping a slot launches
 * that clip in a transport-relative loop on that track and overrides the
 * arrangement scheduling until the user goes back to "ARRANGEMENT" mode.
 *
 * The "session clips" themselves are just references to existing clips in the
 * track's `clips` array — no separate data model. Reuse + edits flow back
 * through the same store actions as the Arrange view.
 */
export function SessionView() {
  const tracks = useStore((s) => s.project.tracks);
  const scenes = useStore((s) => s.project.scenes ?? defaultScenes(), shallow);
  const sessionMode = useStore((s) => s.sessionMode);
  const setSessionMode = useStore((s) => s.setSessionMode);
  const stopAllSessionClips = useStore((s) => s.stopAllSessionClips);
  const launchScene = useStore((s) => s.launchScene);
  const addScene = useStore((s) => s.addScene);
  const removeScene = useStore((s) => s.removeScene);

  return (
    <div
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', contain: 'layout style' }}
      className="hex-grid-bg"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          borderBottom: '1px solid rgba(255,106,0,0.4)',
          flexWrap: 'wrap',
        }}
      >
        {/* One control that states what is playing, rather than two buttons
            whose relationship you had to infer from which was highlighted. */}
        <span className="hud-readout" style={{ textTransform: 'none' }}>
          Playing:
        </span>
        <button
          className={`hud-btn ${!sessionMode ? 'is-active' : ''}`}
          onClick={() => setSessionMode(false)}
          aria-pressed={!sessionMode}
          title="Play the timeline from the Song tab"
        >
          Timeline
        </button>
        <button
          className={`hud-btn ${sessionMode ? 'is-active' : ''}`}
          onClick={() => setSessionMode(true)}
          aria-pressed={sessionMode}
          title="Play the loops launched below instead of the timeline"
        >
          These loops
        </button>
        <button
          className="hud-btn hud-btn--ghost"
          onClick={() => {
            stopAllSessionClips();
            audioEngine.stopAllSessionClips();
          }}
          title="Stop every track's loop"
        >
          ■ Stop all
        </button>
        <div style={{ flex: 1 }} />
        <button className="hud-btn" onClick={addScene} title="Add another scene column">
          + Scene
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        <div style={{ display: 'inline-block', minWidth: '100%' }}>
          {/* Scene header row */}
          <div style={{ display: 'flex', gap: 4 }}>
            <div style={{ width: HEAD_COL_W, flexShrink: 0 }} />
            {scenes.map((scene, i) => (
              <SceneHeader
                key={i}
                index={i}
                name={scene.name}
                onLaunch={() => launchScene(i)}
                onRemove={() => removeScene(i)}
              />
            ))}
          </div>

          {/* Track rows */}
          {tracks.map((t) => (
            <TrackRow key={t.id} track={t} sceneCount={scenes.length} />
          ))}
        </div>
      </div>

      <EditorTip>
        Tap a slot to start that loop. Tap ▶ above a column to start the whole column at once. Use the dropdown in a
        slot to choose which clip it holds. &ldquo;Timeline&rdquo; at the top goes back to playing the song as arranged.
      </EditorTip>
    </div>
  );
}

const SceneHeader = memo(function SceneHeader({
  index,
  name,
  onLaunch,
  onRemove,
}: {
  index: number;
  name: string;
  onLaunch: () => void;
  onRemove: () => void;
}) {
  const setSceneName = useStore((s) => s.setSceneName);
  return (
    <div
      style={{
        width: COL_W,
        flexShrink: 0,
        padding: 4,
        background: 'rgba(255,106,0,0.08)',
        border: '1px solid rgba(255,106,0,0.4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        alignItems: 'center',
      }}
    >
      <input
        value={name}
        onChange={(e) => setSceneName(index, e.target.value)}
        className="display"
        aria-label={`Name of column ${index + 1}`}
        title="Rename this column"
        style={{
          background: 'transparent',
          border: 'none',
          textAlign: 'center',
          width: '100%',
          fontSize: 12,
        }}
      />
      <div style={{ display: 'flex', gap: 3 }}>
        <button
          className="hud-btn hud-btn--green hud-btn--icon"
          onClick={onLaunch}
          title={`Launch ${name}`}
          style={{ padding: '2px 6px', fontSize: 14 }}
        >
          ▶
        </button>
        <button
          className="hud-btn hud-btn--icon"
          onClick={onRemove}
          title="Remove scene"
          style={{ padding: '2px 6px', fontSize: 12 }}
        >
          ✕
        </button>
      </div>
    </div>
  );
});

const TrackRow = memo(function TrackRow({ track, sceneCount }: { track: Track; sceneCount: number }) {
  const isMobile = useIsMobile();
  const launchSessionClip = useStore((s) => s.launchSessionClip);
  const playingClipId = useStore((s) => s.sessionPlaying[track.id] ?? null);

  // every track kind can be session-launched — midi / pattern / audio clips
  // all fire from a session cell
  const canLaunch = true;

  return (
    <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
      <div
        style={{
          width: HEAD_COL_W,
          height: ROW_H,
          flexShrink: 0,
          padding: '4px 8px',
          background: 'rgba(0,0,0,0.55)',
          border: `1px solid ${track.color}66`,
          borderLeft: `4px solid ${track.color}`,
          display: 'flex',
          // side by side rather than stacked: a touch-sized stop button plus a
          // name does not fit in ROW_H when they are in a column
          alignItems: 'center',
          gap: 4,
        }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            color: '#fff',
            letterSpacing: '0.1em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={track.name}
        >
          {track.name}
        </span>
        <button
          className="hud-btn hud-btn--icon"
          onClick={() => launchSessionClip(track.id, null)}
          aria-label={`Stop the loop playing on ${track.name}`}
          title={`Stop the loop playing on ${track.name}`}
          style={{ padding: '1px 6px', fontSize: 12, flex: '0 0 auto' }}
          disabled={!playingClipId}
        >
          {isMobile ? '■' : '■ Stop'}
        </button>
      </div>
      {Array.from({ length: sceneCount }).map((_, i) => (
        <Slot key={i} track={track} sceneIndex={i} playingClipId={playingClipId} canLaunch={canLaunch} />
      ))}
    </div>
  );
});

const Slot = memo(function Slot({
  track,
  sceneIndex,
  playingClipId,
  canLaunch,
}: {
  track: Track;
  sceneIndex: number;
  playingClipId: string | null;
  canLaunch: boolean;
}) {
  const setSessionSlot = useStore((s) => s.setSessionSlot);
  const launchSessionClip = useStore((s) => s.launchSessionClip);

  const assignedId = track.sessionSlots?.[sceneIndex] ?? null;
  const assigned: Clip | undefined = useMemo(
    () => track.clips.find((c) => c.id === assignedId),
    [assignedId, track.clips],
  );
  const isPlaying = assigned && playingClipId === assigned.id;
  const launchable = !!(canLaunch && assigned);

  return (
    <div
      style={{
        width: COL_W,
        height: ROW_H,
        flexShrink: 0,
        background: assigned ? `${track.color}22` : 'rgba(0,0,0,0.45)',
        border: isPlaying ? `1px solid #fff` : `1px solid ${assigned ? `${track.color}99` : 'rgba(255,106,0,0.25)'}`,
        boxShadow: isPlaying ? `0 0 10px ${track.color}` : 'none',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        padding: 4,
        cursor: launchable ? 'pointer' : 'default',
        opacity: !canLaunch ? 0.5 : 1,
      }}
      onClick={() => {
        if (!launchable) return;
        launchSessionClip(track.id, isPlaying ? null : assigned!.id);
      }}
      title={
        !canLaunch
          ? 'Audio tracks can\'t be session-launched yet'
          : assigned
            ? `${assigned.name ?? assigned.kind} — tap to ${isPlaying ? 'stop' : 'launch'}`
            : 'Empty slot — click ✎ to assign a clip'
      }
    >
      <span
        style={{
          fontSize: 12,
          color: assigned ? '#fff' : 'rgba(255,106,0,0.5)',
          letterSpacing: '0.1em',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {assigned?.name ?? assigned?.kind?.toUpperCase() ?? '—'}
      </span>
      <ClipPicker
        track={track}
        sceneIndex={sceneIndex}
        currentId={assignedId}
        onAssign={(id) => setSessionSlot(track.id, sceneIndex, id)}
      />
    </div>
  );
});

const ClipPicker = memo(function ClipPicker({
  track,
  sceneIndex,
  currentId,
  onAssign,
}: {
  track: Track;
  sceneIndex: number;
  currentId: string | null;
  onAssign: (id: string | null) => void;
}) {
  // every clip kind can be a session clip now (audio included)
  const candidates = track.clips;
  if (candidates.length === 0) return null;
  return (
    <select
      value={currentId ?? ''}
      onChange={(e) => onAssign(e.target.value || null)}
      onClick={(e) => e.stopPropagation()}
      className="display"
      title="Assign clip"
      style={{
        fontSize: 12,
        background: 'transparent',
        border: 'none',
        color: 'var(--hud-orange-bright)',
        cursor: 'pointer',
        padding: 0,
        marginTop: 2,
      }}
      aria-label={`Scene ${sceneIndex + 1} slot for ${track.name}`}
    >
      <option value="">Pick a clip…</option>
      {candidates.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name ?? c.kind}
        </option>
      ))}
    </select>
  );
});
