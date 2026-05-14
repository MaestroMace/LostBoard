import { useEffect, useState } from 'react';
import { loadProjectFromStorage, saveProjectToStorage, useStore } from './state/store';
import { audioEngine } from './audio/engine';
import { StatusBar } from './components/hud/StatusBar';
import { BootSequence } from './components/hud/BootSequence';
import { Transport } from './components/transport/Transport';
import { ArrangeView } from './components/arrange/ArrangeView';
import { MixerView } from './components/mixer/MixerView';
import { SynthPanel } from './components/instrument/SynthPanel';
import { StepSequencer } from './components/sequencer/StepSequencer';
import { PianoRoll } from './components/pianoroll/PianoRoll';
import { ProjectView } from './components/project/ProjectView';
import { FxPanel } from './components/fx/FxPanel';
import { useGlobalKeys } from './hooks/useGlobalKeys';

const TABS: { id: ReturnType<typeof useStore.getState>['view']; label: string }[] = [
  { id: 'arrange', label: 'ARRANGE' },
  { id: 'sequencer', label: 'SEQUENCER' },
  { id: 'pianoroll', label: 'PIANO ROLL' },
  { id: 'instrument', label: 'INSTRUMENT' },
  { id: 'fx', label: 'FX RACK' },
  { id: 'mixer', label: 'MIXER' },
  { id: 'project', label: 'PROJECT' },
];

export default function App() {
  const [booted, setBooted] = useState(false);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);

  useGlobalKeys();

  useEffect(() => {
    loadProjectFromStorage();
  }, []);

  // Auto-save every 20s
  useEffect(() => {
    const t = setInterval(() => saveProjectToStorage(), 20000);
    return () => clearInterval(t);
  }, []);

  // Persist on visibility hidden / pagehide (iPhone-safe)
  useEffect(() => {
    const onHide = () => saveProjectToStorage();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);

  return (
    <div className="scanlines crt-flicker" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {!booted && <BootSequence onDone={async () => {
        await audioEngine.init();
        setBooted(true);
      }} />}

      <StatusBar />
      <Transport />

      <div className="nerv-tabs" style={{ flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`nerv-tab ${view === t.id ? 'is-active' : ''}`}
            onClick={() => setView(t.id)}
          >
            {t.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <span className="hud-readout--dim hud-readout" style={{ alignSelf: 'center' }}>VER 0.1.0 // LOSTBOARD</span>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {view === 'arrange' && <ArrangeView />}
        {view === 'sequencer' && <StepSequencer />}
        {view === 'pianoroll' && <PianoRoll />}
        {view === 'instrument' && <SynthPanel />}
        {view === 'fx' && <FxPanel />}
        {view === 'mixer' && <MixerView />}
        {view === 'project' && <ProjectView />}
      </div>

      <FooterBar />

      <div className="crosshair-corner tl" />
      <div className="crosshair-corner tr" />
      <div className="crosshair-corner bl" />
      <div className="crosshair-corner br" />
    </div>
  );
}

function FooterBar() {
  const project = useStore((s) => s.project);
  const playing = useStore((s) => s.isPlaying);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '4px 12px',
        background: 'rgba(0,0,0,0.85)',
        borderTop: '1px solid rgba(255,106,0,0.4)',
        fontSize: 9,
      }}
    >
      <span className="hud-readout--green hud-readout">● ENGINE OK</span>
      <span className="hud-readout">TRACKS {String(project.tracks.length).padStart(2, '0')}</span>
      <span className="hud-readout">CLIPS {String(project.tracks.reduce((n, t) => n + t.clips.length, 0)).padStart(3, '0')}</span>
      <span className="hud-readout">{playing ? 'TRANSPORT ROLLING' : 'TRANSPORT HALTED'}</span>
      <div style={{ flex: 1 }} />
      <span className="hud-readout--dim hud-readout">A.T. FIELD STABLE // SYNC 87% // NO PATTERN BLUE</span>
    </div>
  );
}
