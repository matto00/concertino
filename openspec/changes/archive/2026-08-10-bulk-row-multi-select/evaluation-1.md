## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- All ticket acceptance criteria addressed: `space` multi-select on FAILED/QUEUED,
  bulk `a`/`d`/`f` behind a count-naming `y` confirmation, per-row (never
  rolled-up) partial-failure reporting, and `docs/dashboard.md`'s key tables
  updated (new `space` row plus updated `a`/`d`/`f` rows and a new "Bulk
  actions on multiple rows" section).
- No AC silently reinterpreted — the "empty selection == today's single-row
  behavior" additive framing from proposal.md/design.md is implemented and
  explicitly unit-tested byte-for-byte (`test/fleet.test.js`: "a/d with an
  EMPTY FAILED multi-select set behave byte-for-byte exactly as before this
  change (tasks.md 3.3)", equivalent QUEUED test for `f`).
- All 33 `tasks.md` items are checked (`[x]`) and each matches what the diff
  actually implements — verified item-by-item against the diff, not taken on
  faith.
- No scope creep: `git diff main...HEAD --stat` touches exactly the files
  `files-modified.md`/proposal.md's Impact section name (`app-state.js`,
  `screens/fleet/{keys,render,rows,grid,sections}.js`, `controllers/fleet.js`,
  `watch.js`, `docs/dashboard.md`, three test files) plus the openspec change
  artifacts themselves.
- No regressions to existing single-row FAILED/QUEUED behavior — the
  single-row `address-failure`/`confirm-mark-done`/`confirm-force-start`
  handlers are untouched; the bulk handlers are separate, deliberately
  duplicated cases (tasks.md 5.7's documented decision, with a comment in
  `controllers/fleet.js` explaining why a shared helper was rejected).
- No API/schema contracts affected (purely an in-memory `S`/terminal-UI
  change).
- Planning artifacts (design.md/tasks.md/spec deltas) accurately reflect the
  final implemented behavior; both skeptic-design rounds' findings (round 1
  REFUTE → round 2 CONFIRM) are genuinely carried through to code, not just
  acknowledged in prose (see Phase 2 for the line-by-line check).

### Phase 2: Code Review — FAIL

**Gates run (fresh, in `WORKTREE_PATH`):** `npm test` → **1945 passed, 0
failed**, exit code 0 (includes `node --test` plus the full battery of
`test/scripts/*.test.sh` shell suites). No lint is configured for this
project.

