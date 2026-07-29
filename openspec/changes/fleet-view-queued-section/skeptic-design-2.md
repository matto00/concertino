## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `ticket.md`, the round-1 report (`skeptic-design-1.md`), and the
  current `proposal.md`, `design.md`, `tasks.md`,
  `specs/fleet-queue-visibility/spec.md` in full, from scratch.
- Re-read the actual source rather than trusting the docs' paraphrase:
  `lib/ui/screens/fleet.js` (full file), `lib/ui/watch.js` (full file),
  `lib/ui/queue.js` (full file), `lib/ui/cache.js` (full file),
  `lib/ui/format.js` (full file), and `test/fleet.test.js` (lines 1-260,
  including the multi-section height test at lines 220-247).

- **CR1 (Decision 4 self-contradiction) — resolved.** design.md:143's title
  now reads "`maxConcurrent` is read from `queueState`, not from config — no
  new plumbing required," matching its own body, and the body even flags
  that the title previously read the opposite (design.md:156-160).
  proposal.md's Impact section (line 68) was corrected to match: "No new
  `cfg.maxConcurrent` plumbing is needed — see design.md Decision 4." Ground
  truth: `queue.js:34` (`maxConcurrent: Math.max(1, maxConcurrent || 1)`) puts
  the value on `queueState`, and `fleet.js`'s `render()` (lines 364-372)
  already forwards `state.queueState` unchanged into `renderFleet` — so
  "already available, no new plumbing" is accurate.

- **CR2 (hardcoded 2-lines-per-row) — resolved.** Decision 2 (design.md:86-123)
  now specifies a generalized `linesPerRow` field (`2` explicit default on the
  four existing sections, `1` for QUEUED), with `sectionHeight` reading
  `2 + s.linesPerRow * shown[i] + (overflow ? 1 : 0)`. Confirmed against
  `fleet.js:201-205`, which today still hardcodes `2 + 2 * shown[i]` — i.e.
  the design accurately targets the real "before" state, not a paraphrase of
  it. tasks.md 1.3/1.4/2.2 wire this through the height function, the row
  renderer, and the render loop respectively, staying explicitly in lockstep
  (task 1.3's own wording: "MUST stay in lockstep... exactly like
  `s.unselectable`"). Task 4.4 adds the exact regression test round 1
  demanded — a populated QUEUED section added to an analogue of the existing
  `'the total-height cap holds with all four sections populated'` test,
  which I re-read at `test/fleet.test.js:222-247` (including its own header
  comment documenting the prior real incident) to confirm the pattern being
  extended is real and not invented.

- **CR3 (missing `statusKey: 'queued'` wiring) — resolved.** tasks.md task
  2.1 (lines 24-31) now explicitly lists `statusKey: 'queued'` on the QUEUED
  section entry, with an inline note explaining why ("wires up the
  `f.STATUS_COLOUR` entry from task 1.1 — without this the title renders
  uncoloured"). Confirmed against `format.js`'s actual `STATUS_COLOUR` table
  shape and `fleet.js:250`'s real fallback
  (`f.STATUS_COLOUR[s.statusKey] || ((x) => x)`) — the fix targets the
  correct, real failure mode.

- **CR4 (unspecified render-loop branching mechanism) — resolved.** New
  Decision 5 (design.md:162-188) explicitly states the loop branches on the
  same `s.unselectable` flag Decision 1 already introduces (not a second
  flag), and that `queuedTitles` (built in `watch.js`'s `draw()`) is passed
  into `renderFleet` as a top-level opt exactly like `queueState`/`selected`
  already are — closed over by the render loop, not threaded per-call.
  tasks.md 2.2/3.1/3.2 implement this consistently. Cross-checked against the
  real `fleet.js:242-246` render loop (which today unconditionally calls
  `renderRun`) and `watch.js:296`'s existing `cache.read(root)` call inside
  `openLaunchPad()` — the pattern Decision 3/task 3.1 extends to `draw()` is
  a real, already-used one-line JSON read, not new machinery.

- **Fresh, independent pass for new issues:** Decision numbering (1-5) is
  referenced consistently and correctly across all three docs (grepped every
  "Decision N" reference in proposal.md/design.md/tasks.md — no dangling or
  mismatched references). `queueState.maxConcurrent` (queue.js:34),
  `cache.read(root).tickets` (cache.js:57-64), and ticket `identifier` fields
  (confirmed present via `linear.js:191`) all check out against real code
  shapes the plan depends on. `renderQueuedRow`'s signature
  (`(ticket, position, title, width)`, task 1.4) deliberately omits a
  selected/marker parameter, which correctly avoids a footgun: since queued
  rows never advance `index` (per CR4's fix), computing `index === selected`
  for them would compare against a stale, carried-over index value — the
  design/tasks avoid this by never doing that comparison for QUEUED rows at
  all (task 4.6 tests the resulting invariant: no queued row is ever marked
  selected).
- Ran `npx openspec validate --changes fleet-view-queued-section --strict`:
  `✓ change/fleet-view-queued-section`, 1 passed / 0 failed.

### Verdict: CONFIRM

### Non-blocking notes

- design.md Decision 4's parenthetical explicitly narrating its own prior
  self-contradiction ("This decision's title previously read the opposite of
  this paragraph...") is unusual phrasing for a design doc but is accurate
  and harmless — no objection, just noting it reads more like a changelog
  entry than typical design prose.
- Risk/Trade-off #3 (reusing `MAX_FINISHED` as QUEUED's cap rather than a
  distinct constant) remains an explicit, reasoned deferral rather than an
  oversight — consistent with round 1's assessment.
