'use strict';

// The fleet screen. Pure: (runs, opts) -> string. Attention is the sort key,
// so whatever is blocking you is always at the top and can never scroll away.

const f = require('../format');
const layout = require('../layout');
// The canonical phase list is owned by reducer.js (next to its other
// telemetry vocabularies, TIER2_KINDS/TIER3_KINDS) — re-exported here under
// the same name so drilldown.js and existing tests that import it from this
// module do not need to change their import path.
const { PHASE_ORDER } = require('../reducer');

// Every content row a section box draws costs 2 columns to the border
// characters (one on each side) and 2 more to `box()`'s default horizontal
// padding — see design.md Decision 1/3. Sized once here so both the box
// call and the content-generation width agree with each other exactly.
const BOX_BORDER_PADDING_COLS = 4;

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

// A queued ticket has no run object behind it yet — no phase, no gates, no
// window, no elapsed time — so this renders exactly one line: queue
// position, ticket id, and (if the on-disk ticket cache has it) the title.
// Fabricating a second line (a frozen progress bar, an empty status line)
// would be exactly the "absent data renders as healthy data" failure mode
// this project treats as a correctness bug (design.md Decision 2). Must
// always emit exactly 1 line, matching the `linesPerRow: 1` set on the
// QUEUED section entry — sectionHeight() and this function must stay in
// lockstep on how many lines a queued row costs.
function renderQueuedRow(ticket, position, title, width) {
  const label = `  ${position}. ${ticket}` + (title ? '  ' + title : '');
  return [f.truncate(label, width)];
}

