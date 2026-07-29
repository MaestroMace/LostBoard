/**
 * Deep logic pass: try to put the project into a state that makes no musical
 * sense, then ask the invariant checker what got through.
 *
 * Each probe drives the app the way a user would where it can, and calls the
 * store action directly where the UI has no way to express the abuse (import,
 * MIDI input, a restored project). A probe "wins" when it produces violations —
 * those are the flaws.
 */
// A static import specifier cannot be an expression, so this is dynamic:
// PLAYWRIGHT_MODULE lets a checkout point at a Playwright that is not in
// node_modules (this repo does not depend on it).
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import { CHECK, boot, top, sub } from './invariants.mjs';

const found = [];
const probe = async (name, p, fn) => {
  const before = await p.evaluate(CHECK);
  await fn();
  await p.waitForTimeout(150);
  const after = await p.evaluate(CHECK);
  const beforeKeys = new Set(before.map((x) => x.rule + '|' + x.detail));
  const fresh = after.filter((x) => !beforeKeys.has(x.rule + '|' + x.detail));
  const faults = fresh.filter((x) => !x.warning);
  const warns = fresh.filter((x) => x.warning);
  if (faults.length) {
    console.log(`\nFLAW  ${name}`);
    for (const f of faults) console.log(`        ${f.rule}: ${f.detail}`);
    found.push({ name, fresh: faults });
  } else {
    console.log(`ok    ${name}${warns.length ? `  (expected: ${warns.map((x) => x.rule).join(', ')})` : ''}`);
  }
};

const { b, p } = await boot(chromium);
const act = async (fn, ...args) => p.evaluate(([f, a]) => {
  const s = globalThis.__lostboard.act();
  return s[f](...a);
}, [fn, args]);

const pickTrack = async (kind) => p.evaluate((k) => {
  const s = globalThis.__lostboard.act();
  const t = s.project.tracks.find((x) => x.kind === k);
  if (t) s.selectTrack(t.id);
  return t?.id ?? null;
}, kind);

console.log('=== 1. NOTES ===');

const synthTrack = await pickTrack('synth');
const clipId = await p.evaluate((tid) => {
  const s = globalThis.__lostboard.act();
  const t = s.project.tracks.find((x) => x.id === tid);
  const c = t.clips.find((c) => c.kind === 'midi');
  return c ? c.id : s.addClip(tid, 0, 4)?.id;
}, synthTrack);

await probe('same note added twice at the same pitch and beat', p, () =>
  p.evaluate(([tid, cid]) => {
    const s = globalThis.__lostboard.act();
    s.addNote(tid, cid, { pitch: 60, start: 0, length: 1, velocity: 0.9 });
    s.addNote(tid, cid, { pitch: 60, start: 0, length: 1, velocity: 0.9 });
  }, [synthTrack, clipId]),
);

await probe('note at the same pitch and beat, twenty times', p, () =>
  p.evaluate(([tid, cid]) => {
    const s = globalThis.__lostboard.act();
    for (let i = 0; i < 20; i++) s.addNote(tid, cid, { pitch: 62, start: 1, length: 1, velocity: 0.8 });
  }, [synthTrack, clipId]),
);

await probe('note pitch 200 / -5', p, () =>
  p.evaluate(([tid, cid]) => {
    const s = globalThis.__lostboard.act();
    s.addNote(tid, cid, { pitch: 200, start: 2, length: 1, velocity: 0.9 });
    s.addNote(tid, cid, { pitch: -5, start: 2.5, length: 1, velocity: 0.9 });
  }, [synthTrack, clipId]),
);

await probe('note with zero and negative length', p, () =>
  p.evaluate(([tid, cid]) => {
    const s = globalThis.__lostboard.act();
    s.addNote(tid, cid, { pitch: 64, start: 3, length: 0, velocity: 0.9 });
    s.addNote(tid, cid, { pitch: 65, start: 3, length: -2, velocity: 0.9 });
  }, [synthTrack, clipId]),
);

await probe('note before the clip starts', p, () =>
  p.evaluate(([tid, cid]) => {
    const s = globalThis.__lostboard.act();
    s.addNote(tid, cid, { pitch: 66, start: -4, length: 1, velocity: 0.9 });
  }, [synthTrack, clipId]),
);