**Skeptic-flagged state-threading points — all verified fixed in the diff:**
- `app-state.js`'s `currentState(S)` (line ~350) now lists `multiSelect,
  bulkConfirm, bulkResult` alongside `markDoneConfirm`/`addressFailureNotice`
  — fixes skeptic round-1 finding 1.
- `screens/fleet/render.js`'s `mergeRenderOpts` (line ~399-405) adds the same
  three fields — also finding 1.
- `controllers/fleet.js`'s `scrollToShow`'s `winOpts` (line ~45-51) and
  `watch.js`'s separate `heightOpts` (line ~678-684) both add
  `bulkConfirm`/`bulkResult` with comments citing the historical
  `markDoneConfirm`/`fleet-metrics-grid final-fix 2` bug class — finding 2.
  `test/watch.test.js` pins all three opts-construction sites with an
  explicit field-presence loop.
- `watch.js`'s `onKey` clears `S.bulkResult` immediately before
  `router.handleKey(key, currentState())` (line ~1222), not as a
  `fleet/keys.js` intercept — finding 3. `test/watch.test.js` has a genuine
  end-to-end test asserting `j` both clears a visible `bulkResult` AND still
  moves the cursor in the same keypress.

**New defect found (not covered by either skeptic round or `tasks.md`):
`S.multiSelect.queued` is not cleared when focus leaves `'queue'` via any
path other than `Escape` (`exit-queue-focus`).**

`lib/ui/controllers/fleet.js`'s `'focus-queue'`/`'focus-quickstart'` cases
correctly clear `S.multiSelect.failed` whenever focus leaves `'runs'`
(lines ~92-101). But the mirror-image guarantee for `queued` — stated in
design.md's Risks section ("`S.multiSelect.queued` gets the mirror-image
treatment: cleared on `exit-queue-focus`... in addition to bulk-resolution")
and in the `fleet-bulk-select` spec ("cleared... on `exit-queue-focus`") —
only covers the `Escape` path. Two other ways focus leaves `'queue'` do NOT
clear it:

1. `lib/ui/screens/fleet/keys.js`'s own digit-jump comment (line ~213-215)
   states this is intentional, pre-existing (CON-39/40) behavior: "pressing a
   different section's digit while focus is `'queue'`/`'quickstart'` exits
   that focus and jumps as normal" — dispatching either `{ type: 'jump',
   index }` (target is a runs-backed section) or `{ type: 'focus-quickstart'
   }` (target is QUICK START), never `'exit-queue-focus'`.
2. `lib/ui/watch.js`'s SGR mouse-click handler (line ~1193) dispatches the
   identical `{ type: 'jump', index: S.fleetRowMap[click.row] }` regardless
   of current focus, for any click on a mapped run row.

`controllers/fleet.js`'s `'jump'` case (line ~80-85) sets `S.focus = 'runs'`
but never touches `S.multiSelect.queued`; `'focus-quickstart'` (line
~99-102) clears only `S.multiSelect.failed`. Neither is guarded on
`S.focus === 'queue'` to also clear the queued set the way `'focus-queue'`/
`'focus-quickstart'` already guard for the failed set.

**Concrete repro:** enter QUEUED focus, `space`-toggle a ticket into
`S.multiSelect.queued`, then press a digit key that jumps directly to a
FAILED/RUNNING/DONE section (or click a run row with the mouse) instead of
pressing `Escape` — `S.multiSelect.queued` keeps the stale ticket. Digit-jump
back into QUEUED focus later (`'focus-queue'`, which also doesn't clear
`multiSelect.queued`) and press `f`: the stale, forgotten selection silently
fires as part of a bulk force-start, including a ticket the operator no
longer intends to touch and may not even remember selecting. This is exactly
the "stale selection surviving... would be confusing, not helpful" failure
mode design.md's Decision 3 explicitly names as the reason bulk confirmations
themselves clear the set on cancel — the same reasoning applies to leaving
the section by any path, not just `Escape`, but the implementation (matching
`tasks.md` 7.1/7.2's own narrower wording) only covers the one named
transition.

Confirmed via `grep` that no existing test in `test/controllers-fleet.test.js`
exercises `'jump'` or `'focus-quickstart'` clearing `S.multiSelect.queued` —
only the three transitions `tasks.md` names (`focus-queue`→failed,
`focus-quickstart`→failed, `exit-queue-focus`→queued) are tested.

**Everything else in Phase 2 is solid:**
- DRY / readable / modular: bulk handlers mirror their single-row
  counterparts' logic closely, each carrying a comment explaining the
  deliberate non-shared-helper decision (tasks.md 5.7).
- Type safety: no untyped escape hatches (plain JS project, consistent with
  existing code).
- Security: no new input-validation/injection surface — same trust boundary
  as the existing single-row actions.
- Error handling: every per-ticket outcome is captured in `bulkResult`,
  including the stale/vanished-mid-batch case — no silent swallowing.
- Tests: thorough and meaningful — toggle add/remove, section independence,
  empty-vs-non-empty dispatch threshold (with an explicit byte-for-byte
  regression test), all three bulk-execution handlers' full-success/partial-
  failure/vanished-ticket paths, marker rendering (both alone and alongside
  the existing cursor marker), banner text (count + concurrency overage),
  footer-hint gating, and the three-site scroll/height-budget regression.
- No dead code, no leftover TODO/FIXME.
- No over-engineering — no bulk-mode boolean, no premature abstraction; the
  size-gated dispatch design.md settled on is implemented as specified.

### Phase 3: UI Review — N/A

No UI review is configured for this project (per role instructions); dev
server steps skipped accordingly.

### Overall: FAIL

### Change Requests

1. In `lib/ui/controllers/fleet.js`, clear `S.multiSelect.queued` whenever
   focus is leaving `'queue'` through a path other than `'exit-queue-focus'`:
   - In the `'jump'` case (~line 80-85): before/alongside setting
     `S.focus = 'runs'`, if `S.focus === 'queue'` at the time this fires,
     also set `S.multiSelect.queued = new Set()` — mirroring how
     `'focus-queue'`/`'focus-quickstart'` already clear
     `S.multiSelect.failed` when leaving `'runs'`.
   - In the `'focus-quickstart'` case (~line 99-102): guard the existing
     `S.multiSelect.failed = new Set()` line's sibling — add
     `if (S.focus === 'queue') S.multiSelect.queued = new Set();` (in
     addition to the unconditional failed-clear, since `'focus-quickstart'`
     can be reached from either `'runs'` or `'queue'`).
   Add regression tests in `test/controllers-fleet.test.js` mirroring the
   existing "`focus-queue` clears `S.multiSelect.failed`" tests, but for
   `S.multiSelect.queued` under `'jump'` (starting from `S.focus === 'queue'`)
   and `'focus-quickstart'` (starting from `S.focus === 'queue'`). Also
   consider a `test/watch.test.js`-level end-to-end regression exercising the
   mouse-click path (`S.fleetRowMap` + `parseMouseClick`) from QUEUED focus,
   since that reaches the same under-guarded `'jump'` case independently of
   the keyboard digit-jump path.

### Non-blocking Suggestions

- (Carried from skeptic-design-2.md, still open, genuinely non-blocking):
  `watch.js`'s `onKey` mouse-click and reserved-`g`-key early-return branches
  don't clear `S.bulkResult` before returning, so a mouse click or `g` press
  while a `bulkResult` banner is visible leaves it stale until the next key
  that reaches `router.handleKey`. Not a crash, not an AC violation — worth a
  deliberate one-line fix or an explicit "accepted" note if left as is.
