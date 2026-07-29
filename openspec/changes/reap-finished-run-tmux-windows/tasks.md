## 1. Session and store primitives

- [x] 1.1 Add `captureFull(ticket)` to `lib/ui/session.js` (`tmux capture-pane -p -S - -t <target>`, full history), following `capture()`'s existing error-swallowing shape (returns `''` on failure, including an unaddressable ticket).
- [x] 1.2 Add `scrollbackPath(root, ticket)` to `lib/ui/store.js`, alongside `eventsPath`/`answerPath`.

## 2. Reap module

- [x] 2.1 Create `lib/ui/reap.js` with a pure `selectReapable(runs)`: returns the list of tickets where `run.endStatus != null && run.window && run.window.alive === false`.
- [x] 2.2 Add `reapFinished(root, session, runs)` to the same module: for each ticket from `selectReapable`, capture full scrollback via `session.captureFull`, best-effort write it to `store.scrollbackPath(root, ticket)` (create the run dir if needed, swallow write failures), then `session.kill(ticket)`. Capture-then-kill order always holds, even if the capture or write failed. Returns the list of tickets reaped, for tests/telemetry.

## 3. Wire into the poll loop

- [x] 3.1 In `lib/ui/watch.js`'s `draw()`, call `reap.reapFinished(root, session, runs)` once, immediately after `runs = reduce(...)` — same poll cadence as the rest of draw(), not gated behind any config.

## 4. Tests

- [x] 4.1 `test/session.test.js`: add coverage for `captureFull` — full scrollback returned for a live window, `''` for an unknown/unaddressable ticket (mirror the existing `capture()` tests).
- [x] 4.2 `test/reap.test.js`: pure `selectReapable` cases — terminal+dead is selected; terminal+alive is not; dead+no-`run.end` is NOT selected (the ticket's required guarantee) and, run through `reducer.reduce`, still resolves to status `failed`; no window at all is not selected.
- [x] 4.3 `test/reap.test.js`: `reapFinished` against a fake session (spawn tmux fakes, or a minimal object with `captureFull`/`kill`) and a real tmp `.concertino/runs/<TICKET>/` dir — asserts scrollback file is written before `kill` is called, and that a `captureFull` throwing/erroring does not prevent `kill` from being called.
- [x] 4.4 `test/reap.test.js` (or a `session.test.js` addition), against a real tmux session (mirroring the `concertino-test-<pid>` pattern): spawn a window running a short-lived command, wait for it to go dead, run `reapFinished` with a run marked terminal, and assert the window is gone from `listWindows()` afterward and the scrollback file exists on disk.
- [x] 4.5 `test/watch.test.js`: confirm `reapFinished` is invoked once per `draw()` call at the correct point (after `reduce`), without requiring a real tmux session — a spy/fake session is sufficient.

## 5. Docs

- [x] 5.1 `docs/dashboard.md`: document the reap behavior (conservative policy, scrollback capture location, the "never reaps without run.end" guarantee) near the existing Retention section, and cross-reference that retention prunes logs while this prunes windows independently.