await probe('note past the end of a 4-beat clip', p, () =>
  p.evaluate(([tid, cid]) => {
    const s = globalThis.__lostboard.act();
    s.addNote(tid, cid, { pitch: 67, start: 99, length: 1, velocity: 0.9 });
  }, [synthTrack, clipId]),
);

await probe('note velocity 5 and -1', p, () =>
  p.evaluate(([tid, cid]) => {
    const s = globalThis.__lostboard.act();
    s.addNote(tid, cid, { pitch: 68, start: 0.5, length: 1, velocity: 5 });
    s.addNote(tid, cid, { pitch: 69, start: 0.5, length: 1, velocity: -1 });
  }, [synthTrack, clipId]),
);

await probe('overlapping notes on one pitch (2-beat note, then one at +0.5)', p, () =>
  p.evaluate(([tid, cid]) => {
    const s = globalThis.__lostboard.act();
    s.addNote(tid, cid, { pitch: 70, start: 0, length: 2, velocity: 0.9 });
    s.addNote(tid, cid, { pitch: 70, start: 0.5, length: 2, velocity: 0.9 });
  }, [synthTrack, clipId]),
);

await probe('dragging a note past the clip end', p, async () => {
  const nid = await p.evaluate(([tid, cid]) => {
    const s = globalThis.__lostboard.act();
    return s.addNote(tid, cid, { pitch: 72, start: 0, length: 1, velocity: 0.9 });
  }, [synthTrack, clipId]);
  await p.evaluate(([tid, cid, nid]) => {
    globalThis.__lostboard.act().moveNotesBy(tid, cid, [nid], 500, 0);
  }, [synthTrack, clipId, nid]);
});

await probe('updateNote to a NaN start', p, async () => {
  const nid = await p.evaluate(([tid, cid]) => {
    const s = globalThis.__lostboard.act();
    return s.addNote(tid, cid, { pitch: 73, start: 0, length: 1, velocity: 0.9 });
  }, [synthTrack, clipId]);
  await p.evaluate(([tid, cid, nid]) => {
    globalThis.__lostboard.act().updateNote(tid, cid, nid, { start: NaN, length: NaN });
  }, [synthTrack, clipId, nid]);
});

console.log('\n=== 2. CLIPS ===');

await probe('two clips overlapping on one track', p, () =>
  p.evaluate((tid) => {
    const s = globalThis.__lostboard.act();
    s.addClip(tid, 0, 8);
    s.addClip(tid, 2, 8);
  }, synthTrack),
);

await probe('clip dragged on top of another', p, () =>
  p.evaluate((tid) => {
    const s = globalThis.__lostboard.act();
    const a = s.addClip(tid, 40, 4);
    const c = s.addClip(tid, 60, 4);
    s.moveClip(c.id, 41);
  }, synthTrack),
);

await probe('resize a clip so its notes fall outside it', p, () =>
  p.evaluate(([tid]) => {
    const s = globalThis.__lostboard.act();
    const c = s.addClip(tid, 100, 8);
    s.addNote(tid, c.id, { pitch: 60, start: 7, length: 1, velocity: 0.9 });
    s.resizeClip(c.id, 1);
  }, [synthTrack]),
);

console.log('\n=== 3. REFERENTIAL INTEGRITY ===');

await probe('delete a clip that a session slot points at', p, () =>
  p.evaluate((tid) => {
    const s = globalThis.__lostboard.act();
    const c = s.addClip(tid, 200, 4);
    s.setSessionSlot(tid, 0, c.id);
    s.removeClip(c.id);
  }, synthTrack),
);

await probe('delete a clip that is playing in the session', p, () =>
  p.evaluate((tid) => {
    const s = globalThis.__lostboard.act();
    const c = s.addClip(tid, 210, 4);
    s.launchSessionClip(tid, c.id);
    s.removeClip(c.id);
  }, synthTrack),
);

await probe('delete a track another track ducks under', p, () =>
  p.evaluate(() => {
    const s = globalThis.__lostboard.act();
    const victim = s.addTrack('synth');
    const other = s.project.tracks.find((t) => t.id !== victim.id && t.kind === 'synth');
    s.updateFx(other.id, { sidechainSourceId: victim.id, sidechainDepth: 0.5 });
    s.removeTrack(victim.id);
  }),
);

