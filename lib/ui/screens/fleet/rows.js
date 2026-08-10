'use strict';

// Per-row renderers for the fleet screen: the 2-line live run row and the
// 1-line finished/queued/quick-start rows, plus their shared helpers.

const f = require('../../format');
const textwrap = require('../../textwrap');
// CON-40: launchpad.js's own priorityLabel/priorityRank/sortByPriority/
// isSelectable are the QUICK START widget's single source of truth for
// "what's next" and "is it already spoken for" — reused as-is here, never
// reimplemented (proposal.md's own framing: "a shortcut UI in front of
// existing plumbing, not new plumbing"). No require cycle: launchpad.js
// requires only ../cache, ../format, ../layout, ../ticketDetail — never
// this module.
const launchpadScreen = require('../launchpad');
const { PHASE_ORDER } = require('../../reducer');
// CON-110, design.md Decision 3: the ONE shared match predicate — reused
// here (never a second, ad hoc substring check) so a row's own highlighting
// can never disagree with 'submit-search''s jump resolution (controllers/
// fleet.js) about what counts as a match.
const search = require('./search');

// Idle is now seeded from tmux's own `window_activity`, so it is real from the
// first frame. The old one-minute floor existed only because idle used to start
// at zero on every window the moment you opened the dashboard.
const IDLE_FLOOR_MS = 30000;

function phaseFraction(run) {
  if (!run.phase) return 0;
  const i = PHASE_ORDER.indexOf(run.phase);
  return i < 0 ? 0 : (i + 1) / PHASE_ORDER.length;
}

// The second line of a run: what it is doing, and how confident we are that we
// know. A run we cannot see into must look different from a healthy one.
function statusLine(run, width, avgDoneMs) {
  const parts = [];

  if (run.telemetry === 'none') {
    // CON-77: a live window with a recorded spawn but nothing else yet is
    // "starting…", not the ambiguous "no telemetry" a genuinely
    // under-instrumented mid-run also shows — see reducer.js's startingMs.
    if (run.spawnedAt != null && run.window && run.window.alive) {
      parts.push('starting ' + f.dur(run.startingMs));
    } else {
      parts.push('no telemetry');
    }
  } else if (!run.phase) {
    parts.push('phase unknown');
  } else {
    parts.push(f.dim(f.padTo(run.phase, 11)));
    if (run.cycle != null) parts.push('cycle ' + run.cycle);
  }

  if (run.gates.length) {
    const passed = run.gates.filter((g) => g.status === 'pass').length;
    parts.push('gates ' + passed + '/' + run.gates.length);
  }

  // How the run ended, whenever it said. `escalated` — the circuit breaker
  // giving up — is the loudest "come look" signal the system has, and must
  // never be flattened into the same row as a delivered run.
  if (run.endStatus) parts.push(run.endStatus);

  if (run.window && run.window.idleMs != null && run.window.idleMs >= IDLE_FLOOR_MS) {
    parts.push('idle ' + f.dur(run.window.idleMs));
  }

  // A harness that died leaves a dead tmux window and no `run.end`, so
  // `endedAt` stays null and the reducer keeps measuring elapsed against `now`.
  // By morning a run that crashed at 2am reads `8h32m` — and a growing number
  // is exactly what progress looks like. Say what happened instead.
  if (run.status === 'failed' && run.endedAt == null) {
    if (!run.endStatus) {
      // CON-77: a window that died before ever reaching run.start is a
      // distinct failure mode from one that crashed mid-workflow — see
      // design.md Decision 5.
      parts.push(run.telemetry === 'none' ? 'failed to start' : 'window exited');
    }
  } else if (run.telemetry !== 'none') {
    // CON-77: skip this segment entirely when telemetry is 'none' — the
    // "starting Ns" text pushed above already covers the pre-run.start
    // elapsed-time signal, and elapsedMs itself is null (meaningless "—")
    // for a run that hasn't started.
    let durPart = f.dim(f.dur(run.elapsedMs));
    // Compared only for delivered runs, and only once there is a real average
    // to compare against (avgDoneMs is null with fewer than one prior
    // delivery in this repo's `.concertino/runs/` history) — a lone delivered
    // ticket is trivially "average" and must not render an arrow against
    // itself. Slower-than-average is bad (red, up), faster-than-average is
    // good (green, down) — colour follows "is this good news", not the
    // arrow's own direction.
    if (run.status === 'done' && avgDoneMs != null && run.elapsedMs != null) {
      if (run.elapsedMs > avgDoneMs) durPart += ' ' + f.red('▲');
      else if (run.elapsedMs < avgDoneMs) durPart += ' ' + f.green('▼');
    }
    parts.push(durPart);
  }

  return f.truncate(parts.join('   '), width);
}

