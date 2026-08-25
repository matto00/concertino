# CON-121: other_runs_live() false-positives forever when Phase 4 ends on an unresolved escalation timeout

## Description

`scripts/concertino/cleanup.sh`'s `other_runs_live()` gates whether a Phase 4 fast-forward triggers a `concertino sync` re-render of shared root artifacts. It determines "live" purely by checking whether a run's `.concertino/runs/<TICKET>/events.jsonl` has a `"kind":"run.start"` entry with no matching `"kind":"run.end"` — no timestamp check, no PID/process check. The function's own comment already acknowledges this: a run that ends "without ever writing run.end stays 'live' by this test until its run dir is pruned" — a deliberate false-positive-safe tradeoff (skip a re-render rather than risk rewriting shared artifacts under a genuinely-live run).

In practice this fails permanently, not just conservatively: if a run's orchestrator ends its final turn on an `escalation.timeout` during Phase 4 (e.g. waiting on a human approval that never got a follow-up SendMessage before the session moved on) and never gets resumed to actually finish and log `run.end`, that ticket is flagged "still live" by every subsequent Phase 4 cleanup forever — there's no retention/pruning process actually running in this repo, so nothing ever ages it out.

## Observed impact

Found 2026-08-16: HEL-395's run ended its last logged event on `escalation.timeout`, with no `run.end` ever written. Every Phase 4 cleanup since printed `main fast-forwarded — skipping concertino sync: run HEL-395 is still live`. `concertino sync` was silently skipped across an unknown number of ticket deliveries for 3+ days.

Re-confirmed 2026-08-25 against the live helio repo: `HEL-560`'s run (`.concertino/runs/HEL-560/events.jsonl`) has a last event timestamp of 2026-08-12 (13 days stale) and its PR (#320) merged that same day — unambiguously not live — yet `other_runs_live()` still reports it as live and skipped the automatic `concertino sync` during Phase 4 cleanup on multiple helio runs the night of 2026-08-24/25 (HEL-637, HEL-651, and others), and orchestrators surfaced it in reports as "a concurrent run, HEL-560, is still live" — a false claim reaching a human.

## Suggested fix (from ticket; design decisions are the executor/orchestrator's to make, per design gate)

* Have the escalation-timeout path (or whatever ends an orchestrator's turn without completing Phase 4) still write a distinguishable terminal event — e.g. `run.suspended` or `run.end` with `status: "incomplete"` — rather than leaving the log truly open-ended. `other_runs_live()` can then treat only `run.start`-with-no-terminal-event-at-all as live, not `run.start`-with-no-`run.end`-specifically.
* Alternatively (or additionally): add a real staleness bound to `other_runs_live()` — e.g. also treat a run as "not live" if its last event's timestamp is more than some number of hours old, regardless of whether `run.end` exists.
* A retention/pruning process for `.concertino/runs/*` doesn't appear to run anywhere in this repo — worth confirming whether one exists elsewhere or needs building (out of scope unless trivial).

## Acceptance criteria

- [ ] A run whose orchestrator ends on an unresolved Phase-4 escalation (timeout or otherwise) does not permanently block `concertino sync` for every future run's Phase 4.
- [ ] `other_runs_live()`'s false-positive window is bounded (time-based, or via a distinct terminal-event kind), not indefinite.
- [ ] The fix lands in `core/` so it survives `concertino sync` (CON-133/CON-140/CON-138 precedent).
- [ ] A genuinely long-running concurrent run (no terminal event, recent activity) is still correctly detected as live — no false negative introduced.
