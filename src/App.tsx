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
import { AutomationView } from './components/automation/AutomationView';
import { useGlobalKeys } from './hooks/useGlobalKeys';
import { useIsMobile, useLayoutModeAttribute } from './hooks/useLayoutMode';
import { useEngineSync } from './hooks/useEngineSync';
import { useMediaSession } from './hooks/useMediaSession';
import { rehydrateSamples } from './state/samples';
import { midiInput } from './audio/midiInput';
import { midiOutput } from './audio/midiOutput';

const TABS: { id: ReturnType<typeof useStore.getState>['view']; label: string; hint: string }[] = [
  { id: 'arrange', label: 'ARRANGE', hint: 'Timeline: lay clips out across tracks and time' },
  { id: 'session', label: 'SESSION', hint: 'Clip launcher: trigger loops by scene, Ableton-style' },
  { id: 'sequencer', label: 'SEQUENCER', hint: 'Drum grid: program beats step by step' },
  { id: 'pianoroll', label: 'PIANO ROLL', hint: 'Note editor: draw and edit melodies in a MIDI clip' },
  { id: 'instrument', label: 'INSTRUMENT', hint: "Synth editor: shape the selected track's sound" },
  { id: 'fx', label: 'FX RACK', hint: 'Per-track effects: EQ, compressor, chorus, bit-crusher' },
  { id: 'automation', label: 'AUTOMATION', hint: 'Draw parameter changes over time (volume, cutoff…)' },
  { id: 'mixer', label: 'MIXER', hint: 'Channel strips: volume, pan, mute/solo, master' },
  { id: 'project', label: 'PROJECT', hint: 'Tempo, time signature, save / load / export' },
];

async function bootEngine() {
  await audioEngine.init();
  const st = useStore.getState();
  const p = st.project;
  audioEngine.setBpm(p.bpm);
  audioEngine.setTimeSig(p.numerator, p.denominator);
  audioEngine.setSwing(p.swing ?? 0, p.swingSubdivision ?? '8n');
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
  // publishes <html data-layout="desktop | phone-landscape | phone-portrait">
  useLayoutModeAttribute();

  useEffect(() => {
    loadProjectFromStorage();
    // re-decode persisted audio so audio clips survive a reload
    rehydrateSamples().then((n) => {
      if (n > 0 && audioEngine.isInited()) {
        audioEngine.schedule(useStore.getState().project);
      }
    });
    // MIDI doesn't need a user gesture; arm the bridges as soon as the page loads
    midiInput.init();
    midiOutput.init();
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
        try {
          await bootEngine();
        } catch (e) {
          // never strand the user on the boot screen — the engine re-kicks
          // itself on the next transport action via init-on-demand
          console.error('engine boot failed', e);
        }
        setBooted(true);
      }} />}

      <StatusBar />
      <Transport />

      <div className="hud-tabs">
        {/* Scrolls on phones; the help button below stays pinned outside the
            strip so it can never be pushed off-screen with the tabs. */}
        <div className="hud-tabs__strip" data-scrollx>
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`hud-tab ${view === t.id ? 'is-active' : ''}`}
              onClick={() => setView(t.id)}
              title={t.hint}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          className="hud-btn hud-btn--ghost hud-btn--icon"
          onClick={() => setHelpOpen(true)}
          title="Help (?)"
          style={{ alignSelf: 'center', minWidth: 32, flex: '0 0 auto' }}
        >
          ?
        </button>
        <span
          className="hud-readout--dim hud-readout desktop-only"
          style={{ alignSelf: 'center', whiteSpace: 'nowrap', flex: '0 0 auto' }}
        >
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
        {view === 'automation' && <AutomationView />}
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
  const isMobile = useIsMobile();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: isMobile ? 8 : 12,
        padding: isMobile ? '3px 8px' : '4px 12px',
        background: 'rgba(0,0,0,0.85)',
        borderTop: '1px solid rgba(255,106,0,0.4)',
        fontSize: 9,
        // one line, always: this bar used to wrap to three on a phone and
        // shove the timeline up off the screen
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        flex: '0 0 auto',
      }}
    >
      <span className="hud-readout--green hud-readout">● ENGINE OK</span>
      <span className="hud-readout">TRK {String(trackCount).padStart(2, '0')}</span>
      <span className="hud-readout">CLP {String(clipCount).padStart(3, '0')}</span>
      <span className="hud-readout" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {playing ? 'ROLLING' : 'HALTED'}
      </span>
      <div style={{ flex: 1, minWidth: 0 }} />
      {/* Keyboard shortcuts are meaningless on a touch device — .desktop-only
          drops them under (pointer: coarse). */}
      <span className="hud-readout--dim hud-readout desktop-only">
        SPACE ▶ PLAY · ENTER ■ STOP · ? HELP · AUTOSAVES LOCALLY
      </span>
    </div>
  );
});
