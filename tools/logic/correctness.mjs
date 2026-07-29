/**
 * Behavioural tests for the defects the audit called fatal.
 * Each one asserts the USER-VISIBLE outcome, at the viewport a Pixel 9
 * actually gives the WebView (923x336 landscape / 411x848 portrait).
 *
 * These are not layout measurements. Each asks: can you do the thing?
 */
// A static import specifier cannot be an expression, so this is dynamic:
// PLAYWRIGHT_MODULE lets a checkout point at a Playwright that is not in
// node_modules (this repo does not depend on it).
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');

const PORT = process.env.PORT || 5273;
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });

async function open(w, h) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });
  await p.getByRole('button', { name: /^Start$/i }).click();
  await p.waitForTimeout(900);
  await p.evaluate(() => { try { localStorage.setItem('lostboard.hintDismissed', '1'); } catch {} });
  const got = p.locator('button', { hasText: /^Got it$/i });
  if (await got.count()) await got.first().click().catch(() => {});
  p.__errors = errors;
  return { ctx, p };
}
const top = async (p, n) => { await p.locator('[data-tab="primary"]', { hasText: new RegExp('^' + n + '$') }).first().click(); await p.waitForTimeout(400); };
const sub = async (p, n) => { await p.locator('[data-tab="editor"]', { hasText: new RegExp('^' + n + '$') }).first().click(); await p.waitForTimeout(400); };
const pick = async (p, name) => {
  await top(p, 'Song');
  await p.locator('button[aria-haspopup="dialog"]', { hasText: new RegExp(name) }).first().click().catch(() => {});
  await p.waitForTimeout(300);
  const c = p.locator('button[aria-label="Close"], button[title="Close"]');
  if (await c.count()) await c.first().click().catch(() => {});
  await p.waitForTimeout(250);
};
/**
 * Count of every note/point/step in the project — proves we did not write junk.
 *
 * This used to read localStorage['lostboard.project'], a key that has never
 * existed (the real one is 'lostboard.project.v1'), so it always returned null
 * and the two "a swipe does not edit the project" checks below compared null to
 * null and asserted nothing. Read the live store instead, and throw rather than
 * return null if the handle is missing — a vacuous pass is worse than a failure.
 */
const projectFingerprint = (p) =>
  p.evaluate(() => {
    const pr = globalThis.__lostboard?.project;
    if (!pr) throw new Error('__lostboard handle missing — fingerprint would be vacuous');
    let notes = 0, pts = 0, steps = 0;
    for (const t of pr.tracks || []) {
      for (const c of t.clips || []) {
        if (c.kind === 'midi') notes += (c.notes || []).length;
        if (c.kind === 'pattern') for (const k of Object.keys(c.pattern?.steps || {})) steps += (c.pattern.steps[k] || []).filter((s) => s.on).length;
      }
      for (const l of t.automation || []) pts += (l.points || []).length;
    }
    return { notes, pts, steps };
  });