function renderRun(run, opts, selected) {
  const lines = [];
  const marker = selected ? '▸' : ' ';
  const name = run.changeName || f.dim('(no branch yet)');
  // CON-110, design.md Decision 2: a highlight, not a filter — every row
  // still renders exactly as it would with no query at all; only the
  // matched ticket-id/title token gets wrapped in f.yellow (the same
  // "needs attention" colour the fleet view already uses elsewhere).
  // `opts.searchQuery` is `null`/absent whenever search is not open, so
  // `search.matchesQuery` is always false and this is a byte-for-byte no-op
  // in that case.
  const query = opts.searchQuery;
  const idText = f.padTo(run.ticket, 9);
  const idRendered = f.bold(search.matchesQuery(run.ticket, query) ? f.yellow(idText) : idText);
  const nameText = f.truncate(name, opts.cols - 16);
  const nameRendered = search.matchesQuery(run.changeName, query) ? f.yellow(nameText) : nameText;
  lines.push(`  ${marker} ${idRendered} ${nameRendered}`);

  if (run.escalation) {
    const stale = run.escalationStale ? ' [stale]' : '';
    // Plain, not the `[a]pprove` keybinding idiom: nothing binds those keys
    // until the control plane lands, and advertising a key that does nothing is
    // how a human learns to distrust the whole screen.
    const keys = run.escalation.options.length
      ? '   ' + run.escalation.options.join(' / ')
      : '';
    // CON-53: wrap the question alone (no suffix-width reservation up front —
    // see design.md's Decision for why that's unsound: textwrap.wrap's own
    // `Math.max(10, width)` floor silently ignores a too-small reservation),
    // then append the stale/keys suffix to the wrapped block's last line and
    // re-truncate that composed line back down to the same budget as an
    // unconditional final bound. Every other wrapped line is already
    // `<= opts.cols - 8` by construction of wrap() itself.
    const suffix = stale + keys;
    const wrappedQuestion = textwrap.wrap(run.escalation.question, opts.cols - 8);
    wrappedQuestion.forEach((line, i) => {
      const isLast = i === wrappedQuestion.length - 1;
      const composed = isLast ? f.truncate(line + suffix, opts.cols - 8) : line;
      lines.push('      ' + f.yellow(composed));
    });
  } else {
    const b = (f.STATUS_COLOUR[run.status] || f.dim)(f.bar(phaseFraction(run), 20));
    lines.push('      ' + b + '  ' + statusLine(run, Math.max(0, opts.cols - 30), opts.avgDoneMs));
  }

  return lines;
}

