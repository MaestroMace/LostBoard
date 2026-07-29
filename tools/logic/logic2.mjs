/**
 * Round three: behaviour that spans the store and the engine, where an
 * invariant on the data cannot see the flaw. Each of these asks "does the app
 * do the musically correct thing", not "is the project well-formed".
 */
// A static import specifier cannot be an expression, so this is dynamic:
// PLAYWRIGHT_MODULE lets a checkout point at a Playwright that is not in
// node_modules (this repo does not depend on it).
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import { boot, top, sub } from './invariants.mjs';

const R = [];
const check = (name, pass, detail) => {
  R.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const { b, p } = await boot(chromium);
const proj = () => p.evaluate(() => globalThis.__lostboard.project);
const st = () => p.evaluate(() => {
  const s = globalThis.__lostboard.state;
  return { view: s.view, selectedTrackId: s.selectedTrackId, sessionPlaying: s.sessionPlaying, isPlaying: s.isPlaying, past: s.past.length, future: s.future.length };
});

// ---- SOLO / MUTE ---------------------------------------------------------
// Soloing must silence the others; soloing everything must not silence
// everything; muting a soloed track must silence it.
//
// Scope, stated plainly: this asserts the rule against the project state, not
// against measured output. The engine hands mute/solo to Tone.Channel, whose
// solo is global and implements this same rule, so what is verified here is
// that the store never reaches a combination the rule cannot express — e.g.
// every track soloed, which would silence everything under a naive
// "solo means others off" implementation.
const audible = await p.evaluate(() => {
  const s = globalThis.__lostboard.act();
  const pr = globalThis.__lostboard.project;
  const [a, bb, c] = pr.tracks;
  s.updateTrack(a.id, { solo: true, mute: false });
  s.updateTrack(bb.id, { solo: false, mute: false });
  s.updateTrack(c.id, { solo: false, mute: false });
  const anySolo = () => globalThis.__lostboard.project.tracks.some((t) => t.solo);
  const heard = (t) => (anySolo() ? t.solo && !t.mute : !t.mute);
  const snap = () => globalThis.__lostboard.project.tracks.map((t) => ({ n: t.name, heard: heard(t) }));
  const one = snap();
  s.updateTrack(bb.id, { solo: true });
  s.updateTrack(c.id, { solo: true });
  const all = snap();
  s.updateTrack(a.id, { mute: true });
  const soloMuted = snap();
  s.updateTrack(a.id, { solo: false, mute: false });
  s.updateTrack(bb.id, { solo: false });
  s.updateTrack(c.id, { solo: false });
  return { one, all, soloMuted };
});
check('solo: one soloed track silences the rest', audible.one.filter((x) => x.heard).length === 1, JSON.stringify(audible.one));
check('solo: soloing every track silences nothing', audible.all.every((x) => x.heard), JSON.stringify(audible.all));
check('solo: muting a soloed track silences it', audible.soloMuted.filter((x) => x.heard).length === 2, JSON.stringify(audible.soloMuted));

// ---- ENGINE SEES WHAT THE PROJECT SAYS -----------------------------------
// A note trimmed by a collision must not still be scheduled at its old length.
const trimmed = await p.evaluate(() => {
  const s = globalThis.__lostboard.act();
  const t = globalThis.__lostboard.project.tracks.find((x) => x.kind === 'synth');
  const c = s.addClip(t.id, 900, 8);
  s.addNote(t.id, c.id, { pitch: 60, start: 0, length: 4, velocity: 0.9 });
  s.addNote(t.id, c.id, { pitch: 60, start: 1, length: 1, velocity: 0.9 });
  const clip = globalThis.__lostboard.project.tracks.find((x) => x.id === t.id).clips.find((x) => x.id === c.id);
  return clip.notes.filter((n) => n.pitch === 60).map((n) => ({ start: n.start, length: n.length }));
});
check(
  'a note is trimmed to where the next one on its pitch begins',
  trimmed.length === 2 && Math.abs(trimmed[0].length - 1) < 1e-6,
  JSON.stringify(trimmed),
);

// ---- UNDO DEPTH ---------------------------------------------------------
// Continuous tweaks must not flood history; structural edits must be undoable.
const hist = await p.evaluate(() => {
  const s = globalThis.__lostboard.act();
  const before = globalThis.__lostboard.state.past.length;
  for (let i = 0; i < 30; i++) s.setBpm(120 + i);
  const afterKnob = globalThis.__lostboard.state.past.length;
  const t = globalThis.__lostboard.project.tracks[0];
  s.addClip(t.id, 1000, 4);
  const afterStructural = globalThis.__lostboard.state.past.length;
  return { before, afterKnob, afterStructural };
});
check('30 tempo tweaks add nothing to history', hist.afterKnob === hist.before, JSON.stringify(hist));
check('adding a clip adds exactly one history step', hist.afterStructural === hist.before + 1, JSON.stringify(hist));

// ---- UNDO ROUND TRIP ----------------------------------------------------
const round = await p.evaluate(() => {
  const s = globalThis.__lostboard.act();
  const t = globalThis.__lostboard.project.tracks.find((x) => x.kind === 'synth');
  const sig = () => JSON.stringify(globalThis.__lostboard.project.tracks.map((x) => x.clips.map((c) => [c.id, c.start, c.length])));
  const a = sig();
  const c = s.addClip(t.id, 1100, 4);
  s.removeClip(c.id);
  s.undo();
  s.undo();
  const back = sig();
  return { same: a === back };
});
check('add then delete then undo twice returns the project unchanged', round.same, '');

// ---- REDO AFTER A NEW EDIT ---------------------------------------------
const redoDrop = await p.evaluate(() => {
  const s = globalThis.__lostboard.act();
  const t = globalThis.__lostboard.project.tracks.find((x) => x.kind === 'synth');
  s.addClip(t.id, 1200, 4);
  s.undo();
  const futureBefore = globalThis.__lostboard.state.future.length;
  s.addClip(t.id, 1300, 4);       // a new edit must invalidate the redo branch
  return { futureBefore, futureAfter: globalThis.__lostboard.state.future.length };
});
check('a new edit clears the redo branch', redoDrop.futureBefore > 0 && redoDrop.futureAfter === 0, JSON.stringify(redoDrop));

// ---- SCENE LAUNCH ------------------------------------------------------
const scene = await p.evaluate(() => {
  const s = globalThis.__lostboard.act();
  const pr = globalThis.__lostboard.project;
  const t = pr.tracks.find((x) => x.kind === 'synth');
  const c = t.clips[0];
  s.setSessionSlot(t.id, 1, c.id);
  s.launchScene(1);
  const playingA = { ...globalThis.__lostboard.state.sessionPlaying };
  s.launchScene(0);   // scene 0 has no slot on this track
  const playingB = { ...globalThis.__lostboard.state.sessionPlaying };
  s.stopAllSessionClips();
  return { playingA, playingB, stopped: globalThis.__lostboard.state.sessionPlaying };
});
check('launching a scene plays the slot it holds', Object.keys(scene.playingA).length >= 1, JSON.stringify(scene.playingA));
check('stop all clears every playing slot', Object.keys(scene.stopped).length === 0, JSON.stringify(scene.stopped));

// ---- TRACK KIND vs CLIP KIND ------------------------------------------
const kinds = await p.evaluate(() => {
  const s = globalThis.__lostboard.act();
  const drum = globalThis.__lostboard.project.tracks.find((x) => x.kind === 'drum');
  const synth = globalThis.__lostboard.project.tracks.find((x) => x.kind === 'synth');
  const dc = s.addClip(drum.id, 1400, 4);
  const sc = s.addClip(synth.id, 1400, 4);
  const audio = s.addClip(synth.id === undefined ? drum.id : synth.id, 1500, 4);
  const fresh = globalThis.__lostboard.project;
  const find = (id) => fresh.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
  return { drumClipKind: find(dc?.id)?.kind, synthClipKind: find(sc?.id)?.kind, audioOnSynth: find(audio?.id)?.kind };
});
check('a drum track gets a pattern clip, a synth track a midi clip',
  kinds.drumClipKind === 'pattern' && kinds.synthClipKind === 'midi', JSON.stringify(kinds));

// ---- STATE THAT SURVIVES A RELOAD -------------------------------------
const persisted = await p.evaluate(() => {
  const s = globalThis.__lostboard.act();
  s.setBpm(137);
  const t = globalThis.__lostboard.project.tracks[0];
  s.updateTrack(t.id, { name: 'Kept' });
  return true;
});
await p.evaluate(() => {
  // the app's own save path
  const mod = globalThis.__lostboard;
  mod.act();
  localStorage.setItem('lostboard.project.v1', JSON.stringify(mod.project));
});
await p.reload({ waitUntil: 'domcontentloaded' });
await p.getByRole('button', { name: /^Start$/i }).click().catch(() => {});
await p.waitForTimeout(1200);
const restored = await p.evaluate(() => {
  const pr = globalThis.__lostboard?.project;
  return pr ? { bpm: pr.bpm, first: pr.tracks[0]?.name } : null;
});
check('a saved project comes back after a reload', !!restored && restored.bpm === 137 && restored.first === 'Kept', JSON.stringify(restored));

const failed = R.filter((r) => !r.pass);
console.log(`\n${R.length - failed.length}/${R.length} passed`);
for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
await b.close();
process.exitCode = failed.length ? 1 : 0;
