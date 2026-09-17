'use strict';

// `concertino report <name>` — a read-only, on-demand report namespace
// (design.md Decision 1). The only report today is `followup-survival`
// (CON-192): follow-up survival, segmented and bucketed over time, from two
// never-summed provenance tiers. See openspec/changes/followup-survival-report.
//
// Pure computation lives in lib/followup-survival.js; this module owns all
// I/O (event store, Linear) and rendering, following the repo's existing
// render(state)->string / stateful-driver split (design.md Decision 2).

const { hasHelpFlag, resolveOut, resolveConfigPath, exists, read, red, dim, bold } = require('./shared');
const { printUsage } = require('./help');
const store = require('../ui/store');
const linear = require('../ui/linear');
const survival = require('../followup-survival');

const KNOWN_REPORTS = ['followup-survival'];

// The formatting-tolerant CON-190 convention needle (design.md Decision 9,
// standing constraint C1). The real rendering puts a backtick around the key
// only, with the colon OUTSIDE the backticks: "* `origin_kind`: followup".
// The strict `/origin_kind:\s*followup/i` form can never match that — this is
// the exact false-negative this change's own Planning hit. Positive-controlled
// in test/cli-report.test.js (task 4.3a).
const CONVENTION_NEEDLE = /[`*_]*origin_kind[`*_]*\s*:\s*[`*_]*followup[`*_]*/i;
// The weaker prose heuristic (design.md Decision 9) — deliberately narrower
// than a bare "follow-up" match, which also matches "no follow-ups needed".
const PROSE_NEEDLE = /follow[- ]?up\s+(from|of|to)\b/i;

// CON-188's merge — the boundary before which escalation identity
// (`escalation_id`) is essentially absent from the corpus (design.md Context,
// standing constraint via Decision 8).
const CON188_BOUNDARY_MS = 1789595291000;

const ALL_STATE_TYPES = ['backlog', 'unstarted', 'started', 'completed', 'canceled'];

function matchConvention(description) {
  return CONVENTION_NEEDLE.test(description || '');
}
function matchProse(description) {
  return PROSE_NEEDLE.test(description || '');
}

function parseOverlap(triageField) {
  if (!triageField) return 'unknown';
  let parsed = triageField;
  if (typeof triageField === 'string') {
    try { parsed = JSON.parse(triageField); } catch (e) { return 'unknown'; }
  }
  if (parsed && typeof parsed === 'object' && typeof parsed.overlap === 'string' && parsed.overlap) {
    return parsed.overlap;
  }
  return 'unknown';
}

// Every `ticket.filed` row across every run in the event store, filtered to
// `origin_kind === 'followup'` (tasks.md 4.2). `store.readAll` already
// tolerates a missing/empty runs directory (returns an empty Map), which is
// what makes the empty-corpus path (task 4.6) reachable with no special-case
// here.
function readProvenanceEvents(root) {
  const byTicket = store.readAll(root);
  const out = [];
  for (const { events } of byTicket.values()) {
    for (const ev of events) {
      if (ev && ev.kind === 'ticket.filed' && ev.origin_kind === 'followup') out.push(ev);
    }
  }
  return out;
}

function readEscalationBoundaryCounts(root) {
  const byTicket = store.readAll(root);
  let pre = 0;
  let post = 0;
  for (const { events } of byTicket.values()) {
    for (const ev of events) {
      if (!ev || ev.kind !== 'escalation.raised') continue;
      if (ev.t < CON188_BOUNDARY_MS) pre++;
      else post++;
    }
  }
  return { pre, post };
}

// Builds the provenance tier's rows by joining each `ticket.filed` event to
// the matching Linear ticket (by identifier) for its real completion state —
// never trusting a self-reported field for survival. A `ticket_id` unknown to
// Linear (deleted, wrong team) is still counted (never dropped) but cannot be
// shown as surviving.
function buildProvenanceRows(events, ticketsByIdent, now) {
  return events.map((ev) => {
    const t = ticketsByIdent.get(ev.ticket_id);
    const survived = !!(t && t.state && t.state.type === 'completed');
    const filedAt = t && typeof t.createdAt === 'number' ? t.createdAt : (typeof ev.t === 'number' ? ev.t : null);
    return {
      id: ev.ticket_id,
      originRole: ev.origin_role || 'unknown',
      suggestedBy: ev.suggested_by || 'unknown',
      overlap: parseOverlap(ev.triage),
      filedAt,
      survived,
      ageMs: !survived && filedAt != null ? now - filedAt : null,
    };
  });
}

