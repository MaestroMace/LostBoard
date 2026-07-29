/**
 * Round five: operations whose result is defensible either way, where the
 * question is which behaviour a musician expects.
 */
// A static import specifier cannot be an expression, so this is dynamic:
// PLAYWRIGHT_MODULE lets a checkout point at a Playwright that is not in
// node_modules (this repo does not depend on it).
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import { boot } from './invariants.mjs';
const { b, p } = await boot(chromium);

const pattern = await p.evaluate(() => {
  const s = globalThis.__lostboard.act();
  const t = globalThis.__lostboard.project.tracks.find((x) => x.kind === 'drum');
  const c = t.clips.find((x) => x.kind === 'pattern');
  // a plain four-on-the-floor kick
  for (let i = 0; i < 16; i++) {
    const on = i % 4 === 0;
    const cur = globalThis.__lostboard.project.tracks.find((x) => x.id === t.id).clips.find((x) => x.id === c.id).pattern.steps.kick[i].on;
    if (cur !== on) s.toggleStep(t.id, c.id, 'kick', i);
  }
  const read = () => globalThis.__lostboard.project.tracks.find((x) => x.id === t.id).clips.find((x) => x.id === c.id)
    .pattern.steps.kick.map((st, i) => (st.on ? i : null)).filter((x) => x !== null);
  const at16 = read();
  s.setPatternLength(t.id, c.id, 32);
  const at32 = read();
  s.setPatternLength(t.id, c.id, 16);
  const back16 = read();
  s.setPatternLength(t.id, c.id, 8);
  const at8 = read();
  return { at16, at32, back16, at8 };
});
console.log('kick steps at length 16:', JSON.stringify(pattern.at16));
console.log('  after growing to 32: ', JSON.stringify(pattern.at32));
console.log('  back at 16:          ', JSON.stringify(pattern.back16));
console.log('  then shrunk to 8:    ', JSON.stringify(pattern.at8));
const eq = (a, want) => JSON.stringify(a) === JSON.stringify(want);
const R = [];
const check = (n, ok, d) => { R.push({ n, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
check('growing a pattern keeps every hit on its own step', eq(pattern.at32, [0, 4, 8, 12]), JSON.stringify(pattern.at32));
check('shrinking a pattern truncates rather than rescaling', eq(pattern.at8, [0, 4]), JSON.stringify(pattern.at8));
check('a grow-then-shrink round trip is lossless', eq(pattern.back16, [0, 4, 8, 12]), JSON.stringify(pattern.back16));

// Sampler velocity layers: two zones covering the same range, and a gap.
const zones = await p.evaluate(() => {
  const s = globalThis.__lostboard.act();
  const t = s.addTrack('synth');
  s.setSynthEngine(t.id, 'sampler');
  s.addSamplerZone(t.id, 'sampleA', 60);
  s.addSamplerZone(t.id, 'sampleB', 60);
  const fresh = () => globalThis.__lostboard.project.tracks.find((x) => x.id === t.id).samplerZones ?? [];
  const ids = fresh().map((z) => z.id);
  s.updateSamplerZone(t.id, ids[0], { velMin: 0, velMax: 0.5 });
  s.updateSamplerZone(t.id, ids[1], { velMin: 0.4, velMax: 1 });   // overlapping
  const overlapping = fresh().map((z) => ({ root: z.rootPitch, lo: z.velMin, hi: z.velMax }));
  s.updateSamplerZone(t.id, ids[1], { velMin: 0.8, velMax: 1 });   // leaves 0.5..0.8 uncovered
  const gapped = fresh().map((z) => ({ lo: z.velMin, hi: z.velMax }));
  s.updateSamplerZone(t.id, ids[0], { velMin: 0.9, velMax: 0.2 }); // inverted
  const inverted = fresh().map((z) => ({ lo: z.velMin, hi: z.velMax }));
  return { overlapping, gapped, inverted };
});
console.log('\nsampler zones, overlapping ranges:', JSON.stringify(zones.overlapping));
console.log('  with a gap at 0.5..0.8:         ', JSON.stringify(zones.gapped));
console.log('  after asking for velMin > velMax:', JSON.stringify(zones.inverted));
check(
  'an inverted velocity range is ordered rather than left unplayable',
  zones.inverted.every((z) => (z.lo ?? 0) <= (z.hi ?? 1)),
  JSON.stringify(zones.inverted),
);
const failed = R.filter((r) => !r.ok);
console.log(`\n${R.length - failed.length}/${R.length} passed`);
await b.close();
process.exitCode = failed.length ? 1 : 0;
