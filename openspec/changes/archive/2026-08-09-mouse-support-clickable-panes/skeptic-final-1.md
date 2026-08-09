## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- Isolated the actual CON-112 diff from the stale-local-`main` noise: local
  `main` is behind `origin/main` (missing CON-84/CON-100, already merged
  upstream but not fetched locally), so `git diff main...HEAD` pulls in
  unrelated CON-84 files. Used `git diff 3f16c9b..cf10355` (`3f16c9b` =
  CON-84, the direct parent of CON-112's own commit `cf10355`) to isolate
  exactly CON-112's own change: `docs/dashboard.md`, `lib/ui/app-state.js`,
  `lib/ui/frame.js`, `lib/ui/screens/fleet.js`,
  `lib/ui/screens/fleet/render.js`, `lib/ui/watch.js`, `test/fleet.test.js`,
  `test/scripts/watch-smoke.test.sh`, `test/watch.test.js`, plus the
  openspec change dir — matching `files-modified.md` exactly.
- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/fleet-row-mouse-select/spec.md`, `files-modified.md`,
  `evaluation-1.md` as claims, then verified each against the diff directly.
- Read the persisted design-gate history
  (`.concertino/runs/CON-112/evidence/.../skeptic-design-1.md` +
  `events.jsonl`): two REFUTE rounds at the design gate, both centered on
  the same finding — design.md originally *asserted* a pre-existing
  `uncaughtException` restore site that did not exist (ground-truth
  contradicted: `grep -rn uncaughtException lib/ bin/` returned nothing).
  The design was revised to add a genuine, new `process.on('uncaughtException', ...)`
  handler (Decision 5) plus an explicit listener-removal requirement, then
  CONFIRMed.
- **Crash-safety handler, verified in the actual code, not just claimed:**
  `lib/ui/watch.js:975-984` defines `onUncaughtException` (re-entrancy
  guarded by a `quitting` flag hoisted to the top of `watch()`, shared with
  `quit()`), which removes itself, clears the poll timer, restores raw mode,
  writes `ALT_SCREEN_EXIT + MOUSE_REPORT_EXIT + CURSOR_SHOW` in one write,
  surfaces the error via `console.error`, and calls `process.exit(1)` —
  matching Decision 5 exactly (full terminal restore, not mouse-mode alone;
  error re-surfaced, not swallowed). Registered once via
  `process.on('uncaughtException', onUncaughtException)` right after the
  startup `MOUSE_REPORT_ENTER` write.
- **Listener cleanup, verified in the actual code:** `quit()` (line ~1004)
  calls `process.removeListener('uncaughtException', onUncaughtException)`
  under the same `quitting` guard, before any other teardown. Ran
  `node --test test/watch.test.js test/fleet.test.js` myself (386 tests, 0
  fail) and separately grepped stderr for `MaxListenersExceededWarning` —
  the only warning present is for the pre-existing, deliberately-untouched
  `resize` listener (11 accumulated across the suite's ~62 sequential
  `watch()` calls), never for `uncaughtException` — corroborating that the
  new handler's cleanup actually works and matches the design's own claim
  that this is the discriminator between the two (resize: accepted leak;
  uncaughtException: must not leak).
- Read the dedicated crash-path test
  (`test/watch.test.js`, "an uncaught exception restores the FULL terminal
  state ... exactly once ... a second exception cannot double-write"): it
  captures the real registered handler off `process.listeners('uncaughtException')`,
  invokes it directly (not via `process.emit`, correctly avoiding
  `node:test`'s own global handler), and asserts: exit code 1, error text
  surfaced, `ALT_SCREEN_EXIT`/`MOUSE_REPORT_EXIT` each written exactly once,
  `CURSOR_SHOW` present, listener count back to baseline, and a second call
  to the same handler is a total no-op (no further writes) — this is a
  regression test that would actually catch a broken re-entrancy guard or a
  missing restore field, not a test that merely exercises the path without
  asserting on it.
- Ran the full project test suite fresh myself:
  `node --test` → `# tests 1758`, `# pass 1758`, `# fail 0` (matches
  evaluator's claimed count independently, not trusted from the report).
- **Scope narrowness verified in the diff, not just the docs:**
  `lib/ui/controllers/fleet.js`, `lib/ui/screens/fleet/grid.js`, and
  `lib/ui/screens/fleet/rows.js` are all completely untouched by this commit
  (confirmed via `git diff 3f16c9b..cf10355 -- <those files>` returning
  empty) — the click resolves entirely through the pre-existing `jump`
  action (CON-39) with zero new action type or controller code, exactly as
  design.md Decision 4 requires ("never a second, parallel action path").
  No text-entry file touched. No tmux-specific code added — `docs/dashboard.md`
  explicitly documents the tmux-compatibility deferral as unverified rather
  than silently assuming it works. Grid mode contributes an empty row map
  (`renderFleet(runs,{cols:130,...})` in `test/fleet.test.js` confirms this
  really is the grid-mode path via `/METRICS/` before asserting the empty
  map) — matching the Non-Goals list.
- **Row-index-map math, spot-checked against `layout.box()`:** confirmed
  `box()`'s first returned line really is the top border
  (`lib/ui/layout.js:88-94`), matching `render.js`'s `boxStart + 1 + ci`
  offset comment (the exact post-box coordinate correction design.md's
  implementation note called out as a hazard). The click-to-select
  end-to-end test drives this through the real diff-writer output
  (`screenOf(written)`) rather than re-deriving the arithmetic by hand,
  which is a stronger check than a unit-level offset assertion would be.
- Traced all three ticket ACs to real code:
  1. "clicking to select/focus ... same action handlers" —
     `lib/ui/watch.js` `onKey`'s mouse-click branch dispatches
     `{ type: 'jump', index }` through the same `applyAction` path digit-jump
     uses; `controllers/fleet.js`'s `case 'jump'` is unmodified.
  2. "no leaked terminal mouse-reporting state after `q` or a crash" — both
     paths verified above with passing, meaningful regression tests.
  3. "Documented in `docs/dashboard.md`" — new "Mouse support (fleet run
     rows only)" section covers scope, click behavior, and the tmux caveat.
- No API/schema/contract surface affected (internal TUI only).

### Verdict: CONFIRM

### Non-blocking notes

- `parseMouseClick`'s `col` field is parsed but currently unused by any
  caller (row-only hit-testing, matching this pass's scope) — already
  flagged by the evaluator; agreed this is fine as-is, just worth a sanity
  check on `col` capture correctness whenever a future pass adds column-level
  hit-testing.
- The local `main` branch ref in this environment is stale relative to
  `origin/main` (missing already-merged CON-84/CON-100) — not a CON-112
  defect, but worth a `git fetch`/reconciliation before this branch's own
  PR/merge step so the diff a reviewer sees there isn't similarly polluted
  with unrelated already-merged commits.
