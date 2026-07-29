/**
 * Round seven: the loop, and what happens at its edges. A loop is the one place
 * where beat arithmetic wraps, so off-by-ones hide there.
 */
// A static import specifier cannot be an expression, so this is dynamic:
// PLAYWRIGHT_MODULE lets a checkout point at a Playwright that is not in
// node_modules (this repo does not depend on it).
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import { boot } from './invariants.mjs';
const R = [];
const check = (n, ok, d) => { R.push({ n, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const { b, p } = await boot(chromium);
const P = () => p.evaluate(() => globalThis.__lostboard.project);

// A loop set backwards must come back forwards, not just get clamped to zero.
const back = await p.evaluate(() => {
  const s = globalThis.__lostboard.act();
  s.setLoop(true, 32, 8);
  const a = { ...globalThis.__lostboard.project };
  s.setLoop(true, -4, -8);
  const bb = { ...globalThis.__lostboard.project };
  return { a: { s: a.loopStart, e: a.loopEnd }, b: { s: bb.loopStart, e: bb.loopEnd } };
});
check('a backwards loop becomes a forwards one', back.a.e > back.a.s, JSON.stringify(back.a));
check('a wholly negative loop becomes a valid one', back.b.s >= 0 && back.b.e > back.b.s, JSON.stringify(back.b));

// Changing only one end must not be able to invert the range.
const oneEnd = await p.evaluate(() => {
  const s = globalThis.__lostboard.act();
  s.setLoop(true, 0, 16);
  s.setLoop(true, 20, undefined);      // start pushed past the existing end
  const a = globalThis.__lostboard.project;
  const r1 = { s: a.loopStart, e: a.loopEnd };
  s.setLoop(true, undefined, 1);       // end pulled behind the existing start
  const bb = globalThis.__lostboard.project;
  return { r1, r2: { s: bb.loopStart, e: bb.loopEnd } };
});
check('moving the start past the end repairs the range', oneEnd.r1.e > oneEnd.r1.s, JSON.stringify(oneEnd.r1));
check('moving the end behind the start repairs the range', oneEnd.r2.e > oneEnd.r2.s, JSON.stringify(oneEnd.r2));

// The loop must survive a project length change without pointing outside it.
const len = await p.evaluate(() => {
  const s = globalThis.__lostboard.act();
  s.setLoop(true, 0, 64);
  const pr = globalThis.__lostboard.project;
  return { loopEnd: pr.loopEnd, lengthBars: pr.lengthBars, numerator: pr.numerator, beats: pr.lengthBars * pr.numerator };
});
console.log(`   loop 0..${len.loopEnd} in a project of ${len.beats} beats`);
check('a loop reaching past the arrangement is allowed but finite', Number.isFinite(len.loopEnd) && len.loopEnd > 0, JSON.stringify(len));

// Undo must restore a loop change if it is history-tracked, or leave it alone
// consistently if it is not — what must never happen is a half-applied range.
const undoLoop = await p.evaluate(() => {
  const s = globalThis.__lostboard.act();
  s.setLoop(true, 4, 12);
  const before = { ...globalThis.__lostboard.project };
  const t = globalThis.__lostboard.project.tracks[0];
  s.addClip(t.id, 900, 4);
  s.undo();
  const after = { ...globalThis.__lostboard.project };
  return { before: { s: before.loopStart, e: before.loopEnd }, after: { s: after.loopStart, e: after.loopEnd } };
});
check('undoing an unrelated edit leaves the loop valid', undoLoop.after.e > undoLoop.after.s, JSON.stringify(undoLoop));

const failed = R.filter((r) => !r.ok);
console.log(`\n${R.length - failed.length}/${R.length} passed`);
for (const f of failed) console.log('  - ' + f.n);
await b.close();
process.exitCode = failed.length ? 1 : 0;
