import { useEffect, useState } from 'react';
import { useStore, saveProjectToStorage, loadProjectFromStorage, PROJECT_STORAGE_KEY } from '../../state/store';
import { HexFrame } from '../hud/HexFrame';

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
