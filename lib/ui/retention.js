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
const { computeRunEnd } = require('./run-terminal');

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

// Terminal means "the run's last run.end/run.start transition, per
// ./run-terminal's shared computeRunEnd(), says complete" — checked via
// store.readEvents (the uncached, guaranteed-full-reparse primitive), never
// via tmux window liveness. A crashed run that never wrote run.end is
// indistinguishable from a genuinely still-running one without a liveness
// signal this module deliberately does not depend on (design.md Decision 1),
// so it is kept, not pruned — the safe failure mode. See run-terminal.js for
// what "terminal" means (CON-182: a run.end status of "escalated" does not
// count, and neither does a terminal run.end followed by a later run.start)
// — the identical rule core/scripts/lib/run-end-status.sh applies from bash
// in watchdog.sh/cleanup.sh.
//
// CON-182 also changes retention's actual pruning behavior for a run that
// paused on an escalation and was NEVER resumed: before this fix, such a
// run's (wrongly-terminal) run.end made it age out and get deleted after
// the retention window like any other finished run; after this fix it is
// never eligible, kept forever, same as a crashed run with no run.end at
// all. This is a deliberate widening of the EXISTING CON-4 safety property
// ("pruning must never remove a log for a run that is still active") to a
// case it always should have covered — a paused-forever run has no more of
// a completion signal than a crashed one, and silently deleting either is
// strictly worse than an unbounded (but bounded-by-operator-action) keep.
// The escape hatch already exists and needs no new mechanism: the
// fleet-driver's manual `abandoned-stale` marker (CON-121,
// .claude/skills/concertino-fleet-driver/SKILL.md) is exactly "a human has
// confirmed this one is really dead" and IS terminal per run-terminal.js,
// so an operator who wants a long-abandoned escalated run's log actually
// pruned appends that marker rather than this module inventing a second,
// arbitrary age-based override that would just reopen the CON-4 hole this
// ticket closes.
function hasRunEnd(root, ticket) {
  const { events } = store.readEvents(root, ticket);
  return computeRunEnd(events).complete;
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
