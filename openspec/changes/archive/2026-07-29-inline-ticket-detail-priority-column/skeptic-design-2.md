## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and both spec
  deltas (`specs/launchpad-detail-pane/spec.md`, `specs/ticket-priority/spec.md`)
  fresh, plus `skeptic-design-1.md` (treated as a claim to re-verify, not fact).
- **Round-1 finding (the `P` action being silently dropped by `watch.js`'s
  `applyAction` `default:` branch) is now correctly diagnosed and the fix is
  real**, not cosmetic:
  - `proposal.md`'s Impact section now lists `lib/ui/watch.js` explicitly
    (line 31), describing exactly the gap round 1 found.
  - `design.md` Decision 3 (lines 41-43) now states the reducer-wiring
    requirement explicitly and names both the `openLaunchPad()` initializer
    seed and the new `applyAction` `case`.
  - `tasks.md` task 4.7 adds the actual wiring; task 4.4 was correctly split
    to only return an action (not mutate `lp` directly).
  - Cross-checked every code citation against the real file, not the design's
    paraphrase: `lib/ui/watch.js:292` (`function openLaunchPad()`), `:294`
    (`launchPad = {`), `:597` (`switch (action.type)`), `:810`
    (`case 'set-mode':`), `:983` (`default:`) — all match what design.md and
    tasks.md 4.7 describe. The plan's proposed `case` (sibling to
    `case 'set-mode':`) and initializer seed are both concretely placeable in
    the real code as described.
  - Confirmed `ticketsForEpic(lp)` (`lib/ui/screens/launchpad.js:48-54`) is
    the single shared lookup already used by both `launchpad.js`'s own render
    (line 196) and every `watch.js` case that reads the tickets pane
    (`move-launchpad`, `toggle-select`, `select-all`, `open-ticketview` —
    `lib/ui/watch.js:766-822`), so task 4.5's plan to apply `lp.ticketSort`
    inside it (rather than at each call site) will propagate consistently
    everywhere, not just in one render path.

- **New issue found: task 4.8's test plan is built on a false premise about
  `test/watch.test.js` and is not executable as written**, which reopens
  exactly the class of gap round 1 flagged (a task that can be "checked off"
  without actually proving the real keypress path works).
  - Task 4.8 says: "Add a `watch.js`-level test (in `test/watch.test.js`,
    following that file's existing pattern for dispatching an action and
    asserting on resulting state) that exercises the real `P` keypress →
    `applyAction` → `launchPad.ticketSort` path end to end."
  - Read all of `test/watch.test.js` (198 lines, all 19 `test(...)` blocks
    listed via grep). It exercises exactly five things:
    `buildFrame`, `attachAndRestore`, `computeLiveEscalations`,
    `idleMsFromActivity`. **No test in the file dispatches an action or
    touches `applyAction`, `openLaunchPad`, or `launchPad` state at all** —
    there is no "existing pattern" of the kind task 4.8 asks the executor to
    follow.
  - Read `lib/ui/watch.js` directly: `applyAction` (line 595), `openLaunchPad`
    (line 292), and `onKey` (line 988) are all functions declared *inside*
    the body of the async `watch(opts)` function (line 153) — private
    closures, not standalone module-level functions. `module.exports`
    (lines 1041-1044) exports only `watch, buildFrame, attachAndRestore,
    computeLiveEscalations, idleMsFromActivity` — `applyAction` is not
    reachable from a test file at all, by any name.
  - This is not an oversight in the current code — it's a documented
    architectural decision. The comment directly above `module.exports`
    (`lib/ui/watch.js:1036-1040`) states verbatim: *"buildFrame,
    attachAndRestore, computeLiveEscalations, and idleMsFromActivity are
    exported alongside watch() purely for test/watch.test.js ... watch()
    itself runs an interval loop against real stdin/stdout, so the pure
    logic is what gets unit tests; watch()'s own runtime behavior is
    unchanged and still covered end to end by
    test/scripts/watch-smoke.test.sh."* The project has already deliberately
    chosen an end-to-end shell smoke test as the mechanism for testing this
    exact class of behavior (real keypress → `applyAction` → state), and
    deliberately keeps `applyAction` unexported.
  - Confirmed `test/scripts/watch-smoke.test.sh` is the actual established
    pattern for this: it pipes real key sequences into
    `node bin/concertino watch` (e.g. `printf 'N\t a\x1bq' | ... watch`,
    line 170) and asserts on rendered output content via `grep -q` against
    the captured screen (e.g. `grep -q '\[x\] CON-9'` line 176, `grep -q
    '▲ running'` line 173) — including prior launch-pad-specific cases
    (`N` to open, tab/select, launch-plan). This is precisely the mechanism
    that would let a test seed two fixture tickets with different
    priorities, open the launch pad, press `P`, and assert the rendered
    order flips — the thing round 1 asked for.
  - As currently scoped, an executor following task 4.8 literally has no
    path to complete it: they cannot add a `watch.js`-level unit test that
    "dispatches an action" because no export exists to dispatch through, and
    the file's own existing tests establish no such pattern. The realistic
    outcomes are either (a) the executor discovers this mid-implementation
    and improvises — silently exporting `applyAction`/`launchPad` state from
    `watch.js` against the module's own documented rationale, an
    architectural change never decided in design.md — or (b) the task gets
    quietly dropped/reinterpreted and the `P` key ships with no test that
    actually exercises the real dispatch path, which is the exact defect
    class round 1 was written to prevent.

