import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { audioEngine } from '../../audio/engine';
import { saveProjectToStorage } from '../../state/store';

export function Transport() {
  const project = useStore((s) => s.project);
  const playing = useStore((s) => s.isPlaying);
  const recording = useStore((s) => s.isRecording);
  const metronome = useStore((s) => s.metronome);
  const setMetronome = useStore((s) => s.setMetronome);
  const setBpm = useStore((s) => s.setBpm);
  const setPlaying = useStore((s) => s.setPlaying);
  const setRecording = useStore((s) => s.setRecording);
  const setLoop = useStore((s) => s.setLoop);
  const setPosition = useStore((s) => s.setPosition);
  const positionBeats = useStore((s) => s.positionBeats);

  // sync engine state from store
  useEffect(() => {
    audioEngine.setBpm(project.bpm);
    audioEngine.setTimeSig(project.numerator, project.denominator);
    audioEngine.setMasterVolume(project.master.volume);
    audioEngine.setLoop(project.loopEnabled, project.loopStart, project.loopEnd);
    audioEngine.startMetronome(metronome);
  }, [project.bpm, project.numerator, project.denominator, project.master.volume, project.loopEnabled, project.loopStart, project.loopEnd, metronome]);

  // schedule whenever project content changes
  useEffect(() => {
    // ensure engine knows about every track
    for (const t of project.tracks) audioEngine.ensureTrack(t);
    audioEngine.schedule(project);
  }, [project]);

  // poll position
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const beats = audioEngine.getPositionBeats();
      useStore.getState().setPosition(beats);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

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
    setRecording(false);
    setPosition(0);
  }
  function rec() {
    setRecording(!recording);
  }

  const [showBpmEdit, setShowBpmEdit] = useState(false);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        background: 'rgba(0,0,0,0.6)',
        borderBottom: '1px solid rgba(255,106,0,0.4)',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', gap: 4 }}>
        <button className="nerv-btn touch-target" onClick={() => { setPosition(0); audioEngine.setPosition(0); }} title="Return to start">
          ⏮
        </button>
        <button
          className={`nerv-btn touch-target ${playing ? 'is-active' : ''}`}
          onClick={play}
          aria-pressed={playing}
          title="Play / Pause"
        >
          {playing ? '⏸ PAUSE' : '▶ PLAY'}
        </button>
        <button className="nerv-btn touch-target" onClick={stop}>
          ■ STOP
        </button>
        <button
          className={`nerv-btn nerv-btn--rec touch-target ${recording ? 'is-active' : ''}`}
          onClick={rec}
          aria-pressed={recording}
        >
          ● REC
        </button>
        <button
          className={`nerv-btn touch-target ${project.loopEnabled ? 'is-active' : ''}`}
          onClick={() => setLoop(!project.loopEnabled)}
          aria-pressed={project.loopEnabled}
        >
          ↻ LOOP
        </button>
        <button
          className={`nerv-btn touch-target ${metronome ? 'is-active' : ''}`}
          onClick={() => setMetronome(!metronome)}
          aria-pressed={metronome}
        >
          ⛬ CLICK
        </button>
      </div>

      <div style={{ flex: 1 }} />

      <button
        className="nerv-btn touch-target"
        onClick={() => setShowBpmEdit((v) => !v)}
        style={{ minWidth: 100 }}
      >
        TEMPO {project.bpm.toFixed(1)}
      </button>
      {showBpmEdit && (
        <input
          type="number"
          className="display"
          min={30}
          max={300}
          step={0.5}
          value={project.bpm}
          onChange={(e) => setBpm(parseFloat(e.target.value || '120'))}
          style={{ width: 80, padding: 4 }}
        />
      )}

      <BpmSlider />

      <button
        className="nerv-btn nerv-btn--ghost touch-target"
        onClick={() => {
          saveProjectToStorage();
        }}
        title="Save current project to local storage"
      >
        💾 SAVE
      </button>

      <PositionBar />
    </div>
  );
}

function BpmSlider() {
  const bpm = useStore((s) => s.project.bpm);
  const setBpm = useStore((s) => s.setBpm);
  return (
    <input
      className="nerv-slider"
      type="range"
      min={60}
      max={200}
      step={0.5}
      value={bpm}
      onChange={(e) => setBpm(parseFloat(e.target.value))}
      style={{ width: 160 }}
    />
  );
}

function PositionBar() {
  const project = useStore((s) => s.project);
  const positionBeats = useStore((s) => s.positionBeats);
  const setPosition = useStore((s) => s.setPosition);
  const totalBeats = project.lengthBars * project.numerator;
  const pct = Math.min(1, positionBeats / totalBeats);
  const trackRef = useRef<HTMLDivElement>(null);

  function jumpFromX(clientX: number) {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r) return;
    const x = Math.max(0, Math.min(r.width, clientX - r.left));
    const beats = (x / r.width) * totalBeats;
    setPosition(beats);
    audioEngine.setPosition(beats);
  }
  return (
    <div
      ref={trackRef}
      onPointerDown={(e) => jumpFromX(e.clientX)}
      style={{
        position: 'relative',
        width: 220,
        height: 22,
        background: 'rgba(0,0,0,0.6)',
        border: '1px solid rgba(255,106,0,0.4)',
        cursor: 'pointer',
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
}
