'use strict';

// Pure fold: event log + tmux window state -> the Run model the screens render.
// No I/O, no clock. `now` is passed in so elapsed times are testable.

// Semantic events only an agent can emit. Their presence is what proves the
// run is fully instrumented.
const TIER3_KINDS = new Set([
  'phase.enter', 'agent.spawn', 'agent.resume', 'agent.return', 'verdict',
]);

// Events the procedure scripts emit. Deterministic — no model can forget them.
// `run.cost` (track-per-run-cost-spend): emitted by report-cost.sh, a
// SessionEnd/SubagentStop hook script, not agent prose — same tier as
// run.start/gate.result.
const TIER2_KINDS = new Set(['run.start', 'gate.result', 'run.cost']);

// The canonical phase vocabulary. This is the enforced source of truth for
// `phase.enter`'s `phase` field — cross-referenced from
// `core/workflow-state.template.md`'s `PHASE:` line, which must list the same
// values in the same order. Screens (`fleet.js`, `drilldown.js`) import this
// rather than keeping their own copy.
const PHASE_ORDER = ['Setup', 'Planning', 'Execution', 'Evaluation', 'Delivery', 'Cleanup'];

// Mirrors buildSections()'s canonical section order (lib/ui/screens/fleet.js)
// group-for-group: NEEDS YOU, FAILED, then RUNNING (which also renders
// 'unknown'-status runs, so 'unknown' sorts adjacent to 'running'), then
// DONE. watch.js attaches to runs[selected], where `selected` indexes
// fleet.js's flat walk over its rendered sections — that only lines up with
// this array's order because this grouping matches buildSections' grouping;
// nothing else enforces the correspondence, so if buildSections' order ever
// changes again, this must change with it.
const STATUS_ORDER = { 'needs-you': 0, failed: 1, running: 2, unknown: 3, done: 4 };

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
    // CON-65: absent (null) on a run predating per-ticket provider routing.
    provider: null,
    // CON-22: the resolved speed + per-role models, threaded through from
    // run.start (setup-worktree.sh's own resolve-speed.sh call) the same
    // way harness/model already are — absent on a run that predates this
    // feature, rendered the same way any other missing optional field is.
    speed: null,
    models: null,
    // track-per-run-cost-spend: accumulated across every run.cost event this
    // run has emitted (design.md Decision 1 — a run's total cost is the SUM
    // of every session's own report, not a single terminal value). `null`
    // (not `0`) until the first run.cost event lands, so "no cost data
    // reported" is distinguishable from "reported and the total happens to
    // be zero" — see the reducer fold below and specs/run-cost-telemetry's
    // accumulation requirement.
    costUsd: null,
    tokens: null,
    phase: null,
    cycle: null,
    gates: [],
    lastVerdict: null,
    escalation: null,
    escalationStale: false,
    events: [],
    // CON-77: set by a `run.spawn` event — the instant the dashboard itself
    // created this ticket's tmux window, independent of whether the launched
    // agent ever reaches run.start. Bookkeeping only; deliberately NOT
    // classified as tier-2/tier-3 telemetry (see TIER2_KINDS/TIER3_KINDS
    // above and design.md Decision 3) — `telemetry` still answers "how rich
    // is the phase/gate reporting", not "does a window exist".
    spawnedAt: null,
    startedAt: null,
    endedAt: null,
    endStatus: null,
    elapsedMs: null,
    // CON-77: wall-clock time since spawnedAt, only while startedAt is still
    // null — reverts to null the instant run.start lands, at which point
    // elapsedMs takes over (design.md Decision 4). Kept separate from
    // elapsedMs so pre-bootstrap time (model loading, npm ci, etc.) never
    // pollutes rows.js's avgDoneMs average, which is computed from genuine
    // run.start -> run.end durations.
    startingMs: null,
    window: null,
    status: 'unknown',
    telemetry: 'none',
    malformed: 0,
    // CON-98: set by a `run.override` event — a manual, dashboard-only
    // bucket override (the `d` "mark done" action). Deliberately NOT
    // reinterpreted telemetry: the run's actual endStatus/window history is
    // untouched; this only wins in deriveStatus (see below).
    override: null,
  };
}

// `options` arrives as a comma-joined string from the shell emitter, but an
// array is legal too — accept both.
function toOptions(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.length) return v.split(',');
  return [];
}

