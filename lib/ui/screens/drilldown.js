'use strict';

// The drill-down screen. Pure: (run, opts) -> string. Reached from the fleet
// view by drilling into the selected run (`l` there). Per the design doc's
// "Drill-down — timeline and panels, with a role gutter" mockup: a header,
// a phase pipeline, a timeline on the left, gates and evidence on the right.
//
// The governing property carried over from the fleet and escalation screens:
// absent data must never render as healthy data. Every panel here — the
// pipeline, the timeline, the gates, the evidence — degrades on its own when
// the log has nothing for it, rather than rendering an empty section that
// looks like a populated one that happens to be empty.

const f = require('../format');
const { PHASE_ORDER } = require('./fleet');

// A run is only meaningful to kill or restart while it is still going —
// mirrors reducer.js's own terminal/non-terminal split (deriveStatus never
// reports 'done' or 'failed' for a run still in flight).
function isLive(run) {
  return run.status !== 'done' && run.status !== 'failed';
}

function hhmm(ms) {
  if (ms == null) return null;
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// duration_ms is quantised to whole seconds as of this merge (CON-7) — a
// sub-second gate is indistinguishable from a truly instantaneous one and
// reports exactly 0. Render that honestly (`0ms`) rather than rounding it up
// into a false precision the data does not have.
function fmtGateDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return ms + 'ms';
  const totalSec = ms / 1000;
  if (totalSec < 60) {
    return (Number.isInteger(totalSec) ? String(totalSec) : totalSec.toFixed(1)) + 's';
  }
  // f.dur() (built for elapsed-run display) drops the sub-minute remainder
  // once it hits minute scale, but a gate report should not lose that —
  // 1m12s and 1m52s are both "1m" to f.dur and a build that got 48s slower
  // would read as unchanged. Keep the seconds.
  const mins = Math.floor(totalSec / 60);
  const secs = Math.round(totalSec - mins * 60);
  return mins + 'm' + secs + 's';
}

// Right-aligns `right` against `left` inside `cols` visible columns,
// truncating `left` if the two would not otherwise fit. Used for the header
// rows, which are the one place this screen puts two pieces of information
// on the same line rather than stacking them.
function splitLine(left, right, cols) {
  const rightVisible = f.visibleLength(right);
  const leftBudget = Math.max(0, cols - rightVisible - 2);
  const l = f.truncate(left, leftBudget);
  const gap = Math.max(2, cols - f.visibleLength(l) - rightVisible);
  return l + ' '.repeat(gap) + right;
}

// Two side-by-side panels, each already truncated to its own column budget.
// Shorter column is padded out so the divider is a straight line.
function twoCol(leftLines, rightLines, leftWidth, rightWidth) {
  const n = Math.max(leftLines.length, rightLines.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const l = f.padTo(leftLines[i] != null ? leftLines[i] : '', leftWidth);
    const r = f.truncate(rightLines[i] != null ? rightLines[i] : '', rightWidth);
    out.push(l + ' │ ' + r);
  }
  return out;
}

// One line of human-readable meaning per event kind. Every kind the schema
// defines is covered so the timeline never has to fall back to printing raw
// JSON — but an unrecognised future kind still renders (as its own name)
// rather than being silently dropped, which would be its own small case of
// absent data reading as nothing-to-see-here.
function describeEvent(ev) {
  switch (ev.kind) {
    case 'run.start':
      return { label: 'run started', detail: ev.harness ? ev.harness + (ev.model ? ' · ' + ev.model : '') : '' };
    case 'run.end':
      return { label: 'run ended', detail: ev.status || '' };
    case 'phase.enter':
      return { label: 'phase → ' + (ev.phase || '?'), detail: ev.cycle != null ? 'cycle ' + ev.cycle : '' };
    case 'agent.spawn':
      return { label: 'spawned', detail: '' };
    case 'agent.resume':
      return { label: 'resumed', detail: ev.cycle != null ? 'cycle ' + ev.cycle : '' };
    case 'agent.return':
      return { label: 'returned', detail: ev.verdict || '' };
    case 'gate.result':
      return { label: 'gate ' + (ev.gate || '?'), detail: ev.status || '' };
    case 'verdict':
      return { label: 'verdict ' + (ev.verdict || '?'), detail: ev.ref || '' };
    case 'evidence':
      return { label: 'evidence', detail: ev.label || ev.ref || '' };
    case 'escalation.raised':
      return { label: 'escalation raised', detail: ev.question ? f.truncate(ev.question, 40) : '' };
    case 'escalation.answered':
      return { label: 'escalation answered', detail: ev.answer || '' };
    case 'escalation.timeout':
      return { label: 'escalation timed out', detail: '' };
    case 'note':
      return { label: 'note', detail: ev.msg || '' };
    default:
      return { label: ev.kind, detail: '' };
  }
}