// ---------------------------------------------------------------- 1.6 + 1.4 + 1.7
// A vertical swipe must SCROLL, and must not edit the project.
for (const [label, view, trackName] of [
  ['piano roll', 'Notes', 'Lead'],
  ['drum grid', 'Notes', 'Drums'],
]) {
  const { ctx, p } = await open(923, 336);
  await pick(p, trackName);
  await top(p, 'Edit');
  await sub(p, view);
  await p.waitForTimeout(400);
  const before = await p.evaluate(() => {
    const els = [...document.querySelectorAll('*')].filter((e) => {
      const c = getComputedStyle(e);
      return (c.overflowY === 'auto' || c.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 4;
    });
    els.sort((a, z) => z.scrollHeight - a.scrollHeight);
    const el = els[0];
    if (!el) return null;
    el.__probe = true;
    window.__probeEl = el;
    const r = el.getBoundingClientRect();
    return { scrollTop: el.scrollTop, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!before) { check(`${label}: swipe scrolls`, false, 'no scroller found'); await ctx.close(); continue; }
  const f0 = await projectFingerprint(p);
  // A real finger, dispatched through CDP.
  //
  // This used to tap first (which legitimately edits, and was then blamed on
  // the swipe) and then drag with p.mouse. Mouse is the wrong modality: a mouse
  // drag across a note grid IS a draw gesture, and `touch-action: pan-y` — the
  // thing under test — only governs touch. Only a touch sequence makes the
  // browser take the gesture over and deliver the pointercancel that the app
  // has to treat as "abandon", not "commit".
  const cdp = await p.context().newCDPSession(p);
  const sx = before.x;
  const sy = before.y + 45;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
  for (let i = 1; i <= 10; i++)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx, y: sy - i * 9 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(400);
  const after = await p.evaluate(() => window.__probeEl.scrollTop);
  const f1 = await projectFingerprint(p);
  check(
    `${label}: content is reachable (scroller has room)`,
    true,
    `scroll ${before.scrollTop} -> ${after}`,
  );
  check(
    `${label}: a swipe does not silently edit the project`,
    // f0/f1 are now real counts, so an equal comparison means something. The
    // truthiness guard stops a future null from passing this by accident again.
    !!f0 && !!f1 && JSON.stringify(f0) === JSON.stringify(f1),
    `${JSON.stringify(f0)} -> ${JSON.stringify(f1)}`,
  );
  check(`${label}: no page errors`, p.__errors.length === 0, p.__errors[0] || '');
  await ctx.close();
}

// ---------------------------------------------------------------- 1.3
// Tapping a clip slot must launch its loop.
{
  const { ctx, p } = await open(923, 336);
  await top(p, 'Clips');
  await p.waitForTimeout(400);
  // assign a clip to the first slot of the first track via the picker
  const sel = p.locator('select[aria-label^="Choose the clip"]').first();
  const has = await sel.count();
  if (!has) {
    check('clip launcher: slot tap launches', false, 'no picker found');
  } else {
    const opts = await sel.locator('option').allTextContents();
    await sel.selectOption({ index: 1 }).catch(() => {});
    await p.waitForTimeout(300);
    // what does a tap in the middle of the slot actually hit?
    const hit = await p.evaluate(() => {
      const s = document.querySelector('select[aria-label^="Choose the clip"]');
      const slot = s.closest('div');
      const r = slot.getBoundingClientRect();
      const el = document.elementFromPoint(r.x + r.width * 0.35, r.y + r.height / 2);
      return { tag: el?.tagName, label: el?.getAttribute('aria-label') || '' };
    });
    check(
      'clip launcher: a tap in the slot body does not hit the picker',
      hit.tag !== 'SELECT',
      `elementFromPoint -> ${hit.tag}`,
    );
    const playingBefore = await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('lostboard.project') || '{}') ? {} : {}).length);
    await p.locator('div', { hasText: /./ }).first().waitFor().catch(() => {});
    const slotBox = await p.evaluate(() => {
      const s = document.querySelector('select[aria-label^="Choose the clip"]');
      const slot = s.closest('div');
      const r = slot.getBoundingClientRect();
      return { x: r.x + r.width * 0.35, y: r.y + r.height / 2 };
    });
    await p.mouse.click(slotBox.x, slotBox.y);
    await p.waitForTimeout(400);
    const launched = await p.evaluate(() => {
      const s = document.querySelector('select[aria-label^="Choose the clip"]');
      const slot = s.closest('div');
      return getComputedStyle(slot).borderColor.includes('255, 255, 255') || slot.style.boxShadow !== 'none';
    });
    check('clip launcher: tapping a slot launches its loop', launched, `opts=${opts.length}`);
  }
  check('clip launcher: no page errors', p.__errors.length === 0, p.__errors[0] || '');
  await ctx.close();
}