// `sub_questions` arrives as a JSON-STRING value (the same generic k=v
// mechanism `models` above already relies on) — parsed defensively so a
// torn/malformed value degrades to `undefined` (absent) rather than
// throwing and losing the whole event fold. Exported alongside `toOptions`
// (selectable-escalations-list design.md Decision 1) so metrics.js's
// raised/resolved pairing walk reuses this exact parser for a historical
// `escalation.raised` event rather than hand-rolling a second, subtly
// different one for the same raw field.
function parseSubQuestions(v) {
  if (v == null) return undefined;
  try {
    const parsed = typeof v === 'string' ? JSON.parse(v) : v;
    return Array.isArray(parsed) ? parsed : undefined;
  } catch (_) {
    return undefined;
  }
}

function applyEvent(run, ev) {
  run.events.push(ev);
  if (ev.project && !run.project) run.project = ev.project;

  switch (ev.kind) {
    // CON-77: bookkeeping only — records when the window was created. Never
    // added to TIER2_KINDS/TIER3_KINDS (see emptyRun's spawnedAt comment).
    case 'run.spawn':
      run.spawnedAt = ev.t;
      break;

    case 'run.start':
      run.startedAt = ev.t;
      if (ev.branch != null) run.branch = ev.branch;
      if (ev.worktree != null) run.worktree = ev.worktree;
      if (ev.dev_port != null) run.devPort = ev.dev_port;
      if (ev.backend_port != null) run.backendPort = ev.backend_port;
      if (ev.harness != null) run.harness = ev.harness;
      if (ev.model != null) run.model = ev.model;
      if (ev.speed != null) run.speed = ev.speed;
      // CON-65: which provider the run's models resolved against ("ollama" |
      // "default"), from setup-worktree.sh's resolve-speed.sh call — absent
      // on runs predating per-ticket provider routing.
      if (ev.provider != null) run.provider = ev.provider;
      // `models` arrives as a JSON-STRING value (emit-event.sh's json_value()
      // quotes any field that isn't a bare integer/true/false — see
      // setup-worktree.sh's own comment on this), not a nested object — parse
      // defensively so a torn/malformed value degrades to "absent" rather
      // than throwing and losing the whole event fold.
      if (ev.models != null) {
        try {
          const parsed = typeof ev.models === 'string' ? JSON.parse(ev.models) : ev.models;
          if (parsed && typeof parsed === 'object') run.models = parsed;
        } catch (_) { /* malformed models= — leave run.models as-is, never throw */ }
      }
      break;

    case 'run.end':
      run.endedAt = ev.t;
      run.endStatus = ev.status || 'failed';
      break;

    // CON-98: a manual dashboard override (`d`, "mark done"), written
    // in-process by the dashboard itself (see session.js's
    // writeOverrideEvent). Highest precedence in deriveStatus below.
    case 'run.override':
      run.override = { status: ev.status, t: ev.t };
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

    // track-per-run-cost-spend, design.md Decision 1/6: accumulates —
    // NEVER overwrites — across every run.cost event this run has emitted.
    // `cost_usd` arrives as a JSON-STRING value for any fractional dollar
    // amount (emit-event.sh's json_value() only auto-unquotes bare
    // integers/true/false — Decision 6), so it is parsed via Number(...)
    // before summing, never assumed to already be a JS number. A missing or
    // malformed (NaN-producing) cost_usd contributes 0 to the dollar total
    // (the same "malformed degrades to absent, never throws" fold discipline
    // the `models`/`sub_questions` parsing above already follows) while its
    // token fields are still summed normally — an unrecognized-model event
    // still carries valid token counts (design.md Decision 4).
    case 'run.cost': {
      const costDelta = Number(ev.cost_usd);
      run.costUsd = (run.costUsd || 0) + (Number.isNaN(costDelta) ? 0 : costDelta);
      const tokenFields = {
        input_tokens: 'inputTokens',
        output_tokens: 'outputTokens',
        cache_read_tokens: 'cacheReadTokens',
        cache_creation_tokens: 'cacheCreationTokens',
      };
      if (run.tokens == null) {
        run.tokens = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
      }
      for (const [evKey, tokenKey] of Object.entries(tokenFields)) {
        const delta = Number(ev[evKey]);
        run.tokens[tokenKey] += Number.isNaN(delta) ? 0 : delta;
      }
      break;
    }

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

    case 'escalation.raised': {
      // CON-46: `sub_questions`, when present, arrives as a JSON-STRING value
      // (the same generic k=v mechanism `models` above already relies on) —
      // parse defensively so a torn/malformed value degrades to absent rather
      // than throwing and losing the whole event fold (design.md Decision 1).
      // Additive alongside — never replacing — `question`/`options` below,
      // which stay valid and unchanged for a caller that never sent this.
      run.escalation = {
        question: ev.question || '',
        options: toOptions(ev.options),
        subQuestions: parseSubQuestions(ev.sub_questions),
        raisedAt: ev.t,
        // Every event carries `role` structurally (emit-event.sh defaults it to
        // "script" when unset) — surfaced so the escalation screen can say who
        // raised the question without inventing a field the log doesn't have.
        role: ev.role || null,
        // Additive/optional (CON-11): absent on every escalation raised before
        // this change, and on any raise where gathering context didn't apply.
        // `null`/`false` here render identically to today — no context block.
        context: ev.context != null ? ev.context : null,
        contextTruncated: !!ev.context_truncated,
        contextRef: ev.context_ref != null ? ev.context_ref : null,
      };
      break;
    }

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
//
// CON-48: a run can emit `run.end` (from `cleanup.sh`, mid-Phase-4) and then
// still raise a genuinely live escalation afterward, while its tmux window is
// still alive finishing up. That escalation is not stale — the window is
// there to answer it — so it must win over the `endStatus` short-circuit
// below, not lose to it. This is checked FIRST, ahead of every other branch;
// every other branch's precedence (dead window, plain escalation, BLOCKER,
// alive/unknown) is unchanged from before.
function deriveStatus(run) {
  // CON-98: an explicit human decision ("this is done") wins over every
  // derived signal, including a live escalation on a since-fully-dead run.
  // Placed first purely so the rule reads as unconditional — in practice `d`
  // is only reachable from a FAILED row, and a FAILED row can never
  // simultaneously be 'needs-you' (mutually exclusive per STATUS_ORDER), so
  // this never actually competes with the live-escalation branch below.
  if (run.override) return run.override.status;
  if (run.escalation && run.window && run.window.alive) return 'needs-you';
  if (run.endStatus) {
    // CON-98: retry-visibility refinement (design.md Decision 3). A FAILED
    // run respawned by `a` already has a stale endStatus set — without this,
    // the row would keep reading FAILED while the new
    // /concertino-address-failure session is actively working. If the
    // window is alive and was (re)spawned after the last run.end, report
    // 'running' instead of the stale endStatus-derived value.
    if (run.window && run.window.alive && run.spawnedAt != null
        && (run.endedAt == null || run.spawnedAt > run.endedAt)) {
      return 'running';
    }
    return run.endStatus === 'delivered' ? 'done' : 'failed';
  }
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
    // An escalation is stale only when there is nobody left to answer it: the
    // window is confirmed dead, or there is no window data for this run at
    // all (the conservative default for a log with no matching tmux entry).
    // CON-48: `run.endStatus` being set is NOT on its own grounds for
    // staleness — `run.end` fires mid-Phase-4 (see `cleanup.sh`), before the
    // ticket-Done/hygiene steps even run, so a run can legitimately raise a
    // live, answerable escalation after `run.end` while its window is still
    // alive. Only window liveness decides staleness now.
    run.escalationStale = !!run.escalation
      && (!run.window || !run.window.alive);
    run.elapsedMs = run.startedAt != null
      ? (run.endedAt != null ? run.endedAt : now) - run.startedAt
      : null;
    // CON-77: only meaningful while the run hasn't reached run.start yet —
    // see emptyRun's startingMs comment for why this stays a separate field
    // from elapsedMs rather than folding into it.
    run.startingMs = (run.spawnedAt != null && run.startedAt == null)
      ? (run.endedAt != null ? run.endedAt : now) - run.spawnedAt
      : null;
    runs.push(run);
  }

  runs.sort((a, b) =>
    (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || (lastActivity(b) - lastActivity(a)));

  return runs;
}

module.exports = { reduce, TIER2_KINDS, TIER3_KINDS, PHASE_ORDER, toOptions, parseSubQuestions };