// Only the most recent events are worth a screen's height; older ones are
// accounted for rather than silently dropped.
const MAX_TIMELINE = 14;

function timelineLines(run, width) {
  const events = run.events || [];
  if (!events.length) {
    return [f.yellow('no events recorded — this run cannot be seen into')];
  }
  const shown = events.length > MAX_TIMELINE ? events.slice(events.length - MAX_TIMELINE) : events;
  const lines = [];
  if (events.length > shown.length) {
    lines.push(f.dim('… ' + (events.length - shown.length) + ' earlier events'));
  }
  for (const ev of shown) {
    const role = ev.role || 'script';
    const colour = f.ROLE_COLOUR[role] || f.dim;
    // 12 columns fits the longest role name ('orchestrator') with no
    // truncation — a truncated role name in the one column that exists
    // specifically to identify who did what would defeat its own purpose.
    const roleCol = f.padTo(colour(role), 12);
    const time = hhmm(ev.t) || '--:--';
    const { label, detail } = describeEvent(ev);
    let line = time + '  ' + roleCol + '  ' + label;
    if (detail) line += '  ' + f.dim(detail);
    lines.push(f.truncate(line, width));
  }
  return lines;
}

function gateLine(gate, width) {
  const icon = gate.status === 'pass' ? f.green('✓') : gate.status === 'fail' ? f.red('✗') : f.dim('○');
  const durStr = fmtGateDuration(gate.durationMs);
  const nameWidth = Math.max(1, width - 2 - f.visibleLength(durStr) - 1);
  const name = f.padTo(gate.name || '?', nameWidth);
  return icon + ' ' + name + ' ' + durStr;
}

function gatesLines(run, width) {
  const gates = run.gates || [];
  if (!gates.length) {
    return [f.yellow('no gate results recorded')];
  }
  const lines = [];
  for (const g of gates) {
    lines.push(gateLine(g, width));
    // Render both fields once they exist (duration always does, first_error
    // only on a failing gate) — never invent the one that is missing.
    if (g.firstError) lines.push(f.dim('  └ ' + f.truncate(g.firstError, Math.max(0, width - 4))));
  }
  return lines;
}

function evidenceLines(run, width) {
  const items = (run.events || []).filter((ev) => ev.kind === 'evidence');
  if (!items.length) {
    return [f.yellow('no evidence recorded')];
  }
  return items.map((ev) => f.truncate('  ' + (ev.label || ev.ref || '(untitled)'), width));
}

function phasePipeline(run) {
  const idx = run.phase ? PHASE_ORDER.indexOf(run.phase) : -1;
  if (idx < 0) return null;
  return PHASE_ORDER
    .map((p, i) => {
      const marker = i < idx ? '✓' : i === idx ? '●' : '○';
      const label = i === idx ? f.yellow(p) : f.dim(p);
      return label + ' ' + marker;
    })
    .join('─ ');
}

function portsText(run) {
  const parts = [];
  if (run.devPort != null) parts.push(':' + run.devPort);
  if (run.backendPort != null) parts.push(':' + run.backendPort);
  return parts.length ? parts.join(' ') : f.dim('(no ports yet)');
}

function harnessText(run) {
  if (!run.harness && !run.model) return f.dim('(harness unknown)');
  return (run.harness || f.dim('?')) + ' · ' + (run.model || f.dim('?'));
}

function elapsedText(run) {
  if (run.endStatus) return run.endStatus + ' · ' + f.dur(run.elapsedMs);
  if (run.status === 'failed' && run.endedAt == null) return 'window exited';
  const started = hhmm(run.startedAt);
  return (started ? 'started ' + started + ' · ' : '') + f.dur(run.elapsedMs);
}

function headerLines(run, cols) {
  const name = run.changeName || f.dim('(no branch yet)');
  const phaseRight = run.telemetry === 'none'
    ? f.yellow('no telemetry')
    : (run.phase
      ? run.phase + (run.cycle != null ? ' · c' + run.cycle : '')
      : f.dim('phase unknown'));

  const row1 = splitLine(f.bold(run.ticket) + '  ' + name, phaseRight, cols);
  const row2 = splitLine(run.branch || f.dim('(no branch yet)'), harnessText(run), cols);
  const worktree = run.worktree || f.dim('(no worktree yet)');
  const row3 = splitLine(worktree + '   ' + portsText(run), elapsedText(run), cols);

  return [row1, row2, row3];
}

