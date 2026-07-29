## 1. Implementation

- [x] 1.1 In `lib/ui/watch.js`, add a pure, exported helper:
      `function idleMsFromActivity(activity, now) { return activity != null ? Math.max(0, now - activity * 1000) : 0; }`
      (mirrors the existing `buildFrame`/`attachAndRestore` "exported
      purely for tests" pattern already used in this file).
- [x] 1.2 Add `idleMsFromActivity` to the `module.exports` block at the
      bottom of `lib/ui/watch.js`, alongside `buildFrame`,
      `attachAndRestore`, and the alt-screen constants.
- [x] 1.3 Rewrite `sampleWindows()` so each alive window's `idleMs` comes
      from `idleMsFromActivity(w.activity, now)`, recomputed every poll —
      not only on first sight.
- [x] 1.4 Remove the `idle` Map (`ticket -> { hash, since }`) and its
      declaration.
- [x] 1.5 Remove the `hash()` helper function.
- [x] 1.6 Remove the per-window `session.capture(w.ticket)` call inside
      `sampleWindows()`.
- [x] 1.7 Remove `IDLE_SAMPLE_MS`, `lastSample`, and the `takeSample` gate
      now that nothing in the module reads them.
- [x] 1.8 Re-read `sampleWindows()` end to end to confirm its return shape
      (`{ ticket, alive, idleMs }`) is unchanged and no other function in
      `lib/ui/watch.js` references the removed `idle` Map, `hash()`, or
      `lastSample`.

## 2. Tests

- [x] 2.1 In `test/watch.test.js`, import `idleMsFromActivity` alongside
      the existing `buildFrame`/`attachAndRestore` imports, and add a test
      asserting it reflects a later `activity` value immediately (e.g.
      `idleMsFromActivity(t0, t0*1000 + 5000)` vs. a later `activity`
      closer to `now` yielding a smaller result) — demonstrating idle time
      is derived from `activity` on every call, not only the first.
- [x] 2.2 Add a test demonstrating the acceptance-criteria scenario
      structurally: because `idleMsFromActivity` takes no pane-content
      argument at all, an `activity` timestamp that has advanced yields a
      low `idleMs` regardless of what the pane displayed — assert this
      directly (call it with an advancing `activity` and a fixed `now`,
      confirming the result tracks `activity`, never content, since
      content isn't and can't be an input).
- [x] 2.3 Add a test that idle time survives a restart: call
      `idleMsFromActivity(oldActivity, now)` as if this were the very
      first call of a fresh process (no prior state exists to seed from)
      and assert it returns the full `now - oldActivity*1000` elapsed
      time, not `0`.
- [x] 2.4 Add a test for the `activity == null` fallback (`idleMs` is `0`,
      matching the old seed path's behavior when tmux has no activity
      timestamp yet).
- [x] 2.5 Run the full test suite and confirm no test still depends on the
      removed hash/`idle` Map/`capture-pane`-in-poll-loop behavior.

## 3. Verification

- [x] 3.1 Run the project's lint/typecheck (if configured) against
      `lib/ui/watch.js`. (No lint/typecheck is configured for this repo
      beyond `npm test`; ran the full suite instead — see verification
      results in the executor report.)
- [x] 3.2 Grep the file for `IDLE_SAMPLE_MS`, `lastSample`, `idle.get`,
      `idle.set`, and `hash(` to confirm none remain.