function renderFleet(runs, opts) {
  const cols = Math.max(40, (opts && opts.cols) || 80);
  const rows = (opts && opts.rows) || 0;         // 0 = unbounded (tests, pipes)
  const selected = (opts && opts.selected) || 0;
  // Prompt state is passed IN, never held here: the screen stays a pure
  // (runs, opts) -> string, and everything that remembers a keystroke lives in
  // watch.js. `null`/absent means the plain fleet view.
  const prompt = (opts && opts.prompt) || null;
  const queueNotice = (opts && opts.queueNotice) || null;
  const queueState = (opts && opts.queueState) || null;
  // A ticket-id -> title lookup built by watch.js's draw() from the on-disk
  // ticket cache (design.md Decision 3). Read directly by the QUEUED-only
  // branch of the per-row render loop below (design.md Decision 5) — closed
  // over here rather than threaded per-call, exactly like queueState/selected.
  const queuedTitles = (opts && opts.queuedTitles) || null;
  const quitConfirm = (opts && opts.quitConfirm) || false;
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
  // An active batch is otherwise invisible once you leave the launch pad: the
  // queue itself is in-memory only (see watch.js's own comment on why that is
  // an accepted trade-off) but its PRESENCE must never be — launching a
  // five-ticket sequential batch and returning to the fleet must still show
  // that four more are queued, persistently, for as long as the queue is
  // active (not just on a failure — that is queueNotice, right below).
  if (queueState) {
    const inFlightCount = queueState.inFlight ? queueState.inFlight.size : 0;
    const pendingCount = queueState.pending ? queueState.pending.length : 0;
    if (inFlightCount || pendingCount) {
      tail.push('  ' + f.dim(`▲ queue: ${inFlightCount} running · ${pendingCount} queued`));
    }
  }
  // A queued batch launch that failed to spawn (see queue.js — a slot frees
  // itself naturally next tick since there is no run to track) is otherwise
  // invisible: nothing else on the fleet view watches the launch-pad queue.
  if (queueNotice) tail.push('  ' + f.red(f.truncate(queueNotice, cols - 4)));
  // Advertise only what this slice actually binds. `k` is selection-up here, so
  // labelling it "kill" would be worse than omitting it — kill and restart
  // arrive with the control plane in slice 2. `n` is listed only in fleet mode:
  // while the prompt is open it does nothing but type an "n".
  if (quitConfirm) {
    // A deliberate quit with tickets still queued would otherwise silently
    // discard the un-started tail — same "ask before destroying" property as
    // kill/restart on the drill-down (see drilldown.js's own 'y' gate). Any
    // key other than a repeated q/Ctrl-C cancels rather than acting on
    // whatever it would otherwise have meant, so the warning never lingers
    // looking like a live, ordinary screen.
    const inFlightCount = queueState && queueState.inFlight ? queueState.inFlight.size : 0;
    const pendingCount = queueState && queueState.pending ? queueState.pending.length : 0;
    const remaining = inFlightCount + pendingCount;
    tail.push('  ' + f.yellow(`▲ quit with ${remaining} ticket${remaining === 1 ? '' : 's'} still queued/running?`));
    tail.push(f.dim('  q confirm quit   (any other key) cancel'));
  } else if (prompt) {
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
    tail.push(f.dim('  ↵ attach   l details   j/k move   n new run   N launch pad   q quit'));
  }

  // Section order is the reducer's own sort order, so the Nth rendered row is
  // runs[N] — which is the index watch.js attaches to. FAILED before DONE both
  // matches that order and puts the thing you might have to act on higher.
  // `statusKey` reads the section's colour from the shared STATUS_COLOUR
  // table (design.md Decision 4) instead of each section picking its own
  // f.yellow/f.dim/f.red ad hoc — "yellow means needs-attention" and "red
  // means failed" now hold on every screen, not just this one.
  //
  // Every entry sets `linesPerRow` explicitly (design.md Decision 2) so no
  // section's height cost depends on an unstated default: 2 for a run row
  // (ticket line + bar/status line), 1 for QUEUED's single-line row.
  const sections = [
    { title: 'NEEDS YOU', group: needsYou, statusKey: 'needs-you', cap: Infinity, pinned: true, linesPerRow: 2 },
    { title: 'RUNNING',   group: active,   statusKey: 'running',   cap: Infinity, linesPerRow: 2 },
  ];
  // QUEUED has no run object behind any of its rows — see renderQueuedRow's
  // own header comment — so it must never consume a slot in the row-index
  // space `watch.js`'s `runs[selected]` relies on. `unselectable: true` is
  // the one flag that both keeps it out of that index space (the render loop
  // below) and routes its rows to renderQueuedRow instead of renderRun
  // (design.md Decisions 1 and 5) — set only here, defaulting falsy (index-
  // consuming) on every other section, matching today's behaviour.
  // Positioned after RUNNING, before FAILED: pending, not finished, but not
  // yet actionable either (nothing to attach to).
  if (queueState && queueState.pending && queueState.pending.length) {
    sections.push({
      title: `QUEUED (${queueState.pending.length}, running ${queueState.maxConcurrent} at a time)`,
      group: queueState.pending,
      statusKey: 'queued',
      cap: MAX_FINISHED,
      unselectable: true,
      linesPerRow: 1,
    });
  }
  sections.push(
    { title: 'FAILED', group: failed, statusKey: 'failed', cap: MAX_FINISHED, linesPerRow: 2 },
    { title: 'DONE',   group: done,   statusKey: 'done',   cap: MAX_FINISHED, linesPerRow: 2 },
  );
  const shown = sections.map((s) => Math.min(s.group.length, s.cap));

  // Each row costs `linesPerRow` lines; a section showing at least one row
  // also costs a title and a trailing blank, plus one more for its "… and N
  // more" line when capped. A section trimmed all the way to zero collapses
  // to that one line and nothing else: a title over no rows and a blank
  // after it are three rows carrying no information, and counting them gave
  // the trim loop a floor of 3-per-section it could never get below. With
  // four sections that floor was taller than a short terminal, so the cap
  // silently stopped capping. `linesPerRow` is section-dependent, not a
  // global constant (design.md Decision 2) — it and the row-generation loop
  // below (task 2.2) MUST stay in lockstep on how many lines a section's row
  // actually costs.
  const sectionHeight = (s, i) => {
    if (!s.group.length) return 0;
    if (shown[i] === 0) return 1;
    return 2 + s.linesPerRow * shown[i] + (s.group.length > shown[i] ? 1 : 0);
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

    // Fully collapsed: one line, no title and no trailing blank, no border —
    // there is nothing to put a frame around (design.md Decision 3, "a fully-
    // collapsed fleet section stays a single unbordered line"). Must stay in
    // lockstep with sectionHeight() above.
    if (shown[i] === 0) {
      out.push('      ' + f.dim(`… and ${hidden} more ${s.title.toLowerCase()}`));
      // Unselectable sections (QUEUED) never consume an index slot, whether
      // their rows are shown or hidden under the cap — design.md Decision 1.
      if (!s.unselectable) index += hidden;
      return;
    }

    // Content is generated against the box's own inner width, not the full
    // section width — otherwise a run row sized to `cols` would overflow the
    // box by exactly the border+padding overhead once framed.
    const innerCols = Math.max(0, cols - BOX_BORDER_PADDING_COLS);
    const contentLines = [];
    for (let k = 0; k < shown[i]; k++) {
      if (s.unselectable) {
        // QUEUED rows have no run object and are never selectable — call the
        // 1-line renderer (per linesPerRow: 1) with the ticket's 1-based
        // queue position and its cached title, if any (design.md Decision 5).
        // `index` is untouched: this is the one and only place the shared
        // index counter is advanced, and it is skipped entirely here.
        const ticket = s.group[k];
        const title = queuedTitles ? queuedTitles.get(ticket) : null;
        for (const line of renderQueuedRow(ticket, k + 1, title, innerCols)) contentLines.push(line);
      } else {
        for (const line of renderRun(s.group[k], { cols: innerCols }, index === selected)) contentLines.push(line);
        index++;
      }
    }
    if (hidden) contentLines.push('      ' + f.dim(`… and ${hidden} more`));
    if (!s.unselectable) index += hidden;   // keep row indices aligned with the runs array

    const colourTitle = f.STATUS_COLOUR[s.statusKey] || ((x) => x);
    const boxHeight = contentLines.length + 2;

    // Below layout.degrade()'s threshold, render exactly as this screen did
    // before this change (no frame) rather than drawing a border that would
    // itself have to be truncated into illegibility — design.md Decision 3's
    // degradation order. Per that same decision, the row COUNT is identical
    // either way (2 + 2*shown + moreFlag), so sectionHeight()/height()/budget
    // above never need to know which path a section actually took.
    if (layout.degrade(cols, boxHeight)) {
      out.push('  ' + colourTitle(s.title));
      for (const line of contentLines) out.push(line);
      out.push('');
    } else {
      // All four sections use the plain (unfocused) border set — the fleet
      // has one flat selection list and no second pane to contrast a
      // "focused" style against (design.md Decision 2).
      for (const line of layout.box(contentLines, { width: cols, title: colourTitle(s.title), focused: false })) {
        out.push(line);
      }
    }
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
  const quitConfirm = state && state.quitConfirm;

  // The quit-confirmation warning intercepts every key while it is up: a
  // repeated q/Ctrl-C confirms, anything else cancels back to the ordinary
  // fleet view rather than being interpreted as its usual action (moving
  // selection, attaching, ...) underneath a warning that is about to vanish.
  if (quitConfirm) {
    if (key === 'q' || key === '\u0003') return { type: 'quit' };
    return { type: 'cancel-quit' };
  }

  if (prompt) return promptKey(key, prompt);

  if (key === 'n') return { type: 'open-prompt' };
  // Capital N, deliberately distinct from lowercase n (single-ticket quick
  // launch, already bound). Always bound — even when the feature gate is
  // off — so pressing it explains WHY rather than doing nothing; see
  // launchpad.js's own rendering of linear.js's launchPadStatus reasons.
  // This is also the ONLY new entry point this slice adds: unlike attach (↵),
  // drill-down (l) and the escalation answer screen (↵), which together were
  // flagged as accretion worth watching, the launch pad is reachable from
  // exactly one place — the fleet view — on exactly one key.
  if (key === 'N') return { type: 'open-launchpad' };
  if (key === 'q' || key === '\u0003') {                                 // q / Ctrl-C
    // A queue with anything still pending or in flight would otherwise be
    // silently abandoned by an immediate quit — not just on a crash, on a
    // deliberate `q` too. Ask first; `request-quit` puts the warning up
    // (rendered above, in renderFleet) rather than tearing the screen down
    // right away.
    const qs = state && state.queueState;
    const remaining = qs ? (qs.pending.length + (qs.inFlight ? qs.inFlight.size : 0)) : 0;
    if (remaining > 0) return { type: 'request-quit' };
    return { type: 'quit' };
  }
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
    queueNotice: state.queueNotice,
    queueState: state.queueState,
    // Built by watch.js's draw() from the on-disk ticket cache and passed in
    // as a plain opt alongside queueState (design.md Decisions 3 and 5) —
    // forwarded explicitly here for the same reason queueState is, even
    // though it already arrives on `opts` unchanged.
    queuedTitles: opts && opts.queuedTitles,
    quitConfirm: state.quitConfirm,
  }));
}

module.exports = { renderFleet, phaseFraction, handleKey, render, routeHandleKey: handleKey, PHASE_ORDER };
