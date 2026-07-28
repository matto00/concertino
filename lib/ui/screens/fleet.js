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
  // Prompt state is passed IN, never held here: the screen stays a pure
  // (runs, opts) -> string, and everything that remembers a keystroke lives in
  // watch.js. `null`/absent means the plain fleet view.
  const prompt = (opts && opts.prompt) || null;
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
  // labelling it "kill" would be worse than omitting it — kill and restart
  // arrive with the control plane in slice 2. `n` is listed only in fleet mode:
  // while the prompt is open it does nothing but type an "n".
  if (prompt) {
    tail.push('  ' + f.bold('new run') + f.dim(' › ') +
      f.truncate(prompt.value || '', Math.max(0, cols - 14)) + '▏');
    if (prompt.error) tail.push('  ' + f.red(f.truncate(prompt.error, Math.max(0, cols - 4))));
    tail.push(f.dim('  ↵ start   esc cancel'));
  } else {
    // Kill/restart are NOT bound here even though the final design's footer
    // shows them on the fleet: `k` already means "move selection up" (see the
    // comment on the malformed-events line above), so binding it to kill on
    // this screen would be the exact defect this project treats as a wall —
    // a footer hint whose key does something else. They live on the
    // drill-down instead, where `k`/`r` are unclaimed. `l` opens it.
    tail.push(f.dim('  ↵ attach   l details   j/k move   n new run   q quit'));
  }

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

  // Each run is two lines; a section showing at least one run also costs a
  // title and a trailing blank, plus one more for its "… and N more" line when
  // capped. A section trimmed all the way to zero collapses to that one line
  // and nothing else: a title over no rows and a blank after it are three rows
  // carrying no information, and counting them gave the trim loop a floor of
  // 3-per-section it could never get below. With four sections that floor was
  // taller than a short terminal, so the cap silently stopped capping.
  const sectionHeight = (s, i) => {
    if (!s.group.length) return 0;
    if (shown[i] === 0) return 1;
    return 2 + 2 * shown[i] + (s.group.length > shown[i] ? 1 : 0);
  };
  const height = () => head.length + tail.length +
    sections.reduce((h, s, i) => h + sectionHeight(s, i), 0);

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
    const hidden = s.group.length - shown[i];

    // Fully collapsed: one line, no title and no trailing blank. Must stay in
    // lockstep with sectionHeight() above.
    if (shown[i] === 0) {
      out.push('      ' + f.dim(`… and ${hidden} more ${s.title.toLowerCase()}`));
      index += hidden;
      return;
    }

    out.push('  ' + s.colour(s.title));
    for (let k = 0; k < shown[i]; k++) {
      for (const line of renderRun(s.group[k], { cols }, index === selected)) out.push(line);
      index++;
    }
    if (hidden) out.push('      ' + f.dim(`… and ${hidden} more`));
    index += hidden;   // keep row indices aligned with the runs array
    out.push('');
  });

  for (const line of tail) out.push(line);

  return out.map((l) => (f.visibleLength(l) > cols ? f.truncate(l, cols) : l)).join('\n');
}

// --- key handling ------------------------------------------------------
// Pure: (key, state) -> action | null. watch.js owns selected/prompt/mode and
// interprets the action; this function never touches them directly, which is
// what lets it be unit tested without a tty and keeps the "screens stay pure"
// property true of the seam the router adds, not just of render().

function promptKey(key, prompt) {
  // Arrow keys and friends are multi-byte escape sequences: ignore them
  // outright. Only a BARE escape cancels, or every up-arrow would close the
  // prompt and leave `[A` behind.
  if (key.length > 1) return null;
  if (key === '\x1b' || key === '') return { type: 'cancel-prompt' };   // Escape / Ctrl-C
  if (key === '\x7f' || key === '\b') return { type: 'prompt-backspace' };
  if (key === '\r' || key === '\n') {
    const value = (prompt.value || '').trim();
    if (!value) return { type: 'cancel-prompt' };        // empty submit = cancel
    return { type: 'submit-prompt', value };
  }
  if (key >= ' ') return { type: 'prompt-type', char: key };
  return null;
}

function handleKey(key, state) {
  const runs = (state && state.runs) || [];
  const selected = (state && state.selected) || 0;
  const prompt = state && state.prompt;

  if (prompt) return promptKey(key, prompt);

  if (key === 'n') return { type: 'open-prompt' };
  if (key === 'q' || key === '\u0003') return { type: 'quit' };          // q / Ctrl-C
  // Arrow keys arrive as a three-byte escape sequence in raw mode.
  if (key === 'j' || key === '\x1b[B') return { type: 'move', delta: 1 };
  if (key === 'k' || key === '\x1b[A') return { type: 'move', delta: -1 };
  if (key === '\r' && runs[selected]) {
    const run = runs[selected];
    // A live escalation routes to the answer screen instead of straight to
    // tmux — that is the whole point of the control plane. A stale one, or no
    // escalation at all, attaches exactly as before.
    if (run.escalation && !run.escalationStale) {
      return { type: 'open-escalation', ticket: run.ticket };
    }
    return { type: 'attach', ticket: run.ticket };
  }
  // `l` (and its arrow-key alias, matching the existing j/k aliasing below)
  // drills into the selected run — the timeline, gates and evidence panels a
  // one-line fleet row has no room for.
  if ((key === 'l' || key === '\x1b[C') && runs[selected]) {
    return { type: 'open-drilldown', ticket: runs[selected].ticket };
  }
  return null;
}

// Uniform router seam: every screen exposes render(state, opts) so the router
// never needs to know a screen's own shape. Kept separate from `renderFleet`
// so existing callers (tests, in particular) keep working against the plain
// (runs, opts) -> string function unchanged.
function render(state, opts) {
  return renderFleet(state.runs, Object.assign({}, opts, {
    selected: state.selected,
    prompt: state.prompt,
  }));
}

module.exports = { renderFleet, phaseFraction, handleKey, render, routeHandleKey: handleKey, PHASE_ORDER };