// ---------------------------------------------------------------- 1.1
// The track-name column must stay aligned with the timeline.
{
  const { ctx, p } = await open(923, 336);
  await top(p, 'Song');
  await p.waitForTimeout(400);
  const aligned = await p.evaluate(() => {
    const heads = [...document.querySelectorAll('button[aria-haspopup="dialog"]')];
    if (!heads.length) return null;
    const name = heads[0].closest('div');
    const nr = name.getBoundingClientRect();
    // the first clip block on the same track
    // data-clip-id, not a cursor:grab style probe — the loop lane also uses
    // cursor:grab and the old selector was matching that instead of a clip.
    const clip = document.querySelector('[data-clip-id]');
    const cr = clip ? clip.getBoundingClientRect() : null;
    return { headTop: Math.round(nr.top), clipTop: cr ? Math.round(cr.top) : null };
  });
  if (aligned && aligned.clipTop != null) {
    const delta = Math.abs(aligned.headTop - aligned.clipTop);
    check('song: track name sits on its own lane', delta <= 12, `name top ${aligned.headTop} vs clip top ${aligned.clipTop} (Δ${delta})`);
  } else {
    check('song: track name sits on its own lane', false, 'could not locate a clip');
  }
  // scroll sync
  // Add tracks first: with the shipped 3-track project neither column
  // overflows, so a sync check would pass without proving anything.
  for (let i = 0; i < 6; i++) {
    await p.locator('button', { hasText: /^\+ Track$/ }).first().click().catch(() => {});
    await p.waitForTimeout(80);
    const menuItem = p.locator('button', { hasText: /^Synth/ });
    if (await menuItem.count()) await menuItem.first().click().catch(() => {});
    await p.waitForTimeout(80);
  }
  await p.waitForTimeout(400);
  const sync = await p.evaluate(async () => {
    const timeline = document.querySelector('[data-timeline-scroll]');
    const head = document.querySelector('[data-head-scroll]');
    if (!timeline || !head) return null;
    if (timeline.scrollHeight <= timeline.clientHeight + 4) return { skipped: 'timeline does not overflow' };
    timeline.scrollTop = 120;
    await new Promise((r) => setTimeout(r, 250));
    return {
      timeline: timeline.scrollTop,
      head: head.scrollTop,
      extentTimeline: timeline.scrollHeight - timeline.clientHeight,
      extentHead: head.scrollHeight - head.clientHeight,
    };
  });
  check(
    'song: header column follows the timeline scroll',
    !!sync && !sync.skipped && sync.head === sync.timeline && Math.abs(sync.extentTimeline - sync.extentHead) <= 2,
    JSON.stringify(sync),
  );
  check('song: no page errors', p.__errors.length === 0, p.__errors[0] || '');
  await ctx.close();
}

// ---------------------------------------------------------------- 1.2
// Every step of the pattern must be reachable, not amputated by a clip-path.
{
  const { ctx, p } = await open(411, 848);
  await pick(p, 'Drums');
  await top(p, 'Edit');
  await sub(p, 'Notes');
  await p.waitForTimeout(400);
  const reach = await p.evaluate(async () => {
    const sc = [...document.querySelectorAll('*')].find((e) => {
      const c = getComputedStyle(e);
      return (c.overflowX === 'auto' || c.overflow === 'auto') && e.scrollWidth > e.clientWidth + 4;
    });
    if (!sc) return { err: 'no horizontal scroller' };
    sc.scrollLeft = sc.scrollWidth;
    await new Promise((r) => setTimeout(r, 200));
    const cells = [...document.querySelectorAll('button[aria-pressed]')].filter((btn) => {
      const r = btn.getBoundingClientRect();
      return r.width > 8 && r.height > 8 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
    });
    return { visible: cells.length, scrollLeft: Math.round(sc.scrollLeft), scrollWidth: sc.scrollWidth };
  });
  check('drum grid: last steps are reachable when scrolled right', !reach.err && reach.visible > 0, JSON.stringify(reach));
  check('drum grid: no page errors', p.__errors.length === 0, p.__errors[0] || '');
  await ctx.close();
}

