'use strict';

// Pure fold: event log + tmux window state -> the Run model the screens render.
// No I/O, no clock. `now` is passed in so elapsed times are testable.

// Semantic events only an agent can emit. Their presence is what proves the
// run is fully instrumented.
const TIER3_KINDS = new Set([
  'phase.enter', 'agent.spawn', 'agent.resume', 'agent.return', 'verdict',
]);

// Events the procedure scripts emit. Deterministic — no model can forget them.
const TIER2_KINDS = new Set(['run.start', 'gate.result']);

// The canonical phase vocabulary. This is the enforced source of truth for
// `phase.enter`'s `phase` field — cross-referenced from
// `core/workflow-state.template.md`'s `PHASE:` line, which must list the same
// values in the same order. Screens (`fleet.js`, `drilldown.js`) import this
// rather than keeping their own copy.
const PHASE_ORDER = ['Setup', 'Planning', 'Execution', 'Evaluation', 'Delivery', 'Cleanup'];

const STATUS_ORDER = { 'needs-you': 0, running: 1, unknown: 2, failed: 3, done: 4 };

function emptyRun(ticket) {
  return {
    ticket,
    project: null,
    changeName: null,
    branch: null,
    worktree: null,
    devPort: null,
    backendPort: null,
    harness: null,
    model: null,
    phase: null,
    cycle: null,
    gates: [],
    lastVerdict: null,
    escalation: null,
    escalationStale: false,
    events: [],
    startedAt: null,
    endedAt: null,
    endStatus: null,
    elapsedMs: null,
    window: null,
    status: 'unknown',
    telemetry: 'none',
    malformed: 0,
  };
}

// `options` arrives as a comma-joined string from the shell emitter, but an
// array is legal too — accept both.
function toOptions(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.length) return v.split(',');
  return [];
}

function applyEvent(run, ev) {
  run.events.push(ev);
  if (ev.project && !run.project) run.project = ev.project;

  switch (ev.kind) {
    case 'run.start':
      run.startedAt = ev.t;
      if (ev.branch != null) run.branch = ev.branch;
      if (ev.worktree != null) run.worktree = ev.worktree;
      if (ev.dev_port != null) run.devPort = ev.dev_port;
      if (ev.backend_port != null) run.backendPort = ev.backend_port;
      if (ev.harness != null) run.harness = ev.harness;
      if (ev.model != null) run.model = ev.model;
      break;

    case 'run.end':
      run.endedAt = ev.t;
      run.endStatus = ev.status || 'failed';
      break;

    case 'phase.enter':
      // An unrecognised phase value must never silently overwrite run.phase
      // with garbage (see CON-3): it is left untouched — so a run that had a
      // valid phase keeps showing its last known-good one, not the bad string
      // or null — and counted toward run.malformed, the same fleet-wide
      // indicator that already surfaces a dropped event-log line.
      if (ev.phase != null) {
        if (PHASE_ORDER.includes(ev.phase)) run.phase = ev.phase;
        else run.malformed++;
      }
      if (ev.cycle != null) run.cycle = ev.cycle;
      break;

    case 'agent.resume':
      if (ev.cycle != null) run.cycle = ev.cycle;
      break;

    case 'gate.result': {
      const gate = {
        name: ev.gate,
        status: ev.status,
        durationMs: ev.duration_ms != null ? ev.duration_ms : null,
        firstError: ev.first_error != null ? ev.first_error : null,
      };
      const i = run.gates.findIndex((g) => g.name === ev.gate);
      if (i >= 0) run.gates[i] = gate;
      else run.gates.push(gate);
      break;
    }

    case 'verdict':
      run.lastVerdict = {
        role: ev.role,
        verdict: ev.verdict,
        ref: ev.ref != null ? ev.ref : null,
      };
      break;

    case 'escalation.raised':
      run.escalation = {
        question: ev.question || '',
        options: toOptions(ev.options),
        raisedAt: ev.t,
        // Every event carries `role` structurally (emit-event.sh defaults it to
        // "script" when unset) — surfaced so the escalation screen can say who
        // raised the question without inventing a field the log doesn't have.
        role: ev.role || null,
      };
      break;

    case 'escalation.answered':
    case 'escalation.timeout':
      run.escalation = null;
      break;

    default:
      break;
  }
}

// Order matters. A finished or dead run is reported as such even if it was
// holding an escalation when it died — that escalation is stale, and showing
// it as actionable would send you to answer a question nobody is waiting on.
function deriveStatus(run) {
  if (run.endStatus) return run.endStatus === 'delivered' ? 'done' : 'failed';
  if (run.window && !run.window.alive) return 'failed';
  if (run.escalation) return 'needs-you';
  if (run.lastVerdict && run.lastVerdict.verdict === 'BLOCKER') return 'needs-you';
  if (run.window && run.window.alive) return 'running';
  return 'unknown';
}

function deriveTelemetry(run) {
  let t3 = false;
  let t2 = false;
  for (const ev of run.events) {
    if (TIER3_KINDS.has(ev.kind)) t3 = true;
    else if (TIER2_KINDS.has(ev.kind)) t2 = true;
  }
  if (t3) return 'full';
  if (t2) return 'partial';
  return 'none';
}

function lastActivity(run) {
  return run.events.length ? run.events[run.events.length - 1].t : 0;
}

function reduce(eventsByTicket, windows, now) {
  const byTicket = new Map();

  for (const [ticket, parsed] of eventsByTicket) {
    const run = emptyRun(ticket);
    run.malformed = parsed.malformed || 0;
    const ordered = parsed.events.slice().sort((a, b) => a.t - b.t);
    for (const ev of ordered) applyEvent(run, ev);
    byTicket.set(ticket, run);
  }

  // A live tmux window with no log at all is still a run — it is just one we
  // know nothing about, and that is exactly what we must show.
  for (const w of windows || []) {
    let run = byTicket.get(w.ticket);
    if (!run) {
      run = emptyRun(w.ticket);
      byTicket.set(w.ticket, run);
    }
    run.window = { alive: w.alive, idleMs: w.idleMs != null ? w.idleMs : null };
  }

  const runs = [];
  for (const run of byTicket.values()) {
    if (run.branch) run.changeName = run.branch.split('/')[1] || null;
    run.telemetry = deriveTelemetry(run);
    run.status = deriveStatus(run);
    // An escalation on a run that has reached a terminal state is stale: nobody
    // is waiting on the answer. Window death is only one way to get there — a
    // run that raised an escalation and then delivered has no window at all,
    // and rendering its question as live would send a human to answer nothing.
    run.escalationStale = !!run.escalation
      && (run.endStatus != null || !!(run.window && !run.window.alive));
    run.elapsedMs = run.startedAt != null
      ? (run.endedAt != null ? run.endedAt : now) - run.startedAt
      : null;
    runs.push(run);
  }

  runs.sort((a, b) =>
    (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || (lastActivity(b) - lastActivity(a)));

  return runs;
}

module.exports = { reduce, TIER2_KINDS, TIER3_KINDS, PHASE_ORDER };
