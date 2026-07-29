import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useStore, saveProjectToStorage, loadProjectFromStorage, migrateNames, PROJECT_STORAGE_KEY } from '../../state/store';
import { HexFrame } from '../hud/HexFrame';
import {
  deleteSlot,
  listSlots,
  newSlotId,
  putSlot,
  type ProjectSlot,
} from '../../state/projectSlots';
import { rehydrateSamples, gcOrphanedSamples } from '../../state/samples';
import { audioEngine } from '../../audio/engine';
import { midiInput } from '../../audio/midiInput';
import { subscribeMidiOut, getMidiOutSnapshot } from '../../audio/midiOutput';
import { audioBufferToWav } from '../../audio/wav';
import { projectDurationSec, type TempoEvent } from '../../audio/types';
import { useLayoutMode } from '../../hooks/useLayoutMode';

/**
 * Project used to be one unbroken scroll: tempo, a tempo map, MIDI clock,
 * a slot library, save/load, a raw JSON box and a note about dev servers, all
 * at the same level with nothing to say which you wanted. They answer three
 * different questions, so they now sit behind three named sections and you
 * land on the one people actually come here for.
 */
type Section = 'song' | 'files' | 'advanced';

const SECTIONS: { id: Section; label: string; hint: string }[] = [
  { id: 'song', label: 'Song', hint: 'Name, tempo, time signature, length' },
  { id: 'files', label: 'Saving', hint: 'Saved songs, export, bounce to audio' },
  { id: 'advanced', label: 'Advanced', hint: 'MIDI clock, raw project data, install' },
];

