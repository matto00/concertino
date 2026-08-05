## Context

The fleet view derives every run from two sources folded together by `lib/ui/reducer.js#reduce(eventsByTicket, windows, now)`: `.concertino/runs/<TICKET>/events.jsonl` (via `store.listTickets`/`store.readAll`) and a live `tmux list-windows` snapshot (`sampleWindows`, `lib/ui/watch.js`). Reading `reduce()` directly (not just its tests) shows it already has a window-merge fallback — a live tmux window with no matching event log still produces a run, rendered with `status: 'running'` and `telemetry: 'none'` (`test/reducer.test.js` — "a window with no event log at all still produces a run") — and a dead window with no `run.end` renders `status: 'failed'`, never silently dropped. Reap (`lib/ui/reap.js`) and retention (`lib/ui/retention.js`) both already key exclusively off `run.endStatus`/a `run.end` event's presence, which a pre-`run.start` run never has, so it is already never reaped or pruned by either mechanism.

That means the literal framing in the ticket — "the fleet showed nothing at all" — does not reproduce against this code path for a window whose name matches its ticket, once the dashboard is polling. Two things are still true and still worth fixing, independent of whatever combination of timing/observation produced the original report:

1. The row that *is* shown today is genuinely ambiguous: `telemetry: 'none'` renders as the bare string "no telemetry" everywhere (fleet row, drill-down header, drill-down pipeline), identically whether the ticket was launched ten seconds ago and is still booting, or has been sitting mid-workflow for an hour with its telemetry pipeline broken. There is no elapsed-time signal at all for the pre-`run.start` case (`elapsedMs` is null until `startedAt` is set), so a freshly-launched ticket's row shows a bare "—" where a duration would help most.
2. Everything the dashboard currently knows about a spawn — the ticket, the fact that a window now exists — lives only in tmux, sampled fresh every poll. Writing it into the run's own event log the moment it happens removes the dependency on that poll ever correctly correlating a window back to its ticket, and gives the run a durable, timestamped fact ("spawned at T") independent of tmux state at all, which is a strictly stronger guarantee than "the fallback merge happens to work this poll."

This design closes both: it makes the spawn itself a recorded, timestamped event, and it makes the rendering distinguish "just launched, this is expected" from "no telemetry, something may be wrong," and "died before it even got going" from "died mid-workflow."

## Goals / Non-Goals

**Goals:**
- A ticket launched from the dashboard has a `.concertino/runs/<TICKET>/events.jsonl` the instant its tmux window is created, not the instant `setup-worktree.sh` first runs inside it.
- The fleet row and drill-down clearly read "starting…" (with elapsed time since spawn) for a live, pre-`run.start` window, distinct from both a genuine mid-workflow run and today's ambiguous "no telemetry."
- A window that dies before ever reaching `run.start` reads distinctly ("failed to start") from a window that dies after making some progress ("window exited").
- Formalize, with a test, that a `run.spawn`-only run (no `run.end`) is never reaped and never pruned — already true today, but not directly asserted for this specific event kind.

**Non-Goals:**
- No new reap/retention policy for a window that stays alive indefinitely without ever progressing past `run.spawn` (e.g. a hung harness). The acceptance criteria require such a window not be reaped *as though terminal* — the existing "no `run.end` ⇒ never reaped" rule already guarantees that regardless of how long it sits there. Adding an idle-timeout specifically for the pre-`run.start` case is a separate, forward-looking feature, not required by this ticket.
- No change to `deriveStatus`'s state machine (`running`/`failed`/`done`/`needs-you`/`unknown`) or to section bucketing (`bucketRuns`/`buildSections`). A starting ticket is still `status: 'running'` in the RUNNING section; a died-before-start ticket is still `status: 'failed'` in the FAILED section. Only the label text within those existing rows changes.
- No re-implementation of `reduce()`'s existing window-merge fallback — it is correct as written and stays as the safety net for the (now much narrower) case where, for whatever reason, a `run.spawn` write did not happen.

## Decisions

**Decision 1 — where `run.spawn` is written: inside `session.js#spawn()`, gated on an optional `root` constructor argument.**

`lib/ui/launcher.js`'s own header comment states it is the one seam "every spawn site in the dashboard — the queue tick, force-start, the `n` prompt, draft-then-launch and restart" — routes through, but it delegates straight to `prompt.js#submitTicket()`, which is deliberately kept a pure function of its four arguments (ticket, launchCommand, session, env — see its own header comment, "keeps it a pure function of its existing arguments"). `submitTicket()` in turn calls `session.spawn(ticket, cmd, env)`. `session.spawn()` is therefore the one place every real call path already converges, with no exceptions among the callers found in the codebase.

