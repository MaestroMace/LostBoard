/**
 * Does a "bar" mean the same thing to the ruler and to the transport?
 *
 * The UI defines a bar as `numerator` beats (totalBeats = lengthBars *
 * numerator, and snap-to-bar snaps by numerator). The engine sets
 * Tone.Transport.timeSignature = [num, den], and Tone stores that as
 * beats-per-measure IN QUARTER NOTES — 6/8 becomes 3, not 6. If those disagree,
 * the ruler and the position readout count bars at different rates.
 */
// A static import specifier cannot be an expression, so this is dynamic:
// PLAYWRIGHT_MODULE lets a checkout point at a Playwright that is not in
// node_modules (this repo does not depend on it).
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import { boot } from './invariants.mjs';
async function measure(num, den) {
  // A fresh page per signature: reusing one left the playhead wherever the
  // previous run stopped, so "reached bar 2" was already true at t=0 and the
  // numbers came out as 0.05s.
  const { b, p } = await boot(chromium);
  await p.evaluate(([n, d]) => {
    const s = globalThis.__lostboard.act();
    s.setBpm(120);
    s.setTimeSig(n, d);
    s.setLoop(false);
  }, [num, den]);
  await p.waitForTimeout(500);
  const uiBeatsPerBar = await p.evaluate(() => {
    const pr = globalThis.__lostboard.project;
    return pr.numerator;   // what the ruler and snap-to-bar use
  });
  const t0 = Date.now();
  await p.locator('button[title="Play / Pause"]').first().click();
  let atBar2 = null;
  for (let i = 0; i < 200; i++) {
    const r = await p.evaluate(() => (document.querySelector('.display--big')?.textContent || '').replace(/\s+/g, ''));
    if (parseInt(r.slice(0, 3), 10) >= 2) { atBar2 = (Date.now() - t0) / 1000; break; }
    await p.waitForTimeout(20);
  }
  await p.locator('button[title="Play / Pause"]').first().click().catch(() => {});
  await b.close();
  // at 120 BPM one quarter note is 0.5s, so seconds -> quarter notes is x2
  const transportBeatsPerBar = atBar2 === null ? null : Math.round(atBar2 * 2);
  return { uiBeatsPerBar, atBar2, transportBeatsPerBar };
}

for (const [n, d] of [[4, 4], [6, 8], [7, 4], [3, 4], [5, 8]]) {
  const m = await measure(n, d);
  const agree = m.transportBeatsPerBar === m.uiBeatsPerBar;
  console.log(
    `${n}/${d}:  ruler says ${m.uiBeatsPerBar} beats/bar, transport reached bar 2 after ${m.atBar2}s ` +
    `= ~${m.transportBeatsPerBar} beats/bar  ${agree ? 'AGREE' : 'DISAGREE'}`,
  );
}
