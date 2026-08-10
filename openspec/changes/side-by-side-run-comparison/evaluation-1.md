## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
Issues: none.

- Both AC items addressed explicitly:
  - "Two DONE runs can be selected and compared side by side: timeline,
    gate results, duration" — implemented via `S.compareSelection`
    (capped-at-2, shared between `lib/ui/screens/archive.js` and
    `lib/ui/screens/fleet/keys.js`/`rows.js`), the new `compare` screen
    (`lib/ui/screens/compare.js`) rendering two columns of
    `compareTimelineLines`/`compareGatesLines` plus a duration/delta
    header (`durationHeaderLine`).
  - "Documented in `docs/dashboard.md`" — new "Side-by-side run comparison"
    section added, plus key-table updates for `space`/`c` in both the
    fleet and archive key tables.
- No AC silently reinterpreted — the ticket's own "design decision to
  escalate" (narrower rendering vs. truncated reuse) was resolved via
  self-approval during Planning per design.md's documented rationale
  (escalation went unanswered; ticket's own leaning text supported the
  chosen path), not silently substituted.
- All `tasks.md` items (1.1–9.2) marked `[x]`; spot-checked against the
  diff and each is implemented as described (shared toggle helper,
  archive/fleet marking + trigger, compare screen render/controller,
  router registration, docs, and a full test matrix). No task claims an
  implementation that isn't present in the diff.
- No scope creep — every changed file matches proposal.md's stated Impact
  list (`lib/ui/compare-selection.js`, `screens/compare.js`,
  `controllers/compare.js`, `router.js`, `controllers/index.js`,
  `app-state.js`, `screens/archive.js`, `controllers/archive.js`,
  `screens/fleet/{keys,rows,render}.js`, `controllers/fleet.js`,
  `docs/dashboard.md`, and the corresponding test files).
- No regressions to existing behavior: the FAILED-row `space`/multi-select
  path is untouched (new DONE-row branch is a separate `if`); the
  `CONFIRM_RESTORED_QUEUE_KEY` precedence for a pending restored-queue
  confirmation is preserved (the new `c`-for-compare check sits in a
  second, later `if` block, only reached after the first returns early);
  `backToFleet()` resets only the compare screen's transient view state,
  never `compareSelection` itself, matching design.md's explicit
  "Selection lifecycle, precisely" resolution.
- No backend/API contracts touched — matches proposal.md's stated
  "no new event kinds" / reads the same `state.runs`.
- Planning artifacts (proposal/design/tasks/spec deltas) accurately
  describe the final implementation; spot-checked design.md Decisions 1–4
  against the code and found each precisely implemented (shared
  `toggleCompareSelection` helper, own narrower rendering reusing only
  `describeEvent`/`fmtGateDuration`, `compareReturnMode` mirroring
  `ticketviewReturnMode`, and `c`'s precedence ordering vs.
  `CONFIRM_RESTORED_QUEUE_KEY`).

### Phase 2: Code Review — PASS
Issues: none blocking.

**Gates (freshly re-run by evaluator, in `WORKTREE_PATH` — `SPEED=default`,
`EVALUATOR_CLEAN_WORKTREE=false`, so no clean-worktree re-run applies):**
- `npm test` — exit code 0. `node --test`: 2087 passed, 0 failed
  (includes all new `test/compare.test.js`,
  `test/controllers-compare.test.js`, `test/compare-selection.test.js`
  subtests, plus the extended `archive`/`controllers-archive`/`fleet`/
  `controllers-fleet` suites). All bundled shell-script test suites
  (`test/scripts/*.sh`) also passed.

**Canonical standards:** none configured for this project — none to check.

**Review checklist:**
- DRY — the capped-at-2 toggle/cap logic lives in exactly one place
  (`lib/ui/compare-selection.js`), imported identically by both
  `controllers/archive.js` and `controllers/fleet.js` rather than
  duplicated. `describeEvent`/`fmtGateDuration` are imported and reused
  as-is from `drilldown.js` rather than re-implemented; only the
  width/column-budget line-assembly is new, matching design.md's stated
  drift-minimization rationale.
- Readable — naming is clear and consistent with the codebase's existing
  conventions (`compareSelection`, `compareReturnMode`,
  `compareLeftScroll`/`compareRightScroll`/`compareFocus`); no magic
  values beyond well-commented layout constants
  (`BOX_BORDER_PADDING_COLS`, `GAP`, `COLUMN_VIEWPORT_ROWS`) that mirror
  identical constants already present in `fleet.js`/`drilldown.js`/
  `docview.js`.
- Modular — new screen/controller pair follows the existing router seam
  exactly (`render`/`routeHandleKey` in `compare.js`, `handle` in
  `controllers/compare.js`, registered in `router.js`'s `SCREENS` and
  `controllers/index.js`'s `CONTROLLERS`); selection-toggle logic factored
  into its own pure, single-purpose module.
- Type safety — plain JS, consistent with the rest of the codebase; no
  new untyped escape hatches.
- Security — no new I/O, no user-supplied strings reach a shell/eval
  boundary; all rendering goes through existing `f.truncate`/`f.padTo`
  helpers already used elsewhere for output-width safety.
- Error handling — `resolveCompareRuns` returns `null` for a
  ticket/run that's vanished from `state.runs` (e.g. pruned by
  retention between marking and opening compare), and the render call
  site shows an explicit "no longer available" fallback rather than
  throwing — mirrors `drilldown.js`'s own precedent. `toggleCompareSelection`
  is defensive against a `null`/`undefined` `run` argument (treated as
  non-DONE) and never mutates its input.
- Tests meaningful — new tests exercise the cap boundary (marking a 3rd
  while 2 are already selected is a no-op and evicts neither), the
  DONE-only gate, purity of the pure helper, the `c`-vs-
  `CONFIRM_RESTORED_QUEUE_KEY` precedence interaction, marker rendering
  in both archive and fleet, and `esc`'s origin-aware routing (both
  origins plus the defensive `null`-origin fallback) — these would catch
  a real regression in any of the cap/DONE-only/precedence/origin-routing
  rules.
- No dead code — no unused imports (verified all `compare.js` requires
  are consumed), no leftover TODO/FIXME anywhere in the diff.
- No over-engineering — the new selection state is a small, purpose-built
  field rather than an extension of the unrelated `multiSelect` shape;
  design.md explicitly documents and justifies not reusing `multiSelect`
  for this.
- Behavior-preserving where expected — the FAILED-row multi-select `space`
  binding and existing `CONFIRM_RESTORED_QUEUE_KEY` precedence are both
  verified unchanged by dedicated tests, not just by inspection.

### Phase 3: UI Review — N/A
This project has no UI review configured for this ticket's evaluator role
(per role instructions); dev-server steps skipped.

### Overall: PASS

### Non-blocking Suggestions
- `lib/ui/screens/compare.js`'s `columnLines`/`durationHeaderLine` assume
  `run.gates`/`run.events`/`run.elapsedMs` are always array/number-shaped
  once `run` is non-null (consistent with how `drilldown.js` already
  treats the same fields) — no actual bug observed, just noting the same
  implicit-shape assumption already exists elsewhere in the codebase and
  isn't introduced newly here.