// Builds the recovered-heuristic tier (design.md Decisions 8a/9): scans every
// fetched ticket's description for the two distinct markers, excludes any
// ticket already present in the provenance tier (by identifier, C4), and
// records which marker matched. `convention` rows carry NO recoverable
// `overlap`/`origin_ticket` — descriptions carry no triage payload and render
// `origin_ticket` as a link macro, not plain text (task 4.3b) — so both are
// always `unknown`, never inferred.
function buildRecoveredRows(tickets, provenanceIds, now) {
  const rows = [];
  let excludedCount = 0;
  for (const t of tickets) {
    const desc = t.description || '';
    let marker = null;
    if (matchConvention(desc)) marker = 'convention';
    else if (matchProse(desc)) marker = 'prose';
    if (!marker) continue;

    if (provenanceIds.has(t.identifier)) { excludedCount++; continue; }

    const survived = !!(t.state && t.state.type === 'completed');
    const filedAt = typeof t.createdAt === 'number' ? t.createdAt : null;
    rows.push({
      id: t.identifier,
      originRole: 'unknown',
      suggestedBy: 'unknown',
      overlap: 'unknown',
      originTicket: 'unknown',
      filedAt,
      survived,
      ageMs: !survived && filedAt != null ? now - filedAt : null,
      marker,
    });
  }
  return { rows, excludedCount };
}

function fmtPct(result) {
  if (result.total === 0) return 'no data';
  if (result.suppressed) return 'small-n (n=' + result.total + ')';
  return result.pct + '%';
}

function fmtCounts(result) {
  return result.surviving + '/' + result.total + ' (' + fmtPct(result) + ')';
}

function fmtSurvivalLine(label, result, indent) {
  const pad = indent || '';
  return pad + label + ': ' + fmtCounts(result);
}

function renderSegments(title, rows, minN, isProvenanceTier) {
  const lines = [];
  const axes = [
    ['origin_role', 'originRole'],
    ['suggested_by', 'suggestedBy'],
    ['triage.overlap', 'overlap'],
  ];
  lines.push('  ' + title + ':');
  for (const [label, key] of axes) {
    const seg = survival.segmentBy(rows, key, minN);
    // The hardcoded-template explanation is specific to the PROVENANCE tier's
    // origin_role (design.md defect 1) — the recovered tier's origin_role is
    // always 'unknown' by construction (text recovery carries no role at
    // all), a different and unrelated reason to be single-valued.
    //
    // C5 (final-gate skeptic, round 1): the annotation must be guarded on the
    // VALUE actually observed, never merely on singleValued+tier — the
    // standaloneTicket template only *suggests* origin_role=orchestrator as
    // boilerplate, it is not an enforced constant, and a direct emitter call
    // can (and, in the live corpus, does) record a different role. Rendering
    // the hardcoded-template explanation above a bucket that is NOT
    // 'orchestrator' would be a false claim, not an imprecision.
    const soleValue = seg.singleValued ? Object.keys(seg.buckets)[0] : null;
    if (label === 'origin_role' && seg.singleValued && isProvenanceTier && soleValue === 'orchestrator') {
      lines.push(
        '    ' + label + ': SINGLE-VALUED — the emitting path (standaloneTicket template) hardcodes ' +
        'origin_role=orchestrator, so this axis cannot currently resolve the five roles named in the ' +
        "ticket's acceptance criteria.",
      );
    } else if (label === 'origin_role' && seg.singleValued && isProvenanceTier) {
      lines.push(
        '    ' + label + ': SINGLE-VALUED — only one origin_role value observed in this corpus (' +
        soleValue + ').',
      );
    } else if (label === 'origin_role' && seg.singleValued) {
      lines.push('    ' + label + ': SINGLE-VALUED — unrecoverable from text; always unknown in this tier.');
    } else {
      lines.push('    ' + label + ':');
    }
    for (const value of Object.keys(seg.buckets)) {
      lines.push(fmtSurvivalLine(value, seg.buckets[value], '      '));
    }
  }
  return lines;
}