`session.js` currently does zero filesystem I/O beyond invoking `tmux`; `createSession(name)` takes no root. `watch.js` constructs the one process-wide session instance already inside a scope that has `root` (`const root = opts.root`, `lib/ui/watch.js`), a few lines before `createSession(cfg.tmuxSession || 'concertino')` is called. So: change the constructor to `createSession(name, root)`, and have `spawn()` write the event only when `root` was supplied.

This keeps `prompt.js#submitTicket()` exactly as pure as its own comment says it is designed to be, requires touching exactly one production call site (`watch.js`'s single `createSession(...)` call), and is fully backward compatible: every existing test constructs `createSession(name)` with one argument (`test/session.test.js`, `test/reap.test.js`), so none of them start writing events — this feature is additive-only until `root` is actually threaded through.

Alternative rejected: writing the event one layer up, in `prompt.js` or `launcher.js`. Both would need `root` added to a signature whose own documentation states it is deliberately minimal/pure, for no correctness benefit — `session.spawn()` already sees every one of those calls.

**Decision 2 — hand-rolled JSON-line append, not a shell-out to `emit-event.sh`.**

`scripts/concertino/emit-event.sh` is designed for the agent-side procedure scripts and roles (it resolves ROOT relative to its own script location, with a worktree-vs-main-checkout distinction that does not apply here — the dashboard process already knows exactly which main checkout it is running against). Shelling out to it via `execFileSync` from Node would add a synchronous child-process spawn to the dashboard's own UI-responsiveness path on every single ticket launch, for a one-line file append. Instead, `session.js` builds the identical wire shape by hand:

```
{"t":<ms epoch>,"kind":"run.spawn","project":"<basename(root)>","ticket":"<ticket>","role":"dashboard"}
```

— matching `emit-event.sh`'s own `build_line()` shape (`t`, `kind`, `project`, `ticket`, `role`, plus any extra fields) field-for-field, so `store.readEvents`/`readIncremental` and `reducer.js#applyEvent` parse it exactly as they would a script-emitted line; nothing downstream needs to know which process wrote it. `role: 'dashboard'` (rather than `emit-event.sh`'s own default of `'script'`) distinguishes this event's origin at a glance in the raw log, for exactly the same reason every other role already labels itself.

Kept deliberately minimal (ticket + timestamp only) — no `harness`/`provider` guess. `run.start` already carries the authoritative, resolved harness/provider once `setup-worktree.sh` runs; duplicating that resolution logic into a second, earlier, potentially-stale write is unnecessary risk for a field this proposal doesn't need. Write is wrapped in try/catch and never throws — a lost `run.spawn` event must never block or fail a real launch, the same "telemetry must never fail a delivery run" contract `emit-event.sh` itself upholds structurally (`mkdir -p ... || exit 0`, `write_line ... || true`).

**Decision 3 — `run.spawn` is not added to `TIER2_KINDS`/`TIER3_KINDS`; `run.telemetry`'s meaning is unchanged.**

`run.telemetry` today answers "how rich is the phase/gate reporting" (`'none'` / `'partial'` via `TIER2_KINDS` = `run.start`, `gate.result` / `'full'` via `TIER3_KINDS` = `phase.enter` etc.). `run.spawn` carries no phase/gate information — it is a bookkeeping fact about the window's existence, emitted before the workflow has done anything. Classifying it as tier-2 would flip `telemetry` to `'partial'` the instant a window is created, which would misleadingly suggest a just-launched ticket already has some workflow substance. `run.spawn` therefore gets its own `applyEvent` case that sets a new field (`spawnedAt`) and nothing else; `deriveTelemetry()` is untouched.

**Decision 4 — a new `spawnedAt`/derived `startingMs` field pair, kept separate from `startedAt`/`elapsedMs`.**

`applyEvent`'s new `run.spawn` case sets `run.spawnedAt = ev.t` (first-write-wins is not needed — there is at most one `run.spawn` per run, written once by `session.spawn()`). `reduce()` derives `run.startingMs` the same way it already derives `run.elapsedMs`, but keyed off `spawnedAt` and only while `startedAt` is still null:

```js
run.startingMs = (run.spawnedAt != null && run.startedAt == null)
  ? (run.endedAt != null ? run.endedAt : now) - run.spawnedAt
  : null;
```

