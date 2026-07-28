import { memo, useEffect, useRef, useState } from 'react';
import { shallow } from 'zustand/shallow';
import { useStore, saveProjectToStorage } from '../../state/store';
import { audioEngine } from '../../audio/engine';
import { midiInput } from '../../audio/midiInput';
import { transportClock, seek, usePlayhead } from '../../state/transportClock';
import { useIsMobile, useLayoutMode } from '../../hooks/useLayoutMode';
import { Indicator, PositionReadout, TriadMark } from '../hud/StatusBar';
import { putSample } from '../../state/sampleDB';

export function Transport() {
  const playing = useStore((s) => s.isPlaying);
  const micRecording = useStore((s) => s.micRecording);
  const bouncing = useStore((s) => s.bouncing);
  const metronome = useStore((s) => s.metronome);
  const countInBars = useStore((s) => s.countInBars);
  const loopEnabled = useStore((s) => s.project.loopEnabled);
  const bpm = useStore((s) => s.project.bpm);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);

  const setMetronome = useStore((s) => s.setMetronome);
  const setBpm = useStore((s) => s.setBpm);
  const setPlaying = useStore((s) => s.setPlaying);
  const setMicRecording = useStore((s) => s.setMicRecording);
  const setBouncing = useStore((s) => s.setBouncing);
  const setLoop = useStore((s) => s.setLoop);
  const setCountInBars = useStore((s) => s.setCountInBars);
  const addTrack = useStore((s) => s.addTrack);
  const addAudioClip = useStore((s) => s.addAudioClip);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);

  const recStartBeat = useRef(0);
  const recTrackId = useRef<string | null>(null);

  // sync transport-level engine params (cheap, only fires when these change)
  const tparams = useStore(
    (s) => ({
      bpm: s.project.bpm,
      numerator: s.project.numerator,
      denominator: s.project.denominator,
      masterVol: s.project.master.volume,
      loopEnabled: s.project.loopEnabled,
      loopStart: s.project.loopStart,
      loopEnd: s.project.loopEnd,
      metronome: s.metronome,
    }),
    shallow,
  );
  useEffect(() => {
    audioEngine.setBpm(tparams.bpm);
    audioEngine.setTimeSig(tparams.numerator, tparams.denominator);
    audioEngine.setMasterVolume(tparams.masterVol);
    audioEngine.setLoop(tparams.loopEnabled, tparams.loopStart, tparams.loopEnd);
    audioEngine.startMetronome(tparams.metronome);
  }, [tparams]);

  async function play() {
    await audioEngine.init();
    if (playing) {
      audioEngine.pause();
      setPlaying(false);
    } else {
      await audioEngine.play();
      setPlaying(true);
    }
  }
  function stop() {
    audioEngine.stop();
    setPlaying(false);
    transportClock.set(0);
    // clearing the punch gate so a subsequent plain record captures everything
    midiInput.setRecordGate(null);
  }

  /**
   * Punch-in record: roll the transport from `countInBars` bars BEFORE the
   * current playhead so the player gets a metronome pre-roll, but gate MIDI
   * capture at the playhead — pre-roll bars monitor live without recording.
   * With countInBars = 0 it's a straight punch-in at the playhead.
   */
  async function punchRecord() {
    await audioEngine.init();
    if (playing) {
      stop();
      return;
    }
    const st = useStore.getState();
    const armed = st.project.tracks.find((t) => t.kind === 'synth' && t.arm);
    if (!armed) {
      alert('Arm a synth track first — the ● button in its track header.');
      return;
    }
    const numerator = st.project.numerator;
    const punchBeat = transportClock.getSnapshot();
    const startBeat = Math.max(0, punchBeat - countInBars * numerator);
    audioEngine.stop();
    seek(startBeat);
    midiInput.setRecordGate(punchBeat);
    if (!metronome) setMetronome(true);
    await audioEngine.play();
    setPlaying(true);
  }

  async function toggleMicRec() {
    if (micRecording) {
      const result = await audioEngine.stopMicRecording();
      setMicRecording(false);
      if (result) {
        // persist the take so it survives a reload
        putSample(result.id, result.blob).catch((e) => console.warn('persist failed', e));
        const trackId = recTrackId.current;
        if (trackId) {
          addAudioClip(trackId, recStartBeat.current, result.id, result.duration, 'MIC TAKE');
        }
      }
    } else {
      const ok = await audioEngine.armMic();
      if (!ok) {
        alert('Microphone access denied or unavailable.');
        return;
      }
      // prefer an armed audio track, then any audio track, else create one
      const tracks = useStore.getState().project.tracks;
      let audioTrack =
        tracks.find((t) => t.kind === 'audio' && t.arm) ?? tracks.find((t) => t.kind === 'audio');
      if (!audioTrack) {
        audioTrack = addTrack('audio');
      }
      recTrackId.current = audioTrack.id;
      recStartBeat.current = transportClock.getSnapshot();
      audioEngine.startMicRecording();
      setMicRecording(true);
    }
  }

  async function toggleBounce() {
    if (bouncing) {
      const blob = await audioEngine.stopMasterBounce();
      setBouncing(false);
      audioEngine.stop();
      setPlaying(false);
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${useStore.getState().project.name.replace(/\s+/g, '_')}_bounce_${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } else {
      await audioEngine.init();
      audioEngine.stop();
      transportClock.set(0);
      audioEngine.startMasterBounce();
      await audioEngine.play();
      setPlaying(true);
      setBouncing(true);
    }
  }

  const [showBpmEdit, setShowBpmEdit] = useState(false);
  const isMobile = useIsMobile();
  // Landscape drops the StatusBar entirely and carries its readouts here, so a
  // 411px-tall viewport spends one row on chrome instead of two.
  const mergedHeader = useLayoutMode() === 'phone-landscape';
  const lbl = (full: string) => (isMobile ? '' : ` ${full}`);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: isMobile ? 4 : 8,
        padding: isMobile ? '6px 8px' : '8px 12px',
        background: 'rgba(0,0,0,0.6)',
        borderBottom: '1px solid rgba(255,106,0,0.4)',
        flexWrap: 'wrap',
        contain: 'layout style',
      }}
    >
      {mergedHeader && <TriadMark size={22} />}
      {/* Scrollable so this strip can never clip its own controls — it used to
          push UNDO / REDO / SAVE past the right edge of a phone with no way to
          reach them. On phones the rarely-used half moves into the ⋯ menu. */}
      <div
        className="hud-scroll-x"
        data-scrollx
        style={{ display: 'flex', gap: 4, minWidth: 0, flex: isMobile ? '1 1 auto' : '0 0 auto' }}
      >
        <button className="hud-btn touch-target" onClick={() => seek(0)} title="Return to start">
          ⏮
        </button>
        <button
          className={`hud-btn touch-target ${playing ? 'is-active' : ''}`}
          onClick={play}
          aria-pressed={playing}
          title="Play / Pause"
        >
          {playing ? `⏸${lbl('PAUSE')}` : `▶${lbl('PLAY')}`}
        </button>
        <button className="hud-btn touch-target" onClick={stop} title="Stop">
          ■{lbl('STOP')}
        </button>
        <button
          className={`hud-btn hud-btn--rec touch-target ${micRecording ? 'is-active' : ''}`}
          onClick={toggleMicRec}
          aria-pressed={micRecording}
          title="Record from microphone into an audio track"
        >
          ●{lbl(micRecording ? 'STOP REC' : 'MIC REC')}
        </button>
        <button
          className={`hud-btn hud-btn--rec touch-target ${playing ? 'is-active' : ''}`}
          onClick={punchRecord}
          title={
            countInBars > 0
              ? `Punch-in MIDI record with a ${countInBars}-bar count-in onto the armed synth track`
              : 'Punch-in MIDI record at the playhead onto the armed synth track'
          }
        >
          ⏺{lbl('PUNCH')}
        </button>
        {!isMobile && (
          <select
            className="display touch-target"
            value={countInBars}
            onChange={(e) => setCountInBars(parseInt(e.target.value, 10))}
            title="Count-in bars before a punch-in record"
            style={{ minWidth: 64 }}
          >
            {[0, 1, 2, 4].map((n) => (
              <option key={n} value={n}>
                CI {n}
              </option>
            ))}
          </select>
        )}
        {!isMobile && (
          <button
            className={`hud-btn hud-btn--rec touch-target ${bouncing ? 'is-active' : ''}`}
            onClick={toggleBounce}
            aria-pressed={bouncing}
            title="Bounce the master output to an audio file"
          >
            ⭳{lbl(bouncing ? 'STOP BOUNCE' : 'BOUNCE')}
          </button>
        )}
        <button
          className={`hud-btn touch-target ${loopEnabled ? 'is-active' : ''}`}
          onClick={() => setLoop(!loopEnabled)}
          aria-pressed={loopEnabled}
          title="Loop"
        >
          ↻{lbl('LOOP')}
        </button>
        <button
          className={`hud-btn touch-target ${metronome ? 'is-active' : ''}`}
          onClick={() => setMetronome(!metronome)}
          aria-pressed={metronome}
          title="Metronome"
        >
          ⛬{lbl('CLICK')}
        </button>
        {!isMobile && (
          <>
            <button
              className="hud-btn hud-btn--ghost touch-target"
              onClick={undo}
              disabled={!canUndo}
              title="Undo"
              style={{ opacity: canUndo ? 1 : 0.35 }}
            >
              ↶{lbl('UNDO')}
            </button>
            <button
              className="hud-btn hud-btn--ghost touch-target"
              onClick={redo}
              disabled={!canRedo}
              title="Redo"
              style={{ opacity: canRedo ? 1 : 0.35 }}
            >
              ↷{lbl('REDO')}
            </button>
            <button
              className="hud-btn hud-btn--ghost touch-target"
              onClick={() => saveProjectToStorage()}
              title="Save current project to local storage"
            >
              💾{lbl('SAVE')}
            </button>
          </>
        )}
      </div>

      {isMobile && (
        <TransportOverflow
          bpm={bpm}
          setBpm={setBpm}
          bouncing={bouncing}
          toggleBounce={toggleBounce}
          countInBars={countInBars}
          setCountInBars={setCountInBars}
          undo={undo}
          redo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
        />
      )}

      {mergedHeader && (
        <>
          <div style={{ flex: 1, minWidth: 8 }} />
          <Indicator label="PL" on={playing} color="green" />
          <Indicator label="REC" on={micRecording || bouncing} color="red" />
          <PositionReadout numerator={tparams.numerator} />
        </>
      )}

      {!isMobile && <div style={{ flex: 1 }} />}

      {/* Redundant on phones — tempo lives in the ⋯ menu with room to drag,
          and this button was the one element forcing the row to wrap. */}
      {!isMobile && (
        <button
          className="hud-btn touch-target"
          onClick={() => setShowBpmEdit((v) => !v)}
          style={{ minWidth: 100 }}
          title="Tempo"
        >
          TEMPO {bpm.toFixed(1)}
        </button>
      )}
      {!isMobile && <TapTempoButton compact={false} setBpm={setBpm} />}
      {!isMobile && showBpmEdit && (
        <input
          type="number"
          className="display"
          min={30}
          max={300}
          step={0.5}
          value={bpm}
          onChange={(e) => setBpm(parseFloat(e.target.value || '120'))}
          style={{ width: 80, padding: 4 }}
        />
      )}

      {!isMobile && (
        <input
          className="hud-slider"
          type="range"
          min={60}
          max={200}
          step={0.5}
          value={bpm}
          onChange={(e) => setBpm(parseFloat(e.target.value))}
          style={{ width: 160 }}
        />
      )}

      <PreRollIndicator numerator={tparams.numerator} />
      {/* Duplicates the bars:beats readout and is what tipped the row into
          wrapping on a phone. */}
      {!isMobile && <PositionBar />}
    </div>
  );
}

