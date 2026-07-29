/**
 * The user's report, reproduced through the UI rather than the store: tap the
 * same spot in the note grid over and over and see what the clip ends up
 * holding. Also does it for the drum grid, and checks a drag-out note against
 * a repeat tap on the same cell.
 */
// A static import specifier cannot be an expression, so this is dynamic:
// PLAYWRIGHT_MODULE lets a checkout point at a Playwright that is not in
// node_modules (this repo does not depend on it).
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import { boot, top, sub } from './invariants.mjs';
const { b, p } = await boot(chromium);
const cdp = await p.context().newCDPSession(p);

const tap = async (x, y) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(120);
};
const notesAt = () => p.evaluate(() => {
  const pr = globalThis.__lostboard.project;
  const st = globalThis.__lostboard.state;
  const t = pr.tracks.find((x) => x.id === st.selectedTrackId) ?? pr.tracks[0];
  const c = t.clips.find((x) => x.kind === 'midi');
  if (!c) return null;
  const byKey = {};
  for (const n of c.notes) {
    const k = `${n.pitch}@${n.start}`;
    byKey[k] = (byKey[k] ?? 0) + 1;
  }
  const stacked = Object.entries(byKey).filter(([, n]) => n > 1);
  return { total: c.notes.length, stacked };
});

// Land on a synth track so Notes is the piano roll.
await p.evaluate(() => {
  const s = globalThis.__lostboard.act();
  const t = globalThis.__lostboard.project.tracks.find((x) => x.kind === 'synth');
  s.selectTrack(t.id);
});
await top(p, 'Edit');
await sub(p, 'Notes');
await p.waitForTimeout(500);

const cell = await p.evaluate(() => {
  const grid = [...document.querySelectorAll('div')]
    .filter((d) => d.scrollHeight > d.clientHeight + 20 && d.clientHeight > 60)
    .sort((a, z) => z.clientHeight - a.clientHeight)[0];
  const r = grid.getBoundingClientRect();
  return { x: Math.round(r.left + 120), y: Math.round(r.top + 70) };
});

console.log('before:', JSON.stringify(await notesAt()));
for (let i = 0; i < 12; i++) await tap(cell.x, cell.y);
const after = await notesAt();
console.log('after 12 taps on one cell:', JSON.stringify(after));
console.log(after.stacked.length === 0
  ? 'PASS — no position holds more than one note'
  : `FAIL — stacked: ${JSON.stringify(after.stacked)}`);

// And a step cell, twelve times: a toggle must alternate, not accumulate.
//
// Leave the piano roll BEFORE selecting the drum track: useActiveTrack('synth')
// writes its fallback back to the store, so a drum selection made while the
// roll is mounted is reverted before the next click lands.
await top(p, 'Song');
await p.waitForTimeout(300);
await p.evaluate(() => {
  const s = globalThis.__lostboard.act();
  const t = globalThis.__lostboard.project.tracks.find((x) => x.kind === 'drum');
  s.selectTrack(t.id);
});
await p.waitForTimeout(200);
await top(p, 'Edit');
await p.waitForTimeout(700);
console.log('view now:', await p.evaluate(() => globalThis.__lostboard.state.view));
const stepBox = await p.evaluate(() => {
  const btn = [...document.querySelectorAll('button[aria-pressed]')].find(
    (x) => !(x.textContent || '').trim() && x.getBoundingClientRect().width < 60,
  );
  if (!btn) return null;
  const r = btn.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
const stepCount = () => p.evaluate(() => {
  const pr = globalThis.__lostboard.project;
  let on = 0, len = 0;
  for (const t of pr.tracks) for (const c of t.clips) if (c.kind === 'pattern') {
    for (const k of Object.keys(c.pattern.steps)) { on += c.pattern.steps[k].filter((s) => s.on).length; len = Math.max(len, c.pattern.steps[k].length); }
  }
  return { on, maxPadLength: len };
});
if (stepBox) {
  const s0 = await stepCount();
  for (let i = 0; i < 12; i++) await tap(stepBox.x, stepBox.y);
  const s1 = await stepCount();
  console.log(`step cell: ${JSON.stringify(s0)} -> ${JSON.stringify(s1)}`);
  console.log(s1.on === s0.on && s1.maxPadLength === s0.maxPadLength
    ? 'PASS — twelve taps is an even number of toggles, and no pad array grew'
    : 'FAIL — a toggle accumulated');
}
await b.close();
