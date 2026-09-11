'use strict';

// Shared "is this run terminal?" definition (CON-182) for lib/ui/reducer.js
// and lib/ui/retention.js — extracted so both share one implementation of
// the one magic rule ("escalated" is not terminal) instead of each
// reimplementing it independently and risking drift, mirroring
// core/scripts/lib/run-end-status.sh's identical role on the bash side.
//
// A `run.end` event is terminal only when its status is anything other than
// "escalated": `status:"escalated"` marks an orchestrator pausing on a
// circuit-breaker escalation, not the run ending — the same run typically
// resumes once it's answered, sometimes without ever writing a new
// run.start (observed on helio HEL-1080, 2026-09-11). As of this ticket,
// orchestrator.md no longer emits run.end for an escalation pause at all,
// but historic logs — and any run still mid-flight against an un-synced
// older orchestrator.md — may still contain such a line, so this stays
// permanent, defensive logic. `delivered` (cleanup.sh, the only status it
// itself ever writes), `abandoned-stale` (the fleet-driver's manual marker
// for a confirmed-dead run), and a missing status field are all still
// terminal, unchanged from before this ticket.
function isTerminalRunEnd(ev) {
  return !!ev && ev.kind === 'run.end' && ev.status !== 'escalated';
}

// Folds a ticket's ordered event list into { complete, endedAt, endStatus }:
// - `complete` is true iff the LAST run.end (by time) is terminal AND no
//   run.start event occurs after it. A run.start emitted after a real
//   terminal run.end means the ticket's events.jsonl (append-only, shared
//   across that ticket's whole history) was genuinely re-run — that later
//   run is live again (cold-review cycle-2 addition, 2026-09-11).
// - `endedAt`/`endStatus` are the values callers should actually record —
//   null while not complete, so a resumed or paused-on-escalation run
//   reports as still-live rather than delivered/failed.
// Events are expected already time-ordered (both callers pre-sort before
// folding).
function computeRunEnd(events) {
  let complete = false;
  let endedAt = null;
  let endStatus = null;
  for (const ev of events || []) {
    if (!ev) continue;
    if (ev.kind === 'run.end') {
      if (isTerminalRunEnd(ev)) {
        complete = true;
        endedAt = ev.t;
        endStatus = ev.status || 'failed';
      }
    } else if (ev.kind === 'run.start') {
      complete = false;
      endedAt = null;
      endStatus = null;
    }
  }
  return { complete, endedAt, endStatus };
}

module.exports = { isTerminalRunEnd, computeRunEnd };