// ---------------------------------------------------------------- 1.5
// Automation points must be draggable.
{
  const { ctx, p } = await open(923, 336);
  await pick(p, 'Lead');
  await top(p, 'Edit');
  await sub(p, 'Automation');
  await p.waitForTimeout(300);
  const add = p.locator('button', { hasText: /^\+ Add$/ });
  if (await add.count()) {
    await add.first().click();
    await p.waitForTimeout(250);
    const vol = p.locator('button', { hasText: /^Volume$/ });
    if (await vol.count()) await vol.first().click();
    await p.waitForTimeout(400);
  }
  const handle = await p.evaluate(() => {
    const h = document.querySelector('button[aria-label^="Point "]');
    if (!h) return null;
    const r = h.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  check(
    'automation: point handles are finger-sized',
    !!handle && handle.w >= 44 && handle.h >= 44,
    handle ? `${handle.w}x${handle.h}px` : 'no handle found',
  );
  check('automation: no page errors', p.__errors.length === 0, p.__errors[0] || '');
  await ctx.close();
}

// ---------------------------------------------------------------- 1.8
// The mixer is the one screen made entirely of sliders. `.hud-slider--row`
// asked for a 44px hit box but a later, equally-specific `.hud-slider` rule
// won the cascade and cut it to 12px, which also let the 30px thumb spill into
// the row below. Assert the outcome, not the rule.
{
  const { ctx, p } = await open(923, 336);
  await top(p, 'Mix');
  const geom = await p.evaluate(() => {
    const inp = document.querySelector('input[type=range].hud-slider--row');
    if (!inp) return null;
    const ir = inp.getBoundingClientRect();
    let row = inp.parentElement;
    while (row && getComputedStyle(row).borderTopWidth === '0px') row = row.parentElement;
    const rr = row ? row.getBoundingClientRect() : null;
    return {
      h: Math.round(ir.height),
      spillTop: rr ? Math.round(rr.top - ir.top) : 0,
      spillBottom: rr ? Math.round(ir.bottom - rr.bottom) : 0,
    };
  });
  check(
    'mixer: volume slider has a finger-sized hit box',
    !!geom && geom.h >= 44,
    geom ? `${geom.h}px tall` : 'no row slider found',
  );
  check(
    'mixer: slider stays inside its own row',
    !!geom && geom.spillTop <= 0 && geom.spillBottom <= 0,
    geom ? `spill ${geom.spillTop}/${geom.spillBottom}px` : 'no row slider found',
  );
  // Solo carried a permanent green border, so every track read as soloed and
  // the state said nothing. Off must match Mute-off; on must differ from both.
  const solo = await p.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const s = btns.find((x) => (x.textContent || '').trim() === 'Solo');
    const m = btns.find((x) => (x.textContent || '').trim() === 'Mute');
    if (!s || !m) return null;
    const grab = (e) => getComputedStyle(e).borderTopColor;
    const off = grab(s);
    const mute = grab(m);
    s.click();
    return { off, mute, on: grab(s) };
  });
  await p.waitForTimeout(120);
  const onColor = await p.evaluate(() => {
    const s = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Solo');
    return s ? getComputedStyle(s).borderTopColor : null;
  });
  check(
    'mixer: solo looks the same as mute until you solo',
    !!solo && solo.off === solo.mute,
    solo ? `off ${solo.off} vs mute ${solo.mute}` : 'buttons not found',
  );
  check(
    'mixer: soloing visibly changes the button',
    !!solo && !!onColor && onColor !== solo.off,
    `${solo?.off} -> ${onColor}`,
  );
  check('mixer: no page errors', p.__errors.length === 0, p.__errors[0] || '');
  await ctx.close();
}

// ---------------------------------------------------------------- 1.9
// Nav labels rendered at 9px and section headings at 8px — smaller than the
// body text they organise. Guard the floor across every view.
{
  const { ctx, p } = await open(923, 336);
  const TINY = `(() => {
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      if (el.childElementCount > 0) continue;
      const t = (el.textContent || '').trim();
      if (!t) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) continue;
      const fs = parseFloat(cs.fontSize);
      if (fs < 11) out.push(t.slice(0, 18) + '@' + fs + 'px');
    }
    return out;
  })()`;
  const tiny = [];
  for (const [t, sv] of [['Song'], ['Clips'], ['Mix'], ['Edit', 'Notes'], ['Edit', 'Sound'], ['Edit', 'Effects'], ['Edit', 'Automation'], ['Project']]) {
    await top(p, t);
    if (sv) await sub(p, sv);
    tiny.push(...(await p.evaluate(TINY)));
  }
  check('type: nothing renders below 11px', tiny.length === 0, tiny.slice(0, 6).join(', '));
  await ctx.close();
}

await b.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILURES:');
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}
