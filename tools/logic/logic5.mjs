/**
 * Round six: audio-clip warping and the beat/second conversions around it,
 * plus MIDI-recorded notes, which enter the project without touching the UI.
 */
// A static import specifier cannot be an expression, so this is dynamic:
// PLAYWRIGHT_MODULE lets a checkout point at a Playwright that is not in
// node_modules (this repo does not depend on it).
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import { boot } from './invariants.mjs';
const R = [];
const check = (n, ok, d) => { R.push({ n, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const { b, p } = await boot(chromium);

// --- audio clip length from a recorded duration -------------------------
const audio = await p.evaluate(() => {
  const s = globalThis.__lostboard.act();
  const t = s.addTrack('audio');
  s.setBpm(120);                       // 1 beat = 0.5s
  const c2 = s.addAudioClip(t.id, 0, 'sid', 2, 'two seconds');
  const c0 = s.addAudioClip(t.id, 40, 'sid', 0, 'zero seconds');
  const cn = s.addAudioClip(t.id, 80, 'sid', NaN, 'NaN seconds');
  const cneg = s.addAudioClip(t.id, 120, 'sid', -5, 'negative');
  const find = (id) => globalThis.__lostboard.project.tracks.flatMap((x) => x.clips).find((x) => x.id === id);
  return {
    two: find(c2?.id)?.length ?? null,
    zero: find(c0?.id)?.length ?? null,
    nan: find(cn?.id)?.length ?? null,
    neg: find(cneg?.id)?.length ?? null,
  };
});
check('a 2s recording at 120 BPM becomes a 4-beat clip', Math.abs(audio.two - 4) < 1e-6, JSON.stringify(audio));
check('a zero-length recording does not become a zero-length clip', audio.zero === null || audio.zero > 0, `${audio.zero}`);
check('a NaN duration does not become a NaN clip length', audio.nan === null || Number.isFinite(audio.nan), `${audio.nan}`);
check('a negative duration does not become a negative clip length', audio.neg === null || audio.neg > 0, `${audio.neg}`);

// --- warp: playbackRate is currentBpm / sourceBpm -----------------------
const warp = await p.evaluate(() => {
  const s = globalThis.__lostboard.act();
  const t = globalThis.__lostboard.project.tracks.find((x) => x.kind === 'audio');
  const c = globalThis.__lostboard.project.tracks.find((x) => x.id === t.id).clips[0];
  s.updateAudioClip(c.id, { warp: true, sourceBpm: 0 });
  const zero = globalThis.__lostboard.project.tracks.flatMap((x) => x.clips).find((x) => x.id === c.id);
  s.updateAudioClip(c.id, { sourceBpm: NaN });
  const nan = globalThis.__lostboard.project.tracks.flatMap((x) => x.clips).find((x) => x.id === c.id);
  return { zero: zero?.sourceBpm, nan: nan?.sourceBpm };
});
check('sourceBpm 0 is rejected (it divides into the playback rate)', warp.zero !== 0 && Number.isFinite(warp.zero), `${warp.zero}`);
check('sourceBpm NaN is rejected', Number.isFinite(warp.nan), `${warp.nan}`);

// --- notes arriving from MIDI rather than the grid ----------------------
const midi = await p.evaluate(() => {
  const s = globalThis.__lostboard.act();
  const t = globalThis.__lostboard.project.tracks.find((x) => x.kind === 'synth');
  const c = s.addClip(t.id, 200, 4);
  // A held key recorded twice at the same instant, which is what a stuck
  // note-on or a doubled MIDI cable produces.
  s.addNote(t.id, c.id, { pitch: 64, start: 1, length: 2, velocity: 1 });
  s.addNote(t.id, c.id, { pitch: 64, start: 1, length: 2, velocity: 1 });
  // A note-off that never arrived: length longer than the clip.
  s.addNote(t.id, c.id, { pitch: 67, start: 3, length: 999, velocity: 1 });
  const clip = globalThis.__lostboard.project.tracks.flatMap((x) => x.clips).find((x) => x.id === c.id);
  return clip.notes.map((n) => ({ p: n.pitch, s: n.start, l: n.length }));
});
check('a doubled MIDI note-on records once', midi.filter((n) => n.p === 64).length === 1, JSON.stringify(midi));
check('a note with no note-off is bounded by the clip', midi.filter((n) => n.p === 67).every((n) => n.s + n.l <= 4 + 1e-6), JSON.stringify(midi));

const failed = R.filter((r) => !r.ok);
console.log(`\n${R.length - failed.length}/${R.length} passed`);
for (const f of failed) console.log('  - ' + f.n);
await b.close();
process.exitCode = failed.length ? 1 : 0;