function renderDrillDown(run, opts) {
  const cols = Math.max(50, (opts && opts.cols) || 80);
  const confirm = (opts && opts.confirm) || null;
  const notice = (opts && opts.notice) || null;

  // The run vanished between opening this screen and drawing it (the run's
  // log/window disappeared entirely) — render safely rather than throw.
  if (!run) {
    return [f.bold('concertino'), '', f.dim('  run no longer available'), '',
      f.dim('  esc back')].join('\n');
  }

  const out = [];
  for (const line of headerLines(run, cols)) out.push(line);
  out.push('');

  const pipeline = phasePipeline(run);
  if (pipeline) {
    out.push(f.truncate(pipeline, cols));
  } else {
    out.push(f.dim(run.telemetry === 'none'
      ? 'no telemetry — phase pipeline unavailable'
      : 'no phase.enter events recorded — phase pipeline unavailable'));
  }
  out.push('');

  const sepWidth = 3;
  const leftWidth = Math.max(24, Math.floor((cols - sepWidth) * 0.55));
  const rightWidth = Math.max(18, cols - sepWidth - leftWidth);

  const left = ['TIMELINE', ...timelineLines(run, leftWidth)];
  const right = [
    'GATES' + (run.cycle != null ? ' · cycle ' + run.cycle : ''),
    ...gatesLines(run, rightWidth),
    '',
    'EVIDENCE',
    ...evidenceLines(run, rightWidth),
  ];
  for (const line of twoCol(left, right, leftWidth, rightWidth)) out.push(line);
  out.push('');

  if (notice) {
    out.push('  ' + f.red(f.truncate(notice, cols - 4)));
    out.push('');
  }

  const live = isLive(run);
  if (confirm) {
    const verb = confirm === 'kill' ? 'kill' : 'restart';
    const warning = confirm === 'kill'
      ? 'ends the agent mid-run — it cannot resume'
      : 'kills the current run mid-progress and starts over — it cannot resume the old one';
    out.push('  ' + f.red(f.bold(verb + ' ' + run.ticket + '?') + ' ' + warning));
    out.push(f.dim('  y confirm   (any other key) cancel'));
  } else {
    const hints = ['↵ attach'];
    if (live) hints.push('k kill', 'r restart');
    hints.push('esc back');
    out.push(f.dim('  ' + hints.join('   ')));
  }

  return out.map((l) => f.truncate(l, cols)).join('\n');
}

// Given a keypress and the local screen state ({ run, confirm }), returns an
// action for watch.js to carry out, or null for "no-op, no redraw". Never
// mutates, same seam as escalation.js.
function handleKey(key, state) {
  const run = state && state.run;
  const confirm = state && state.confirm;

  if (!run) {
    if (key === '\x1b') return { type: 'back' };
    return null;
  }

  // A destructive action needs a deliberate 'y'; anything else — including
  // esc — backs out of the confirmation without acting, so there is no key
  // that both cancels AND does something else by accident.
  if (confirm) {
    if (key === 'y') {
      return { type: confirm === 'kill' ? 'kill-confirmed' : 'restart-confirmed', ticket: run.ticket };
    }
    return { type: 'cancel-confirm' };
  }

  if (key === '\x1b') return { type: 'back' };
  if (key === '\r') return { type: 'attach', ticket: run.ticket };

  // Refused in the two places the escalation screen refuses a stale one: the
  // footer above omits the hint for a finished run, and here the key itself
  // does nothing — not merely undocumented, actually inert.
  if (isLive(run)) {
    if (key === 'k') return { type: 'confirm-action', action: 'kill' };
    if (key === 'r') return { type: 'confirm-action', action: 'restart' };
  }

  return null;
}

// Uniform router seam: state.runs is the full fleet, state.drillTicket picks
// the one run this screen cares about, so it always reflects the latest poll
// rather than a snapshot taken when the screen was opened.
function render(state, opts) {
  const run = (state.runs || []).find((r) => r.ticket === state.drillTicket) || null;
  return renderDrillDown(run, Object.assign({}, opts, {
    confirm: state.drillConfirm,
    notice: state.drillNotice,
  }));
}

function routeHandleKey(key, state) {
  const run = (state.runs || []).find((r) => r.ticket === state.drillTicket) || null;
  return handleKey(key, { run, confirm: state.drillConfirm });
}

module.exports = {
  renderDrillDown, handleKey, render, routeHandleKey,
  isLive, fmtGateDuration, describeEvent, phasePipeline,
};
