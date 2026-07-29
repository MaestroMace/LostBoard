import { memo, useEffect, useState } from 'react';
import { shallow } from 'zustand/shallow';
import { loadProjectFromStorage, saveProjectToStorage, useStore } from './state/store';
import { audioEngine } from './audio/engine';
import { StatusBar } from './components/hud/StatusBar';
import { BootSequence } from './components/hud/BootSequence';
import { HelpOverlay } from './components/hud/HelpOverlay';
import { FirstRunHint } from './components/hud/FirstRunHint';
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
import { useIsMobile, useLayoutMode, useLayoutModeAttribute } from './hooks/useLayoutMode';
import { useEngineSync } from './hooks/useEngineSync';
import { useMediaSession } from './hooks/useMediaSession';
import { rehydrateSamples } from './state/samples';
import { midiInput } from './audio/midiInput';
import { midiOutput } from './audio/midiOutput';

type View = ReturnType<typeof useStore.getState>['view'];

/**
 * Navigation is two levels, not nine peers.
 *
 * Five of the old tabs were all "edit the selected track" — notes, sound,
 * effects, automation — so as siblings of ARRANGE and MIXER they gave no sense
 * of where anything lived or where to start. They now sit behind one Edit
 * destination with its own sub-tabs, which leaves a top row short enough to
 * read at a glance without scrolling.
 */
const EDITOR_VIEWS: View[] = ['sequencer', 'pianoroll', 'instrument', 'fx', 'automation'];

const PRIMARY: { id: View | 'edit'; label: string; hint: string }[] = [
  { id: 'arrange', label: 'Song', hint: 'Lay clips out across tracks and time' },
  { id: 'session', label: 'Clips', hint: 'Launch loops by scene' },
  { id: 'edit', label: 'Edit', hint: 'Edit the selected track' },
  { id: 'mixer', label: 'Mix', hint: 'Levels, pan, mute and solo' },
  { id: 'project', label: 'Project', hint: 'Tempo, saving and export' },
];

const EDITOR_TABS: { id: View | 'notes'; label: string; hint: string }[] = [
  { id: 'notes', label: 'Notes', hint: 'Draw the notes or beats for this track' },
  { id: 'instrument', label: 'Sound', hint: "Shape the track's instrument" },
  { id: 'fx', label: 'Effects', hint: 'EQ, compression, chorus, bit-crush' },
  { id: 'automation', label: 'Automation', hint: 'Change parameters over time' },
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
  // "Notes" means a drum grid or a piano roll depending on what is selected —
  // the user should not have to know which editor their track needs.
  const selectedTrack = useStore((s) => s.project.tracks.find((t) => t.id === s.selectedTrackId) ?? s.project.tracks[0]);
  const notesViewForTrack: View = selectedTrack?.kind === 'drum' ? 'sequencer' : 'pianoroll';
  const inEditor = EDITOR_VIEWS.includes(view);
  /**
   * A phone in landscape has ~336 CSS px of usable height once Android's
   * status and gesture bars take their share. Two stacked tab rows plus a
   * transport plus a footer spent 155 of it before the view began, and on the
   * piano roll that left 47px of grid for 844px of notes. Landscape therefore
   * carries both levels of navigation on one row and drops the footer.
   */
  const oneRowNav = useLayoutMode() === 'phone-landscape';
  const isMobile = useIsMobile();

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
        {/* Five destinations fit without scrolling; the help button stays
            pinned outside the strip regardless. */}
        <div className="hud-tabs__strip" data-scrollx>
          {PRIMARY.map((t) => {
            const active = t.id === 'edit' ? inEditor : view === t.id;
            return (
              <button
                key={t.id}
                data-tab="primary"
                className={`hud-tab ${active ? 'is-active' : ''}`}
                onClick={() => setView(t.id === 'edit' ? notesViewForTrack : (t.id as View))}
                title={t.hint}
              >
                {t.label}
              </button>
            );
          })}
          {/* Landscape folds the second level in here rather than spending
              another 38px row on it. The divider keeps the two levels legible
              as levels — nine peers in a line would read as one flat list.
              No track name here: all five editor panels carry their own
              kind-aware track selector, so a read-only copy in the strip was a
              sixth place showing the same thing, one row above the control that
              can actually change it. */}
          {oneRowNav && inEditor && (
            <>
              <span className="hud-tabs__divider" aria-hidden />
              {EDITOR_TABS.map((t) => {
                const target = t.id === 'notes' ? notesViewForTrack : (t.id as View);
                return (
                  <button
                    key={t.id}
                    data-tab="editor"
                    className={`hud-tab ${view === target ? 'is-active' : ''}`}
                    onClick={() => setView(target)}
                    title={t.hint}
                  >
                    {t.label}
                  </button>
                );
              })}
            </>
          )}
        </div>
        <button
          className="hud-btn hud-btn--ghost hud-btn--icon"
          onClick={() => setHelpOpen(true)}
          aria-label="Help"
          title="Help"
          style={{ alignSelf: 'center', flex: '0 0 auto' }}
        >
          ?
        </button>
        <span
          className="hud-readout--dim hud-readout desktop-only"
          style={{ alignSelf: 'center', whiteSpace: 'nowrap', flex: '0 0 auto' }}
        >
          v0.1.0
        </span>
      </div>

      {inEditor && !oneRowNav && (
        <div className="hud-tabs hud-tabs--sub">
          <div className="hud-tabs__strip" data-scrollx>
            {EDITOR_TABS.map((t) => {
              const target = t.id === 'notes' ? notesViewForTrack : (t.id as View);
              return (
                <button
                  key={t.id}
                  data-tab="editor"
                  className={`hud-tab ${view === target ? 'is-active' : ''}`}
                  onClick={() => setView(target)}
                  title={t.hint}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

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

      {booted && <FirstRunHint />}

      {/* Nothing in this bar was doing any work on a phone: "● Ready" is a
          hardcoded constant, "Stopped" restates the transport's own Play/Stop
          state, and the keyboard hints are already dropped under a coarse
          pointer. Landscape dropped it for the 23px; portrait drops it because
          it was noise. Desktop keeps it — there the shortcut hints earn it. */}
      {!isMobile && <FooterBar />}

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
        fontSize: 12,
        // one line, always: this bar used to wrap to three on a phone and
        // shove the timeline up off the screen
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        flex: '0 0 auto',
      }}
    >
      <span className="hud-readout--green hud-readout">{playing ? '● Playing' : '● Stopped'}</span>
      <span className="hud-readout">
        {trackCount} track{trackCount === 1 ? '' : 's'} · {clipCount} clip{clipCount === 1 ? '' : 's'}
      </span>
      <div style={{ flex: 1, minWidth: 0 }} />
      {/* Keyboard shortcuts are meaningless on a touch device — .desktop-only
          drops them under (pointer: coarse). */}
      <span className="hud-readout--dim hud-readout desktop-only">
        Space ▶ Play · Enter ■ Stop · ? Help · autosaves locally
      </span>
    </div>
  );
});
