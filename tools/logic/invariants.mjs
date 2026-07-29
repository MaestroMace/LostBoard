/**
 * Project invariant checker, as a string injected into the page.
 *
 * Shared by the logic probes: each probe tries to violate an invariant through
 * the UI (or through a store action the UI drives), then this runs against the
 * live project and reports which invariants the app actually let through.
 *
 * Every rule states a musical or referential fact that must hold for the
 * project to make sense. "It renders" is not one of them.
 */
export const CHECK = `(() => {
  const p = globalThis.__lostboard?.project;
  const st = globalThis.__lostboard?.state;
  if (!p) return [{ rule: 'harness', detail: '__lostboard handle missing — is this a dev build?' }];
  const v = [];
  const w = [];
  const add = (rule, detail) => v.push({ rule, detail });
  const warn = (rule, detail) => w.push({ rule, detail, warning: true });
  const fin = (x) => typeof x === 'number' && Number.isFinite(x);

  const trackIds = new Set();
  const allClipIds = new Set();
  const allIds = new Map(); // id -> what it is, to catch collisions

  const uniq = (id, what) => {
    if (allIds.has(id)) add('id/unique', \`\${id} used by both \${allIds.get(id)} and \${what}\`);
    else allIds.set(id, what);
  };

  // ---- project scalars
  if (!fin(p.bpm) || p.bpm < 20 || p.bpm > 400) add('project/bpm', \`bpm = \${p.bpm}\`);
  if (!Number.isInteger(p.numerator) || p.numerator < 1) add('project/numerator', \`\${p.numerator}\`);
  if (!Number.isInteger(p.denominator) || p.denominator < 1) add('project/denominator', \`\${p.denominator}\`);
  if (!Number.isInteger(p.lengthBars) || p.lengthBars < 1) add('project/lengthBars', \`\${p.lengthBars}\`);
  if (!fin(p.master?.volume)) add('project/masterVolume', \`\${p.master?.volume}\`);
  if (!fin(p.loopStart) || p.loopStart < 0) add('loop/start', \`loopStart = \${p.loopStart}\`);
  if (!fin(p.loopEnd)) add('loop/end', \`loopEnd = \${p.loopEnd}\`);
  if (fin(p.loopStart) && fin(p.loopEnd) && p.loopEnd <= p.loopStart)
    add('loop/order', \`loopStart \${p.loopStart} >= loopEnd \${p.loopEnd} — a loop that cannot advance\`);
  if (p.swing !== undefined && (!fin(p.swing) || p.swing < 0 || p.swing > 1)) add('project/swing', \`\${p.swing}\`);

  // ---- tempo map
  const map = p.tempoMap ?? [];
  const beatsSeen = new Map();
  for (const ev of map) {
    uniq(ev.id, 'tempo event');
    if (!fin(ev.beat) || ev.beat < 0) add('tempo/beat', \`\${ev.beat}\`);
    if (!fin(ev.bpm) || ev.bpm < 20 || ev.bpm > 400) add('tempo/bpm', \`\${ev.bpm} at beat \${ev.beat}\`);
    if (beatsSeen.has(ev.beat))
      add('tempo/duplicate-beat', \`two tempo events at beat \${ev.beat} (\${beatsSeen.get(ev.beat)} and \${ev.bpm} BPM) — which wins is undefined\`);
    else beatsSeen.set(ev.beat, ev.bpm);
  }
  for (let i = 1; i < map.length; i++)
    if (map[i].beat < map[i - 1].beat) add('tempo/unsorted', \`beat \${map[i].beat} after \${map[i - 1].beat}\`);

  // ---- scenes
  const sceneCount = (p.scenes ?? []).length;

  const PARAM_RANGE = {
    volume: [-60, 6], pan: [-1, 1], cutoff: [50, 18000], reverb: [0, 1], delay: [0, 1],
    eqLow: [-24, 24], eqMid: [-24, 24], eqHigh: [-24, 24],
    compThreshold: [-60, 0], compRatio: [1, 20], bitcrush: [1, 16],
  };

  for (const t of p.tracks ?? []) {
    uniq(t.id, \`track "\${t.name}"\`);
    trackIds.add(t.id);
    if (!fin(t.volume)) add('track/volume', \`\${t.name}: \${t.volume}\`);
    if (!fin(t.pan) || t.pan < -1 || t.pan > 1) add('track/pan', \`\${t.name}: \${t.pan}\`);
    if (t.midiOutChannel !== undefined && (!Number.isInteger(t.midiOutChannel) || t.midiOutChannel < 1 || t.midiOutChannel > 16))
      add('track/midiChannel', \`\${t.name}: \${t.midiOutChannel}\`);
    if (t.swing !== undefined && (!fin(t.swing) || t.swing < 0 || t.swing > 1)) add('track/swing', \`\${t.name}: \${t.swing}\`);

    // ---- fx / sidechain
    if (t.fx?.sidechainSourceId) {
      if (t.fx.sidechainSourceId === t.id)
        add('fx/self-sidechain', \`\${t.name} ducks under itself — a feedback loop on its own envelope\`);
      else if (!(p.tracks ?? []).some((o) => o.id === t.fx.sidechainSourceId))
        add('fx/dangling-sidechain', \`\${t.name} ducks under track \${t.fx.sidechainSourceId}, which does not exist\`);
    }

    // ---- automation
    const seenParams = new Set();
    for (const lane of t.automation ?? []) {
      if (seenParams.has(lane.param))
        add('automation/duplicate-lane', \`\${t.name} has two "\${lane.param}" lanes\`);
      seenParams.add(lane.param);
      const range = PARAM_RANGE[lane.param];
      if (!range) add('automation/unknown-param', \`\${t.name}: \${lane.param}\`);
      const seenBeats = new Map();
      for (const pt of lane.points ?? []) {
        uniq(pt.id, \`automation point on \${t.name}/\${lane.param}\`);
        if (!fin(pt.beat) || pt.beat < 0) add('automation/beat', \`\${t.name}/\${lane.param}: \${pt.beat}\`);
        if (!fin(pt.value)) add('automation/value-nan', \`\${t.name}/\${lane.param}: \${pt.value}\`);
        else if (range && (pt.value < range[0] || pt.value > range[1]))
          add('automation/value-range', \`\${t.name}/\${lane.param} = \${pt.value}, outside \${range[0]}..\${range[1]}\`);
        if (seenBeats.has(pt.beat))
          add('automation/duplicate-beat', \`\${t.name}/\${lane.param}: two points at beat \${pt.beat} (\${seenBeats.get(pt.beat)} and \${pt.value}) — the ramp between them is undefined\`);
        else seenBeats.set(pt.beat, pt.value);
      }
      const pts = lane.points ?? [];
      for (let i = 1; i < pts.length; i++)
        if (pts[i].beat < pts[i - 1].beat) add('automation/unsorted', \`\${t.name}/\${lane.param}\`);
    }

    // ---- sampler zones
    for (const z of t.samplerZones ?? []) {
      uniq(z.id, \`sampler zone on \${t.name}\`);
      if (!Number.isInteger(z.rootPitch) || z.rootPitch < 0 || z.rootPitch > 127)
        add('zone/rootPitch', \`\${t.name}: \${z.rootPitch}\`);
      const lo = z.velMin ?? 0, hi = z.velMax ?? 1;
      if (!fin(lo) || !fin(hi) || lo < 0 || hi > 1) add('zone/velRange', \`\${t.name}: \${lo}..\${hi}\`);
      else if (lo > hi) add('zone/velInverted', \`\${t.name}: velMin \${lo} > velMax \${hi} — the zone can never fire\`);
    }

    // ---- clips
    const spans = [];
    for (const c of t.clips ?? []) {
      uniq(c.id, \`clip "\${c.name}" on \${t.name}\`);
      allClipIds.add(c.id);
      if (c.trackId !== t.id) add('clip/trackId', \`clip \${c.id} sits on \${t.id} but claims \${c.trackId}\`);
      if (!fin(c.start) || c.start < 0) add('clip/start', \`\${c.name}: \${c.start}\`);
      if (!fin(c.length) || c.length <= 0) add('clip/length', \`\${c.name}: \${c.length}\`);
      if (fin(c.start) && fin(c.length)) spans.push({ c, a: c.start, b: c.start + c.length });

      if (c.kind === 'midi') {
        const key = new Map();   // pitch|start -> note
        const byPitch = new Map();
        for (const n of c.notes ?? []) {
          uniq(n.id, \`note in "\${c.name}"\`);
          if (!Number.isInteger(n.pitch) || n.pitch < 0 || n.pitch > 127) add('note/pitch', \`\${c.name}: \${n.pitch}\`);
          if (!fin(n.start) || n.start < 0) add('note/start', \`\${c.name}: \${n.start}\`);
          if (!fin(n.length) || n.length <= 0) add('note/length', \`\${c.name}: length \${n.length}\`);
          if (!fin(n.velocity) || n.velocity < 0 || n.velocity > 1) add('note/velocity', \`\${c.name}: \${n.velocity}\`);
          // NOT a violation. Shrinking a clip hides the notes past its new
          // end and lengthening brings them back — the convention every DAW
          // follows, and the piano roll's scroll extent still reaches them, so
          // they stay selectable and deletable. Destroying them on resize
          // would trade an invisible note for lost work. Reported so the count
          // is visible, never counted as a fault.
          if (fin(n.start) && fin(c.length) && n.start >= c.length)
            warn('note/past-clip-end', \`\${c.name}: note at beat \${n.start} is outside the clip's \${c.length} beats — hidden until the clip is lengthened\`);
          const k = n.pitch + '|' + n.start;
          if (key.has(k))
            add('note/duplicate', \`\${c.name}: \${key.get(k) + 1} notes stacked at pitch \${n.pitch}, beat \${n.start}\`);
          key.set(k, (key.get(k) ?? 0) + 1);
          if (!byPitch.has(n.pitch)) byPitch.set(n.pitch, []);
          byPitch.get(n.pitch).push(n);
        }
        for (const [pitch, ns] of byPitch) {
          const sorted = ns.slice().sort((x, y) => x.start - y.start);
          for (let i = 1; i < sorted.length; i++) {
            const prev = sorted[i - 1], cur = sorted[i];
            if (cur.start < prev.start + prev.length - 1e-9 && cur.start !== prev.start)
              add('note/overlap', \`\${c.name}: pitch \${pitch} — note at \${cur.start} starts inside the one at \${prev.start} (len \${prev.length}); the note-off of the first cuts the second\`);
          }
        }
      }

      if (c.kind === 'pattern') {
        const len = c.pattern?.length;
        if (!Number.isInteger(len) || len < 1) add('pattern/length', \`\${c.name}: \${len}\`);
        for (const pad of Object.keys(c.pattern?.steps ?? {})) {
          const steps = c.pattern.steps[pad];
          if (!Array.isArray(steps)) { add('pattern/steps-shape', \`\${c.name}/\${pad}\`); continue; }
          if (steps.length !== len)
            add('pattern/steps-length', \`\${c.name}/\${pad}: \${steps.length} steps but pattern.length = \${len}\`);
          for (const s of steps) {
            if (!fin(s?.velocity) || s.velocity < 0 || s.velocity > 1) add('step/velocity', \`\${c.name}/\${pad}: \${s?.velocity}\`);
            if (s?.probability !== undefined && (!fin(s.probability) || s.probability < 0 || s.probability > 1))
              add('step/probability', \`\${c.name}/\${pad}: \${s.probability}\`);
          }
        }
      }

      if (c.kind === 'audio') {
        if (!fin(c.gain) || c.gain < 0) add('audio/gain', \`\${c.name}: \${c.gain}\`);
        if (!fin(c.offset) || c.offset < 0) add('audio/offset', \`\${c.name}: \${c.offset}\`);
        if (c.sourceBpm !== undefined && (!fin(c.sourceBpm) || c.sourceBpm <= 0)) add('audio/sourceBpm', \`\${c.name}: \${c.sourceBpm}\`);
        if (!c.sampleId) add('audio/sampleId', \`\${c.name}: missing\`);
      }
    }

    // Two clips covering the same beats on one track both play, so every note
    // in the overlap fires twice.
    spans.sort((x, y) => x.a - y.a);
    for (let i = 1; i < spans.length; i++)
      if (spans[i].a < spans[i - 1].b - 1e-9)
        add('clip/overlap', \`\${t.name}: "\${spans[i].c.name}" starts at \${spans[i].a} inside "\${spans[i - 1].c.name}" (\${spans[i - 1].a}..\${spans[i - 1].b}) — both schedule\`);

    // ---- session slots
    const slots = t.sessionSlots ?? [];
    slots.forEach((id, i) => {
      if (id === null || id === undefined) return;
      if (!(t.clips ?? []).some((c) => c.id === id))
        add('session/dangling-slot', \`\${t.name} scene \${i} points at clip \${id}, which is not on this track\`);
      if (i >= sceneCount)
        add('session/orphan-slot', \`\${t.name} has a slot at scene \${i} but the project has \${sceneCount} scenes — unreachable\`);
    });
  }

  // ---- runtime references into the project
  if (st) {
    if (st.selectedTrackId && !trackIds.has(st.selectedTrackId))
      add('selection/track', \`selectedTrackId \${st.selectedTrackId} does not exist\`);
    for (const id of st.selectedClipIds ?? [])
      if (!allClipIds.has(id)) add('selection/clip', \`selectedClipIds holds \${id}, which does not exist\`);
    const noteIds = new Set();
    for (const t of p.tracks ?? []) for (const c of t.clips ?? []) if (c.kind === 'midi') for (const n of c.notes ?? []) noteIds.add(n.id);
    for (const id of st.selectedNoteIds ?? [])
      if (!noteIds.has(id)) add('selection/note', \`selectedNoteIds holds \${id}, which does not exist\`);
    for (const [tid, cid] of Object.entries(st.sessionPlaying ?? {})) {
      if (!trackIds.has(tid)) add('session/playing-track', \`sessionPlaying names track \${tid}, which does not exist\`);
      else if (cid && !allClipIds.has(cid)) add('session/playing-clip', \`sessionPlaying names clip \${cid}, which does not exist\`);
    }
  }
  // Warnings ride along so a caller can print them, but they are not faults.
  return v.concat(w);
})()`;

/** Boot a page with the app running and the first-run hint dismissed. */
export async function boot(chromium, { w = 923, h = 336, port = 5273 } = {}) {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  await p.goto(`http://localhost:${port}`, { waitUntil: 'domcontentloaded' });
  await p.getByRole('button', { name: /^Start$/i }).click();
  await p.waitForTimeout(900);
  await p.evaluate(() => { try { localStorage.setItem('lostboard.hintDismissed', '1'); } catch {} });
  const got = p.locator('button', { hasText: /^Got it$/i });
  if (await got.count()) await got.first().click().catch(() => {});
  p.__errors = errors;
  return { b, p };
}

export const top = async (p, n) => {
  await p.locator('[data-tab="primary"]', { hasText: new RegExp('^' + n + '$') }).first().click();
  await p.waitForTimeout(350);
};
export const sub = async (p, n) => {
  const l = p.locator('[data-tab="editor"]', { hasText: new RegExp('^' + n + '$') });
  if (await l.count()) { await l.first().click(); await p.waitForTimeout(350); }
};
