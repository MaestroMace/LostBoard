/**
 * Round four: the arithmetic. Tempo maps, warping, swing and beat/second
 * conversion are pure functions with edge cases that no invariant on the stored
 * data can catch — a wrong number here is silently in tune with itself.
 */
// A static import specifier cannot be an expression, so this is dynamic:
// PLAYWRIGHT_MODULE lets a checkout point at a Playwright that is not in
// node_modules (this repo does not depend on it).
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import { boot } from './invariants.mjs';

const R = [];
const check = (name, pass, detail) => { R.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`); };
const { b, p } = await boot(chromium);

// projectDurationSec is exported from audio/types; reach it through a module
// import in the page so the real implementation is under test.
const dur = async (project, endBeat) =>
  p.evaluate(async ([pr, end]) => {
    const m = await import('/src/audio/types.ts');
    return m.projectDurationSec(pr, end);
  }, [project, endBeat]);

const base = { bpm: 120, numerator: 4, denominator: 4, tracks: [], master: { volume: 0, limiter: true }, loopStart: 0, loopEnd: 16, loopEnabled: false, lengthBars: 16, id: 'x', name: 'x', createdAt: 0, updatedAt: 0 };

// 120 BPM: one beat is half a second.
const d1 = await dur(base, 8);
check('no tempo map: 8 beats at 120 BPM is 4s', Math.abs(d1 - 4) < 1e-9, `${d1}`);

// A step change halfway must apply from its beat onward, not retroactively.
const d2 = await dur({ ...base, tempoMap: [{ id: 'a', beat: 4, bpm: 240 }] }, 8);
check('step change at beat 4: 2s + 1s', Math.abs(d2 - 3) < 1e-9, `${d2}`);

// An event exactly at the end must not be applied at all.
const d3 = await dur({ ...base, tempoMap: [{ id: 'a', beat: 8, bpm: 240 }] }, 8);
check('an event at the end beat does not shorten the range', Math.abs(d3 - 4) < 1e-9, `${d3}`);

// A ramp arriving at beat 4 glides across beats 0..4, so the segment lasts
// N*60/avg. Measuring to exactly beat 4 must still count it.
const d4 = await dur({ ...base, tempoMap: [{ id: 'a', beat: 4, bpm: 240, curve: 'ramp' }] }, 4);
check('a ramp uses the average tempo across the segment', Math.abs(d4 - (4 / 180) * 60) < 1e-9, `${d4} vs ${(4 / 180) * 60}`);

// Zero beats is zero seconds, whatever the map says.
const d5 = await dur({ ...base, tempoMap: [{ id: 'a', beat: 0, bpm: 300 }] }, 0);
check('zero beats is zero seconds', d5 === 0, `${d5}`);

// An event at beat 0 replaces the project tempo for the whole range.
const d6 = await dur({ ...base, tempoMap: [{ id: 'a', beat: 0, bpm: 60 }] }, 4);
check('an event at beat 0 sets the starting tempo', Math.abs(d6 - 4) < 1e-9, `${d6}`);

// An unsorted map must still produce the sorted answer.
const d7 = await dur({ ...base, tempoMap: [{ id: 'b', beat: 4, bpm: 240 }, { id: 'a', beat: 2, bpm: 60 }] }, 8);
const want7 = (2 / 120) * 60 + (2 / 60) * 60 + (4 / 240) * 60;
check('an unsorted tempo map is sorted before use', Math.abs(d7 - want7) < 1e-9, `${d7} vs ${want7}`);

// A negative-beat event must be ignored rather than counted backwards.
const d8 = await dur({ ...base, tempoMap: [{ id: 'a', beat: -4, bpm: 240 }] }, 4);
check('a negative-beat event is treated as the start tempo, not negative time', d8 > 0, `${d8}`);

// A ramp beyond the range is entered partway: the tempo at endBeat is the
// interpolated value, and the average runs between the two.
const d9 = await dur({ ...base, tempoMap: [{ id: 'a', beat: 8, bpm: 240, curve: 'ramp' }] }, 4);
const want9 = (4 / ((120 + 180) / 2)) * 60;
check('a ramp cut halfway uses the interpolated tempo', Math.abs(d9 - want9) < 1e-9, `${d9} vs ${want9}`);

const failed = R.filter((r) => !r.pass);
console.log(`\n${R.length - failed.length}/${R.length} passed`);
for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
await b.close();
process.exitCode = failed.length ? 1 : 0;
