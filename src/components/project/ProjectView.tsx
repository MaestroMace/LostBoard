import { useCallback, useEffect, useState } from 'react';
import { useStore, saveProjectToStorage, loadProjectFromStorage, PROJECT_STORAGE_KEY } from '../../state/store';
import { HexFrame } from '../hud/HexFrame';
import {
  deleteSlot,
  listSlots,
  newSlotId,
  putSlot,
  type ProjectSlot,
} from '../../state/projectSlots';
import { rehydrateSamples } from '../../state/samples';
import { audioEngine } from '../../audio/engine';

export function ProjectView() {
  const project = useStore((s) => s.project);
  const newProject = useStore((s) => s.newProject);
  const importProject = useStore((s) => s.importProject);
  const exportProject = useStore((s) => s.exportProject);
  const setBpm = useStore((s) => s.setBpm);
  const setTimeSig = useStore((s) => s.setTimeSig);

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
    a.download = `${project.name.replace(/\s+/g, '_')}_${Date.now()}.nervproj.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }} className="hex-grid-bg">
      <HexFrame title="PROJECT // MAGI HEADQUARTERS">
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
        </div>
      </HexFrame>

      <SlotLibrary />

      <HexFrame title="STORAGE // SAVE / LOAD">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            className="nerv-btn"
            onClick={() => {
              saveProjectToStorage();
              setSavedAt(new Date().toLocaleString());
            }}
          >
            💾 SAVE TO BROWSER
          </button>
          <button
            className="nerv-btn"
            onClick={() => {
              if (!loadProjectFromStorage()) alert('No saved project found.');
            }}
          >
            ⤓ LOAD FROM BROWSER
          </button>
          <button className="nerv-btn" onClick={exportFile}>⬇ EXPORT JSON</button>
          <StemBounceButton />
          <label className="nerv-btn" style={{ cursor: 'pointer' }}>
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
            className="nerv-btn nerv-btn--rec"
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
            className="nerv-btn"
            onClick={() => {
              if (!json) return;
              importProject(json);
              setJson('');
            }}
          >
            APPLY JSON
          </button>
          <button className="nerv-btn nerv-btn--ghost" onClick={() => setJson(exportProject())}>RELOAD</button>
        </div>
      </HexFrame>

      <HexFrame title="TAILSCALE // iOS NOTE" variant="green">
        <p style={{ margin: 0, fontSize: 11, lineHeight: 1.6 }}>
          The dev server binds to <span className="hud-value">0.0.0.0:5173</span>. From your iPhone connected to the
          same Tailnet, open <span className="hud-value">http://{'<machine-name>'}.tail-scale.ts.net:5173</span> (or the
          tailnet IP). For a more app-like feel, use Safari → Share → Add to Home Screen. The manifest registers a
          standalone display + iOS status-bar styling.
        </p>
      </HexFrame>
    </div>
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
    a.download = `${slot.name.replace(/\s+/g, '_')}_${slot.savedAt}.nervproj.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <HexFrame title="PROJECT LIBRARY // SLOTS">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="nerv-btn nerv-btn--green" onClick={saveAsNew}>
            + SAVE AS NEW SLOT
          </button>
          <button className="nerv-btn nerv-btn--ghost" onClick={refresh} title="Re-read the slot list">
            ↻ REFRESH
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
                <button className="nerv-btn nerv-btn--icon" onClick={() => load(slot)} title="Load this slot">
                  ⤓ LOAD
                </button>
                <button
                  className="nerv-btn nerv-btn--icon"
                  onClick={() => overwrite(slot)}
                  title="Overwrite with current project"
                >
                  ↻ OVR
                </button>
                <button
                  className="nerv-btn nerv-btn--icon"
                  onClick={() => exportSlot(slot)}
                  title="Download as JSON"
                >
                  ⬇
                </button>
                <button
                  className="nerv-btn nerv-btn--icon nerv-btn--rec"
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
  const durationSec = (beats / project.bpm) * 60 + 0.5;

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
      className="nerv-btn"
      onClick={bounce}
      disabled={busy}
      title="Bounce each track to its own audio file (real-time playthrough)"
    >
      {running ? `⌛ BOUNCING ${Math.round(progress * 100)}%` : '⬇⬇ STEMS'}
    </button>
  );
}