function renderPeriods(title, rows, minN) {
  const lines = [];
  lines.push('  ' + title + ' (per filing week, volume + survival):');
  const buckets = survival.bucketByWeek(rows, minN);
  if (buckets.length === 0) {
    lines.push('    no data');
    return lines;
  }
  for (const b of buckets) {
    if (b.total === 0) {
      lines.push('    ' + b.period + ': no data (0 filed)');
    } else {
      lines.push('    ' + b.period + ': filed=' + b.total + '  survival=' + fmtPct(b));
    }
  }
  return lines;
}

// The pure model-building step: everything above the render() line is a
// pure function of its inputs (rows, tickets), so it is directly unit
// testable without a subprocess or the network (tasks.md 4.2-4.4c).
function buildModel({ provenanceEvents, tickets, now, minN }) {
  const n = typeof now === 'number' ? now : Date.now();
  const ticketsByIdent = new Map((tickets || []).map((t) => [t.identifier, t]));

  const provenanceRows = buildProvenanceRows(provenanceEvents || [], ticketsByIdent, n);
  const provenanceIds = new Set(provenanceRows.map((r) => r.id));

  const { rows: recoveredRows, excludedCount } = buildRecoveredRows(tickets || [], provenanceIds, n);

  return {
    provenanceRows,
    recoveredRows,
    excludedCount,
    provenanceOverall: survival.computeSurvival(provenanceRows, minN),
    recoveredOverall: survival.computeSurvival(recoveredRows, minN),
  };
}

function renderReport(model, escalationCounts, minN) {
  const lines = [];
  lines.push(bold('concertino report followup-survival'));
  lines.push('');
  lines.push(
    dim(
      'Two tiers, never summed (design.md Decision 3): "provenance" is authoritative ' +
      '(from ticket.filed events); "recovered-heuristic" is indicative only (from text matching).',
    ),
  );

  // --- Provenance tier ------------------------------------------------
  lines.push('');
  lines.push(bold('PROVENANCE tier') + dim(' (source: ticket.filed events)'));
  if (model.provenanceOverall.total === 0) {
    // Final-gate skeptic, round 2: the prior wording ("this run's own filing
    // is the exception; see below") is a present-tense claim that CANNOT be
    // true whenever this branch fires — it only fires when total is exactly
    // 0, so no exception exists in this render and "see below" points at
    // nothing. State only what is true of THIS render: zero rows, and why.
    lines.push(
      '  No follow-up provenance has been recorded yet in this event store — ticket.filed only accrues ' +
      'from the next standalone triage onward. This is an explicitly-empty, well-formed result, never a ' +
      'fabricated survival figure.',
    );
  } else {
    lines.push(fmtSurvivalLine('overall', model.provenanceOverall, '  '));
    if (model.provenanceOverall.medianAgeOfNonSurvivors != null) {
      lines.push('  median age of non-survivors (ms): ' + model.provenanceOverall.medianAgeOfNonSurvivors);
    }
    renderSegments('by segment', model.provenanceRows, minN, true).forEach((l) => lines.push(l));
    renderPeriods('by period', model.provenanceRows, minN).forEach((l) => lines.push(l));
  }

  // --- Recovered tier ---------------------------------------------------
  lines.push('');
  lines.push(bold('RECOVERED-HEURISTIC tier') + dim(' (indicative only — text matching, not provenance)'));
  lines.push('  markers used: convention=' + CONVENTION_NEEDLE.source + '  prose=' + PROSE_NEEDLE.source);
  lines.push(
    '  ' + model.excludedCount + ' recovered row(s) excluded because they already have provenance ' +
    '(recovered tier means strictly what provenance missed — design.md Decision 8a / C4).',
  );
  if (model.recoveredOverall.total === 0) {
    lines.push('  no recovered rows.');
  } else {
    lines.push(fmtSurvivalLine('overall', model.recoveredOverall, '  '));
    const byMarker = new Map();
    for (const r of model.recoveredRows) {
      if (!byMarker.has(r.marker)) byMarker.set(r.marker, []);
      byMarker.get(r.marker).push(r);
    }
    for (const [marker, rows] of byMarker.entries()) {
      lines.push('  marker=' + marker + ': ' + fmtCounts(survival.computeSurvival(rows, minN)));
    }
    renderSegments('by segment', model.recoveredRows, minN).forEach((l) => lines.push(l));
    renderPeriods('by period', model.recoveredRows, minN).forEach((l) => lines.push(l));
  }

  const bothHaveData =
    survival.bucketByWeek(model.provenanceRows).some((b) => b.total > 0) &&
    survival.bucketByWeek(model.recoveredRows).some((b) => b.total > 0);
  if (bothHaveData) {
    lines.push('');
    lines.push(
      dim(
        'Migration caveat: once provenance coverage is non-trivial, a declining recovered-tier volume ' +
        'over time must be read alongside provenance-tier growth, not as an isolated signal — rows ' +
        'migrate from recovered into provenance as ticket.filed accrues.',
      ),
    );
  }

  // --- Escalation boundary context (stated, never a pre/post rate) -----
  lines.push('');
  lines.push(bold('Escalation context') + dim(' (CON-188 boundary — populations stated, no comparison computed)'));
  lines.push('  boundary: t=' + CON188_BOUNDARY_MS + ' (CON-188 merge — before this, escalation_id is essentially absent)');
  lines.push('  pre-boundary escalation.raised events: ' + escalationCounts.pre + ' (pairing unreliable)');
  lines.push('  post-boundary escalation.raised events: ' + escalationCounts.post);

  return lines.join('\n');
}

