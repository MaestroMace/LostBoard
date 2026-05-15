import { memo, useEffect, useRef, useState } from 'react';
import { shallow } from 'zustand/shallow';
import { useStore, saveProjectToStorage } from '../../state/store';
import { audioEngine } from '../../audio/engine';
import { transportClock, seek, usePlayhead } from '../../state/transportClock';
import { useIsMobile } from '../../hooks/useIsMobile';
import { putSample } from '../../state/sampleDB';

export function Transport() {
  const playing = useStore((s) => s.isPlaying);
  const micRecording = useStore((s) => s.micRecording);
  const bouncing = useStore((s) => s.bouncing);
  const metronome = useStore((s) => s.metronome);
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
      <div style={{ display: 'flex', gap: 4 }}>
        <button className="nerv-btn touch-target" onClick={() => seek(0)} title="Return to start">
          ⏮
        </button>
        <button
          className={`nerv-btn touch-target ${playing ? 'is-active' : ''}`}
          onClick={play}
          aria-pressed={playing}
          title="Play / Pause"
        >
          {playing ? `⏸${lbl('PAUSE')}` : `▶${lbl('PLAY')}`}
        </button>
        <button className="nerv-btn touch-target" onClick={stop} title="Stop">
          ■{lbl('STOP')}
        </button>
        <button
          className={`nerv-btn nerv-btn--rec touch-target ${micRecording ? 'is-active' : ''}`}
          onClick={toggleMicRec}
          aria-pressed={micRecording}
          title="Record from microphone into an audio track"
        >
          ●{lbl(micRecording ? 'STOP REC' : 'MIC REC')}
        </button>
        <button
          className={`nerv-btn nerv-btn--rec touch-target ${bouncing ? 'is-active' : ''}`}
          onClick={toggleBounce}
          aria-pressed={bouncing}
          title="Bounce the master output to an audio file"
        >
          ⭳{lbl(bouncing ? 'STOP BOUNCE' : 'BOUNCE')}
        </button>
        <button
          className={`nerv-btn touch-target ${loopEnabled ? 'is-active' : ''}`}
          onClick={() => setLoop(!loopEnabled)}
          aria-pressed={loopEnabled}
          title="Loop"
        >
          ↻{lbl('LOOP')}
        </button>
        <button
          className={`nerv-btn touch-target ${metronome ? 'is-active' : ''}`}
          onClick={() => setMetronome(!metronome)}
          aria-pressed={metronome}
          title="Metronome"
        >
          ⛬{lbl('CLICK')}
        </button>
        <button
          className="nerv-btn nerv-btn--ghost touch-target"
          onClick={undo}
          disabled={!canUndo}
          title="Undo"
          style={{ opacity: canUndo ? 1 : 0.35 }}
        >
          ↶{lbl('UNDO')}
        </button>
        <button
          className="nerv-btn nerv-btn--ghost touch-target"
          onClick={redo}
          disabled={!canRedo}
          title="Redo"
          style={{ opacity: canRedo ? 1 : 0.35 }}
        >
          ↷{lbl('REDO')}
        </button>
        <button
          className="nerv-btn nerv-btn--ghost touch-target"
          onClick={() => saveProjectToStorage()}
          title="Save current project to local storage"
        >
          💾{lbl('SAVE')}
        </button>
      </div>

      {!isMobile && <div style={{ flex: 1 }} />}

      <button
        className="nerv-btn touch-target"
        onClick={() => setShowBpmEdit((v) => !v)}
        style={{ minWidth: isMobile ? 64 : 100 }}
        title="Tempo"
      >
        {isMobile ? bpm.toFixed(0) : `TEMPO ${bpm.toFixed(1)}`}
      </button>
      <TapTempoButton compact={isMobile} setBpm={setBpm} />
      {showBpmEdit && (
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

      <input
        className="nerv-slider"
        type="range"
        min={60}
        max={200}
        step={0.5}
        value={bpm}
        onChange={(e) => setBpm(parseFloat(e.target.value))}
        style={{ width: isMobile ? 100 : 160, flex: isMobile ? 1 : undefined }}
      />

      <PositionBar />
    </div>
  );
}

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
      className="nerv-btn nerv-btn--ghost touch-target"
      onClick={tap}
      title="Tap repeatedly to set the tempo"
      // tiny visual blink on each tap so the user sees their input
      style={{ filter: pulse % 2 === 0 ? undefined : 'brightness(1.4)' }}
    >
      ◉{compact ? '' : ' TAP'}
    </button>
  );
});
