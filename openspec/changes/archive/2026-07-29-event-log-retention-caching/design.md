## Context

`.concertino/runs/<TICKET>/events.jsonl` is append-only for the life of a
run and is intentionally left behind by `cleanup.sh --phase4` (see
`docs/dashboard.md`'s "Where the data lives"). Two independent problems stem
from that: unbounded disk growth, and `lib/ui/store.js#readAll` doing a full
`readFileSync` + line-by-line `JSON.parse` of every ticket's log on every
one-second poll in `lib/ui/watch.js`, regardless of whether that log changed
since the previous poll.

`lib/ui/reducer.js`'s `deriveStatus` already has a notion of a run's status
(`needs-you` / `running` / `failed` / `done` / `unknown`) built from the
combination of the event log and live tmux window state (`window.alive`).
Reusing that machinery for a standalone prune operation would couple pruning
to tmux, which is an unnecessary and fragile dependency for what is meant to
be a blunt, safe, offline-capable operation (it must also work when tmux
isn't running, e.g. a cron-style invocation). Instead, pruning uses a
narrower, purely log-derived signal: whether a `run.end` event has been
written at all.

## Goals / Non-Goals

**Goals:**
- Bound disk usage under `.concertino/runs/` via a configurable, documented
  policy with a sensible default.
- Guarantee an active run's log is never removed, by construction, not by
  tuning a cutoff correctly.
- Make `readAll`'s per-poll cost scale with *changed* bytes, not total
  project history.

**Non-Goals:**
- Does not change what `cleanup.sh --phase4` leaves behind (still leaves the
  log; still emits `run.end`).
- Does not attempt to reclaim logs for runs that die without ever emitting
  `run.end` (crashed mid-flight, killed before Phase 4). Those are kept
  indefinitely under the current design — see Risks below.
- Does not add a background/daemon pruning process. Pruning runs either on
  explicit user invocation or once at dashboard startup; never on the poll
  loop.

## Decisions

### 1. "Active" means "no `run.end` event yet" — not tmux window liveness

A run is eligible for pruning only if its log contains a `run.end` event
(emitted by `cleanup.sh` on success, or `assert-phase.sh`/orchestrator on a
recorded failure) **and** the log file's mtime is older than
`dashboard.retentionDays`. Absent `run.end`, the log is never pruned,
regardless of age.

Alternative considered: reuse `reducer.js#deriveStatus`, which also factors
in tmux window liveness (a dead window with no `run.end` reads as `failed`).
Rejected because:
- It couples a disk-hygiene operation to tmux being installed and the
  session being reachable — `concertino prune` should work standalone.
- `window.alive` is a live, momentary signal; basing a destructive operation
  on "the window happened to be dead when I sampled it" is a race a purely
  log-derived, monotonic signal (`run.end` was written or it wasn't) avoids
  entirely.
- It matches the ticket's explicit ask for "a blunt age cutoff" — the one
  extra condition (terminal-only) is the minimum needed to keep the cutoff
  safe, not an attempt to be clever about liveness.

### 2. Prune the whole run directory, not just `events.jsonl`

Eligible tickets have their entire `.concertino/runs/<TICKET>/` directory
removed (`events.jsonl`, `answer.json` if a stale one exists, anything else
found there) rather than leaving an empty directory. `listTickets` already
treats "directory exists" as "this ticket has a run"; leaving an empty
directory behind would make an already-pruned ticket look like a run with no
events instead of like a run that was never there, which is the wrong signal
for both the dashboard and a human running `ls`.

### 3. `readAll` caches by (ticket → last-read byte offset), not by whole-file hash

Store an in-memory `Map<ticket, { offset, size, mtimeMs, events, malformed }>`
outside of `store.js`, owned by the caller (`watch.js` holds one instance for
the process lifetime; a fresh `Map()` per call is the zero-caching
fallback, which is what every existing caller not yet updated — including
tests calling `store.readAll(root)` with one argument — gets automatically).

On each read:
- `stat` the file. Missing file → evict any cache entry, return empty.
- Size and mtime unchanged since the cached entry → return the *same* cached
  `events` array (no re-parse; verified in tests via reference equality,
  which only holds if no new array was allocated).
- Size grew, mtime moved forward → read only the bytes from the cached
  `offset` to EOF, parse only the newly-complete lines (an unterminated
  trailing partial line — the writer mid-`fwrite` — is left unconsumed; it
  is picked up whole on the next poll once its trailing `\n` lands), and
  append to the cached `events`/`malformed` accumulators.
- Size shrank or the file's mtime moved backward (truncated/rewritten,
  which should not happen to an append-only log but must not corrupt state
  if it does) → discard the cache entry and do a full read from offset 0,
  identical to a cold start.

This is strictly better than hashing the whole file to decide whether to
reparse (the alternative considered): hashing still costs a full read every
poll to compute the hash, defeating the point. Offset-based reads cost
`O(bytes appended since last poll)`, which for an idle run is `O(0)` (a stat
call only).

`readEvents(root, ticket)` (the existing two-argument, uncached, full-read
function) is left as-is: it remains the primitive used wherever a guaranteed
complete, from-scratch parse is wanted (pruning's eligibility check, and any
test that wants ground truth independent of cache state).

### 4. Pruning runs at `concertino watch` startup and via `concertino prune`, never on the poll loop

`watch()` calls `retention.prune(root, config)` once, before entering the
poll loop, wrapped so a pruning failure (permissions, races) is swallowed
and never blocks the dashboard from starting — pruning is hygiene, not a
dashboard dependency. `concertino prune [--dry-run]` exposes the same
operation for cron/manual use and CI hygiene checks. `--dry-run` reports
what would be removed without touching disk, mirroring the existing
`--dry-run` convention used by `sync`/`update`/`diff`.

## Risks / Trade-offs

- **[Risk]** A run that crashes before emitting `run.end` (agent killed,
  machine restarted mid-run) leaves a log that is never pruned under this
  design, however old it gets.
  → **Mitigation**: this is the safe failure mode the ticket asks for
  ("pruning must never remove a log for a run that is still active") — an
  unterminated log is indistinguishable from a genuinely still-running one
  without a liveness signal we've deliberately chosen not to depend on
  (Decision 1). If this proves to matter in practice, a follow-up could add
  a much longer secondary cutoff for unterminated logs; out of scope here.
- **[Risk]** The in-memory read cache means a `watch.js` process that runs
  for a very long time accumulates one cache entry per ticket ever seen,
  including tickets later pruned from disk.
  → **Mitigation**: `readAll` evicts any cache entry whose ticket no longer
  appears in `listTickets(root)` on every call, so a pruned ticket's cache
  entry is dropped on the very next poll, bounding cache size to the current
  on-disk ticket count.
- **[Trade-off]** Pruning at `watch` startup only, not periodically while the
  dashboard is open, means a dashboard left running for weeks won't reclaim
  disk from runs that cross the retention boundary mid-session.
  → Acceptable: `concertino prune` covers that case explicitly, and the
  ticket's own framing ("something the user runs or that runs on a natural
  boundary") does not ask for a background timer.

## Migration Plan

No data migration. `dashboard.retentionDays` is additive-optional in the
config schema (defaults to 30 when absent). No existing on-disk log is
touched until the first `concertino prune` or `concertino watch` invocation
after this change ships, and even then only logs that are both terminal and
past the default 30-day window are removed.