async function runFollowupSurvival(args) {
  const out = resolveOut(args);
  const cfgPath = resolveConfigPath(args, out);
  const config = exists(cfgPath) ? JSON.parse(read(cfgPath)) : {};

  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    console.error(
      red('error: ') +
      'LINEAR_API_KEY is not set — completion state cannot be read, so a survival figure ' +
      'cannot be honestly reported. Refusing rather than reporting 0% survival.',
    );
    process.exit(1);
    return;
  }

  const team = linear.teamKeyFromConfig(config, process.env);
  if (!team.key) {
    console.error(
      red('error: ') + 'no ticketProvider.teamKey configured (and no LINEAR_TEAM_KEY env var) — ' +
      'completion state cannot be read without a team.',
    );
    process.exit(1);
    return;
  }

  const provenanceEvents = readProvenanceEvents(out);
  const escalationCounts = readEscalationBoundaryCounts(out);

  // C2: the bulk tickets fetch, never the single-issue lookup — the latter's
  // ISSUE_QUERY selects only id/identifier/labels and would silently return
  // no description/state.
  const result = await linear.fetchTickets({
    teamKey: team.key,
    apiKey,
    stateTypes: ALL_STATE_TYPES,
    transport: args.__transport,
  });

  const model = buildModel({ provenanceEvents, tickets: result.tickets, now: Date.now() });
  console.log(renderReport(model, escalationCounts, survival.DEFAULT_MIN_N));
  process.exit(0);
}

async function cmdReport(args) {
  if (hasHelpFlag(args)) { printUsage('report'); return; }
  const name = args._[1];
  if (!name) {
    console.error(red('error: ') + 'usage: concertino report <name>');
    console.error('  known: ' + KNOWN_REPORTS.join(', '));
    process.exit(1);
    return;
  }
  if (!KNOWN_REPORTS.includes(name)) {
    console.error(red('error: ') + 'unknown report "' + name + '".');
    console.error('  known: ' + KNOWN_REPORTS.join(', '));
    process.exit(1);
    return;
  }
  await runFollowupSurvival(args);
}

module.exports = {
  cmdReport,
  matchConvention,
  matchProse,
  CONVENTION_NEEDLE,
  PROSE_NEEDLE,
  parseOverlap,
  buildProvenanceRows,
  buildRecoveredRows,
  buildModel,
  renderReport,
  readProvenanceEvents,
  readEscalationBoundaryCounts,
  CON188_BOUNDARY_MS,
  ALL_STATE_TYPES,
};
