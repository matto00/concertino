## Why

`.concertino/runs/<TICKET>/events.jsonl` logs are deliberately kept in the main
checkout after `cleanup.sh --phase4` removes a worktree, so a run's history
survives the moment it succeeds. Nothing ever removes them afterward, so the
directory grows without bound for the life of the project. Worse, `lib/ui/store.js`'s
`readAll` re-reads and re-`JSON.parse`s every log in full on every dashboard
poll (once per second), so the read cost scales with total project history
rather than with the number of currently-active runs — ten runs' worth of
history is a lot of synchronous parsing on the main thread, every second,
forever.

## What Changes

- Add a configurable retention policy under `dashboard.retentionDays`
  (default: 30) documented in `docs/dashboard.md` and the config schema.
- Add a `prune` operation (`lib/ui/retention.js`) that removes a run's log
  directory once it is both terminal (has emitted a `run.end` event) and
  older than the retention window. A run that has not emitted `run.end` is
  always treated as still active and is never pruned, regardless of age —
  pruning is conservative by construction, not merely by tuning the cutoff.
- Expose pruning as `concertino prune [--dry-run]`, and also run it once,
  best-effort, at `concertino watch` startup — the natural boundary where a
  human is already about to look at the fleet. Pruning never runs on the
  per-second poll path.
- Change `lib/ui/store.js`'s `readAll` to read incrementally from a
  per-ticket cached byte offset instead of re-reading and re-parsing the
  whole file every call — the logs are append-only, so this is both simpler
  and strictly better than caching whole parses. `lib/ui/watch.js` holds one
  cache instance for the process lifetime and passes it to every poll's
  `readAll` call.

## Capabilities

### New Capabilities
- `event-log-retention`: configurable retention policy for
  `.concertino/runs/<TICKET>/events.jsonl`, a prune operation that never
  removes an active run's log, and incremental (offset-cached) reads in
  `lib/ui/store.js#readAll` so the dashboard's per-second poll cost no longer
  scales with total project history.

### Modified Capabilities
(none — `dashboard-render-loop` and `evidence-telemetry` govern rendering
and evidence refs respectively, neither of which this change touches; the
read-path change to `store.js#readAll` is an internal performance change
with no observable behavior difference to those specs' requirements.)

## Impact

- `lib/ui/store.js`: `readAll` becomes cache-aware (new optional cache
  parameter); `readEvents` is unchanged and remains the uncached full-read
  primitive used by callers (including pruning) that need a guaranteed full
  parse.
- `lib/ui/watch.js`: owns one long-lived `store` cache instance across polls,
  and runs a best-effort prune pass once at startup.
- `lib/ui/retention.js` (new): `prune(root, opts)` and its eligibility
  predicate.
- `bin/concertino`: new `prune` subcommand.
- `config/concertino.schema.json`, `docs/dashboard.md`: document
  `dashboard.retentionDays`.
- Tests: `test/retention.test.js` (new), `test/store.test.js` (incremental
  read coverage).