await probe('a track ducking under itself', p, () =>
  p.evaluate(() => {
    const s = globalThis.__lostboard.act();
    const t = s.project.tracks.find((x) => x.kind === 'synth');
    s.updateFx(t.id, { sidechainSourceId: t.id, sidechainDepth: 0.6 });
  }),
);

await probe('delete a track that is playing in the session', p, () =>
  p.evaluate(() => {
    const s = globalThis.__lostboard.act();
    const t = s.addTrack('synth');
    const c = s.addClip(t.id, 0, 4);
    s.launchSessionClip(t.id, c.id);
    s.removeTrack(t.id);
  }),
);

await probe('undo an added clip while it is selected', p, () =>
  p.evaluate((tid) => {
    const s = globalThis.__lostboard.act();
    s.addClip(tid, 300, 4);      // commit sets selectedClipIds to the new clip
    s.undo();                     // clip is gone; is the selection?
  }, synthTrack),
);

await probe('undo an added note while it is selected', p, () =>
  p.evaluate(([tid, cid]) => {
    const s = globalThis.__lostboard.act();
    const id = s.addNote(tid, cid, { pitch: 80, start: 0, length: 1, velocity: 0.9 });
    s.selectNote(id);
    s.undo();
  }, [synthTrack, clipId]),
);

await probe('assign one track a clip belonging to another', p, () =>
  p.evaluate(() => {
    const s = globalThis.__lostboard.act();
    const [a, bb] = s.project.tracks.filter((t) => t.kind !== 'audio');
    const c = s.addClip(a.id, 400, 4);
    s.setSessionSlot(bb.id, 0, c.id);
  }),
);

console.log('\n=== 4. AUTOMATION ===');

await probe('two automation points on the same beat', p, () =>
  p.evaluate((tid) => {
    const s = globalThis.__lostboard.act();
    s.addAutomationPoint(tid, 'volume', 4, -6);
    s.addAutomationPoint(tid, 'volume', 4, 0);
  }, synthTrack),
);

await probe('automation value outside the parameter range', p, () =>
  p.evaluate((tid) => {
    const s = globalThis.__lostboard.act();
    s.addAutomationPoint(tid, 'pan', 8, 12);
    s.addAutomationPoint(tid, 'cutoff', 8, -400);
  }, synthTrack),
);

await probe('automation point dragged to a NaN beat', p, () =>
  p.evaluate((tid) => {
    const s = globalThis.__lostboard.act();
    const pt = s.addAutomationPoint(tid, 'reverb', 12, 0.5);
    s.updateAutomationPoint(tid, 'reverb', pt.id, { beat: NaN, value: NaN });
  }, synthTrack),
);

console.log('\n=== 5. TRANSPORT AND TEMPO ===');

await probe('loop end before loop start', p, () =>
  p.evaluate(() => globalThis.__lostboard.act().setLoop(true, 32, 8)),
);
await probe('negative loop start', p, () =>
  p.evaluate(() => globalThis.__lostboard.act().setLoop(true, -16, 4)),
);
await probe('zero-length loop', p, () =>
  p.evaluate(() => globalThis.__lostboard.act().setLoop(true, 8, 8)),
);
await probe('bpm 0', p, () => p.evaluate(() => globalThis.__lostboard.act().setBpm(0)));
await probe('bpm NaN', p, () => p.evaluate(() => globalThis.__lostboard.act().setBpm(NaN)));
await probe('bpm 100000', p, () => p.evaluate(() => globalThis.__lostboard.act().setBpm(100000)));
await p.evaluate(() => globalThis.__lostboard.act().setBpm(124));

await probe('two tempo changes on the same beat', p, () =>
  p.evaluate(() => {
    const s = globalThis.__lostboard.act();
    s.addTempoEvent(16, 90);
    s.addTempoEvent(16, 160);
  }),
);

console.log('\n=== 6. PATTERNS ===');

const drumTrack = await pickTrack('drum');
const patClip = await p.evaluate((tid) => {
  const s = globalThis.__lostboard.act();
  const t = s.project.tracks.find((x) => x.id === tid);
  const c = t.clips.find((c) => c.kind === 'pattern');
  return c ? c.id : s.addClip(tid, 0, 4)?.id;
}, drumTrack);

