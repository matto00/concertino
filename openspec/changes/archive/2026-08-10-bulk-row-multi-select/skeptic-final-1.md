## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established, cold.**
- Read `ticket.md`, `design.md`, `tasks.md`, `files-modified.md`, and all three
  spec deltas (`specs/fleet-bulk-select/spec.md`,
  `specs/fleet-failed-remediation/spec.md`,
  `specs/fleet-queue-force-start/spec.md`) directly from the worktree.
- `git diff main...HEAD --stat` — 25 files, matches `files-modified.md`'s claims
  file-for-file; no unrelated files touched (the two openspec bookkeeping
  files `workflow-state.md`/`evaluation-2.md` are the only uncommitted diffs
  at HEAD, expected mid-review state).
- Read `lib/ui/screens/fleet/keys.js`, `lib/ui/controllers/fleet.js` (full),
  `lib/ui/app-state.js`, `lib/ui/screens/fleet/render.js`,
  `lib/ui/screens/fleet/grid.js`, `lib/ui/screens/fleet/rows.js`,
  `lib/ui/screens/fleet/sections.js`, and the relevant `watch.js` sections
  in full — not summaries, the actual source.

**Gates re-run myself, fresh:**
- `node --test` (full suite): **1952 passed, 0 failed**, exit 0.
- `node --test test/controllers-fleet.test.js test/fleet.test.js
  test/watch.test.js` (the three files this ticket touches, isolated):
  **482 passed, 0 failed**.
- `npm test`'s bash-script tail (auditor/set-ticket-state/local-provider
  tests, unrelated to this change but part of the full gate) also completed
  clean in the portion I inspected.

**Acceptance criteria traced to real code + tests, not just claims:**
1. *"`space` multi-selects rows within FAILED and QUEUED; the section's
   existing action key applies to the full selection behind one `y`
   confirmation naming the count."* — `keys.js:406-420` binds `space` at the
   FAILED top-level site and inside `focus === 'queue'` (`keys.js:259-264`);
   `a`/`d`/`f` each check `multiSelect.<section>.size > 0` before falling
   back to single-row (`keys.js:415-420`, `keys.js:274-277`);
   `controllers/fleet.js:530-541` opens `S.bulkConfirm`; `sections.js:376-401`
   renders the count-naming banner (and, for force-start, the
   `maxConcurrent` overage). Verified against real tests:
   `fleet.test.js:1898-1973` (space toggle + bulk dispatch + confirm/cancel
   resolution), `fleet.test.js:2486-2514` (banner text names the count).
2. *"A partial failure mid-batch is reported per-row, never silently
   swallowed."* — `controllers/fleet.js:568-655`, all three
   `confirm-bulk-*` handlers build `results: [{ticket, ok, error}]` per
   ticket via a loop/map that never short-circuits on one ticket's failure,
   set into `S.bulkResult`, rendered by `sections.js:331-337` as one line
   per ticket. Verified with tests that actually exercise the failure path,
   not just assert prose: `controllers-fleet.test.js:456-475` (a mocked
   `submitTicket` spawn error for HEL-2 leaves HEL-1's spawn untouched and
   both appear in results), `controllers-fleet.test.js:516-527` (a ticket
   admitted mid-batch is reported `ok:false`, not double-started), and the
   "fully successful still renders" case (`fleet.test.js:2549-2555`) proving
   this isn't special-cased into silence on the happy path either.
3. *"Documented in `docs/dashboard.md`'s key tables."* — confirmed: the key
   table rows for `space`/`a`/`d`/`f` (`docs/dashboard.md:137-140`) and a
   dedicated "Bulk actions on multiple rows" section
   (`docs/dashboard.md:192-222`) describing the marker, persistence,
   confirmation, and per-row result semantics accurately match the
   implementation I read.

**Design decisions honored, not just asserted:**
- Dedicated `✓` marker independent of `▸`/`»`, persists across `j`/`k`:
  confirmed in `rows.js:163-202` (`renderFinishedRow`) and `rows.js:226-247`
  (`renderQueuedRow`) — both markers render independently; `move`/
  `move-queue-focus` handlers in `controllers/fleet.js` never touch
  `S.multiSelect`.
- Per-row result list, not a rolled-up summary: confirmed above.
- Threading discipline (skeptic-design round 1's findings 1-3, load-bearing
  per design.md): `app-state.js` allowlists `multiSelect`/`bulkConfirm`/
  `bulkResult` in `currentState()` (line ~308-351); `render.js`'s
  `mergeRenderOpts` threads all three (lines 404-406); `scrollToShow`'s
  `winOpts` and `watch.js`'s `heightOpts` both carry `bulkConfirm`/
  `bulkResult` (`controllers/fleet.js:45-52`, `watch.js:678-685`); grid mode
  (`grid.js`) independently threads the same fields through its own
  `rowCtx`/`buildHeadTail` call — I checked grid mode is not a silent gap.
- The evaluator-cycle-1 regression (stale `S.multiSelect.queued` surviving a
  digit-jump/mouse-click out of QUEUED focus) — the actual fix in
  `controllers/fleet.js:77-129` (`applyJumpAction`'s `'jump'` and
  `'focus-quickstart'` cases, each guarded on `S.focus === 'queue'`) is
  real and exercised by a genuine end-to-end regression test
  (`test/watch.test.js:1624-1730`) that drives an SGR mouse click through
  the actual `onKey` intercept, then presses `f` and asserts the resulting
  confirm is single-row, not a stale bulk one — the strongest form of
  coverage for this defect class, not a shortcut controller-only assertion.
- One-shot `S.bulkResult` clear that still lets the triggering key act
  (design.md Decision 4 / skeptic round 1 finding 3): `watch.js:1174-1186`
  clears it at the very top of `onKey`, before the mouse-click intercept
  and the reserved-`g`-key branch too (an improvement over the design's
  literal ask, made in cycle 2, and it does not reintroduce a swallowed-key
  regression — the clear is unconditional and non-returning).

### UI / design judgment

N/A — no UI review is configured for this project (per role instructions);
this is a terminal dashboard with no design-standard doc configured, and no
dev-server verification step applies.

### Verdict: CONFIRM

Ships. All three ACs trace to real, working code exercised by meaningful
tests (not vacuous ones — each new test asserts a distinct, previously
unverified transition). The gates I re-ran independently match the
evaluator's cycle-2 PASS claim (1952/1952). The one substantive defect
caught in cycle 1 (stale QUEUED multi-select surviving a non-Escape exit
from queue focus) has a correct, narrowly-scoped fix with the strongest
tier of regression coverage available for a keyboard/mouse-driven TUI.

### Non-blocking notes

- `confirm-bulk-address`/`confirm-bulk-mark-done` do not clear a
  possibly-stale `S.addressFailureNotice` left over from a prior single-row
  `a` failure, so in the rare case both are simultaneously non-null the
  footer could show an old single-ticket notice line alongside the new
  per-row `bulkResult` list. Not a shipped-behavior regression (the single-
  row path already clears its own notice on next attempt) and not covered
  by any AC — worth a follow-up ticket if it's ever observed in practice,
  not a blocker here.