export function ProjectView() {
  const land = useLayoutMode() === 'phone-landscape';
  const project = useStore((s) => s.project);
  const newProject = useStore((s) => s.newProject);
  const importProject = useStore((s) => s.importProject);
  const exportProject = useStore((s) => s.exportProject);
  const setBpm = useStore((s) => s.setBpm);
  const setTimeSig = useStore((s) => s.setTimeSig);
  const setSwing = useStore((s) => s.setSwing);

  const [json, setJson] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [section, setSection] = useState<Section>('song');

  useEffect(() => {
    const raw = localStorage.getItem(PROJECT_STORAGE_KEY);
    if (raw) {
      try {
        const p = JSON.parse(raw);
        setSavedAt(new Date(p.updatedAt).toLocaleString());
      } catch {}
    }
  }, []);

  function exportFile() {
    const data = exportProject();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/\s+/g, '_')}_${Date.now()}.lostproj.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: land ? 'row' : 'column' }}
      className="hex-grid-bg"
    >
      <div
        className="hud-tabs hud-tabs--sub"
        style={land ? { flexDirection: 'column', alignItems: 'stretch', borderBottom: 'none', borderRight: '1px solid rgba(255,106,0,0.22)', flex: '0 0 auto' } : undefined}
      >
        <div className="hud-tabs__strip" style={land ? { flexDirection: 'column', flexWrap: 'nowrap' } : undefined}>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`hud-tab ${section === s.id ? 'is-active' : ''}`}
              onClick={() => setSection(s.id)}
              title={s.hint}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {section === 'song' && (
      <>
      <HexFrame title="Song settings">
        {/* 140 not 200: at 200 a phone got one field per row and the four
            short numeric fields each ate a full-width box. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          <Field label="Name">
            <input
              className="display"
              style={{ width: '100%' }}
              value={project.name}
              onChange={(e) => useStore.setState({ project: { ...project, name: e.target.value, updatedAt: Date.now() } })}
            />
          </Field>
          <Field label="Tempo (BPM)">
            <input
              className="display"
              type="number"
              min={30}
              max={300}
              step={0.5}
              value={project.bpm}
              onChange={(e) => setBpm(parseFloat(e.target.value || '120'))}
              style={{ width: '100%' }}
            />
          </Field>
          <Field label="Time signature">
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                className="display"
                type="number"
                min={1}
                max={16}
                value={project.numerator}
                onChange={(e) => setTimeSig(parseInt(e.target.value), project.denominator)}
                aria-label="Beats per bar"
                style={{ width: 60 }}
              />
              <span style={{ alignSelf: 'center' }}>/</span>
              {/* The wrapping <label> names the first control only, so this one
                  needs its own or it reads as an unnamed dropdown. */}
              <select
                className="display"
                value={project.denominator}
                onChange={(e) => setTimeSig(project.numerator, parseInt(e.target.value))}
                aria-label="Beat length"
              >
                {[2, 4, 8, 16].map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          </Field>
          <Field label="Length (bars)">
            <input
              className="display"
              type="number"
              min={1}
              max={256}
              value={project.lengthBars}
              onChange={(e) => useStore.setState({ project: { ...project, lengthBars: Math.max(1, parseInt(e.target.value) || 16), updatedAt: Date.now() } })}
              style={{ width: '100%' }}
            />
          </Field>
          {/* Two columns wide. A 1fr column here is ~150px, and the field's own
              floor is 190 (120 of slider travel plus the 1/8 vs 1/16 select),
              so as a single column it pushed 30px of the select past the right
              edge of the viewport with only 8px of scroll to recover it. */}
          <Field label={`Swing — ${Math.round((project.swing ?? 0) * 100)}%`} span={2}>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', minWidth: 0 }}>
              <input
                type="range"
                className="hud-slider"
                min={0}
                max={1}
                step={0.01}
                value={project.swing ?? 0}
                onChange={(e) => setSwing(parseFloat(e.target.value), project.swingSubdivision ?? '8n')}
                aria-label="Swing amount"
                // a floor, not just flex: with the section rail taking width in
                // landscape this collapsed to 48px of travel
                style={{ flex: 1, minWidth: 120 }}
              />
              <select
                className="display"
                value={project.swingSubdivision ?? '8n'}
                onChange={(e) => setSwing(project.swing ?? 0, e.target.value)}
                aria-label="Swing note length"
                title="Whether swing is applied to 1/8 or 1/16 notes"
              >
                <option value="8n">1/8</option>
                <option value="16n">1/16</option>
              </select>
            </div>
          </Field>
        </div>
      </HexFrame>

      <TempoMapEditor />
      </>
      )}

      {section === 'files' && (
      <>
      <HexFrame title="This song">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            className="hud-btn"
            onClick={() => {
              saveProjectToStorage();
              setSavedAt(new Date().toLocaleString());
            }}
            title="Keep the current song on this device"
          >
            Save now
          </button>
          <button
            className="hud-btn"
            onClick={() => {
              if (!loadProjectFromStorage()) alert('Nothing has been saved on this device yet.');
            }}
            title="Go back to the last saved version, losing changes since"
          >
            Revert to saved
          </button>
          <button
            className="hud-btn hud-btn--rec"
            onClick={() => {
              if (confirm('Start a new song? Anything unsaved will be lost.')) newProject();
            }}
          >
            New song
          </button>
          <span className="hud-readout--dim hud-readout" style={{ fontSize: 12 }}>
            {savedAt ? `Last saved ${savedAt}` : 'Saves by itself every 20 seconds'}
          </span>
        </div>
      </HexFrame>

      <SlotLibrary />

      <HexFrame title="Bounce to audio">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <OfflineBounceButton />
          <OfflineStemsButton />
          <StemBounceButton />
        </div>
      </HexFrame>

      <HexFrame title="Move between devices">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="hud-btn" onClick={exportFile} title="Download the song as a file you can keep or share">
            Export song file
          </button>
          <label className="hud-btn" style={{ cursor: 'pointer' }}>
            Import song file
            <input
              type="file"
              accept="application/json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => importProject(String(reader.result));
                reader.readAsText(file);
              }}
              style={{ display: 'none' }}
            />
          </label>
        </div>
      </HexFrame>
      </>
      )}

      {section === 'advanced' && (
      <>
      <MidiSyncPanel />

      <InstallBanner />

      <HexFrame title="Project data" variant="soft">
        <p className="hud-readout--dim hud-readout" style={{ margin: '0 0 8px', fontSize: 12 }}>
          The whole song as text. Editing this by hand can break it &mdash; export a file first.
        </p>
        <textarea
          className="display"
          rows={3}
          value={json || exportProject()}
          onChange={(e) => setJson(e.target.value)}
          aria-label="Project data as JSON"
          // 84, not 220: at 220 the only non-textarea drag surface shrank to
          // 2px and Apply first appeared at scrollTop 252.
          style={{ width: '100%', minHeight: 84, overscrollBehavior: 'contain', fontFamily: 'var(--font-data)', fontSize: 13 }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            className="hud-btn"
            onClick={() => {
              if (!json) return;
              importProject(json);
              setJson('');
            }}
          >
            Apply
          </button>
          <button className="hud-btn hud-btn--ghost" onClick={() => setJson(exportProject())}>
            Discard edits
          </button>
        </div>
      </HexFrame>
      </>
      )}
      </div>
    </div>
  );
}