await probe('step velocity 9 and -3', p, () =>
  p.evaluate(([tid, cid]) => {
    const s = globalThis.__lostboard.act();
    s.setStepVelocity(tid, cid, 'kick', 0, 9);
    s.setStepVelocity(tid, cid, 'snare', 0, -3);
  }, [drumTrack, patClip]),
);

await probe('step probability 4', p, () =>
  p.evaluate(([tid, cid]) => globalThis.__lostboard.act().setStepProbability(tid, cid, 'kick', 1, 4), [drumTrack, patClip]),
);

await probe('shrink then grow a pattern (16 -> 4 -> 16)', p, () =>
  p.evaluate(([tid, cid]) => {
    const s = globalThis.__lostboard.act();
    s.setPatternLength(tid, cid, 4);
    s.setPatternLength(tid, cid, 16);
  }, [drumTrack, patClip]),
);

console.log('\n=== 7. RESTORED / IMPORTED PROJECTS ===');

await probe('import a project full of impossible values', p, () =>
  p.evaluate(() => {
    const s = globalThis.__lostboard.act();
    const bad = {
      id: 'p1', name: 'Bad', bpm: 4000, numerator: 0, denominator: 0,
      master: { volume: NaN, limiter: true },
      loopStart: 40, loopEnd: 4, loopEnabled: true, lengthBars: 0,
      createdAt: 1, updatedAt: 1,
      scenes: [{ name: 'A' }],
      tempoMap: [{ id: 'e1', beat: 8, bpm: 5 }, { id: 'e1', beat: 8, bpm: 900 }],
      tracks: [
        {
          id: 't1', name: 'X', kind: 'synth', color: '#f00', volume: NaN, pan: 9,
          mute: false, solo: false, arm: false, midiOutChannel: 99,
          fx: { enabled: true, eqLow: 0, eqMid: 0, eqHigh: 0, compThreshold: -18, compRatio: 3, compOn: false, chorusDepth: 0.5, chorusOn: false, bitcrush: 8, bitcrushOn: false, sidechainSourceId: 'nope' },
          automation: [
            { param: 'volume', points: [{ id: 'a1', beat: 4, value: 999 }, { id: 'a1', beat: 4, value: -999 }] },
            { param: 'volume', points: [] },
          ],
          sessionSlots: ['ghost', null, null, null, null, null],
          clips: [
            { id: 'c1', kind: 'midi', trackId: 'WRONG', start: -4, length: 0, notes: [
              { id: 'n1', pitch: 400, start: -1, length: 0, velocity: 3 },
              { id: 'n1', pitch: 400, start: -1, length: 0, velocity: 3 },
            ] },
            { id: 'c2', kind: 'midi', trackId: 't1', start: 0, length: 8, notes: [] },
            { id: 'c3', kind: 'midi', trackId: 't1', start: 2, length: 8, notes: [] },
          ],
        },
      ],
    };
    s.importProject(JSON.stringify(bad));
  }),
);

console.log('\n=== 8. EDIT OPERATIONS ===');

// Section 7 replaced the whole project, so the ids captured at the top are
// gone. Start from a clean project and re-pick.
await p.evaluate(() => globalThis.__lostboard.act().newProject());
await p.waitForTimeout(250);
const synth2 = await pickTrack('synth');
const drum2 = await pickTrack('drum');
const patClip2 = await p.evaluate((tid) => {
  const s = globalThis.__lostboard.act();
  const t = globalThis.__lostboard.project.tracks.find((x) => x.id === tid);
  const c = t.clips.find((c) => c.kind === 'pattern');
  return c ? c.id : s.addClip(tid, 0, 4)?.id;
}, drum2);

await probe('quantise two notes on one pitch onto the same grid line', p, () =>
  p.evaluate((tid) => {
    const s = globalThis.__lostboard.act();
    const c = s.addClip(tid, 500, 8);
    s.addNote(tid, c.id, { pitch: 61, start: 0.9, length: 0.5, velocity: 0.9 });
    s.addNote(tid, c.id, { pitch: 61, start: 1.1, length: 0.5, velocity: 0.9 });
    s.quantizeClip(tid, c.id, 1);
  }, synth2),
);

await probe('quantise with a NaN grid', p, () =>
  p.evaluate((tid) => {
    const s = globalThis.__lostboard.act();
    const c = s.addClip(tid, 520, 4);
    s.addNote(tid, c.id, { pitch: 62, start: 1, length: 1, velocity: 0.9 });
    s.quantizeClip(tid, c.id, NaN);
  }, synth2),
);

