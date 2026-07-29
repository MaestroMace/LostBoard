# Logic suites

Adversarial tests for the project model. They exist because a reported symptom —
unlimited notes stacking at one spot in the grid — turned out to be the visible
end of a store that validated almost nothing. The first run of `logic.mjs`
produced a violation on **every one of its 33 probes**.

```sh
npx vite --port 5273 &
tools/logic/run.sh
```

A **dev build is required**. The suites read project state through the
`__lostboard` handle in `src/state/store.ts`, which `import.meta.env.DEV` strips
from a production bundle. Reading the live store rather than `localStorage` is
deliberate: the previous approach read a key that had never existed, so two
checks compared `null` to `null` and asserted nothing for weeks.

| file | what it asks |
|---|---|
| `invariants.mjs` | the shared checker: ~40 rules about what must be true of a project, plus page boot and nav helpers |
| `logic.mjs` | 33 probes, each trying to violate one invariant through a store action or the UI |
| `logic2.mjs` | behaviour spanning store and engine — solo semantics, undo depth and round trips, scene launch, clip/track kind matching, reload |
| `logic3.mjs` | `projectDurationSec` arithmetic, including both tempo-ramp boundary cases |
| `logic4.mjs` | operations defensible either way: pattern resize semantics, sampler velocity layers |
| `logic5.mjs` | paths that bypass the UI — a recording's duration becoming a clip length, warp's `sourceBpm`, notes arriving from MIDI |
| `logic6.mjs` | loop edges, where beat arithmetic wraps |
| `correctness.mjs` | behavioural checks at the real 923×336 device viewport, each asking "can you do the thing" |
| `touchswipe.mjs` | every scrollable view swiped with dispatched touch events; a swipe must scroll and must not edit |

Single-purpose scripts kept for the record, not run by `run.sh`:
`tapstack.mjs` (the reported bug, reproduced through the UI), `rampcheck.mjs`
(tempo ramps measured end to end through the playhead), `timesig.mjs` (ruler and
transport agreeing on the length of a bar).

## Two rules these earned

**Touch is not mouse.** A mouse drag across a note grid *is* a draw gesture, and
`touch-action: pan-y` only governs touch. Testing a touch behaviour with
`page.mouse` cannot fail correctly. Use `Input.dispatchTouchEvent` via CDP so the
browser takes the gesture over and delivers the `pointercancel` the app has to
treat as "abandon" rather than "commit".

**Never `import('tone')` inside the page.** It creates a second Tone module with
its own Transport, which reports position `0:0:0` forever while the app plays
normally. Measure the observable consequence instead — the playhead readout,
wall-clock time to reach a beat.
