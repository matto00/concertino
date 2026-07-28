'use strict';

// The fleet screen. Pure: (runs, opts) -> string. Attention is the sort key,
// so whatever is blocking you is always at the top and can never scroll away.

const f = require('../format');

const PHASE_ORDER = ['Setup', 'Planning', 'Execution', 'Evaluation', 'Delivery', 'Cleanup'];

// `.concertino/runs/` is never pruned — cleanup.sh deliberately keeps the log so
// a run's history outlives its worktree. So the finished groups are unbounded
// history, and rendering all of it scrolls the header and NEEDS YOU off the TOP
// of the terminal. Cap them here rather than in the store: the store returning
// full history is correct, and the drill-down will want it.
const MAX_FINISHED = 5;

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
    if (!run.endStatus) parts.push('window exited');
  } else {
    parts.push(f.dur(run.elapsedMs));
  }

  return f.truncate(parts.join('   '), width);
}

function renderRun(run, opts, selected) {
  const lines = [];
  const marker = selected ? '▸' : ' ';
  const name = run.changeName || f.dim('(no branch yet)');
  lines.push(`  ${marker} ${f.padTo(run.ticket, 9)} ${f.truncate(name, opts.cols - 16)}`);

  if (run.escalation) {
    const stale = run.escalationStale ? ' [stale]' : '';
    // Plain, not the `[a]pprove` keybinding idiom: nothing binds those keys
    // until the control plane lands, and advertising a key that does nothing is
    // how a human learns to distrust the whole screen.
    const keys = run.escalation.options.length
      ? '   ' + run.escalation.options.join(' / ')
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
  const rows = (opts && opts.rows) || 0;         // 0 = unbounded (tests, pipes)
  const selected = (opts && opts.selected) || 0;
  const project = (runs[0] && runs[0].project) || '';

  const needsYou = runs.filter((r) => r.status === 'needs-you');
  const active   = runs.filter((r) => r.status === 'running' || r.status === 'unknown');
  const failed   = runs.filter((r) => r.status === 'failed');
  const done     = runs.filter((r) => r.status === 'done');

  const countLabel = `${runs.length} run${runs.length === 1 ? '' : 's'}` +
    (needsYou.length ? ` · ${needsYou.length} needs you` : '');
  const head = [
    f.bold('concertino') + f.dim(' · ' + project) + '  ' + f.dim(countLabel),
    '',
  ];
  if (!runs.length) head.push(f.dim('  no active runs'));

  const tail = [];
  const malformed = runs.reduce((n, r) => n + (r.malformed || 0), 0);
  if (malformed) tail.push('  ' + f.yellow(`▲ ${malformed} malformed events`));
  // Advertise only what this slice actually binds. `k` is selection-up here, so
  // labelling it "kill" would be worse than omitting it — new run, kill and
  // restart all arrive with the control plane in slice 2.
  tail.push(f.dim('  ↵ attach   j/k move   q quit'));

  // Section order is the reducer's own sort order, so the Nth rendered row is
  // runs[N] — which is the index watch.js attaches to. FAILED before DONE both
  // matches that order and puts the thing you might have to act on higher.
  const sections = [
    { title: 'NEEDS YOU', group: needsYou, colour: f.yellow, cap: Infinity, pinned: true },
    { title: 'RUNNING',   group: active,   colour: f.dim,    cap: Infinity },
    { title: 'FAILED',    group: failed,   colour: f.red,    cap: MAX_FINISHED },
    { title: 'DONE',      group: done,     colour: f.dim,    cap: MAX_FINISHED },
  ];
  const shown = sections.map((s) => Math.min(s.group.length, s.cap));

  // Each run is two lines; a non-empty section also costs a title and a
  // trailing blank, plus one more for its "… and N more" line when capped.
  const height = () => head.length + tail.length + sections.reduce(
    (h, s, i) => h + (s.group.length
      ? 2 + 2 * shown[i] + (s.group.length > shown[i] ? 1 : 0)
      : 0), 0);

  // One row is reserved for the newline the writer appends: filling the last
  // terminal row and then emitting \n scrolls the screen by one, which is the
  // very thing the cap exists to prevent.
  const budget = rows > 0 ? rows - 1 : 0;
  if (budget > 0) {
    for (let i = sections.length - 1; i >= 0 && height() > budget; i--) {
      // NEEDS YOU is never trimmed. If it alone overflows the terminal we lose
      // the header, which is the right thing to lose.
      if (sections[i].pinned) continue;
      while (shown[i] > 0 && height() > budget) shown[i]--;
    }
  }

  const out = head.slice();
  let index = 0;
  sections.forEach((s, i) => {
    if (!s.group.length) return;
    out.push('  ' + s.colour(s.title));
    for (let k = 0; k < shown[i]; k++) {
      for (const line of renderRun(s.group[k], { cols }, index === selected)) out.push(line);
      index++;
    }
    const hidden = s.group.length - shown[i];
    if (hidden) out.push('      ' + f.dim(`… and ${hidden} more`));
    index += hidden;   // keep row indices aligned with the runs array
    out.push('');
  });

  for (const line of tail) out.push(line);

  return out.map((l) => (f.visibleLength(l) > cols ? f.truncate(l, cols) : l)).join('\n');
}

module.exports = { renderFleet, phaseFraction };
