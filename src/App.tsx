import { memo, useEffect, useState } from 'react';
import { shallow } from 'zustand/shallow';
import { loadProjectFromStorage, saveProjectToStorage, useStore } from './state/store';
import { audioEngine } from './audio/engine';
import { StatusBar } from './components/hud/StatusBar';
import { BootSequence } from './components/hud/BootSequence';
import { HelpOverlay } from './components/hud/HelpOverlay';
import { Transport } from './components/transport/Transport';
import { ArrangeView } from './components/arrange/ArrangeView';
import { SessionView } from './components/session/SessionView';
import { MixerView } from './components/mixer/MixerView';
import { SynthPanel } from './components/instrument/SynthPanel';
import { StepSequencer } from './components/sequencer/StepSequencer';
import { PianoRoll } from './components/pianoroll/PianoRoll';
import { ProjectView } from './components/project/ProjectView';
import { FxPanel } from './components/fx/FxPanel';
import { useGlobalKeys } from './hooks/useGlobalKeys';
import { useEngineSync } from './hooks/useEngineSync';
import { useMediaSession } from './hooks/useMediaSession';
import { rehydrateSamples } from './state/samples';
import { midiInput } from './audio/midiInput';

const TABS: { id: ReturnType<typeof useStore.getState>['view']; label: string }[] = [
  { id: 'arrange', label: 'ARRANGE' },
  { id: 'session', label: 'SESSION' },
  { id: 'sequencer', label: 'SEQUENCER' },
  { id: 'pianoroll', label: 'PIANO ROLL' },
  { id: 'instrument', label: 'INSTRUMENT' },
  { id: 'fx', label: 'FX RACK' },
  { id: 'mixer', label: 'MIXER' },
  { id: 'project', label: 'PROJECT' },
];

async function bootEngine() {
  await audioEngine.init();
  const st = useStore.getState();
  const p = st.project;
  audioEngine.setBpm(p.bpm);
  audioEngine.setTimeSig(p.numerator, p.denominator);
  audioEngine.setMasterVolume(p.master.volume);
  audioEngine.setLoop(p.loopEnabled, p.loopStart, p.loopEnd);
  audioEngine.startMetronome(st.metronome);
  audioEngine.schedule(p);
}

export default function App() {
  const [booted, setBooted] = useState(false);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const helpOpen = useStore((s) => s.helpOpen);
  const setHelpOpen = useStore((s) => s.setHelpOpen);

  useGlobalKeys();
  useEngineSync();
  useMediaSession();

  useEffect(() => {
    loadProjectFromStorage();
    // re-decode persisted audio so audio clips survive a reload
    rehydrateSamples().then((n) => {
      if (n > 0 && audioEngine.isInited()) {
        audioEngine.schedule(useStore.getState().project);
      }
    });
    // MIDI doesn't need a user gesture; arm the bridge as soon as the page loads
    midiInput.init();
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
        await bootEngine();
        setBooted(true);
      }} />}

      <StatusBar />
      <Transport />

      <div className="nerv-tabs">
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
        <button
          className="nerv-btn nerv-btn--ghost nerv-btn--icon"
          onClick={() => setHelpOpen(true)}
          title="Help (?)"
          style={{ alignSelf: 'center', minWidth: 32 }}
        >
          ?
        </button>
        <span className="hud-readout--dim hud-readout" style={{ alignSelf: 'center', whiteSpace: 'nowrap' }}>
          VER 0.1.0
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {view === 'arrange' && <ArrangeView />}
        {view === 'session' && <SessionView />}
        {view === 'sequencer' && <StepSequencer />}
        {view === 'pianoroll' && <PianoRoll />}
        {view === 'instrument' && <SynthPanel />}
        {view === 'fx' && <FxPanel />}
        {view === 'mixer' && <MixerView />}
        {view === 'project' && <ProjectView />}
      </div>

      <FooterBar />

      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}

      <div className="crosshair-corner tl" />
      <div className="crosshair-corner tr" />
      <div className="crosshair-corner bl" />
      <div className="crosshair-corner br" />
    </div>
  );
}

const FooterBar = memo(function FooterBar() {
  const { trackCount, clipCount } = useStore(
    (s) => ({
      trackCount: s.project.tracks.length,
      clipCount: s.project.tracks.reduce((n, t) => n + t.clips.length, 0),
    }),
    shallow,
  );
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
      <span className="hud-readout">TRACKS {String(trackCount).padStart(2, '0')}</span>
      <span className="hud-readout">CLIPS {String(clipCount).padStart(3, '0')}</span>
      <span className="hud-readout">{playing ? 'TRANSPORT ROLLING' : 'TRANSPORT HALTED'}</span>
      <div style={{ flex: 1 }} />
      <span className="hud-readout--dim hud-readout">A.T. FIELD STABLE // SYNC 87% // NO PATTERN BLUE</span>
    </div>
  );
});
