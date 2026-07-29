/**
 * Does a real finger swipe scroll, or does it edit?
 *
 * The existing check drove this with p.mouse, which is the wrong modality: a
 * mouse drag on a note grid IS a draw gesture, and `touch-action: pan-y` — the
 * fix under test — only governs touch. Dispatch genuine touch events through
 * CDP so the browser applies pan-y and delivers pointercancel the way a phone
 * would.
 */
// A static import specifier cannot be an expression, so this is dynamic:
// PLAYWRIGHT_MODULE lets a checkout point at a Playwright that is not in
// node_modules (this repo does not depend on it).
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import { CHECK, boot, top, sub } from './invariants.mjs';

const { b, p } = await boot(chromium);
const cdp = await p.context().newCDPSession(p);

const fingerprint = () => p.evaluate(() => {
  const pr = globalThis.__lostboard.project;
  let notes = 0, steps = 0, pts = 0;
  for (const t of pr.tracks) {
    for (const c of t.clips) {
      if (c.kind === 'midi') notes += c.notes.length;
      if (c.kind === 'pattern') for (const k of Object.keys(c.pattern.steps)) steps += c.pattern.steps[k].filter((s) => s.on).length;
    }
    for (const l of t.automation ?? []) pts += l.points.length;
  }
  return { notes, steps, pts };
});

async function swipe(x, y, dy) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (dy * i) / 10 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(400);
}

const results = [];
async function testView(label, goTop, goSub) {
  await top(p, goTop);
  if (goSub) await sub(p, goSub);
  await p.waitForTimeout(400);
  const target = await p.evaluate(() => {
    // the tallest scrollable region in the view — the note or step grid
    const el = [...document.querySelectorAll('div')]
      .filter((d) => d.scrollHeight > d.clientHeight + 20 && d.clientHeight > 60)
      .sort((a, b) => b.clientHeight - a.clientHeight)[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    globalThis.__t = el;
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), scrollTop: el.scrollTop };
  });
  if (!target) { console.log(`${label}: no vertical scroller`); return; }
  const f0 = await fingerprint();
  await swipe(target.x, target.y, -90);
  const after = await p.evaluate(() => globalThis.__t.scrollTop);
  const f1 = await fingerprint();
  const scrolled = after !== target.scrollTop;
  const edited = JSON.stringify(f0) !== JSON.stringify(f1);
  console.log(`${label}: scrollTop ${target.scrollTop} -> ${after}   ${JSON.stringify(f0)} -> ${JSON.stringify(f1)}`);
  console.log(`   ${scrolled ? 'scrolled' : 'DID NOT SCROLL'} · ${edited ? 'EDITED THE PROJECT' : 'no edit'}`);
  results.push({ label, scrolled, edited });
}

await testView('piano roll (Bass)', 'Edit', 'Sound');   // select a synth track first
await sub(p, 'Notes');
await testView('piano roll', 'Edit', 'Notes');
await p.evaluate(() => {
  const s = globalThis.__lostboard.act();
  const d = globalThis.__lostboard.project.tracks.find((t) => t.kind === 'drum');
  s.selectTrack(d.id);
});
await testView('drum grid', 'Edit', 'Notes');
await testView('automation', 'Edit', 'Automation');

const bad = results.filter((r) => r.edited);
console.log(`\n${bad.length ? 'FAIL' : 'PASS'} — ${bad.length} view(s) edited the project on a finger swipe`);
for (const r of bad) console.log('  - ' + r.label);
await b.close();
process.exitCode = bad.length ? 1 : 0;
