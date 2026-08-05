## Why

A tmux window the dashboard itself creates is invisible in the fleet from the moment it is created until the launched agent gets far enough to run `setup-worktree.sh`, which is the only thing that emits `run.start`. That window is everything before the workflow proper begins — model loading, reading the role spec, and any failure to get that far at all — which is exactly the interval where a new harness or a local model is most likely to go wrong. An operator watching the fleet has no way to tell "just launched, still booting" from "the launch never happened," and a window that dies before `run.start` disappears from view entirely rather than surfacing as the failure it is.

## What Changes

- The dashboard writes a minimal `run.spawn` telemetry event, in-process, at the exact moment `session.spawn()` creates a ticket's tmux window — the spawn is a fact the dashboard already owns (it made the `tmux new-window` call), so it records that fact itself rather than waiting for the launched agent to report in later. This makes `.concertino/runs/<TICKET>/events.jsonl` exist from the instant a window exists, independent of how long the harness takes to reach `setup-worktree.sh` or whether it ever does.
- `reducer.js` gains a `run.spawn` case that records when the window was spawned, without changing what `run.telemetry` means — `run.spawn` is bookkeeping, not evidence of phase/gate richness, so a ticket that has only just been launched still correctly reads as having no meaningful telemetry yet.
- The fleet row and the drill-down screen render a distinct, legible label for a live window that has not yet reached `run.start` ("starting…", with elapsed time since spawn) instead of today's ambiguous "no telemetry," and a distinct label for a window that died before ever reaching `run.start` ("failed to start") instead of the generic "window exited" a mid-run crash also shows. No existing status/section machinery changes — a starting ticket still lands in RUNNING, a died-before-start ticket still lands in FAILED; only the text within those rows becomes more specific.
- Reap/retention behavior is unchanged (a run with no `run.end` is already never reaped or pruned, which already covers this new event kind) — this proposal adds a regression test making that guarantee explicit for a `run.spawn`-only run, since the acceptance criteria call it out directly.

## Capabilities

### New Capabilities

- `spawn-visibility`: the `run.spawn` event contract (who emits it, when, and with what fields), the Run-model fields it populates (`spawnedAt`, derived `startingMs`), and the distinct "starting…" / "failed to start" rendering rules for a ticket in the window before `run.start`.

### Modified Capabilities

(none — `window-reaping`'s existing "a run with no `run.end` is never reaped" requirement already covers a `run.spawn`-only run without any wording change; this proposal only adds a test against that existing requirement.)

## Impact

- `lib/ui/session.js` — `createSession(name, root)` gains an optional second constructor argument; `spawn()` writes the `run.spawn` event when `root` was supplied. Omitting `root` (every existing caller in the test suite) is a no-op, unchanged from today.
- `lib/ui/watch.js` — the single `createSession(...)` call site passes `root` through.
- `lib/ui/reducer.js` — new `run.spawn` case in `applyEvent`; new `spawnedAt`/`startingMs` fields on the Run model.
- `lib/ui/screens/fleet/rows.js` — `statusLine()` and `renderFinishedRow()` gain the "starting…" / "failed to start" labels.
- `lib/ui/screens/drilldown.js` — `elapsedText()` and `headerLines()`'s `phaseRight` gain the same distinction.
- Tests: `test/session.test.js`, `test/reducer.test.js`, `test/fleet.test.js`, `test/drilldown.test.js`, `test/reap.test.js` (regression case), `test/retention.test.js` (regression case) if applicable.
