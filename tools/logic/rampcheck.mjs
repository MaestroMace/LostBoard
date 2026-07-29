/**
 * Does a tempo ramp actually change the music's timing?
 *
 * Reading Tone's transport from an injected `import('tone')` gets a SECOND
 * module instance with its own Transport, which is why an earlier version of
 * this saw position 0:0:0 forever. Measure the observable consequence instead:
 * wall-clock time for the playhead to reach beat 8 with a ramp to 240 arriving
 * at beat 4.
 *
 *   glide (correct): beats 0-4 average 180 BPM = 1.333s, then 4-8 at 240 = 1s
 *                    -> 2.33s
 *   jump  (the bug): beats 0-4 at 120 = 2s, then 4-8 at 240 = 1s
 *                    -> 3.00s
 */
// A static import specifier cannot be an expression, so this is dynamic:
// PLAYWRIGHT_MODULE lets a checkout point at a Playwright that is not in
// node_modules (this repo does not depend on it).
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import { boot } from './invariants.mjs';

async function run(curve) {
  const { b, p } = await boot(chromium);
  await p.evaluate((c) => {
    const s = globalThis.__lostboard.act();
    s.setBpm(120);
    s.clearTempoMap();
    s.addTempoEvent(4, 240);
    const ev = globalThis.__lostboard.project.tempoMap[0];
    s.updateTempoEvent(ev.id, { curve: c });
  }, curve);
  await p.waitForTimeout(400);
  // The readout is `.display--big` with the digits split across child spans;
  // an earlier loose selector matched an ancestor and "reached beat 8" in 60ms.
  const readout = () => p.evaluate(() => {
    const el = document.querySelector('.display--big');
    return (el?.textContent || '').replace(/\s+/g, '');
  });
  const t0 = Date.now();
  await p.locator('button[title="Play / Pause"]').first().click();
  let hit = null;
  for (let i = 0; i < 120; i++) {
    const r = await readout();
    const bar = parseInt(r.slice(0, 3), 10);
    if (bar >= 3) { hit = (Date.now() - t0) / 1000; break; }
    await p.waitForTimeout(25);
  }
  await p.locator('button[title="Play / Pause"]').first().click().catch(() => {});
  await b.close();
  return hit;
}

const ramp = await run('ramp');
const step = await run('step');
console.log(`time to reach beat 8:  ramp ${ramp}s   step ${step}s`);
console.log(`expected:              ramp ~2.33s     step ~3.00s`);
const ok = ramp !== null && step !== null && ramp < step - 0.25;
console.log(ok
  ? 'PASS — the ramp reaches beat 8 measurably sooner, so the glide is real'
  : 'FAIL — ramp and step take the same time: the curve does nothing');
process.exitCode = ok ? 0 : 1;