await probe('humanise notes crowded against the clip end', p, () =>
  p.evaluate((tid) => {
    const s = globalThis.__lostboard.act();
    const c = s.addClip(tid, 540, 1);
    for (const st of [0.5, 0.6, 0.7, 0.8, 0.9]) s.addNote(tid, c.id, { pitch: 63, start: st, length: 0.1, velocity: 0.9 });
    s.humanizeClip(tid, c.id, 1);
  }, synth2),
);

await probe('duplicate a clip onto the one after it', p, () =>
  p.evaluate((tid) => {
    const s = globalThis.__lostboard.act();
    const a = s.addClip(tid, 560, 4);
    s.addClip(tid, 566, 4);
    s.selectClip(a.id);
    s.duplicateSelectedClips();
  }, synth2),
);

await probe('paste a clip on top of an existing one', p, () =>
  p.evaluate((tid) => {
    const s = globalThis.__lostboard.act();
    const a = s.addClip(tid, 600, 4);
    s.addClip(tid, 620, 8);
    s.selectClip(a.id);
    s.copySelectedClips();
    s.pasteClipboard(621);
  }, synth2),
);

await probe('paste a clip whose track was deleted', p, () =>
  p.evaluate(() => {
    const s = globalThis.__lostboard.act();
    const t = s.addTrack('synth');
    const c = s.addClip(t.id, 700, 4);
    s.selectClip(c.id);
    s.copySelectedClips();
    s.removeTrack(t.id);
    s.pasteClipboard(700);
  }),
);

await probe('drag a group of clips onto other clips', p, () =>
  p.evaluate((tid) => {
    const s = globalThis.__lostboard.act();
    const a = s.addClip(tid, 800, 4);
    const bb = s.addClip(tid, 806, 4);
    s.addClip(tid, 830, 4);
    s.moveClipsBy([a.id, bb.id], 30);
  }, synth2),
);

await probe('toggle a step index past the end of the pattern', p, () =>
  p.evaluate(([tid, cid]) => {
    const s = globalThis.__lostboard.act();
    s.toggleStep(tid, cid, 'kick', 99);
    s.setStepVelocity(tid, cid, 'kick', 99, 0.5);
    s.setStepProbability(tid, cid, 'kick', -3, 0.5);
  }, [drum2, patClip2]),
);

console.log('\n=== 9. SCALARS THE UI CAN CLEAR ===');

await probe('master volume null', p, () =>
  p.evaluate(() => globalThis.__lostboard.act().setMasterVolume(null)),
);
await probe('swing NaN', p, () =>
  p.evaluate(() => globalThis.__lostboard.act().setSwing(NaN)),
);
await probe('audio clip gain and offset NaN', p, () =>
  p.evaluate(() => {
    const s = globalThis.__lostboard.act();
    const at = s.project.tracks.find((t) => t.kind === 'audio') ?? s.addTrack('audio');
    const c = s.addAudioClip(at.id, 0, 'nope', 2, 'Take');
    if (c) s.updateAudioClip(c.id, { gain: NaN, offset: NaN, sourceBpm: 0 });
  }),
);

console.log('\n=== 10. SCENES ===');

await probe('remove every scene', p, () =>
  p.evaluate(() => {
    const s = globalThis.__lostboard.act();
    const n = (globalThis.__lostboard.project.scenes ?? []).length;
    for (let i = n - 1; i >= 0; i--) s.removeScene(0);
  }),
);
await probe('remove a scene that does not exist', p, () =>
  p.evaluate(() => globalThis.__lostboard.act().removeScene(99)),
);
await probe('launch a scene index past the end', p, () =>
  p.evaluate(() => globalThis.__lostboard.act().launchScene(99)),
);

console.log(`\n=== ${found.length} probes produced violations ===`);
for (const f of found) console.log(`  - ${f.name} (${f.fresh.length})`);
// A leftover violation is a real defect, so this is a gate, not a report.
if (found.length) process.exitCode = 1;
if (p.__errors.length) {
  console.log(`\npage errors (${p.__errors.length}):`);
  for (const e of p.__errors.slice(0, 8)) console.log('  ' + e);
}
await b.close();
