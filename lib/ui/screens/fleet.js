'use strict';

// The fleet screen. Pure: (runs, opts) -> string. Attention is the sort key,
// so whatever is blocking you is always at the top and can never scroll away.

const f = require('../format');

const PHASE_ORDER = ['Setup', 'Planning', 'Execution', 'Evaluation', 'Delivery', 'Cleanup'];

function phaseFraction(run) {
  if (!run.phase) return 0;
  const i = PHASE_ORDER.indexOf(run.phase);
  return i < 0 ? 0 : (i + 1) / PHASE_ORDER.length;
}

// The second line of a run: what it is doing, and how confident we are that we
// know. A run we cannot see into must look different from a healthy one.
function statusLine(run, width) {
  const parts = [];

  if (run.telemetry === 'none') {
    parts.push('no telemetry');
  } else if (!run.phase) {
    parts.push('phase unknown');
  } else {
    parts.push(f.padTo(run.phase, 11));
    if (run.cycle != null) parts.push('cycle ' + run.cycle);
  }

  if (run.gates.length) {
    const passed = run.gates.filter((g) => g.status === 'pass').length;
    parts.push('gates ' + passed + '/' + run.gates.length);
  }

  if (run.window && run.window.idleMs != null && run.window.idleMs >= 60000) {
    parts.push('idle ' + f.dur(run.window.idleMs));
  }

  parts.push(f.dur(run.elapsedMs));
  return f.truncate(parts.join('   '), width);
}

function renderRun(run, opts, selected) {
  const lines = [];
  const marker = selected ? '▸' : ' ';
  const name = run.changeName || f.dim('(no branch yet)');
  lines.push(`  ${marker} ${f.padTo(run.ticket, 9)} ${f.truncate(name, opts.cols - 16)}`);

  if (run.escalation) {
    const stale = run.escalationStale ? ' [stale]' : '';
    const keys = run.escalation.options.length
      ? '   ' + run.escalation.options.map((o) => `[${o[0]}]${o.slice(1)}`).join('  ')
      : '';
    lines.push('      ' + f.yellow(f.truncate(run.escalation.question + stale + keys, opts.cols - 8)));
  } else {
    const b = f.dim(f.bar(phaseFraction(run), 20));
    lines.push('      ' + b + '  ' + statusLine(run, Math.max(0, opts.cols - 30)));
  }

  return lines;
}

function renderFleet(runs, opts) {
  const cols = Math.max(40, (opts && opts.cols) || 80);
  const selected = (opts && opts.selected) || 0;
  const project = (runs[0] && runs[0].project) || '';

  const needsYou = runs.filter((r) => r.status === 'needs-you');
  const active   = runs.filter((r) => r.status === 'running' || r.status === 'unknown');
  const finished = runs.filter((r) => r.status === 'done' || r.status === 'failed');

  const out = [];
  const countLabel = `${runs.length} run${runs.length === 1 ? '' : 's'}` +
    (needsYou.length ? ` · ${needsYou.length} needs you` : '');
  out.push(f.bold('concertino') + f.dim(' · ' + project) + '  ' +
    f.dim(countLabel));
  out.push('');

  if (!runs.length) {
    out.push(f.dim('  no active runs — press n to start one'));
  }

  let index = 0;
  const section = (title, group, colour) => {
    if (!group.length) return;
    out.push('  ' + colour(title));
    for (const run of group) {
      for (const line of renderRun(run, { cols }, index === selected)) out.push(line);
      index++;
    }
    out.push('');
  };

  section('NEEDS YOU', needsYou, f.yellow);
  section('RUNNING', active, f.dim);
  section('DONE', finished, f.dim);

  const malformed = runs.reduce((n, r) => n + (r.malformed || 0), 0);
  if (malformed) out.push('  ' + f.yellow(`▲ ${malformed} malformed events`));

  // Advertise only what this slice actually binds. `k` is selection-up here, so
  // labelling it "kill" would be worse than omitting it — new run, kill and
  // restart all arrive with the control plane in slice 2.
  out.push(f.dim('  ↵ attach   j/k move   q quit'));

  return out.map((l) => (f.visibleLength(l) > cols ? f.truncate(l, cols) : l)).join('\n');
}

module.exports = { renderFleet, phaseFraction };