// A finished (DONE/FAILED) run's progress bar/phase/gates detail is no
// longer LIVE information — collapsing it to one line roughly doubles how
// much history fits on screen (lazygit-layout pass's "dense, glanceable"
// trait). NEEDS YOU/RUNNING keep renderRun's 2-line shape above; that bar
// IS live there. Mirrors statusLine's own "window exited" special case (a
// dead window with no run.end must never show a growing elapsed time as
// though it were progress — reducer.js keeps measuring it against `now`)
// by omitting the duration entirely in that one case, not just relabelling
// it. Must always emit exactly 1 line, matching FAILED/DONE's own
// `linesPerRow: 1` — sectionHeight() and this function must stay in
// lockstep on how many lines a finished row costs, exactly like
// renderQueuedRow's own header comment requires of itself.
function renderFinishedRow(run, opts, selected) {
  const marker = selected ? '▸' : ' ';
  // CON-109, fleet-bulk-select spec: the dedicated multi-select marker (`✓`),
  // independent of (and rendered alongside) the ordinary cursor marker just
  // above — a row may show both at once, since cursor position and
  // multi-select membership are independent facts. `opts.multiSelected` is
  // threaded from `state.multiSelect.failed` (render.js's per-row call site,
  // below).
  const multiMarker = opts.multiSelected ? '✓' : ' ';
  const name = run.changeName || f.dim('(no branch yet)');
  const statusColour = f.STATUS_COLOUR[run.status] || f.dim;
  // CON-110, design.md Decision 2: same highlight-not-filter treatment as
  // renderRun's own comment above — only the matched ticket-id/title token
  // is wrapped in f.yellow; `run.changeName` (not the already-`f.dim`-
  // wrapped `name` fallback) is what's tested, so a run with no branch yet
  // never spuriously "matches" an empty/placeholder string.
  const query = opts.searchQuery;
  const idText = f.padTo(run.ticket, 9);
  const idRendered = f.bold(search.matchesQuery(run.ticket, query) ? f.yellow(idText) : idText);
  const nameRendered = search.matchesQuery(run.changeName, query) ? f.yellow(name) : name;
  const left = `  ${multiMarker}${marker} ${idRendered} ${nameRendered}`;

  let right;
  if (run.status === 'failed' && run.endedAt == null && !run.endStatus) {
    // CON-77: same "failed to start" vs "window exited" split as statusLine
    // above — see design.md Decision 5.
    right = statusColour(run.telemetry === 'none' ? 'failed to start' : 'window exited');
  } else {
    const endLabel = run.endStatus || run.status;
    let durPart = f.dur(run.elapsedMs);
    if (run.status === 'done' && opts.avgDoneMs != null && run.elapsedMs != null) {
      if (run.elapsedMs > opts.avgDoneMs) durPart += ' ' + f.red('▲');
      else if (run.elapsedMs < opts.avgDoneMs) durPart += ' ' + f.green('▼');
    }
    right = statusColour(endLabel) + '  ' + f.dim(durPart);
  }

  const gap = Math.max(2, opts.cols - f.visibleLength(left) - f.visibleLength(right));
  return [f.truncate(left + ' '.repeat(gap) + right, opts.cols)];
}

