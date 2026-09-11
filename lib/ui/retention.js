'use strict';

// Pruning for `.concertino/runs/<TICKET>/` — a blunt, offline-capable age
// cutoff, gated on a purely log-derived terminal signal so an active run's
// log can never be removed by construction, not by tuning the cutoff
// correctly. See openspec/changes/event-log-retention-caching/design.md for
// the full rationale, in particular Decision 1 (why this does NOT consult
// tmux window liveness) and Decision 2 (why the whole run directory is
// removed, not just events.jsonl).

const fs = require('fs');
const store = require('./store');

const DEFAULT_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// `opts.retentionDays` wins when present (the CLI's cmdPrune resolves it
// once, up front, from config + default). Failing that, a full project
// config object — passed as-is by `watch()` at startup — is also accepted,
// so both call sites can hand this whichever shape is most natural to them
// without either duplicating the other's default-resolution logic.
function resolveRetentionDays(opts) {
  const o = opts || {};
  if (typeof o.retentionDays === 'number') return o.retentionDays;
  if (o.dashboard && typeof o.dashboard.retentionDays === 'number') return o.dashboard.retentionDays;
  return DEFAULT_RETENTION_DAYS;
}

// Terminal means "has emitted a run.end event whose status is not
// 'escalated', ever" — checked via store.readEvents (the uncached,
// guaranteed-full-reparse primitive), never via tmux window liveness. A
// crashed run that never wrote run.end is indistinguishable from a genuinely
// still-running one without a liveness signal this module deliberately does
// not depend on (design.md Decision 1), so it is kept, not pruned — the safe
// failure mode.
//
// CON-182: `status:"escalated"` marks an orchestrator pausing on a
// circuit-breaker escalation, not the run actually ending — the same run
// typically resumes once it's answered, sometimes without ever writing a new
// run.start (observed on helio HEL-1080, 2026-09-11). Treating that run.end
// as terminal would let a live, resuming run get pruned out from under
// itself. As of this ticket, orchestrator.md no longer emits run.end for an
// escalation pause, but historic logs still contain such lines, so only the
// LAST run.end event (readEvents returns them in file/chronological order)
// decides terminality — any status other than "escalated" (delivered, the
// only one cleanup.sh itself ever writes; abandoned-stale, the
// fleet-driver's manual marker for a confirmed-dead run; a missing status
// field) counts as terminal, same as before this fix. See the matching
// comment on cleanup.sh's run_end_is_terminal() and watchdog.sh's
// lane_is_complete(), which apply the identical rule from bash.
function hasRunEnd(root, ticket) {
  const { events } = store.readEvents(root, ticket);
  let terminal = false;
  for (const e of events) {
    if (!e || e.kind !== 'run.end') continue;
    terminal = e.status !== 'escalated';
  }
  return terminal;
}

// A run is eligible only if BOTH hold: it is terminal, and its log file's
// mtime is older than the configured retention window. Absent run.end, this
// returns false regardless of how old the file is — the core safety property
// (ticket CON-4: "pruning must never remove a log for a run that is still
// active").
function isEligible(root, ticket, opts) {
  if (!hasRunEnd(root, ticket)) return false;

  let stat;
  try {
    stat = fs.statSync(store.eventsPath(root, ticket));
  } catch (e) {
    return false; // nothing on disk to be eligible
  }

  const now = (opts && typeof opts.now === 'number') ? opts.now : Date.now();
  const cutoff = now - resolveRetentionDays(opts) * DAY_MS;
  return stat.mtimeMs < cutoff;
}

// Removes the entire `.concertino/runs/<TICKET>/` directory (not just
// events.jsonl — design.md Decision 2) for every eligible ticket.
// `opts.dryRun` computes and returns the identical report without touching
// disk, mirroring the `--dry-run` convention already used by
// sync/update/diff.
function prune(root, opts) {
  const dryRun = !!(opts && opts.dryRun);
  const removed = [];
  const keptActive = [];

  for (const ticket of store.listTickets(root)) {
    if (isEligible(root, ticket, opts)) {
      if (!dryRun) fs.rmSync(store.runDir(root, ticket), { recursive: true, force: true });
      removed.push(ticket);
    } else {
      keptActive.push(ticket);
    }
  }

  return { removed, keptActive };
}

module.exports = { DEFAULT_RETENTION_DAYS, resolveRetentionDays, hasRunEnd, isEligible, prune };