/**
 * InstallBanner — captures the browser's `beforeinstallprompt` event so we
 * can offer a one-click PWA install on Chromium-family browsers. iOS Safari
 * doesn't fire this event (Add-to-Home-Screen is manual there); we leave
 * the existing iOS note in place for that path. Hidden once the app is
 * already running in standalone display mode.
 */
type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function InstallBanner() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const standalone =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches ||
      // Safari iOS legacy flag
      (window.navigator as unknown as { standalone?: boolean }).standalone === true);

  if (standalone || installed || !prompt) return null;

  return (
    <HexFrame title="Install as an app" variant="green">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className="hud-btn hud-btn--green"
          onClick={async () => {
            await prompt.prompt();
            try {
              await prompt.userChoice;
            } catch {
              /* user dismissed */
            }
            setPrompt(null);
          }}
        >
          Add to home screen
        </button>
        <span className="hud-readout--dim hud-readout" style={{ fontSize: 12 }}>
          Opens LostBoard like any other app, full screen, without the browser bar.
        </span>
      </div>
    </HexFrame>
  );
}

/**
 * A real <label> wrapping the control, not a <span> sitting above it — so the
 * caption is the control's accessible name and tapping the caption focuses the
 * field. As a span, the song-name box had no name at all.
 */
function Field({ label, children, span }: { label: string; children: React.ReactNode; span?: number }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: span ? `span ${span}` : undefined, minWidth: 0 }}>
      <span className="hud-label" style={{ fontSize: 12 }}>{label}</span>
      {children}
    </label>
  );
}

/**
 * SlotLibrary — multiple named save slots persisted in IndexedDB, so the
 * single autosave isn't the only way to keep work. Recorded/imported audio
 * stays in IndexedDB across slots (sample ids are stable), so loading a
 * different slot still hears its audio clips.
 */