/**
 * TransportOverflow — the ⋯ menu that holds the controls a phone row has no
 * width for. Everything in here stays a real, labelled, finger-sized target
 * rather than being dropped: on a phone SAVE and UNDO matter more than BOUNCE,
 * and all three used to sit off the right edge of the screen entirely.
 */
function TransportOverflow({
  bpm,
  setBpm,
  bouncing,
  toggleBounce,
  countInBars,
  setCountInBars,
  undo,
  redo,
  canUndo,
  canRedo,
}: {
  bpm: number;
  setBpm: (n: number) => void;
  bouncing: boolean;
  toggleBounce: () => void;
  countInBars: number;
  setCountInBars: (n: number) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '10px 12px',
    minHeight: 42,
    textAlign: 'left',
    borderBottom: '1px solid rgba(255,106,0,0.18)',
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: '0 0 auto' }}>
      <button
        className={`hud-btn touch-target ${open ? 'is-active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="More transport controls"
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: '110%',
            right: 0,
            zIndex: 40,
            minWidth: 190,
            // never taller than the viewport allows in landscape
            maxHeight: '60vh',
            overflowY: 'auto',
            background: 'rgba(6,4,3,0.97)',
            border: '1px solid rgba(255,106,0,0.6)',
            boxShadow: '0 8px 28px rgba(0,0,0,0.75)',
          }}
        >
          <div style={{ ...item, display: 'block' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span className="hud-label" style={{ fontSize: 9 }}>TEMPO</span>
              <span className="hud-readout">{bpm.toFixed(1)} BPM</span>
            </div>
            <input
              type="range"
              className="hud-slider"
              min={40}
              max={220}
              step={0.5}
              value={bpm}
              aria-label="Tempo"
              onChange={(e) => setBpm(parseFloat(e.target.value))}
              style={{ width: '100%', height: 14 }}
            />
          </div>
          <button
            className="hud-btn hud-btn--ghost"
            style={{ ...item, opacity: canUndo ? 1 : 0.35 }}
            disabled={!canUndo}
            onClick={() => {
              undo();
              setOpen(false);
            }}
          >
            ↶ UNDO
          </button>
          <button
            className="hud-btn hud-btn--ghost"
            style={{ ...item, opacity: canRedo ? 1 : 0.35 }}
            disabled={!canRedo}
            onClick={() => {
              redo();
              setOpen(false);
            }}
          >
            ↷ REDO
          </button>
          <button
            className="hud-btn hud-btn--ghost"
            style={item}
            onClick={() => {
              saveProjectToStorage();
              setOpen(false);
            }}
          >
            💾 SAVE PROJECT
          </button>
          <button
            className={`hud-btn hud-btn--rec ${bouncing ? 'is-active' : ''}`}
            style={item}
            onClick={() => {
              toggleBounce();
              setOpen(false);
            }}
          >
            ⭳ {bouncing ? 'STOP BOUNCE' : 'BOUNCE TO FILE'}
          </button>
          <label style={{ ...item, borderBottom: 'none' }}>
            <span className="hud-label" style={{ fontSize: 9, flex: 1 }}>
              COUNT-IN
            </span>
            <select
              className="display"
              value={countInBars}
              onChange={(e) => setCountInBars(parseInt(e.target.value, 10))}
              style={{ minWidth: 66, minHeight: 34 }}
            >
              {[0, 1, 2, 4].map((n) => (
                <option key={n} value={n}>
                  {n} BAR{n === 1 ? '' : 'S'}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

/**
 * PreRollIndicator — shows a "PRE-ROLL n" countdown while the transport is
 * inside the punch-in pre-roll (position before the MIDI record gate).
 * Renders nothing once recording is live, so it's invisible during normal
 * playback. Memoized + playhead-subscribed so only this leaf re-renders.
 */
const PreRollIndicator = memo(function PreRollIndicator({ numerator }: { numerator: number }) {
  const position = usePlayhead();
  const playing = useStore((s) => s.isPlaying);
  const gate = midiInput.getRecordGate();
  if (!playing || !isFinite(gate) || position >= gate) return null;
  const barsLeft = Math.ceil((gate - position) / Math.max(1, numerator));
  return (
    <div
      className="hud-readout blink"
      style={{
        fontSize: 10,
        padding: '2px 8px',
        color: '#ff5a5a',
        border: '1px solid rgba(255,60,60,0.6)',
        whiteSpace: 'nowrap',
      }}
    >
      ⏺ PRE-ROLL {barsLeft}
    </div>
  );
});

const PositionBar = memo(function PositionBar() {
  const totalBeats = useStore((s) => s.project.lengthBars * s.project.numerator);
  const positionBeats = usePlayhead();
  const pct = Math.min(1, positionBeats / totalBeats);
  const trackRef = useRef<HTMLDivElement>(null);

  function jumpFromX(clientX: number) {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r) return;
    const x = Math.max(0, Math.min(r.width, clientX - r.left));
    seek((x / r.width) * totalBeats);
  }
  return (
    <div
      ref={trackRef}
      onPointerDown={(e) => jumpFromX(e.clientX)}
      style={{
        position: 'relative',
        flex: 1,
        minWidth: 140,
        maxWidth: 280,
        height: 24,
        background: 'rgba(0,0,0,0.6)',
        border: '1px solid rgba(255,106,0,0.4)',
        cursor: 'pointer',
        touchAction: 'none',
        contain: 'strict',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${pct * 100}%`,
          background: 'linear-gradient(90deg, rgba(255,106,0,0.4), rgba(255,106,0,0.8))',
          willChange: 'width',
        }}
      />
      <div
        className="hud-readout"
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 9,
        }}
      >
        {positionBeats.toFixed(2)} / {totalBeats}
      </div>
    </div>
  );
});


