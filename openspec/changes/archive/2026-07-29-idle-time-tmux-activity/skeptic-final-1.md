## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Diff scope**: `git diff main...HEAD --stat` — only `lib/ui/watch.js` (+83/-49ish) and
  `test/watch.test.js` (+52) changed in `lib/`/`test/`, plus openspec planning artifacts.
  No scope creep.

- **AC1 ("idle from activity on every poll, not only first")**: `lib/ui/watch.js:311-323`
  — `sampleWindows()` now calls `idleMsFromActivity(w.activity, now)` unconditionally for
  every alive window, on every poll. No seed-once/first-sight branch remains (confirmed by
  reading the full diff hunk, not just the evaluator's line citation).

- **AC2 (hash/idle Map/per-window capture removed)**: read the full diff — `hash()`, the
  `idle` Map (`ticket -> {hash, since}`), `IDLE_SAMPLE_MS`, `lastSample`, `takeSample`, and
  the per-window `session.capture(w.ticket)` call inside `sampleWindows()` are all deleted.
  Independently re-ran the grep: `grep -n "IDLE_SAMPLE_MS\|lastSample\|idle\.get\|idle\.set\|hash(\|takeSample" lib/ui/watch.js`
  returns nothing. `session.capture()` itself is untouched (still used in
  `test/session.test.js`); repo-wide grep for `.capture(` shows no other production call
  site was touched.

- **AC3 (survives restart)**: `idleMsFromActivity` is a pure function of `(activity, now)`
  with no closure state — `activity` comes from `session.listWindows()` parsing tmux's own
  `#{window_activity}` (`lib/ui/session.js:63-85`), which is tmux-server state, not
  dashboard-process state. A restart is definitionally "call this function fresh" and gets
  the same answer. `test/watch.test.js`'s restart test exercises this directly.

- **AC4 (identical redraw must not read as idle) — independently re-verified with real
  tmux, not just trusted from design.md**: ran two live tmux sessions myself (tmux 3.6a):
  1. A session whose pane prints byte-identical content (`printf '\033[H spinner-frame-static '`)
     every second: `#{window_activity}` advanced from `1785310565` to `1785310568` over
     3s of identical redraws — activity tracks pty writes, not visual diffs, confirming the
     claim underlying this whole change is true (this is the third independent confirmation:
     design round 1, design round 2, and now here).
  2. A genuinely idle session (`sleep 100`, no output): `#{window_activity}` stayed frozen
     (`1785310575` == `1785310575` across 4s). Confirms the contrast case too.
  Code-side, `idleMsFromActivity` structurally cannot be influenced by pane content — it
  takes no content argument — so this AC is both empirically and structurally satisfied.

- **Test suite**: ran `node --test test/watch.test.js` directly — 15/15 pass, including
  all 4 new `idleMsFromActivity` tests (advancing activity shrinks idleMs on the same call;
  content can't be an input; restart returns full elapsed time; `null`/`undefined` activity
  falls back to `0`). Ran full `npm test` independently — exit code 0, all suites pass; spot
  checked the "fail"/"FAIL" grep hits in the log and confirmed they are all substrings of
  passing test names (e.g. "FAIL printed to stderr"), not actual failures.

- **Downstream consumers unaffected**: `sampleWindows()`'s return shape
  (`{ ticket, alive, idleMs }`) is unchanged; `lib/ui/reducer.js:194` and
  `lib/ui/screens/fleet.js:62-63` (the only two production readers of `idleMs`) consume it
  identically to before. `IDLE_FLOOR_MS` in `fleet.js` is a distinct, untouched constant —
  confirmed it isn't accidentally coupled to the removed `IDLE_SAMPLE_MS`.

- **No leftover state/edge-case regressions**: old code's first-seed path used
  `Math.min(w.activity * 1000, now)` to guard against `activity` rounding to a value
  slightly ahead of `now`; new code's `Math.max(0, now - activity*1000)` clamps the same
  scenario to `0` from the other direction — equivalent user-visible behavior (idle reads
  as `0`), not a regression.

- **Planning artifacts vs. implementation**: proposal.md/design.md/tasks.md/spec.md all
  match the diff with no drift; design already passed two prior cold skeptic gates
  (`skeptic-design-1.md`, `skeptic-design-2.md`, both CONFIRM with only non-blocking notes
  about spec-scenario-count wording, which does not affect the executed code).

- **UI**: N/A — this is a headless poll-loop logic change with no UI surface; no design
  standard is configured for this project. Confirmed no changed file touches rendering
  (`buildFrame`/screens are untouched aside from the unaffected export-list comment).

### Verdict: CONFIRM

### Non-blocking notes
- None beyond what design-gate skeptics already flagged (spec.md's "every scenario"
  overclaim by one; cosmetically minor, doesn't affect delivered code).
