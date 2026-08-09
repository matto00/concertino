## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
Issues: none.

- All three ticket ACs addressed explicitly and fully:
  1. "At least one screen supports clicking to select/focus, dispatched through the same action handlers as the equivalent keyboard path" — fleet run-row list click resolves to the pre-existing `jump` action (`lib/ui/controllers/fleet.js:76-82`, unchanged, reused by both digit-jump and click); dispatch site `lib/ui/watch.js:1161-1167`.
  2. "Mouse mode is enabled/disabled cleanly on dashboard entry/exit — no leaked terminal mouse-reporting state after `q` or a crash" — `MOUSE_REPORT_ENTER`/`EXIT` paired at all four now-real exit paths (startup, `quit()`, both suspend-for-attach functions) plus a genuinely new `process.on('uncaughtException', ...)` handler (`lib/ui/watch.js:975-1000` area) that did not exist before this change, matching design.md's ground-truth correction that no such handler previously existed.
  3. "Documented in `docs/dashboard.md`" — new "Mouse support (fleet run rows only)" section covers scope, click behavior, and the tmux-caveat deferral, matching proposal.md's wording closely.
- No AC silently reinterpreted — the escalated scope decisions (fleet row list only, text-entry click deferred, tmux verification deferred) are exactly what's implemented and exactly what's documented as deferred, not silently dropped.
- All `tasks.md` items marked `[x]` match what's actually in the diff (verified 1.1–1.7, 2.1–2.3, 3.1–3.3, 4.1–4.4, 5.1, 6.1 against the code/tests directly; 6.2's "manual" confirmation is reasonably substituted by the automated `uncaughtException` test's exact-once assertion on `MOUSE_REPORT_EXIT`).
- No scope creep: `git diff 3f16c9b..cf10355` (the CON-112 commit isolated from an unrelated, already-present-in-branch CON-84 commit) touches only the files `files-modified.md` lists — `lib/ui/frame.js`, `lib/ui/app-state.js`, `lib/ui/screens/fleet/render.js`, `lib/ui/screens/fleet.js`, `lib/ui/watch.js`, `docs/dashboard.md`, `test/fleet.test.js`, `test/watch.test.js`, `test/scripts/watch-smoke.test.sh`, plus the openspec change dir itself. (Note: `git diff main...HEAD` also shows README.md/lib/cli/* changes — these belong to the prior, already-committed CON-84 commit `3f16c9b` this branch is stacked on, not to the executor's own CON-112 work; confirmed via `git diff 3f16c9b..cf10355 --stat -- README.md lib/cli/` returning empty.)
- No regressions to existing behavior: `renderFleet`'s string-only contract is preserved byte-for-byte (`buildFleetOutput` factored out, `renderFleet` still `-> string`, confirmed by the ~150 existing call sites in fleet.test.js/drilldown.test.js/format-colour.test.js still passing unmodified). Mouse-click interception in `onKey` only triggers on a `parseMouseClick`-matched sequence — no other keypress path is touched.
- No API/schema contracts affected (internal TUI only, no external interface).
- Planning artifacts (proposal/design/tasks/spec deltas) accurately reflect the final implementation — cross-checked in detail; no drift found.

### Phase 2: Code Review — PASS
Issues: none.

Ran the canonical gate myself, fresh, in `WORKTREE_PATH` (`CLEAN_WORKTREE` not set — `SPEED=default` per `workflow-state.md`):
```
npm test
```
Result: `# tests 1758`, `# pass 1758`, `# fail 0`, exit code 0. All CON-112-specific tests (18 in `test/fleet.test.js`/`test/watch.test.js`) pass, including the `uncaughtException`-simulation test and the click-dispatch integration tests via `withWatchHarness`.

Checklist:
- **Canonical code-quality compliance**: no project-wide standard configured beyond the test gate itself; no [mechanical] rule violations found.
- **DRY**: `buildFleetOutput` is the single shared computation behind both `renderFleet` (string) and `renderFleetRowMap` (row map) — explicitly designed and implemented to prevent the two ever drifting apart (`lib/ui/screens/fleet/render.js:25-40` comment, `mergeRenderOpts` shared by `render`/`renderRowMap`). No duplicated layout math.
- **Readable**: named constants (`MOUSE_REPORT_ENTER/EXIT`, `MOUSE_CLICK_RE`), no magic values — the `rowOffset = 2 + bannerLines` arithmetic in `watch.js` is commented with the exact reasoning tying it to the template literal it mirrors.
- **Modular**: `parseMouseClick` is a pure function next to `splitKeys`; row-map computation lives entirely inside the fleet screen's own render module (never a fleet-wide hit-test layer), exactly matching design.md's stated non-goal.
- **Type safety**: N/A (untyped JS codebase, consistent with existing conventions).
- **Security**: mouse input is regex-matched against a strict anchored pattern (`^\x1b\[<0;(\d+);(\d+)M$`) before use; row lookup uses `Object.prototype.hasOwnProperty.call` (not a bare `in`/truthy check) to avoid prototype-chain surprises. No injection surface (no user string reaches a shell/eval boundary).
- **Error handling**: the new `uncaughtException` handler is the standout addition here — restores full terminal state exactly once (re-entrancy-guarded by the shared `quitting` flag) and re-surfaces the error via `console.error` + `process.exit(1)` rather than swallowing it, closing a documented pre-existing gap as a side effect of correctly satisfying the ticket's own crash AC (per design.md Decision 5's own reasoning, which the evaluator agrees is in-scope, not incidental scope creep).
- **Tests meaningful**: new tests exercise real regression surfaces — row-map/rendered-text drift (comparing map entries against the actual rendered line's ticket string), scrolled-window correctness, grid-mode/QUEUED exclusion, click-to-select end-to-end via the real stdin handler, click-outside-row no-op, non-fleet-mode no-op, and the uncaught-exception handler's exact-once restore + listener-count parity across repeated `watch()` calls (directly protecting against the `MaxListenersExceededWarning` hazard design.md flags).
- **No dead code**: no leftover TODO/FIXME; `click.col` is computed but intentionally unused this pass (row-only hit-testing, matching the narrow scope) — not dead code, just an unused-but-documented field of the parser's return shape.
- **No over-engineering**: no generic hit-test registry was built (explicitly rejected in design.md and correctly not implemented) — the scope stayed exactly as narrow as decided.
- **Behavior-preserving where expected**: the `renderFleet(runs, opts) -> string` contract is unchanged for all existing callers; `render(state, opts)` unchanged. No drive-by behavior changes detected in the diff.

### Phase 3: UI Review — N/A
No UI review configured for this project per the evaluator's instructions; dev-server steps skipped.

### Overall: PASS

### Non-blocking Suggestions
- `parseMouseClick`'s returned `col` field is currently unused by any caller (`watch.js` only reads `click.row`). This is fine for the current narrow scope, but if a future ticket extends hit-testing to columns (e.g. per-cell affordances within a row), it's worth a quick sanity check at that time that `col` was captured correctly (SGR `Cx` = column) rather than assuming it from this pass alone.