/**
 * TapTempoButton — tap repeatedly to set BPM from the inter-tap interval.
 * Resets if more than 2 seconds pass between taps, averages the last 4 to
 * smooth out human jitter.
 */
const TapTempoButton = memo(function TapTempoButton({
  compact,
  setBpm,
}: {
  compact: boolean;
  setBpm: (bpm: number) => void;
}) {
  const taps = useRef<number[]>([]);
  const [pulse, setPulse] = useState(0);

  function tap() {
    const now = performance.now();
    if (taps.current.length > 0 && now - taps.current[taps.current.length - 1] > 2000) {
      taps.current = [];
    }
    taps.current.push(now);
    setPulse((p) => p + 1);
    if (taps.current.length < 2) return;
    // average over the last 4 intervals
    const recent = taps.current.slice(-5);
    const intervals = recent.slice(1).map((t, i) => t - recent[i]);
    const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const bpm = 60000 / avgMs;
    if (bpm >= 40 && bpm <= 240) setBpm(Math.round(bpm * 10) / 10);
  }

  return (
    <button
      className="hud-btn hud-btn--ghost touch-target"
      onClick={tap}
      title="Tap repeatedly to set the tempo"
      // tiny visual blink on each tap so the user sees their input
      style={{ filter: pulse % 2 === 0 ? undefined : 'brightness(1.4)' }}
    >
      ◉{compact ? '' : ' TAP'}
    </button>
  );
});
