## Context

`concertino watch` (`lib/ui/watch.js`) polls every second: reads the event
log for every run under `.concertino/runs/<TICKET>/` (`lib/ui/store.js`),
samples tmux window state for the dashboard's session (`lib/ui/session.js`),
folds both into a `Run` model (`lib/ui/reducer.js`), and renders. Nothing in
that loop ever calls `session.kill()` on a finished run's window — windows
only die when the harness process itself exits (`remain-on-exit` keeps the
dead pane around), or when a human explicitly kills/restarts one from the
drilldown screen (`lib/ui/control.js`).

`reducer.js#deriveStatus` derives a run's displayed status in a fixed
priority order:

```js
if (run.endStatus) return run.endStatus === 'delivered' ? 'done' : 'failed';
if (run.window && !run.window.alive) return 'failed';
```

The first line only fires once a `run.end` event has been read from the log.
The second line is what catches a run that died WITHOUT ever emitting one —
a crash, an OOM kill, `kill -9`, a harness that exited before Phase 4 ever
ran. That line has no other source of truth: if the window is gone, so is the
only remaining evidence that the run existed at all.

A closely related mechanism already exists for the log side of this exact
problem: `lib/ui/retention.js` prunes `.concertino/runs/<TICKET>/` directories,
gated on the identical "has this run emitted `run.end`, ever" predicate
(`hasRunEnd`), and documents the same non-negotiable: a run without `run.end`
is never touched, regardless of age. This change is retention's tmux-window
counterpart, not a new kind of judgment call — the safety predicate is proven
prior art, just re-applied to `session.kill()` instead of `fs.rmSync()`.

## Goals / Non-Goals

**Goals:**
- Automatically close a run's tmux window once BOTH the log says the run is
  terminal (`run.end` observed) AND tmux itself says the pane is already
  dead — the conservative policy from the ticket.
- Preserve full scrollback to disk before killing, so the human-facing detail
  a killed window would otherwise discard (final merge instructions, a last
  escalation) survives.
- Never touch a window for a run that has not emitted `run.end` — that
  window is tier-1 telemetry (reducer.js's own description) and destroying it
  turns a `failed` run into a silent `unknown`.
- Never touch `__concertino__` or a `concertino-smoke-*` session's windows.

**Non-Goals:**
- Reaping a run's window while it is still alive, even after `run.end` (the
  "aggressive" policy from the ticket). See Decision 3.
- Any change to `lib/ui/retention.js`'s log-pruning behavior. The two
  mechanisms are deliberately independent — see the ticket's own note that
  "neither should assume the other ran" — and this change does not touch it.
- A config toggle to disable reaping. Not requested by the ticket; adding one
  speculatively would be scope creep with no consumer. If a real need shows
  up later, `dashboard.reap.enabled` (mirroring `dashboard.launchPad.enabled`)
  is the obvious follow-up shape.

## Decisions

### Decision 1: Selection predicate — `run.endStatus != null && run.window && !run.window.alive`

`runs` is already the exact fold `reduce()` produces every poll: `endStatus`
is non-null only once a `run.end` event has been parsed from the log (see
`applyEvent`'s `run.end` case), and `window.alive` is tmux's own
`pane_dead` bit sampled fresh this poll (`session.listWindows()` /
`sampleWindows()`). Both facts the ticket requires are already sitting on the
object the poll loop computes anyway — no new I/O, no duplicated `hasRunEnd`-
style log re-read. `retention.js` re-reads the log directly because it runs
independently of the dashboard's poll loop (also from `concertino prune`,
a separate command); reaping only ever runs inside `watch()`'s own loop, where
`runs` already exists synchronously.

Alternative considered: reuse `retention.hasRunEnd(root, ticket)` directly,
mirroring retention.js's own implementation exactly. Rejected — it would
re-open and re-parse each run's `events.jsonl` on every one-second poll for
every ticket, duplicating work `reduce()` already did moments earlier in the
same tick, for a value already available on the `run` object as `endStatus`.

### Decision 2: Natural idempotency — no reaped-ticket bookkeeping needed

Once a window is killed, `session.listWindows()` no longer reports it, so the
very next poll's `sampleWindows()` returns nothing for that ticket and
`reduce()` leaves `run.window` at its default (`null`, from `emptyRun()`).
The selection predicate (`run.window && !run.window.alive`) is then false by
construction — there is no window object to check. This makes the reap
selection self-terminating for free: no separate "already reaped" set has to
be tracked or persisted across polls or dashboard restarts. The one edge case
— `session.kill()` throwing/no-op'ing on an already-half-dead window — is
already a documented no-op in `session.js` (`kill()` swallows all errors), so
a retry on the next poll is harmless: it re-captures the same scrollback
content (an overwrite, not an append) and re-issues a kill that finds nothing
to kill.

### Decision 3: Conservative-only, not aggressive-with-grace-period

