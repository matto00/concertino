## 1. Session: write `run.spawn` at spawn time

- [x] 1.1 Change `lib/ui/session.js#createSession(name)` to `createSession(name, root)` (`root` optional/undefined for backward compatibility).
- [x] 1.2 Add a private helper in `session.js` that appends one JSON line to `${root}/.concertino/runs/${ticket}/events.jsonl` matching `emit-event.sh`'s wire shape: `{"t":<ms>,"kind":"run.spawn","project":"<basename(root)>","ticket":"<ticket>","role":"dashboard"}`. `mkdir -p` the run directory first. Wrap the whole thing in try/catch that swallows every error silently — must never throw, must never block the real spawn.
- [x] 1.3 Call that helper from `spawn()`, only when `root` was supplied, at the point the tmux window has just been created (after the `respawn-window` call succeeds, mirroring where `run.start` semantically belongs relative to "the thing actually happened").
- [x] 1.4 Update `lib/ui/watch.js`'s one `createSession(cfg.tmuxSession || 'concertino')` call site to `createSession(cfg.tmuxSession || 'concertino', root)`.

## 2. Reducer: `run.spawn` event + derived fields

- [x] 2.1 Add `spawnedAt: null` to `emptyRun()` in `lib/ui/reducer.js`.
- [x] 2.2 Add a `run.spawn` case to `applyEvent()` that sets `run.spawnedAt = ev.t` and nothing else. Do NOT add `'run.spawn'` to `TIER2_KINDS`/`TIER3_KINDS`.
- [x] 2.3 In `reduce()`, alongside the existing `run.elapsedMs` computation, add `run.startingMs`: `(run.spawnedAt != null && run.startedAt == null) ? (run.endedAt != null ? run.endedAt : now) - run.spawnedAt : null`.

## 3. Fleet row labels

- [x] 3.1 In `lib/ui/screens/fleet/rows.js#statusLine()`: when `run.telemetry === 'none'`, push `'starting ' + f.dur(run.startingMs)` if `run.spawnedAt != null && run.window && run.window.alive`, else push `'no telemetry'` (today's behavior, unchanged for a run with no `spawnedAt`).
- [x] 3.2 In the same function's duration branch (the `else` after the `status === 'failed' && endedAt == null` check): skip pushing the elapsedMs-based duration segment when `run.telemetry === 'none'` (it would otherwise show a meaningless "—" alongside the new "starting Ns" text).
- [x] 3.3 In `statusLine()`'s failed branch: when `run.status === 'failed' && run.endedAt == null && !run.endStatus`, push `'failed to start'` if `run.telemetry === 'none'`, else keep `'window exited'`.
- [x] 3.4 In `renderFinishedRow()`: apply the same `'failed to start'` vs `'window exited'` split for the FAILED/DONE 1-line row.

## 4. Drill-down labels

- [x] 4.1 In `lib/ui/screens/drilldown.js#elapsedText()`: apply the same `'failed to start'` vs `'window exited'` split.
- [x] 4.2 In the same function: add a `'starting · ' + f.dur(run.startingMs)` branch when `run.telemetry === 'none' && run.spawnedAt != null`, ahead of the existing `started HH:MM` fallback.
- [x] 4.3 In `headerLines()`'s `phaseRight`: render `'starting…'` instead of `'no telemetry'` when `run.telemetry === 'none' && run.spawnedAt != null && run.window && run.window.alive`.

## 5. Reap/retention regression tests (no production code change expected)

- [x] 5.1 Add a test (in `test/reap.test.js` or wherever `selectReapable` is exercised) constructing a run with only a `run.spawn` event (no `run.end`) and asserting it is never selected for reaping, for both an alive and a dead window.
- [x] 5.2 Add an equivalent test against `retention.js`'s eligibility check, asserting a spawn-only run's log is never eligible for pruning regardless of file age.

## 6. Tests for the new behavior

- [x] 6.1 `test/session.test.js`: new test(s) using a temp directory as `root`, asserting `session.spawn(ticket, cmd)` writes a `run.spawn` line to `<root>/.concertino/runs/<ticket>/events.jsonl` with the right `ticket`/`kind`/`t` fields; assert a session created without `root` does not write anything (existing tests must keep passing unchanged).
- [x] 6.2 `test/reducer.test.js`: a run whose only event is `run.spawn` has `telemetry: 'none'` and `spawnedAt` set to that event's `t`; `run.startingMs` reflects `now - spawnedAt` while `startedAt` is null, and reverts to `null` once a `run.start` event is also present.
- [x] 6.3 `test/fleet.test.js`: a running, telemetry-`'none'` run with a `spawnedAt` renders "starting" with an elapsed duration, not "no telemetry"; the existing "an uninstrumented run reports no telemetry" test (no `spawnedAt` set) continues to pass unchanged. A dead, telemetry-`'none'`, no-`endStatus` run renders "failed to start"; the existing "window exited" test (non-`'none'` telemetry) continues to pass unchanged.
- [x] 6.4 `test/drilldown.test.js`: equivalent assertions for `elapsedText()` and `headerLines()`'s `phaseRight`; the existing "no telemetry at all" test continues to pass unchanged.

## 7. Verification

- [x] 7.1 Run the full test suite; fix any regressions.
- [x] 7.2 Manually launch a ticket from the dashboard (or a scripted equivalent) and confirm the fleet shows a "starting" row within one poll, before `run.start` has fired.
