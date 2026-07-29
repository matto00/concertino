## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Read all planning artifacts**: `ticket.md`, `proposal.md`, `design.md`,
  `tasks.md`, `specs/fleet-idle-tracking/spec.md` (full text, all present, no
  TODO/TBD placeholders found).

- **Independently reproduced the empirical claim with real tmux** (not the
  proposal's prose). Spun up two fresh detached sessions:
  - `skeptic-test`: `while :; do printf "\033[H\033[2Jspinner: |\n"; sleep 1; done`
    — rewrites byte-identical content every second.
  - `skeptic-control`: `sleep 3600` — genuinely idle, zero output.

  Sampled `#{window_activity}` three times over 8 seconds:
  ```
  t=0s: test=1785309480  control=1785309479
  t=4s: test=1785309491  control=1785309479
  t=8s: test=1785309495  control=1785309479
  ```
  `test`'s activity advances every ~1s in lockstep with its redraw loop;
  `control`'s stays frozen at its initial value for the full 8s. This
  independently confirms the ticket's premise: `window_activity` is a
  pty-write signal, not a visual-diff signal, and does not share the hash's
  failure mode. (tmux 3.6a, `/usr/bin/tmux`.) Sessions killed after the test.

- **Read `lib/ui/watch.js` in full** (pristine main-branch copy, confirmed
  identical in intent to the worktree's unmodified copy per the task
  description). Confirmed the `idle` Map (line 159, `ticket -> {hash, since}`),
  `hash()` (line 28), `IDLE_SAMPLE_MS`/`lastSample` (lines 24, 162), and the
  per-poll `session.capture(w.ticket)` call inside `sampleWindows()` (line
  327) all exist exactly as the proposal/design describe. Grepped the whole
  file for `IDLE_SAMPLE_MS`, `lastSample`, `idle.get`/`idle.set`, `hash(` —
  all references are confined to `sampleWindows()`, confirming nothing else
  in the module depends on them (matches design.md's Non-Goals claim).
  Confirmed `reducer.js:194` and `fleet.js:62-63` only read `idleMs`/`alive`
  off the returned object — the `{ ticket, alive, idleMs }` return shape is
  correctly identified as the only external contract, and it is preserved
  by the plan.

- **Checked `session.capture()` usage across the whole repo**
  (`grep -rn "\.capture(" lib/ bin/ scripts/ test/`): the *only* production
  call site is `watch.js:327`, the one being removed.
  `lib/ui/screens/launchpad.js` and `bin/concertino` only mention the word
  "capture" in comments/prose, not actual calls. `test/session.test.js`
  exercises `session.capture()` directly (unit tests of the method itself,
  independent of the poll loop) — those are unaffected by this change since
  they don't touch `watch.js`.

- **Checked test scaffolding**: `test/watch.test.js` currently only imports
  and tests `buildFrame`, `attachAndRestore`, and the alt-screen constants —
  all deliberately exported "purely for tests" per the file's own trailing
  comment (watch.js:895-899). `sampleWindows()` is a private closure inside
  `watch()`, closed over `session`, `idle`, `lastSample` — it is not
  exported and there is no way to construct a `watch.js`-external `session`
  double and feed it in; `createSession()` is called unconditionally inside
  `watch()` with no injection seam. `test/scripts/watch-smoke.test.sh`
  confirms the only current test strategy for this file's runtime behavior
  is end-to-end (real tmux session, real `node bin/concertino watch`,
  grep the rendered stdout).

### Verdict: REFUTE

### Change Requests

1. **tasks.md 2.1/2.2/2.3 presuppose a testability seam that does not exist
   and is not planned.** The tasks read: "e.g. by advancing a fake `activity`
   value between two `sampleWindows()`/poll calls" — this requires calling
   `sampleWindows()` directly from a test. As verified above,
   `sampleWindows()` is an unexported closure inside `watch()` with no way
   to inject a fake `session`; the only current precedent in this exact file
   (`buildFrame`, `attachAndRestore`) is to export pure/testable pieces
   explicitly for `test/watch.test.js`. Neither `design.md` nor `tasks.md`
   states that `sampleWindows()` (or an equivalent extracted, injectable
   function) will be exported — task 1 never mentions touching the
   `module.exports` block at the bottom of the file. Meanwhile,
   `proposal.md`'s own Impact section asserts "No API surface change" for
   this work. Those two are in tension: as written, tasks 2.1-2.3 cannot be
   executed against the current architecture without adding to the module's
   exports, which the proposal explicitly says isn't happening. This is
   exactly the "task a competent implementer could read two ways" case —
   one implementer exports `sampleWindows` (contradicting proposal.md),
   another quietly downgrades the unit tests to smoke-test-only coverage
   (undercutting the acceptance-criteria-level scenario in
   spec.md's "redraws identical pane content" scenario, which needs
   poll-to-poll `activity` control that a real tmux window can't give
   on-demand within a `node --test` timeframe as easily as a fake `session`
   can).

   **Required revision:** `tasks.md` task 1 must explicitly decide and state
   how `sampleWindows()` (or the `now - activity*1000` computation) becomes
   unit-testable — e.g., "export `sampleWindows` from `watch.js` for tests,
   mirroring `buildFrame`/`attachAndRestore`," or "extract the
   `now`-from-`activity` computation into a small pure helper function and
   export that instead, leaving `sampleWindows` itself private." Whichever
   is chosen, `proposal.md`'s Impact section must be corrected — it
   currently states flatly "No API surface change," which will no longer be
   true.

### Non-blocking notes

- `design.md`/`proposal.md`'s parenthetical "`session.capture()` itself,
  used elsewhere for on-demand pane inspection, is unaffected" overstates
  the current state: a repo-wide grep shows `session.capture()` has
  exactly one production call site today — the one this change removes.
  It isn't wrong that the *method* survives unaffected, but "used
  elsewhere" implies existing call sites that don't exist yet (the design
  doc's own hedge, "e.g. an attach/drill-down screen, if any," is closer to
  the truth). Doesn't change the soundness of removing the one real call
  site, but the executor should not cite "it's used elsewhere" as
  justification if asked to explain the change later — it currently isn't.