The ticket asks to check where `run.end` actually sits relative to the final
Phase 4 steps before choosing between conservative and aggressive. Tracing
it:

- `core/scripts/cleanup.sh` (the canonical Phase-4 teardown script) emits
  `run.end status=delivered` near its own end — after stopping dev servers,
  removing the worktree, and fast-forwarding local `main` — but that is only
  step 1 of Phase 4 as `core/roles/orchestrator.md` defines it.
- The orchestrator's Phase 4 continues, in the SAME tmux window, AFTER
  `cleanup.sh` returns: it sets the Linear ticket to Done, posts a closing
  comment, and runs a hygiene check (`git worktree list`, `git status
  --short`, stray-file checks) — real work, against real APIs, that can take
  meaningful wall-clock time.

So `run.end` is emitted well before the run's tmux window is actually done
doing useful work — not "genuinely the last thing emitted" the ticket
speculates might be true. Aggressive reaping (killing on `run.end` regardless
of liveness) would risk truncating that tail every single Phase 4, not as a
rare race. A grace period could paper over this, but sizing it correctly
depends on Linear API latency and hygiene-check cost, neither of which this
change has any way to measure or bound safely. Conservative-only is therefore
not a stopgap — it is the correct policy given what Phase 4 actually does
today. If a future change moves `run.end` to genuinely be the last Phase 4
action (or wants the memory reclaimed sooner), aggressive mode is a
self-contained follow-up; nothing here forecloses it.

### Decision 4: Full-history capture via a new `session.captureFull()`, not reusing `capture()`

The ticket specifies `tmux capture-pane -p -S - -t ...` (`-S -`: from the
start of history) for the pre-kill snapshot. The existing `capture()` method
calls `tmux capture-pane -p -t ...` with no `-S`, which only returns the
current visible pane (bounded by terminal rows) — adequate for its one
existing caller (unused in production today; exercised only by
`test/session.test.js`) but not for "preserve everything before it's gone."
Adding a second, explicitly named method keeps `capture()`'s existing
contract (and its tests) untouched and makes the full-history variant
self-documenting at the call site, rather than overloading `capture()` with a
boolean flag whose meaning is invisible from a `session.capture(ticket)` call
site months from now.

### Decision 5: `.concertino/runs/<TICKET>/session-scrollback.txt`, best-effort

Written under the same per-ticket run directory `store.js` already owns
(`events.jsonl`, `answer.json`), so it is discovered, gitignored, and pruned
alongside them — `retention.js#prune` already removes the whole
`.concertino/runs/<TICKET>/` directory, not just `events.jsonl`, so the
scrollback file's lifetime is already bounded by the exact same retention
policy with zero additional code. The ticket notes the capture is bounded in
practice (~47 lines, since Claude Code uses the alternate screen buffer), so
cost is not a concern. The write is wrapped exactly like `retention.prune`'s
own startup call: best-effort, swallowed on failure (permissions, races) —
a scrollback write failing must never block the kill, and a kill failing must
never block the next poll's dashboard render.

On the "confirm it does not widen what is written to disk" note in the
ticket: `.concertino/` is already gitignored in full (`events.jsonl` already
contains ticket titles/descriptions verbatim via `run.start`'s `project`
field and escalation `question`/`context` fields), so a scrollback capture of
the same session's own terminal output is not a new category of sensitive
data reaching disk, just a second file holding overlapping content.

## Risks / Trade-offs

- **[Risk]** A window reaped mid-way through being inspected by a human who
  just detached (`Ctrl-b d`) loses nothing extra beyond what conservative
  reaping already guarantees not to touch — detaching does not kill the
  pane, so `window.alive` is still true and the window is not reaped until
  the process itself actually exits.
- **[Risk]** `captureFull()` failing silently (tmux transiently unavailable)
  means a kill proceeds without a saved scrollback. → Accepted: the ticket's
  own priority order is capture-then-kill, not capture-gates-kill; refusing
  to reap because a courtesy capture failed would re-introduce the visual-
  noise/memory problem this change exists to fix. The kill itself already
  degrades the same way today (`session.kill` swallows all errors).
- **[Trade-off]** Conservative-only does not reclaim the idle-session memory
  the ticket calls out as "worse" than visual noise, for however long Phase 4
  takes to finish after `run.end`. → Accepted per Decision 3; sizing a safe
  aggressive grace period needs data this change has no way to gather, so
  deferring it is more honest than guessing a number.

## Migration Plan

Purely additive: a new module (`lib/ui/reap.js`), two new small methods
(`session.captureFull`, `store.scrollbackPath`), and one new call site in
`watch.js`'s existing poll loop. No schema change, no config change, no
existing behavior altered. Rollback is deleting the new call site (or the
module) — every existing code path is unmodified.

## Open Questions

None outstanding — the one open question the ticket itself posed (conservative
vs. aggressive) is resolved by Decision 3 above with the Phase 4 trace it asked
for.
