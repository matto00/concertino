## Context

`core/scripts/cleanup.sh`'s `other_runs_live()` (rendered into every consuming project as
`scripts/concertino/cleanup.sh`) is the guard that decides whether Phase-4's automatic
`concertino sync` re-render is safe to run — skip it if another run might still be mutating
the tree. Today it is purely presence-based: `run.start` with no `run.end` = live, forever.
Observed in this repo's own operating history (helio's HEL-395, HEL-560) this produces a
permanent false positive whenever an orchestrator's final turn ends on an unresolved Phase-4
escalation and the run is never resumed to completion.

**Correction from design-gate round 1:** a retention/pruning process for `.concertino/runs/*`
*does* exist (`lib/ui/retention.js`, exposed as `concertino prune` via `lib/cli/prune.js`,
auto-invoked at dashboard startup — `lib/ui/watch.js:218`). The earlier draft of this document
wrongly claimed no such process existed (the grep that produced that claim was scoped only to
`core/`/`scripts/`, where retention never lived). The practical conclusion is unchanged — nothing
ages a stuck marker like HEL-560 out today — but the reason is different and load-bearing:
`retention.isEligible()` requires `hasRunEnd()` to be true before a run directory is eligible for
pruning at all; absent `run.end`, retention deliberately never touches it, regardless of age. So a
run stuck on an unresolved Phase-4 escalation is exactly the case retention was designed to leave
alone (it can't safely know the run is really over), which is precisely why `other_runs_live()`
needs its own, independent staleness signal rather than being able to rely on retention ever
clearing the marker. Separately: the in-code comment at `core/scripts/cleanup.sh:413-420`
currently claims a stuck run "stays 'live' by this test until its run dir is pruned (`lib/ui/
retention.js` prunes exactly those, by mtime)" — this is the exact inversion of the real behavior
and must be corrected (not copied forward) when that block is edited for this change.

## Goals / Non-Goals

**Goals:**
- Bound the false-positive window so a stuck run marker stops blocking `concertino sync` after
  a reasonable, generous amount of time.
- Never introduce a false negative: a genuinely still-running concurrent run must still be
  detected as live.
- Land the fix in `core/scripts/cleanup.sh` so `concertino sync` propagates it to every
  consuming project (CON-133/CON-140/CON-138 precedent).

**Non-Goals:**
- Building a `.concertino/runs/*` retention/pruning process. The ticket calls this out as
  "worth confirming... doesn't appear to run anywhere," but pruning old run directories is a
  separate, larger concern (forensic-history retention policy) than bounding one function's
  liveness check. Out of scope here.
- PID-based liveness (rejected — see Decision 2 below).
- Changing what escalation-timeout or any other orchestrator code path writes to `events.jsonl`.
  The suggested-fix list in the ticket offers "write a distinguishable terminal event" as one
  option; this design picks the time-bound option instead (see Decision 1) because it requires
  no change anywhere in the orchestrator's many exit paths, closing the false-positive window
  for every existing stuck run in every project's history immediately, not just future ones.

## Decisions

### Decision 1: Time-based staleness bound, not a new terminal-event kind

Add a threshold: a run is only "live" if it has `run.start`, no `run.end`, AND its last logged
event's timestamp is within the staleness window. Once the last event is older than the window,
`other_runs_live()` stops counting it, `run.end` or not.

Rejected alternative: teach every place an orchestrator's turn can end early (escalation timeout,
a killed session, a crash) to write a new `run.suspended`/`run.end{status:incomplete}` event.
This only protects *future* runs that go through the updated code path — it does nothing for
runs already stuck today (HEL-560, HEL-395, and any other silently-stuck marker in any consuming
project's `.concertino/runs/`), and there is no way to enumerate and guarantee coverage of every
current and future turn-ending path (this file's own "Harness resume model" section documents at
length how varied and harness-specific those exit paths are). A time bound closes the gap
retroactively and unconditionally, with a single change in one function.

### Decision 2: Time bound, not PID-based liveness

`tui-attached.sh` was suggested as a reusable pattern (PID stored in a lockfile, checked live via
`kill -0`/`process.kill(pid, 0)`). Rejected for this use case:
- `tui-attached.sh` tracks exactly one thing (a singleton dashboard process) via one lockfile.
  A ticket-delivery orchestrator run has no equivalent single PID to record — it may itself be a
  subagent, may resume across multiple separate harness invocations (the "Cycles 2+ — resume"
  pattern this repo's own orchestrator role documents), and its identifying process may not even
  exist on this machine (a fleet/queue runner could dispatch it elsewhere).
- PID liveness is meaningless across a reboot — the ticket calls this out directly as a known
  failure mode, and this repo's own long-running deliveries (CON-138: 1+ hour; HEL-651: multiple
  hours spanning API outages) make an accidental reboot during a real, still-live run entirely
  plausible.
A wall-clock timestamp comparison has neither failure mode: it survives reboots and requires no
new bookkeeping (`events.jsonl`'s timestamps already exist on every event).

### Decision 3: Threshold value and override

Default staleness window: **6 hours**. Chosen to comfortably exceed every observed real delivery
duration in this repo's own history (CON-138 ~1 hour, HEL-651 multiple hours across API outages)
by a wide margin, while still bounding a stuck marker's false-positive window to "same day,"
not "indefinitely." Overridable via `CONCERTINO_LIVE_RUN_STALE_HOURS` (falls back to 6 when unset
or non-numeric), mirroring the existing `CONCERTINO_CLEANUP_SKIP_SYNC` env-gate pattern already in
this same file, for any project that needs a different bound.

### Decision 4: Determine "last event timestamp" the same way the file is already read

`other_runs_live()` already `grep`s `events.jsonl` line by line; reuse that — take the last
line's `"t":<epoch-ms>` field (every event already carries `t` per `emit-event.sh`'s schema) via
a trailing `tail -1` + extraction, no new dependency, no JSON parser required (matching the
existing grep-based, dependency-light style of the rest of this function and file).

### Decision 5: Unparsable or missing last-event timestamp falls back to LIVE

If the last logged line's `t` field cannot be extracted (a torn final line from a concurrent
append — most likely to occur under a genuinely live run, i.e. exactly the dangerous direction to
get wrong — a trailing blank line, or a hand-edited log), `other_runs_live()` SHALL fall back to
today's presence-based verdict: treat the run as LIVE. Extraction SHALL scan backwards from the
end of the file to the last line that parses as a JSON object with a numeric `t` field, rather
than trusting a blind `tail -1`, so one torn trailing line doesn't discard an otherwise-good
timestamp one line above it. Failing closed here (toward LIVE, i.e. toward skipping sync) is the
same conservative bias the rest of this function already has — better to skip one sync
unnecessarily than to rewrite shared artifacts under a run that is, in fact, still live.

## Risks / Trade-offs

- [Risk] A run that is genuinely still live but silent for over 6 hours (e.g. a human took a long
  time to answer a mid-run escalation with no automated event emitted in the interim) would now
  be incorrectly treated as not-live. → Mitigation: every escalation call already documented in
  this repo's orchestrator role emits its own `escalation.raised`/`escalation.timeout`/
  `escalation.answered` event at each state transition — a run genuinely blocked on a human for
  hours still has *an* event within the window (the raise itself, or periodic `--wait-only` polls
  in the bubbled-escalation resolution loop), not silence. A run truly silent for 6+ hours with no
  event at all is indistinguishable from an abandoned one by any signal available in this file,
  and 6 hours already exceeds every observed real delivery by 5-6x.
- [Risk] Clock skew between the machine that wrote an old event and the machine running this
  cleanup check. → Mitigation: not a new risk — the pre-existing presence-based check had no
  time dependency at all, so this is a new failure mode class, but the practical exposure (single
  local machine in every observed real use of this repo) makes it negligible; noted, not solved.
- [Trade-off] A stuck marker now silently stops protecting `concertino sync` after 6 hours even in
  the rare case a run really did survive that long with zero events. This is the accepted
  trade-off explicitly required by the ticket ("do not fix the false positive by introducing a
  false negative" is satisfied for the realistic case; the theoretical zero-event 6-hour-silent
  live run is judged not realistic enough to design around, matching the ticket's own instruction
  to prefer a bounded, not indefinite, false-positive window).

## Migration Plan

Single self-contained change to `core/scripts/cleanup.sh`; propagates to every consuming project's
rendered `scripts/concertino/cleanup.sh` on that project's next `concertino sync`. No data
migration, no schema change, backward compatible (absent env var falls back to the default).

## Open Questions

None outstanding — resolved during design gate if raised.