Kept as its own field rather than folding into `elapsedMs` because `elapsedMs` is compared elsewhere (`rows.js`) against `avgDoneMs`, an average computed from genuine workflow durations (`run.start` → `run.end`). Conflating pre-bootstrap wall-clock time (however long `npm ci`/model loading takes) into that average would make a slow *bootstrap* look like a slow *workflow*. The two fields never overlap in meaning: once `run.start` arrives, `startingMs` reverts to `null` and `elapsedMs` takes over, exactly mirroring how `telemetry` itself only ever moves forward (`'none'` → `'partial'` → `'full'`, never back).

**Decision 5 — rendering changes are label-only, at four existing call sites; no new status/section.**

- `rows.js#statusLine()` (RUNNING/NEEDS-YOU 2-line row): when `run.telemetry === 'none'`, show `'starting ' + f.dur(run.startingMs)` if `run.spawnedAt != null && run.window && run.window.alive`, else fall back to today's `'no telemetry'` — and skip the (already-null, already-meaningless) trailing duration segment in that case, rather than appending a redundant "—".
- `rows.js#renderFinishedRow()` (FAILED/DONE 1-line row): when `run.status === 'failed' && run.endedAt == null && !run.endStatus`, show `'failed to start'` if `run.telemetry === 'none'`, else keep today's `'window exited'`.
- `drilldown.js#elapsedText()`: same `'failed to start'` vs `'window exited'` split; additionally, `'starting · ' + f.dur(run.startingMs)` when `run.telemetry === 'none' && run.spawnedAt != null` (ahead of the existing `started HH:MM` branch, which still applies once `run.start` lands).
- `drilldown.js#headerLines()`'s `phaseRight`: `'starting…'` instead of `'no telemetry'` under the same condition.

A run whose `spawnedAt` is `null` — a run predating this feature, or (defense in depth) any path that somehow reaches `session.spawn()` without `root` — renders exactly as it does today; nothing regresses for that case, it simply doesn't gain the new label.

Alternative rejected: a new `status: 'starting'` value with its own section. This would touch `STATUS_ORDER`, `bucketRuns`, `buildSections`'s section list and `sectionHeight()`'s per-section line-budget math, and every test keyed off the current status/section enumeration — a much larger blast radius for a distinction a label conveys just as legibly within the existing RUNNING/FAILED buckets, and one that degrades safely (see above) rather than needing every consumer of `status` updated in lockstep.

**Decision 6 — reap/retention: no code change, add a regression test.**

`reap.js#selectReapable`'s very first check (`if (run.endStatus == null || !run.window) return false;`) and `retention.js#isEligible`'s `hasRunEnd` both already exclude any run without a `run.end` event — a `run.spawn`-only run has neither `endStatus` nor `run.end`, so it is already, structurally, never reaped and never pruned. No change needed. Add one test to `test/reap.test.js` (or `test/reducer.test.js`, wherever `selectReapable` is exercised most directly) constructing a run with only a `run.spawn` event and asserting `selectReapable` returns `false` regardless of window liveness — turning an implication of the general "no `run.end`" rule into an explicit, named assertion for this specific new event kind, since the acceptance criteria call it out directly and a rule with no dedicated test for a new case is one refactor away from silently breaking.

## Risks / Trade-offs

- [Risk] A caller somewhere constructs its own `session`-shaped object (a test double) that doesn't accept/ignore a second constructor argument or an event-writing side effect. → Mitigation: the write only happens when `root` is explicitly passed; every real production call site is `watch.js`'s single `createSession(...)`, updated here; every test double in the existing suite already calls `createSession(name)` with one argument and needs no change.
- [Risk] The in-process JSON-line writer's format silently drifts from `emit-event.sh`'s over time (e.g. if `emit-event.sh`'s wire shape changes later and this second implementation isn't updated in lockstep). → Mitigation: kept intentionally tiny (one line, five fixed fields, no escaping edge cases beyond `JSON.stringify` on plain strings/numbers) and covered by a test asserting `reducer.js` parses the dashboard-written line identically to a script-written one.
- [Risk] This proposal narrows, but does not fully explain, the original CON-75/CON-59 observation (a window that should have been correlated by `reduce()`'s existing fallback apparently wasn't). → Mitigation: `run.spawn` is a synchronous, in-process write at the exact moment the window is created — it does not depend on any subsequent poll correctly sampling and correlating tmux state, so it closes the gap unconditionally regardless of whatever timing/observation produced the original report, without requiring that root cause to be fully diagnosed first.