### Verdict: REFUTE

### Change Requests

1. **Rewrite `tasks.md` task 4.8 to target `test/scripts/watch-smoke.test.sh`,
   not `test/watch.test.js`.** `applyAction`/`openLaunchPad` are private
   closures inside `watch(opts)` (`lib/ui/watch.js:153,292,595`) and are not
   exported (`module.exports` at `lib/ui/watch.js:1041-1044`); the file's own
   header comment (`lib/ui/watch.js:1036-1040`) states this is deliberate and
   names `test/scripts/watch-smoke.test.sh` as the established mechanism for
   testing exactly this class of behavior. The new case should follow the
   existing launch-pad cases in that file (e.g. the `N`-open and
   select/select-all cases around lines 130-176): seed a fixture cache with
   at least two tickets of different priority under the same epic, pipe a
   key sequence that opens the launch pad and presses `P`, and assert via
   `grep -q`/ordering on the captured `$OUT` that the rendered ticket order
   actually changes — proving the real `P` keypress reaches
   `applyAction`/`launchPad.ticketSort`, not just that `handleKey` returns
   the right action shape or that `renderLaunchPad` sorts correctly against
   a hand-built fixture.
2. **Update `design.md` Decision 3 and/or the Risks section** to name
   `test/scripts/watch-smoke.test.sh` (not a generic "`watch.js`-level test")
   as where the end-to-end proof lives, so a reader doesn't reasonably expect
   a `test/watch.test.js` unit test that the codebase's own architecture
   cannot support.

### Non-blocking notes

- Everything else from round 1 (cache-schema versioning, shared
  `ticketDetail.js` renderer, three-pane degrade behavior, priority rank/
  rendering, row-width re-derivation) is unchanged since round 1's review and
  was already confirmed sound there; this round's re-review found no new
  issues in those areas.
- Once Change Request 1 is applied, re-verify that the smoke-test fixture
  pattern used elsewhere in `watch-smoke.test.sh` (e.g. the `LP_WORK`/
  `LP2_WORK` cache-seeding blocks around lines 130-172) can express "two
  tickets, same epic, different priority" without new scaffolding — a quick
  skim suggests yes (the existing `Q_WORK` block at line 189 already seeds
  two tickets under one epic), but the executor should confirm this doesn't
  need a new helper.