// A queued ticket has no run object behind it yet — no phase, no gates, no
// window, no elapsed time — so this renders exactly one line: queue
// position, ticket id, (if the on-disk ticket cache has it) the title, and
// (CON-39) the batch's speed/agent-merge setting. Fabricating a second line
// (a frozen progress bar, an empty status line) would be exactly the "absent
// data renders as healthy data" failure mode this project treats as a
// correctness bug (design.md Decision 2). Must always emit exactly 1 line,
// matching the `linesPerRow: 1` set on the QUEUED section entry —
// sectionHeight() and this function must stay in lockstep on how many lines
// a queued row costs.
//
// `opts.focused` (CON-39, design.md Decision 1) draws a marker distinct from
// the ordinary run-selection `▸` — QUEUED rows are never part of that flat
// index space, so reusing `▸` here would misleadingly suggest they are.
// `opts.speed`/`opts.agentMerge` are the batch-level values parsed ONCE by
// the caller (renderFleet) from `queueState.launchCommand`, not re-derived
// per row — every row in one QUEUED section shares the same batch, so the
// same values are simply threaded through unchanged. `agentMerge: null`
// (a launchCommand with no {{TICKET}} placeholder at all) omits that field
// rather than showing a fabricated on/off value; `speed` is never null (see
// launchplan.js's parseLaunchCommand — 'default' is itself a valid, always-
// shown value, not an absence).
function renderQueuedRow(ticket, position, title, width, opts) {
  const o = opts || {};
  const marker = o.focused ? '»' : ' ';
  // CON-109, fleet-bulk-select spec: the dedicated multi-select marker (`✓`),
  // independent of (and rendered alongside) the QUEUED-local focus marker
  // just above — mirrors renderFinishedRow's own treatment exactly.
  // `o.multiSelected` is threaded from `state.multiSelect.queued`
  // (render.js's per-row call site, below).
  const multiMarker = o.multiSelected ? '✓' : ' ';
  // CON-110, design.md Decision 2: same highlight-not-filter treatment as
  // renderRun's/renderFinishedRow's own — only the matched ticket-id/title
  // token is wrapped in f.yellow.
  const query = o.searchQuery;
  const ticketRendered = search.matchesQuery(ticket, query) ? f.yellow(ticket) : ticket;
  const titleRendered = title && search.matchesQuery(title, query) ? f.yellow(title) : title;
  let label = `  ${multiMarker}${marker} ${position}. ${ticketRendered}` + (title ? '  ' + titleRendered : '');
  const meta = [];
  if (o.speed) meta.push(o.speed);
  if (o.agentMerge != null) meta.push('agent-merge ' + (o.agentMerge ? 'on' : 'off'));
  if (meta.length) label += '   ' + meta.join('  ');
  return [f.truncate(label, width)];
}

// CON-40: a QUICK START row is a ticket the operator COULD start, not a run
// and not (yet) a queued ticket — no phase, no gates, no window, no elapsed
// time, and (unlike QUEUED) no separate on-disk title lookup needed: the
// eligible list threaded through `opts.quickStartTickets` (design.md
// Decision 4) already carries full ticket objects, not bare id strings, so
// `.title`/`.priority` are read straight off the row's own argument. Mirrors
// launchpad.js's `ticketRow` priority-label convention (reusing
// `priorityLabel`, not reimplementing it) and renderQueuedRow's `focused`
// marker convention just above — but is its own function, not a call into
// either: a QUEUED row has no priority column, and ticketRow's own
// checkbox/pane-focus columns do not apply to a widget with neither
// selection checkboxes nor a second pane. Must always emit exactly 1 line,
// matching the `linesPerRow: 1` set on the QUICK START section entry —
// sectionHeight() and this function must stay in lockstep on how many lines
// a row costs, exactly as renderQueuedRow's own header comment requires of
// itself.
// `query` (CON-110, design.md Decision 2) is a plain trailing parameter, NOT
// folded onto an `opts`-shaped context object the way the other three row
// renderers' own `searchQuery` field is — this is the one row renderer with
// no `opts` parameter to thread it onto at all (unlike renderRun/
// renderFinishedRow's `opts` or renderQueuedRow's own 5th `opts` argument),
// so both of its call sites (render.js, grid.js) pass the active query
// straight through as a new final argument instead of inventing an opts
// object this function would otherwise never need.
function renderQuickStartRow(ticket, focused, width, query) {
  const marker = focused ? '»' : ' ';
  const priorityText = launchpadScreen.priorityLabel(ticket.priority);
  const priorityCol = f.padTo(priorityText != null ? priorityText : '?', 4);
  // Same highlight-not-filter treatment as the other three row renderers —
  // see renderRun's own header comment.
  const idRendered = search.matchesQuery(ticket.identifier, query) ? f.yellow(ticket.identifier) : ticket.identifier;
  const titleRendered = ticket.title && search.matchesQuery(ticket.title, query) ? f.yellow(ticket.title) : ticket.title;
  const label = `  ${marker} ${priorityCol} ${idRendered}` +
    (ticket.title ? '  ' + titleRendered : '');
  return [f.truncate(label, width)];
}

module.exports = {
  phaseFraction, renderRun, renderFinishedRow, renderQueuedRow, renderQuickStartRow,
};