function SlotLibrary() {
  const project = useStore((s) => s.project);
  const loadProject = useStore((s) => s.loadProject);
  const [slots, setSlots] = useState<ProjectSlot[]>([]);

  const refresh = useCallback(async () => {
    try {
      setSlots(await listSlots());
    } catch (e) {
      console.warn('listSlots failed', e);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function saveAsNew() {
    const name = prompt('Slot name?', project.name);
    if (!name) return;
    await putSlot({
      id: newSlotId(),
      name,
      savedAt: Date.now(),
      project: { ...project, name },
    });
    refresh();
  }

  async function overwrite(slot: ProjectSlot) {
    if (!confirm(`Overwrite "${slot.name}" with the current project?`)) return;
    await putSlot({ ...slot, project, savedAt: Date.now() });
    refresh();
  }

  async function load(slot: ProjectSlot) {
    if (!confirm(`Load "${slot.name}"? Unsaved changes to the current project will be lost.`)) return;
    loadProject(migrateNames(slot.project));
    // re-decode persisted audio after a load, since samples may have been
    // added in another slot's session
    rehydrateSamples().then((n) => {
      if (n > 0 && audioEngine.isInited()) {
        audioEngine.schedule(useStore.getState().project);
      }
    });
  }

  async function remove(slot: ProjectSlot) {
    if (!confirm(`Delete slot "${slot.name}"? This cannot be undone.`)) return;
    await deleteSlot(slot.id);
    refresh();
  }

  function exportSlot(slot: ProjectSlot) {
    const blob = new Blob([JSON.stringify(slot.project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slot.name.replace(/\s+/g, '_')}_${slot.savedAt}.lostproj.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <HexFrame title="Saved songs">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="hud-btn hud-btn--green" onClick={saveAsNew} title="Keep a named copy you can come back to">
            + Save a copy
          </button>
          <button className="hud-btn hud-btn--ghost" onClick={refresh} title="Re-read the list">
            Refresh
          </button>
          <button
            className="hud-btn hud-btn--ghost"
            onClick={async () => {
              if (!confirm('Delete recorded audio that no saved song uses any more?')) return;
              const n = await gcOrphanedSamples();
              alert(n === 0 ? 'Nothing to clean up.' : `Freed ${n} unused recording${n === 1 ? '' : 's'}.`);
            }}
            title="Delete recorded audio that no saved song refers to any more"
          >
            Free up space
          </button>
          <span className="hud-readout--dim hud-readout" style={{ fontSize: 12 }}>
            {slots.length} saved on this device
          </span>
        </div>
        {/* Capped and scrollable: with four saved songs, zero rows were
            visible and nothing on screen said any existed. */}
        {slots.length === 0 ? (
          <p className="hud-readout--dim hud-readout" style={{ margin: 0, fontSize: 13 }}>
            Nothing saved yet. &ldquo;Save a copy&rdquo; keeps the song you have now under a name of its own, so you
            can try something else without losing it.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 120, overflowY: 'auto', overscrollBehavior: 'contain' }}>
            {slots.map((slot) => (
              <div
                key={slot.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 8px',
                  background: 'rgba(0,0,0,0.4)',
                  border: '1px solid rgba(255,106,0,0.2)',
                  flexWrap: 'wrap',
                }}
              >
                <span className="hud-value" style={{ minWidth: 160, fontSize: 13 }}>
                  {slot.name}
                </span>
                <span className="hud-readout--dim hud-readout" style={{ fontSize: 12 }}>
                  {new Date(slot.savedAt).toLocaleString()}
                </span>
                <span className="hud-readout--dim hud-readout" style={{ fontSize: 12 }}>
                  {slot.project.tracks.length} track{slot.project.tracks.length === 1 ? '' : 's'} ·{' '}
                  {slot.project.bpm.toFixed(0)} BPM
                </span>
                <div style={{ flex: 1 }} />
                <button className="hud-btn hud-btn--tight" onClick={() => load(slot)} title={`Open ${slot.name}`}>
                  Open
                </button>
                <button
                  className="hud-btn hud-btn--tight"
                  onClick={() => overwrite(slot)}
                  title={`Replace ${slot.name} with the song you have open now`}
                >
                  Replace
                </button>
                <button
                  className="hud-btn hud-btn--tight"
                  onClick={() => exportSlot(slot)}
                  aria-label={`Export ${slot.name} as a file`}
                  title="Download as a file"
                >
                  Export
                </button>
                <button
                  className="hud-btn hud-btn--tight hud-btn--rec"
                  onClick={() => remove(slot)}
                  aria-label={`Delete ${slot.name}`}
                  title={`Delete ${slot.name}`}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </HexFrame>
  );
}

/**
 * MidiSyncPanel — MIDI clock sync, both directions.
 *
 * CLOCK OUT: the engine sends 24-PPQN timing clock + start/continue/stop
 * to the selected output port, so external gear locks to the transport.
 *
 * CLOCK IN: the transport locks to an incoming external clock — BPM is
 * re-derived from the pulse rate and start/continue/stop drive the
 * transport. With sync-in on, the external device owns the tempo (a
 * tempo map would fight it).
 */
function MidiSyncPanel() {
  const midiClockOut = useStore((s) => s.midiClockOut);
  const setMidiClockOut = useStore((s) => s.setMidiClockOut);
  const midiClockIn = useStore((s) => s.midiClockIn);
  const setMidiClockIn = useStore((s) => s.setMidiClockIn);
  const midi = useSyncExternalStore(subscribeMidiOut, getMidiOutSnapshot, getMidiOutSnapshot);
  const portName = midi.ports.find((p) => p.id === midi.selectedId)?.name;

  // Android WebView has no Web MIDI. Showing two permanently-disabled buttons
  // plus an apology is worse than showing one sentence.
  if (!midi.supported) {
    return (
      <HexFrame title="MIDI sync" variant="soft">
        <p className="hud-readout--dim hud-readout" style={{ margin: 0, fontSize: 13 }}>
          This device can&rsquo;t talk MIDI to other gear, so clock sync is unavailable here.
        </p>
      </HexFrame>
    );
  }

  return (
    <HexFrame title="MIDI sync">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className={`hud-btn ${midiClockOut ? 'is-active' : ''}`}
            onClick={() => {
              const next = !midiClockOut;
              setMidiClockOut(next);
              audioEngine.setMidiClockEnabled(next);
            }}
            disabled={!midi.supported}
            aria-pressed={midiClockOut}
          >
            Send clock: {midiClockOut ? 'on' : 'off'}
          </button>
          <span className="hud-readout--dim hud-readout" style={{ fontSize: 12 }}>
            {midiClockOut
              ? `Other gear follows this tempo, via ${portName ?? 'no output chosen yet'}`
              : 'Make other gear follow this song’s tempo.'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className={`hud-btn ${midiClockIn ? 'is-active' : ''}`}
            onClick={() => {
              const next = !midiClockIn;
              setMidiClockIn(next);
              midiInput.setClockSync(next);
            }}
            disabled={!midi.supported}
            aria-pressed={midiClockIn}
          >
            Follow clock: {midiClockIn ? 'on' : 'off'}
          </button>
          <span className="hud-readout--dim hud-readout" style={{ fontSize: 12 }}>
            {midiClockIn
              ? 'This song follows the other device’s tempo — the tempo box here is ignored.'
              : 'Follow another device’s tempo instead of this song’s.'}
          </span>
        </div>
      </div>
    </HexFrame>
  );
}

/**
 * TempoCurve — read-only BPM-over-beats sparkline for the tempo map.
 * Step events draw as a horizontal hold + vertical jump; ramp events
 * draw as a diagonal. The first event seeds the starting BPM, and the
 * curve extends flat to the end of the project so accel/rit shapes are
 * legible at a glance without scrubbing the transport.
 */
function TempoCurve({
  events,
  projectBpm,
  projectBeats,
}: {
  events: TempoEvent[];
  projectBpm: number;
  projectBeats: number;
}) {
  const sorted = [...events].sort((a, b) => a.beat - b.beat);
  // build (beat, bpm) vertices that already encode step vs ramp
  const verts: { beat: number; bpm: number }[] = [];
  let bpm = sorted[0].beat <= 0 ? sorted[0].bpm : projectBpm;
  verts.push({ beat: 0, bpm });
  for (const ev of sorted) {
    if (ev.beat <= 0) {
      bpm = ev.bpm;
      verts[0] = { beat: 0, bpm };
      continue;
    }
    if (ev.curve === 'ramp') {
      verts.push({ beat: ev.beat, bpm: ev.bpm });
    } else {
      verts.push({ beat: ev.beat, bpm }); // hold previous
      verts.push({ beat: ev.beat, bpm: ev.bpm }); // jump
    }
    bpm = ev.bpm;
  }
  verts.push({ beat: projectBeats, bpm });

  const bpms = verts.map((v) => v.bpm);
  const lo = Math.min(...bpms) - 4;
  const hi = Math.max(...bpms) + 4;
  const span = Math.max(1, hi - lo);
  const x = (beat: number) => (beat / Math.max(1, projectBeats)) * 100;
  const y = (b: number) => (1 - (b - lo) / span) * 100;
  const path = verts.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(v.beat)} ${y(v.bpm)}`).join(' ');

  return (
    <div
      style={{
        position: 'relative',
        border: '1px solid rgba(255,106,0,0.3)',
        background: 'linear-gradient(180deg, rgba(255,106,0,0.04), rgba(255,106,0,0.1))',
      }}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height={64} style={{ display: 'block' }}>
        <path d={path} fill="none" stroke="var(--hud-orange-bright)" strokeWidth={0.7} vectorEffect="non-scaling-stroke" />
        {verts.map((v, i) => (
          <circle key={i} cx={x(v.beat)} cy={y(v.bpm)} r={1} fill="var(--hud-amber)" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <span
        className="hud-readout--dim hud-readout"
        style={{ position: 'absolute', top: 2, left: 4, fontSize: 11 }}
      >
        {hi.toFixed(0)} BPM
      </span>
      <span
        className="hud-readout--dim hud-readout"
        style={{ position: 'absolute', bottom: 2, left: 4, fontSize: 11 }}
      >
        {lo.toFixed(0)} BPM
      </span>
    </div>
  );
}

/**
 * TempoMapEditor — sparse list of (beat, BPM) events. Empty list means the
 * project uses its single `bpm` everywhere; any events take precedence
 * from their beat onward. Each event can step-jump or ramp into its BPM;
 * the engine schedules `Transport.bpm.setValueAtTime` /
 * `linearRampToValueAtTime` accordingly.
 */
function TempoMapEditor() {
  const project = useStore((s) => s.project);
  const addTempoEvent = useStore((s) => s.addTempoEvent);
  const updateTempoEvent = useStore((s) => s.updateTempoEvent);
  const removeTempoEvent = useStore((s) => s.removeTempoEvent);
  const clearTempoMap = useStore((s) => s.clearTempoMap);

  const events: TempoEvent[] = project.tempoMap ?? [];
  const projectBeats = project.lengthBars * project.numerator;

  return (
    <HexFrame title="Tempo changes">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="hud-btn hud-btn--green"
            onClick={() => addTempoEvent(events.length === 0 ? 0 : projectBeats / 2, project.bpm)}
          >
            + Add a change
          </button>
          {events.length > 0 && (
            <button className="hud-btn hud-btn--ghost" onClick={() => clearTempoMap()}>
              Clear all
            </button>
          )}
          <span className="hud-readout--dim hud-readout" style={{ fontSize: 12 }}>
            {events.length === 0
              ? `Steady ${project.bpm.toFixed(1)} BPM the whole way through`
              : `${events.length} change${events.length === 1 ? '' : 's'}`}
          </span>
        </div>
        {events.length > 0 && <TempoCurve events={events} projectBpm={project.bpm} projectBeats={projectBeats} />}
        {events.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 120, overflowY: 'auto', overscrollBehavior: 'contain' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '70px 1fr 1fr 100px 60px',
                gap: 6,
                padding: '4px 8px',
                fontSize: 12,
              }}
              className="hud-readout--dim hud-readout"
            >
              <span>#</span>
              <span>Beat</span>
              <span>BPM</span>
              <span>Shape</span>
              <span></span>
            </div>
            {events.map((ev, i) => (
              <div
                key={ev.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '70px 1fr 1fr 100px 60px',
                  gap: 6,
                  padding: '4px 8px',
                  background: 'rgba(0,0,0,0.4)',
                  border: '1px solid rgba(255,106,0,0.2)',
                  alignItems: 'center',
                }}
              >
                <span className="hud-value" style={{ fontSize: 13 }}>{i + 1}</span>
                <input
                  className="display"
                  type="number"
                  min={0}
                  step={0.25}
                  value={ev.beat}
                  onChange={(e) => updateTempoEvent(ev.id, { beat: parseFloat(e.target.value) || 0 })}
                  style={{ width: '100%' }}
                />
                <input
                  className="display"
                  type="number"
                  min={20}
                  max={400}
                  step={0.5}
                  value={ev.bpm}
                  onChange={(e) => updateTempoEvent(ev.id, { bpm: parseFloat(e.target.value) || project.bpm })}
                  style={{ width: '100%' }}
                />
                <select
                  className="display"
                  value={ev.curve ?? 'step'}
                  onChange={(e) => updateTempoEvent(ev.id, { curve: e.target.value as 'step' | 'ramp' })}
                  disabled={i === 0}
                  aria-label={`Shape into change ${i + 1}`}
                  title={i === 0 ? 'Nothing comes before the first change' : 'Jump changes tempo at once; glide slides there from the tempo before'}
                  style={{ width: '100%' }}
                >
                  <option value="step">⌐ Jump</option>
                  <option value="ramp">╱ Glide</option>
                </select>
                <button
                  className="hud-btn hud-btn--icon hud-btn--rec"
                  onClick={() => removeTempoEvent(ev.id)}
                  title="Remove this tempo event"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="hud-readout--dim hud-readout" style={{ fontSize: 12, margin: 0 }}>
          Each change takes effect on its beat. One placed at beat 0 sets the tempo the song starts at.
        </p>
      </div>
    </HexFrame>
  );
}

/**
 * OfflineBounceButton — renders the full project to a WAV via Tone.Offline,
 * usually many times faster than real-time. The audio doesn't play out of
 * speakers during the render; the live transport keeps running unaffected,
 * since Tone.Offline builds a parallel offline graph for the duration of
 * the callback.
 */
function OfflineBounceButton() {
  const project = useStore((s) => s.project);
  const sessionMode = useStore((s) => s.sessionMode);
  const [running, setRunning] = useState(false);

  const beats = project.lengthBars * project.numerator;
  const durationSec = projectDurationSec(project, beats) + 0.5;

  async function bounce() {
    if (sessionMode) {
      alert('Switch the Clips tab back to playing the Timeline first — tracks bounce from the song timeline, not from launched loops.');
      return;
    }
    setRunning(true);
    try {
      const buffer = await audioEngine.bounceOffline(project, durationSec);
      const blob = audioBufferToWav(buffer);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.name.replace(/\s+/g, '_')}__master_${Date.now()}.wav`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Offline bounce failed', e);
      alert('Offline bounce failed; see console.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <button
      className="hud-btn"
      onClick={bounce}
      disabled={running}
      title="Render the full project to WAV faster-than-real-time (Tone.Offline)"
    >
      {running ? 'Bouncing…' : 'Whole song to WAV'}
    </button>
  );
}

/**
 * OfflineStemsButton — one offline render per track (every other track
 * muted), each encoded as a WAV. Faster-than-real-time overall on any
 * non-trivial project; produces clean per-track WAVs suitable for an
 * external DAW remix.
 */
function OfflineStemsButton() {
  const project = useStore((s) => s.project);
  const sessionMode = useStore((s) => s.sessionMode);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  const beats = project.lengthBars * project.numerator;
  const durationSec = projectDurationSec(project, beats) + 0.5;

  async function bounce() {
    if (sessionMode) {
      alert('Switch the Clips tab back to playing the Timeline first — tracks bounce from the song timeline, not from launched loops.');
      return;
    }
    if (!confirm(`Render ${project.tracks.length} offline stems? Usually faster than real-time.`)) return;
    setRunning(true);
    setProgress(0);
    try {
      const stems = await audioEngine.bounceStemsOffline(project, durationSec, (i, total) => {
        setProgress(total > 0 ? i / total : 0);
      });
      for (const stem of stems) {
        const blob = audioBufferToWav(stem.buffer);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${project.name.replace(/\s+/g, '_')}__${stem.name.replace(/[^\w]+/g, '_')}.wav`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      console.error('Offline stems failed', e);
      alert('Offline stems failed; see console.');
    } finally {
      setRunning(false);
      setProgress(0);
    }
  }

  return (
    <button
      className="hud-btn"
      onClick={bounce}
      disabled={running}
      title="Render each track to its own WAV faster-than-real-time"
    >
      {running ? `Bouncing tracks… ${Math.round(progress * 100)}%` : 'Each track to its own WAV'}
    </button>
  );
}

/**
 * StemBounceButton — bounces every track to its own audio file in one
 * real-time playthrough, then downloads each as a .webm. Disabled while
 * in session mode (the arrangement scheduler is what feeds the channels)
 * and while a bounce or transport is already running.
 */
function StemBounceButton() {
  const project = useStore((s) => s.project);
  const sessionMode = useStore((s) => s.sessionMode);
  const playing = useStore((s) => s.isPlaying);
  const bouncing = useStore((s) => s.bouncing);
  const setPlaying = useStore((s) => s.setPlaying);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  const busy = running || bouncing || playing;
  const beats = project.lengthBars * project.numerator;
  const durationSec = projectDurationSec(project, beats) + 0.5;

  async function bounce() {
    if (sessionMode) {
      alert('Switch the Clips tab back to playing the Timeline first — tracks bounce from the song timeline, not from launched loops.');
      return;
    }
    if (!confirm(`Bounce ${project.tracks.length} stems? Playback runs for ~${durationSec.toFixed(1)}s.`)) return;
    setRunning(true);
    setProgress(0);
    const tick = window.setInterval(() => setProgress((p) => Math.min(0.99, p + 0.05 / durationSec)), 50);
    try {
      const stems = await audioEngine.bounceStems(project, durationSec);
      setPlaying(false);
      // download each stem as a file
      for (const stem of stems) {
        const url = URL.createObjectURL(stem.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${project.name.replace(/\s+/g, '_')}__${stem.name.replace(/[^\w]+/g, '_')}.webm`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      console.error('Stem bounce failed', e);
      alert('Stem bounce failed; see console.');
    } finally {
      clearInterval(tick);
      setRunning(false);
      setProgress(0);
    }
  }

  return (
    <button
      className="hud-btn"
      onClick={bounce}
      disabled={busy}
      title="Bounce each track to its own audio file (real-time playthrough)"
    >
      {running ? `Recording tracks… ${Math.round(progress * 100)}%` : 'Each track, recorded live'}
    </button>
  );
}
