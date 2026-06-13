import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useStore, saveProjectToStorage, loadProjectFromStorage, PROJECT_STORAGE_KEY } from '../../state/store';
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

export function ProjectView() {
  const project = useStore((s) => s.project);
  const newProject = useStore((s) => s.newProject);
  const importProject = useStore((s) => s.importProject);
  const exportProject = useStore((s) => s.exportProject);
  const setBpm = useStore((s) => s.setBpm);
  const setTimeSig = useStore((s) => s.setTimeSig);
  const setSwing = useStore((s) => s.setSwing);

  const [json, setJson] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);

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
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }} className="hex-grid-bg">
      <HexFrame title="PROJECT // COMMAND DECK">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <Field label="NAME">
            <input
              className="display"
              style={{ width: '100%' }}
              value={project.name}
              onChange={(e) => useStore.setState({ project: { ...project, name: e.target.value, updatedAt: Date.now() } })}
            />
          </Field>
          <Field label="BPM">
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
          <Field label="TIME">
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                className="display"
                type="number"
                min={1}
                max={16}
                value={project.numerator}
                onChange={(e) => setTimeSig(parseInt(e.target.value), project.denominator)}
                style={{ width: 60 }}
              />
              <span style={{ alignSelf: 'center' }}>/</span>
              <select
                className="display"
                value={project.denominator}
                onChange={(e) => setTimeSig(project.numerator, parseInt(e.target.value))}
              >
                {[2, 4, 8, 16].map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          </Field>
          <Field label="BARS">
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
          <Field label={`SWING ${Math.round((project.swing ?? 0) * 100)}%`}>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input
                type="range"
                className="hud-slider"
                min={0}
                max={1}
                step={0.01}
                value={project.swing ?? 0}
                onChange={(e) => setSwing(parseFloat(e.target.value), project.swingSubdivision ?? '8n')}
                style={{ flex: 1 }}
              />
              <select
                className="display"
                value={project.swingSubdivision ?? '8n'}
                onChange={(e) => setSwing(project.swing ?? 0, e.target.value)}
                title="Swing grid"
              >
                <option value="8n">1/8</option>
                <option value="16n">1/16</option>
              </select>
            </div>
          </Field>
        </div>
      </HexFrame>

      <TempoMapEditor />

      <MidiSyncPanel />

      <SlotLibrary />

      <HexFrame title="STORAGE // SAVE / LOAD">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            className="hud-btn"
            onClick={() => {
              saveProjectToStorage();
              setSavedAt(new Date().toLocaleString());
            }}
          >
            💾 SAVE TO BROWSER
          </button>
          <button
            className="hud-btn"
            onClick={() => {
              if (!loadProjectFromStorage()) alert('No saved project found.');
            }}
          >
            ⤓ LOAD FROM BROWSER
          </button>
          <button className="hud-btn" onClick={exportFile}>⬇ EXPORT JSON</button>
          <OfflineBounceButton />
          <OfflineStemsButton />
          <StemBounceButton />
          <label className="hud-btn" style={{ cursor: 'pointer' }}>
            ⬆ IMPORT JSON
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
          <button
            className="hud-btn hud-btn--rec"
            onClick={() => {
              if (confirm('Discard current project and start new?')) newProject();
            }}
          >
            ⌫ NEW PROJECT
          </button>
          {savedAt && (
            <span className="hud-readout--green hud-readout">LAST SAVE: {savedAt}</span>
          )}
        </div>
      </HexFrame>

      <HexFrame title="RAW DATA">
        <textarea
          className="display"
          rows={10}
          value={json || exportProject()}
          onChange={(e) => setJson(e.target.value)}
          style={{ width: '100%', minHeight: 220, fontFamily: 'var(--font-data)', fontSize: 11 }}
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
            APPLY JSON
          </button>
          <button className="hud-btn hud-btn--ghost" onClick={() => setJson(exportProject())}>RELOAD</button>
        </div>
      </HexFrame>

      <InstallBanner />

      <HexFrame title="TAILSCALE // iOS NOTE" variant="green">
        <p style={{ margin: 0, fontSize: 11, lineHeight: 1.6 }}>
          The dev server binds to <span className="hud-value">0.0.0.0:5273</span>. From your iPhone connected to the
          same Tailnet, open <span className="hud-value">http://{'<machine-name>'}.tail-scale.ts.net:5273</span> (or the
          tailnet IP). For a more app-like feel, use Safari → Share → Add to Home Screen. The manifest registers a
          standalone display + iOS status-bar styling.
        </p>
      </HexFrame>
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
    <HexFrame title="INSTALL // PWA" variant="green">
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
          ⬇ INSTALL TO HOME
        </button>
        <span className="hud-readout--dim hud-readout" style={{ fontSize: 10 }}>
          Run LOSTBOARD as a standalone app, with safe-area insets honored on
          phone screens.
        </span>
      </div>
    </HexFrame>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="hud-label" style={{ fontSize: 9 }}>{label}</span>
      {children}
    </div>
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
    loadProject(slot.project);
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
    <HexFrame title="PROJECT LIBRARY // SLOTS">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="hud-btn hud-btn--green" onClick={saveAsNew}>
            + SAVE AS NEW SLOT
          </button>
          <button className="hud-btn hud-btn--ghost" onClick={refresh} title="Re-read the slot list">
            ↻ REFRESH
          </button>
          <button
            className="hud-btn hud-btn--ghost"
            onClick={async () => {
              if (!confirm('Delete persisted audio samples not referenced by any slot or the current project?')) return;
              const n = await gcOrphanedSamples();
              alert(n === 0 ? 'No orphaned samples found.' : `Removed ${n} orphaned sample${n === 1 ? '' : 's'}.`);
            }}
            title="Garbage-collect audio samples no project references any more"
          >
            ⌫ GC SAMPLES
          </button>
          <span className="hud-readout--dim hud-readout" style={{ fontSize: 9 }}>
            {slots.length} slot{slots.length === 1 ? '' : 's'} · stored in browser IndexedDB
          </span>
        </div>
        {slots.length === 0 ? (
          <p className="hud-readout--dim hud-readout" style={{ margin: 0, fontSize: 11 }}>
            No saved slots yet. Save the current project to create one.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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
                <span className="hud-value" style={{ minWidth: 160, fontSize: 11 }}>
                  {slot.name}
                </span>
                <span className="hud-readout--dim hud-readout" style={{ fontSize: 9 }}>
                  {new Date(slot.savedAt).toLocaleString()}
                </span>
                <span className="hud-readout--dim hud-readout" style={{ fontSize: 9 }}>
                  {slot.project.tracks.length}t · {slot.project.bpm.toFixed(0)} bpm
                </span>
                <div style={{ flex: 1 }} />
                <button className="hud-btn hud-btn--icon" onClick={() => load(slot)} title="Load this slot">
                  ⤓ LOAD
                </button>
                <button
                  className="hud-btn hud-btn--icon"
                  onClick={() => overwrite(slot)}
                  title="Overwrite with current project"
                >
                  ↻ OVR
                </button>
                <button
                  className="hud-btn hud-btn--icon"
                  onClick={() => exportSlot(slot)}
                  title="Download as JSON"
                >
                  ⬇
                </button>
                <button
                  className="hud-btn hud-btn--icon hud-btn--rec"
                  onClick={() => remove(slot)}
                  title="Delete this slot"
                >
                  ✕
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

  return (
    <HexFrame title="MIDI SYNC // CLOCK">
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
            ⧖ CLOCK OUT {midiClockOut ? 'ON' : 'OFF'}
          </button>
          <span className="hud-readout--dim hud-readout" style={{ fontSize: 10 }}>
            {!midi.supported
              ? 'Web MIDI unavailable in this browser.'
              : midiClockOut
                ? `24-PPQN clock → ${portName ?? 'no output port'}`
                : 'Sync external gear to the transport tempo.'}
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
            ⧗ CLOCK IN {midiClockIn ? 'ON' : 'OFF'}
          </button>
          <span className="hud-readout--dim hud-readout" style={{ fontSize: 10 }}>
            {midiClockIn
              ? 'Transport follows an incoming external clock — it owns the tempo.'
              : 'Lock the transport to an external MIDI clock.'}
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
        style={{ position: 'absolute', top: 2, left: 4, fontSize: 8 }}
      >
        {hi.toFixed(0)} BPM
      </span>
      <span
        className="hud-readout--dim hud-readout"
        style={{ position: 'absolute', bottom: 2, left: 4, fontSize: 8 }}
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
    <HexFrame title="TEMPO MAP // BPM AUTOMATION">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="hud-btn hud-btn--green"
            onClick={() => addTempoEvent(events.length === 0 ? 0 : projectBeats / 2, project.bpm)}
          >
            + ADD EVENT
          </button>
          {events.length > 0 && (
            <button className="hud-btn hud-btn--ghost" onClick={() => clearTempoMap()}>
              ✕ CLEAR MAP
            </button>
          )}
          <span className="hud-readout--dim hud-readout" style={{ fontSize: 9 }}>
            {events.length === 0
              ? `flat — using ${project.bpm.toFixed(1)} BPM throughout`
              : `${events.length} event${events.length === 1 ? '' : 's'}`}
          </span>
        </div>
        {events.length > 0 && <TempoCurve events={events} projectBpm={project.bpm} projectBeats={projectBeats} />}
        {events.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '70px 1fr 1fr 100px 60px',
                gap: 6,
                padding: '4px 8px',
                fontSize: 9,
              }}
              className="hud-readout--dim hud-readout"
            >
              <span>#</span>
              <span>BEAT</span>
              <span>BPM</span>
              <span>CURVE</span>
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
                <span className="hud-value" style={{ fontSize: 11 }}>EV-{String(i + 1).padStart(2, '0')}</span>
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
                  title={i === 0 ? 'First event — no curve into it' : 'Step jumps; ramp glides linearly from previous BPM'}
                  style={{ width: '100%' }}
                >
                  <option value="step">⌐ step</option>
                  <option value="ramp">╱ ramp</option>
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
        <p className="hud-readout--dim hud-readout" style={{ fontSize: 9, margin: 0 }}>
          Events fire on their beat. An event at beat 0 overrides the project
          BPM as the starting tempo. Affects offline bounce duration too.
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
      alert('Switch back to ARRANGEMENT mode in the SESSION tab first.');
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
      {running ? '⌛ RENDERING…' : '⚡ BOUNCE WAV'}
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
      alert('Switch back to ARRANGEMENT mode in the SESSION tab first.');
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
      {running ? `⌛ STEMS ${Math.round(progress * 100)}%` : '⚡⬇ OFFLINE STEMS'}
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
      alert('Switch back to ARRANGEMENT mode in the SESSION tab first — stems bounce from the arrangement timeline.');
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
      {running ? `⌛ BOUNCING ${Math.round(progress * 100)}%` : '⬇⬇ STEMS'}
    </button>
  );
}
