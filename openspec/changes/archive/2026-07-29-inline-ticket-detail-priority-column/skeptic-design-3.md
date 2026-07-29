## Skeptic Report — design gate (round 3)

### What I verified (with evidence)

- Re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both spec deltas
  (`specs/launchpad-detail-pane/spec.md`, `specs/ticket-priority/spec.md`), and
  both prior skeptic reports (treated as claims to re-verify, not fact).

- **Round 1 finding (the `P` sort-toggle action silently dropped by
  `watch.js`'s `applyAction` `default:` branch) remains correctly fixed** —
  unchanged since round 2's confirmation: `proposal.md` Impact lists
  `lib/ui/watch.js` (line 31), `design.md` Decision 3 names the
  `openLaunchPad()` initializer seed and the new `applyAction` `case`
  explicitly (lines 41-43), and `tasks.md` 4.7 implements it.

- **Round 2 finding (task 4.8 targeted `test/watch.test.js` with a
  "dispatch an action" pattern that cannot exist, since `applyAction`/
  `openLaunchPad` are private unexported closures) is now genuinely fixed,
  not cosmetically reworded.**
  - Read `tasks.md` task 4.8 fresh (line 30): it now targets
    `test/scripts/watch-smoke.test.sh`, cites the correct reason
    (`applyAction`/`openLaunchPad` are private closures, not exported),
    names the file's existing launch-pad cases to follow (the `N`-open and
    select/select-all cases), and points at the `Q_WORK` two-tickets-under-
    one-epic seeding block as the pattern to reuse.
  - Read `design.md` Decision 3's final paragraph (lines 45): it now states
    verbatim that `applyAction`/`openLaunchPad` are "private closures inside
    `watch(opts)`... a deliberate, already-documented architectural choice,
    not an oversight to work around," and names
    `test/scripts/watch-smoke.test.sh` as where the end-to-end proof belongs.
  - Independently re-verified the underlying facts against the real code
    (not just trusting the design's restatement): `lib/ui/watch.js`'s
    `module.exports` (grepped) still exports only
    `watch, buildFrame, attachAndRestore, computeLiveEscalations,
    idleMsFromActivity`; `applyAction`/`openLaunchPad` remain private.
    `test/scripts/watch-smoke.test.sh` (368 lines, read in full) does contain
    the `Q_WORK` block (lines 187-212) seeding two tickets
    (`CON-21`/`CON-22`) under one epic (`e2`/"Batch") via a hand-written
    cache JSON, exactly as task 4.8 and design.md now describe. This
    round-2 gap is resolved.

- **New issue found, not present in either prior round: task 2 (cache
  schema versioning) will break three already-passing regression cases in
  `test/scripts/watch-smoke.test.sh`, and no task in `tasks.md` updates
  them.**
  - `tasks.md` 2.3: "`read()` returns `empty()` when `parsed.schemaVersion`
    is missing or does not equal `CACHE_SCHEMA_VERSION`, before any other
    field is read from `parsed`." Read `lib/ui/cache.js` directly (122
    lines) to confirm today's `read()` (lines 39-65) has no such gate yet —
    task 2.3 is a new, stricter precondition than what exists now.
  - `lib/ui/watch.js:296` (`openLaunchPad()`) calls `cache.read(root)`
    directly against the on-disk file — this is the real load path a smoke
    test's seeded cache goes through, not a hypothetical.
  - Read `test/scripts/watch-smoke.test.sh` in full and found **three**
    existing regression blocks that hand-write
    `$WORK/.concertino/cache/linear.json` directly via `printf '{...}' >
    ...linear.json` with no `schemaVersion` field at all:
    - `LP2_WORK` (lines 160-164) — the "Critical-1" regression: seeds
      ticket `CON-9` to prove the launch pad shows `▲ running` for an
      already-running ticket and refuses to select it (lines 149-180).
    - `Q_WORK` (lines 187-190) — the "Critical-2" regression: seeds
      `CON-21`/`CON-22` under epic `e2` to prove an active queue survives
      and `q` warns before discarding it (lines 182-212). This is the exact
      block task 4.8 now points to as the "existing two-tickets-one-epic
      pattern" to reuse for the new priority-sort case.
    - `H_WORK` (lines 221-224) — the "Minor-1" regression: seeds `CON-31`
      to prove `h harness` cycling isn't advertised when `launchCommand` is
      pinned (lines 214-241).
  - Once task 2.3 lands, `parsed.schemaVersion` is `undefined` for all
    three of these fixture files (`undefined !== CACHE_SCHEMA_VERSION`), so
    `cache.read()` returns `empty()` for every one of them. The launch pad
    opens with zero tickets in all three cases instead of the seeded
    fixture tickets — the tickets these tests select, queue, and assert
    `▲ running`/`1 queued`/`LAUNCH PLAN` against would simply not be there
    to select. All three existing `grep -q` assertions that depend on those
    tickets being present and selectable (`▲ running`, `1 running`/
    `1 queued`, `quit with 2 ticket`, `quitting with 2 queued ticket`,
    `LAUNCH PLAN`) would fail.
  - No task addresses this. `tasks.md` 2.4 only scopes updates to
    `test/cache.test.js` (the file task 2 is directly about — a reasonably
    foreseeable edit for whoever executes task 2). `tasks.md` 6.1 ("run the
    full test suite and confirm no regressions in unrelated screens... that
    also exercise `layout.js`/`opts.rows`") is scoped to layout/render
    regressions, not to cache-format fixture breakage, and does not name
    `test/scripts/watch-smoke.test.sh`. `proposal.md`'s Impact section does
    not list `test/scripts/watch-smoke.test.sh` among the files this change
    touches.
  - This is the same class of gap round 1 and round 2 both found and
    required fixing for: a concrete, mechanically-verifiable consequence of
    the plan (an existing file's behavior breaking) that no task names, so
    the task list as written cannot be executed to completion without an
    unplanned deviation discovered only when the suite is run at 6.1 — by
    which point the executor has to freelance a fix (or, worse, weaken
    task 2.3's invalidate-on-mismatch behavior to avoid touching the
    fixtures, undermining Decision 1's whole rationale) that design.md never
    decided.
  - This also affects task 4.8's own new fixture: the new smoke-test case it
    asks for (seed two tickets, same epic, different priority, press `P`)
    will hit exactly the same problem unless its own hand-written cache JSON
    includes a matching `schemaVersion` — task 4.8 as currently worded gives
    no reason to expect the executor writing the *new* case would think to
    add a field none of the *existing* cases (which it is told to model the
    new one on) currently have.

### Verdict: REFUTE

### Change Requests

1. **Add a task (e.g. 2.5, or fold into 6.1) to update the three existing
   hand-written cache fixtures in `test/scripts/watch-smoke.test.sh` to
   include the new `schemaVersion` field**, so they continue to read as
   valid caches once task 2.3's invalidate-on-mismatch check lands:
   - `LP2_WORK`'s seeded JSON, `test/scripts/watch-smoke.test.sh:163`
     (Critical-1 regression, `▲ running` / refuses-to-select).
   - `Q_WORK`'s seeded JSON, `test/scripts/watch-smoke.test.sh:189`
     (Critical-2 regression, active-queue warning on quit).
   - `H_WORK`'s seeded JSON, `test/scripts/watch-smoke.test.sh:223`
     (Minor-1 regression, `h harness` not advertised when pinned).
   Each currently has the shape
   `{"fetchedAt":...,"teamKey":"CON","tickets":[...],"epics":[...]}` with no
   `schemaVersion` key; each needs `"schemaVersion":2` (or whatever
   `CACHE_SCHEMA_VERSION` resolves to) added so `cache.read()` does not
   invalidate them and silently empty out the launch pad these tests
   depend on.
2. **Explicitly note in task 4.8 (or design.md Decision 3/1) that the new
   priority-sort fixture cache must itself include `schemaVersion`**, since
   the existing `Q_WORK`-style pattern it's told to follow predates this
   change and does not have that field — without calling this out, an
   executor modeling the new case on the old one reproduces the same
   omission in the very fixture the new test depends on.
3. **List `test/scripts/watch-smoke.test.sh` in `proposal.md`'s Impact
   section** alongside `lib/ui/cache.js`, so the schema-version change's
   blast radius on this file (three fixture updates, not just the new
   task-4.8 case) is visible at the proposal level — matching the project's
   established practice of naming every file a change's plan requires
   touching (the same practice round 1 asked for `lib/ui/watch.js`).

### Non-blocking notes

- Everything round 1 and round 2 found is now genuinely resolved: the `P`
  key's reducer wiring (`watch.js` initializer + `applyAction` case) is
  planned and file-referenced correctly, and task 4.8 now targets the
  correct, executable test mechanism
  (`test/scripts/watch-smoke.test.sh`) with a concrete, reusable fixture
  pattern.
- Decision 1 (cache schema versioning, invalidate-not-infer), Decision 2
  (shared `ticketDetail.js` renderer), and Decision 4 (three-pane degrade
  budget) remain sound on this pass — no new issues found there.
- `test/cache.test.js`'s own pre-existing cases (e.g. lines 63-64 seeding a
  raw `{"fetchedAt":1}` file) already expect `empty()` for a file missing
  required fields, so they're unaffected by the schema-version gate; the
  gap identified here is specific to `test/scripts/watch-smoke.test.sh`'s
  hand-written fixtures, which are outside the file task 2 is scoped to and
  therefore easy to miss.
