'use strict';

// The fleet screen. Pure: (runs, opts) -> string. Attention is the sort key,
// so whatever is blocking you is always at the top and can never scroll away.

const f = require('../format');
const layout = require('../layout');
const textwrap = require('../textwrap');
// CON-39: parseLaunchCommand is the one shared implementation of "read the
// speed/agent-merge token(s) back out of a launchCommand string" — see its
// own header comment in launchplan.js for why this is not a second regex
// duplicated here.
const launchplan = require('./launchplan');
// CON-40: launchpad.js's own priorityLabel/priorityRank/sortByPriority/
// isSelectable are the QUICK START widget's single source of truth for
// "what's next" and "is it already spoken for" — reused as-is here, never
// reimplemented (proposal.md's own framing: "a shortcut UI in front of
// existing plumbing, not new plumbing"). No require cycle: launchpad.js
// requires only ../cache, ../format, ../layout, ../ticketDetail — never
// this module.
const launchpadScreen = require('./launchpad');
const icons = require('../icons');
// CON-21, design.md Decision 4: the `n` prompt's ticket-shape branch reuses
// `parseTicketInput` (built on the single `looksLikeTicket` predicate) —
// NOT a second, bare `looksLikeTicket(value)` call, which would misroute
// "CON-21 fast"/"CON-21 --agent-merge" (whole-string match, no whitespace
// tolerance) even though those are exactly how `n` launches today.
const { parseTicketInput } = require('../prompt');
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

// fleet-metrics-grid design: the two-column layout only engages at this
// width; below it, renderFleet is the single-column stack, unchanged.
// Exported so watch.js's scroll logic can use the exact same threshold —
// two implementations of "is this wide enough for grid mode" that could
// ever disagree is exactly the risk design.md's own precedent (e.g.
// buildHeadTail being the ONE head/tail-row-count implementation both the
// renderer and the height budget call) warns against.
const GRID_MIN_COLS = 110;
// Final whole-branch review, Finding 1: the height component of the
// grid-mode gate, alongside GRID_MIN_COLS' width component — METRICS'
// compact tier (metricsColumnLines) is a fixed 5 content lines + 2-row
// border, and renderFleetGrid's `layout.box` call silently drops content
// beyond that floor with no signal, so grid mode is only viable when the
// column area has at least this many rows. Exported (alongside
// gridModeEligible, below) so watch.js's scroll-accounting call sites —
// which must pick the exact same windowing function (visibleWindowGrid vs
// visibleWindow) the renderer will use THIS frame — apply the identical
// gate renderFleet does, not just its own width check.
const GRID_MIN_COLUMN_AREA_HEIGHT = 7;
// Column 1's fixed width in grid mode, regardless of total terminal width
// — see the design doc's "Sizing thresholds" section for why this is a
// constant rather than a proportional split.
const COLUMN_ONE_WIDTH = 70;

// `.concertino/runs/` is never pruned — cleanup.sh deliberately keeps the log so
// a run's history outlives its worktree. So the finished groups are unbounded
// history, and rendering all of it scrolls the header and NEEDS YOU off the TOP
// of the terminal. Cap them here rather than in the store: the store returning
// full history is correct, and the drill-down will want it.
const MAX_FINISHED = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

// A display-order HINT only (NOT a filter/allowlist) for the METRICS gates
// line, below — the 4 phase gates core/scripts/assert-phase.sh's own PHASE
// argument actually emits (setup/servers/delivery/cleanup — that script's
// own vocabulary, a completely different one from reducer.js's PHASE_ORDER,
// which is the 6-stage Setup/Planning/Execution/Evaluation/Delivery/Cleanup
// vocabulary for phase.enter EVENTS) plus the 2 server gates
// core/scripts/start-servers.sh emits. metricsFor's gateRates (below) is the
// actual source of truth for WHICH gate names render — it derives its key
// set from whatever names actually appear across `runs`, not from this
// list — so a gate name introduced later that isn't in this list still
// renders (just alphabetically after the known ones, via the sort in
// buildSections' gates-line construction) rather than being silently
// dropped the way a filter/allowlist would drop it.
const GATE_NAME_ORDER = ['phase:setup', 'phase:servers', 'phase:delivery', 'phase:cleanup', 'server:backend', 'server:frontend'];

// Fleet-wide roll-up for the METRICS panel — a pure function of `runs` and
// `now`, reusing the exact avg-delivery-time computation renderFleet already
// does inline for the DONE-row arrows (folded in here as the one shared
// implementation rather than kept as two). "Today" is a UTC calendar-day
// boundary; "this week" is a rolling 7-day window, not a calendar week —
// deterministic across timezones/DST, good enough for a glanceable summary.
function metricsFor(runs, now) {
  const list = runs || [];
  const done = list.filter((r) => r.status === 'done');
  const withElapsed = done.filter((r) => r.elapsedMs != null);
  const avgMs = withElapsed.length
    ? withElapsed.reduce((sum, r) => sum + r.elapsedMs, 0) / withElapsed.length
    : null;

  const todayStart = Math.floor(now / DAY_MS) * DAY_MS;
  const weekStart = now - 7 * DAY_MS;
  const deliveredToday = done.filter((r) => r.endedAt != null && r.endedAt >= todayStart).length;
  const deliveredWeek = done.filter((r) => r.endedAt != null && r.endedAt >= weekStart).length;

  let escalationsToday = 0;
  for (const r of list) {
    for (const ev of r.events || []) {
      if (ev.kind === 'escalation.raised' && ev.t >= todayStart) escalationsToday++;
    }
  }

  // Success rate: of every run that reached a TERMINAL state (done or
  // failed) with endedAt inside the window, what fraction were 'done' — a
  // failed run and a done run both "used up" a delivery attempt, so both
  // count toward the denominator; a run still in flight has no verdict yet
  // and is excluded (the same "endedAt != null" gate deliveredToday/
  // deliveredWeek already use).
  const terminal = list.filter((r) => (r.status === 'done' || r.status === 'failed') && r.endedAt != null);
  const rateFor = (windowStart) => {
    const inWindow = terminal.filter((r) => r.endedAt >= windowStart);
    const total = inWindow.length;
    if (!total) return { rate: null, done: 0, total: 0 };
    const doneCount = inWindow.filter((r) => r.status === 'done').length;
    return { rate: doneCount / total, done: doneCount, total };
  };
  const successRate = { today: rateFor(todayStart), week: rateFor(weekStart) };

  // Throughput: daily buckets of delivered ('done') runs, oldest first,
  // ending at today — a fixed-width array regardless of how much history
  // exists (a young project just gets leading zeroes), so sparkline()
  // always has a fixed-width array to render. Generalized to a `days`
  // parameter so the compact METRICS tier's 7-day window and the expanded
  // tier's 30-day window share one implementation.
  const buildThroughput = (days) => {
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const dayStart = todayStart - i * DAY_MS;
      const dayEnd = dayStart + DAY_MS;
      out.push(done.filter((r) => r.endedAt != null && r.endedAt >= dayStart && r.endedAt < dayEnd).length);
    }
    return out;
  };
  const throughput = buildThroughput(7);
  const throughput30d = buildThroughput(30);

  // Run-duration distribution: the same `withElapsed` list `avgMs` already
  // computes (done runs with a known elapsedMs), bucketed into three ranges.
  // Boundaries: [0, 10m) / [10m, 30m) / [30m, +inf) — no existing bucketing
  // helper in the codebase to reuse (confirmed by research before this plan
  // was written), so this is new, self-contained code.
  const durationBuckets = { under10: 0, from10to30: 0, over30: 0 };
  for (const r of withElapsed) {
    if (r.elapsedMs < 10 * 60000) durationBuckets.under10++;
    else if (r.elapsedMs < 30 * 60000) durationBuckets.from10to30++;
    else durationBuckets.over30++;
  }

  // Every escalation.raised event across all history, newest first — NOT
  // capped here; the METRICS rendering layer decides how many rows it has
  // room to show (a terminal's available height, not this function's
  // business).
  const recentEscalations = [];
  for (const r of list) {
    for (const ev of r.events || []) {
      if (ev.kind === 'escalation.raised') {
        recentEscalations.push({ ticket: ev.ticket, role: ev.role || null, question: ev.question || '', raisedAt: ev.t });
      }
    }
  }
  recentEscalations.sort((a, b) => b.raisedAt - a.raisedAt);

  // Verdict pass-rates per role, over ALL history (same "walk the full runs
  // array" precedent avgMs already established) — PASS/CONFIRM/MERGE is
  // each role's own "good" outcome per core/roles/{evaluator,skeptic,
  // auditor}.md's documented verdict vocabulary; every other value (FAIL,
  // REFUTE, ESCALATE, BLOCKER) counts against the rate. null (not 0) when a
  // role has never reported at all — a role that's never run is different
  // from one that always fails.
  const VERDICT_PASS_VALUE = { evaluator: 'PASS', skeptic: 'CONFIRM', auditor: 'MERGE' };
  const verdictRates = {};
  for (const role of Object.keys(VERDICT_PASS_VALUE)) {
    let total = 0;
    let passed = 0;
    for (const r of list) {
      for (const ev of r.events || []) {
        if (ev.kind === 'verdict' && ev.role === role) {
          total++;
          if (ev.verdict === VERDICT_PASS_VALUE[role]) passed++;
        }
      }
    }
    verdictRates[role] = total ? passed / total : null;
  }

  // Gate pass-rates per gate name, over ALL history — reads each run's
  // already-deduped `run.gates` (latest result per name per run,
  // reducer.js's gate.result fold), so a run that retried a gate only
  // counts its FINAL outcome, not every attempt. The name set is the UNION
  // of whatever gate names actually appear across `runs` — never a fixed
  // candidate list to check against (see GATE_NAME_ORDER's own header
  // comment, above, for why a static list is the wrong shape for this) — so
  // a gate name absent from every run's history is simply never a key in
  // the map at all, never reported as a misleading 0%, and a gate name this
  // file has never heard of still gets counted correctly.
  const gateTotal = {};
  const gatePassed = {};
  for (const r of list) {
    for (const g of r.gates || []) {
      gateTotal[g.name] = (gateTotal[g.name] || 0) + 1;
      if (g.status === 'pass') gatePassed[g.name] = (gatePassed[g.name] || 0) + 1;
    }
  }
  const gateRates = {};
  for (const name of Object.keys(gateTotal)) {
    gateRates[name] = (gatePassed[name] || 0) / gateTotal[name];
  }

  return {
    avgMs, deliveredToday, deliveredWeek, escalationsToday,
    successRate, throughput, throughput30d, verdictRates, gateRates,
    durationBuckets, recentEscalations,
  };
}

// CON-40: the QUICK START widget lists the top N open tickets by priority,
// flattened across every epic — a fixed constant, not a config knob (the
// ticket's own "next 3-5 tickets" language is a range, not a tunable; see
// design.md Decision 6), matching MAX_FINISHED's own precedent just above.
const QUICK_START_COUNT = 5;

// Idle is now seeded from tmux's own `window_activity`, so it is real from the
// first frame. The old one-minute floor existed only because idle used to start
// at zero on every window the moment you opened the dashboard.
const IDLE_FLOOR_MS = 30000;

// The METRICS column's content — a pure function of the metrics object
// metricsFor() returns and how much room is available. Extracted out of
// buildSections' inline `if (o.metrics)` block (lazygit-layout /
// fleet-metrics-charts passes) so the grid-mode renderer (Task 8) can call
// it directly with a DIFFERENT `cols`/`contentRows` than the single-column
// METRICS box gets, without duplicating this construction. `opts.cols` is
// the box's INNER width (same convention buildSections' block already
// used — the caller has already subtracted BOX_BORDER_PADDING_COLS).
function metricsColumnLines(m, opts) {
  const o = opts || {};
  const cols = Math.max(0, o.cols || 0);
  const contentRows = o.contentRows != null ? o.contentRows : 5;
  const expanded = cols >= 80 && contentRows >= 11;

  // Defensive defaults: sectionJumpTargets() (below) deliberately passes
  // `{}` for `o.metrics` when it only needs to know METRICS is included,
  // not what it says — these nested shapes do not tolerate dereferencing
  // straight into e.g. `m.successRate.today` the way the old single-scalar
  // `avgMs` field did.
  const successRate = m.successRate || {
    today: { rate: null, done: 0, total: 0 },
    week: { rate: null, done: 0, total: 0 },
  };
  const throughput = m.throughput || [0, 0, 0, 0, 0, 0, 0];
  const throughput30d = m.throughput30d || new Array(30).fill(0);
  const verdictRates = m.verdictRates || {};
  const gateRates = m.gateRates || {};
  const durationBuckets = m.durationBuckets || { under10: 0, from10to30: 0, over30: 0 };
  const recentEscalations = m.recentEscalations || [];

  // `escalations today` lives on line 1, not packed into line 2's
  // fitSegments call — see the fleet-metrics-charts design doc for why
  // (it was the first thing fitSegments dropped at a standard 80-column
  // terminal when tried on line 2).
  const avgText = m.avgMs != null ? f.dur(m.avgMs) : 'n/a';
  const line1 = `avg delivery ${avgText} · delivered today ${m.deliveredToday ?? 0} · ` +
    `this week ${m.deliveredWeek ?? 0} · escalations today ${m.escalationsToday ?? 0}`;

  const rateSegment = (label, r) => r.rate == null
    ? `${label} n/a`
    : `${label} ${f.bar(r.rate, 10)} ${Math.round(r.rate * 100)}% (${r.done}/${r.total})`;
  const line2Prefix = 'success  ';
  const line2Segments = [rateSegment('today', successRate.today), rateSegment('week', successRate.week)];
  const line2 = line2Prefix + layout.fitSegments(line2Segments, cols - line2Prefix.length);

  const throughputData = expanded ? throughput30d : throughput;
  const throughputWindowLabel = expanded ? '30d' : '7d';
  const throughputAvg = (throughputData.reduce((a, b) => a + b, 0) / throughputData.length).toFixed(1);
  const throughputPeak = Math.max(...throughputData);
  const line3 = `throughput (${throughputWindowLabel})  ${f.sparkline(throughputData)}  avg ${throughputAvg}/day · peak ${throughputPeak}`;

  const line4Prefix = 'verdicts  ';
  const verdictSegments = ['evaluator', 'skeptic', 'auditor']
    .filter((role) => verdictRates[role] != null)
    .map((role) => `${role} ${f.bar(verdictRates[role], 10)} ${Math.round(verdictRates[role] * 100)}%`);
  const line4 = verdictSegments.length
    ? line4Prefix + layout.fitSegments(verdictSegments, cols - line4Prefix.length)
    : line4Prefix + 'no data yet';

  const line5Prefix = 'gates  ';
  const gateSegments = Object.keys(gateRates)
    .sort((a, b) => {
      const ia = GATE_NAME_ORDER.indexOf(a);
      const ib = GATE_NAME_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a < b ? -1 : a > b ? 1 : 0;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    })
    .map((name) => `${name.replace(/^phase:|^server:/, '')} ${Math.round(gateRates[name] * 100)}%`);
  const line5 = gateSegments.length
    ? line5Prefix + layout.fitSegments(gateSegments, cols - line5Prefix.length)
    : line5Prefix + 'no data yet';

  const compactLines = [line1, line2, line3, line4, line5];
  if (!expanded) return compactLines;

  // Expanded tier: the fixed blocks below always cost the same 8 lines for
  // a given terminal; whatever's left goes to "recent escalations" — see
  // the design doc for why that specific block is the one that absorbs
  // leftover vertical space (it's the only unbounded-length real data
  // METRICS has).
  const durationTotal = durationBuckets.under10 + durationBuckets.from10to30 + durationBuckets.over30;
  const durationPrefix = 'duration  ';
  const line7 = durationTotal
    ? durationPrefix + layout.fitSegments([
        `<10m ${Math.round(durationBuckets.under10 / durationTotal * 100)}%`,
        `10-30m ${Math.round(durationBuckets.from10to30 / durationTotal * 100)}%`,
        `30m+ ${Math.round(durationBuckets.over30 / durationTotal * 100)}%`,
      ], cols - durationPrefix.length)
    : durationPrefix + 'no data yet';

  const fixedLines = [line1, line2, line3, line4, line5, '', line7, ''];
  const remaining = Math.max(0, contentRows - fixedLines.length);
  if (remaining === 0) return fixedLines;

  const escalationLines = ['recent escalations'];
  const rowsForList = remaining - 1;
  if (rowsForList > 0) {
    if (!recentEscalations.length) {
      escalationLines.push('  no escalations yet');
    } else {
      for (const esc of recentEscalations.slice(0, rowsForList)) {
        const time = new Date(esc.raisedAt).toISOString().slice(11, 16);
        const rolePart = esc.role ? esc.role + '  ' : '';
        escalationLines.push(f.truncate(`  ${time}  ${esc.ticket}  ${rolePart}"${esc.question}"`, cols));
      }
    }
  }
  return fixedLines.concat(escalationLines);
}

// CON-29: the key that confirms a paused queue (queueState.confirmed ===
// false) — originally only a queue restored from a previous session, later
// joined by a fresh batch the operator deliberately held via the launch
// plan's own "start now: no" toggle (launchplan.js's `startNow` / queue.js's
// createQueue `confirmed` param); watch.js's 'confirm-restored-queue' action
// and this key are unchanged either way — only buildHeadTail's wording below
// tells the two apart. Chosen from fleet mode's current key map with no
// collision: n/N (prompt/launch pad), q/Ctrl-C (quit), j/k and their arrow
// aliases (move), Enter and l/right-arrow (attach/drilldown) are all already
// claimed — see handleKey below. CON-39 later claims digit keys 1-9 (section
// jump) and, while focus is on QUEUED, `f` (force-start) and bare Escape
// (exit queue focus) — none of these collide with `c` either.
const CONFIRM_RESTORED_QUEUE_KEY = 'c';

// Capital, deliberately distinct from the lowercase CONFIRM_RESTORED_QUEUE_KEY
// just above (same "n vs N" idiom as the launch pad's own single/batch keys)
// — drops every ticket still in queueState.pending (never anything already
// inFlight; see queue.js's clearPending()). Bound identically on the launch
// pad (launchpad.js's own CLEAR_QUEUE_KEY, same value — the two are kept as
// separate constants rather than one shared import so each screen's key map
// stays self-contained, matching how CONFIRM_RESTORED_QUEUE_KEY itself is
// only ever read here).
const CLEAR_QUEUE_KEY = 'C';

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
    parts.push('no telemetry');
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
    if (!run.endStatus) parts.push('window exited');
  } else {
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
  lines.push(`  ${marker} ${f.bold(f.padTo(run.ticket, 9))} ${f.truncate(name, opts.cols - 16)}`);

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
  const name = run.changeName || f.dim('(no branch yet)');
  const statusColour = f.STATUS_COLOUR[run.status] || f.dim;
  const left = `  ${marker} ${f.bold(f.padTo(run.ticket, 9))} ${name}`;

  let right;
  if (run.status === 'failed' && run.endedAt == null && !run.endStatus) {
    right = statusColour('window exited');
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
  let label = `  ${marker} ${position}. ${ticket}` + (title ? '  ' + title : '');
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
function renderQuickStartRow(ticket, focused, width) {
  const marker = focused ? '»' : ' ';
  const priorityText = launchpadScreen.priorityLabel(ticket.priority);
  const priorityCol = f.padTo(priorityText != null ? priorityText : '?', 4);
  const label = `  ${marker} ${priorityCol} ${ticket.identifier}` +
    (ticket.title ? '  ' + ticket.title : '');
  return [f.truncate(label, width)];
}

// Splits `runs` into the four status buckets every section is built from.
// Shared by renderFleet and visibleWindow so both see the exact same
// partition of the same `runs` array (design.md Decision 2).
function bucketRuns(runs) {
  return {
    needsYou: runs.filter((r) => r.status === 'needs-you'),
    active:   runs.filter((r) => r.status === 'running' || r.status === 'unknown'),
    failed:   runs.filter((r) => r.status === 'failed'),
    done:     runs.filter((r) => r.status === 'done'),
  };
}

// Builds the section list in render/index order: NEEDS YOU, FAILED, RUNNING,
// QUICK START (always included, CON-56), [QUEUED if non-empty], DONE. Section order is
// the reducer's own sort order, so the Nth rendered (selectable) row is
// runs[N] — which is the index watch.js attaches to. FAILED right after
// NEEDS YOU groups the two "something needs your attention" categories
// together, ahead of RUNNING/history (fleet-metrics-grid design — see the
// comment on the `sections` array below for why this also matters for
// grid-mode rendering).
// `statusKey` reads the section's colour from the shared STATUS_COLOUR table
// (design.md Decision 4) instead of each section picking its own
// f.yellow/f.dim/f.red ad hoc. `kind` (CON-40, design.md Decision 3) is a
// SEPARATE, stable discriminator every section carries — unlike `statusKey`
// (a colour lookup key) or `title` (QUEUED's is a dynamic string carrying a
// live pending count, never safe to match on), `kind` never changes shape
// and is what both the digit-jump branch (handleKey, below) and the
// per-row render dispatch (renderFleet, below) key off to tell an
// `unselectable` QUICK START section apart from an `unselectable` QUEUED one
// now that both can be on screen at once.
//
// Every entry sets `linesPerRow` explicitly (design.md Decision 2) so no
// section's height cost depends on an unstated default: 2 for a run row
// (ticket line + bar/status line), 1 for QUEUED's/QUICK START's single-line
// rows. Neither QUEUED nor QUICK START has a run object behind any of its
// rows — see renderQueuedRow's/renderQuickStartRow's own header comments —
// so neither may ever consume a slot in the row-index space `watch.js`'s
// `runs[selected]` relies on. `unselectable: true` is the one flag that
// both keeps a section out of that index space and routes its rows to
// renderQueuedRow/renderQuickStartRow instead of renderRun (design.md
// Decisions 1 and 5).
//
// The QUICK START entry is always built — CON-56: no longer gated behind a
// visibility flag, mirroring METRICS' own unconditional inclusion just below
// (the `o.metrics` truthy-check). It is included REGARDLESS of how many
// tickets `opts.quickStartTickets` actually holds (`forceRender`/
// `emptyHint`, read by visibleWindow's sectionHeight and renderFleet's own
// per-section loop below), the one deliberate divergence from every other
// section's "only non-empty groups render" convention. `opts.quickStartCold`
// picks WHICH hint text applies when the list is empty — cold cache (never
// fetched) vs. populated-but-fully-filtered — a distinction this function
// has no other way to make on its own (it has no access to the cache
// module), so the caller (watch.js's draw()) computes it once via
// `cache.isCold(cache.read(root))` and threads it through here exactly like
// `quickStartTickets` itself. Neither `visibleWindow`'s nor
// `sectionJumpTargets`'s own calls below need `quickStartCold` — only
// renderFleet's call ever reads `s.emptyHint`'s text.
//
// Shared by renderFleet and visibleWindow — a single source of truth for the
// section shape (design.md Decision 3's own risk mitigation, applied here
// as well as to the window arithmetic itself).
function buildSections(buckets, queueState, opts) {
  const o = opts || {};
  // fleet-metrics-grid design: FAILED sits right after NEEDS YOU — both are
  // "something needs your attention" categories, grouped together so the
  // grid-mode renderer (a later task) can lay them out as adjacent
  // full-width banners without any index-space translation between this
  // canonical order and where things actually render on screen. This is
  // also why FAILED moved here: it used to sit between QUEUED and DONE.
  const sections = [
    { title: 'NEEDS YOU', group: buckets.needsYou, statusKey: 'needs-you', cap: Infinity, pinned: true, linesPerRow: 2, kind: 'needs-you' },
    { title: 'FAILED', group: buckets.failed, statusKey: 'failed', cap: MAX_FINISHED, linesPerRow: 1, kind: 'failed' },
    { title: 'RUNNING',   group: buckets.active,   statusKey: 'running',   cap: Infinity, linesPerRow: 2, kind: 'running' },
  ];
  // CON-40: positioned after RUNNING, before the (already-conditional)
  // QUEUED entry (design.md Decision 2) — "what's wrong" -> "what's
  // happening" -> "what you could start" -> "what's about to start" ->
  // history.
  {
    const quickStartTickets = o.quickStartTickets || [];
    const forceRender = quickStartTickets.length === 0;
    sections.push({
      title: icons.quickStart + ' QUICK START',
      group: quickStartTickets,
      statusKey: 'quickstart',
      cap: QUICK_START_COUNT,
      unselectable: true,
      linesPerRow: 1,
      kind: 'quickstart',
      forceRender,
      emptyHint: forceRender
        ? (o.quickStartCold ? 'no tickets cached yet — press N to fetch' : 'nothing left to quick-start')
        : undefined,
    });
  }
  // Positioned after RUNNING (and QUICK START, if shown): pending, not
  // finished, but not yet actionable either (nothing to attach to).
  if (queueState && queueState.pending && queueState.pending.length) {
    sections.push({
      title: `${icons.queue} QUEUED (${queueState.pending.length}, running ${queueState.maxConcurrent} at a time)`,
      group: queueState.pending,
      statusKey: 'queued',
      cap: MAX_FINISHED,
      unselectable: true,
      linesPerRow: 1,
      kind: 'queued',
    });
  }
  sections.push(
    { title: 'DONE',   group: buckets.done,   statusKey: 'done',   cap: MAX_FINISHED, linesPerRow: 1, kind: 'done' },
  );
  // Lazygit-layout pass: a fleet-wide roll-up, positioned last (after
  // history) — reuses the exact same forceRender mechanism QUICK START
  // established above (always shown, no selectable rows) rather than
  // inventing a second "always render an empty section" path. Unlike QUICK
  // START's single `emptyHint` line, METRICS is a fixed 5-line summary
  // (avg/delivered/escalations, success rate, throughput, verdicts, gates)
  // via `emptyLines` below — see sectionHeight's own comment on the
  // `emptyHint`-vs-`emptyLines` generalization. `o.metrics` is null/undefined
  // only in the two call sites
  // (sectionJumpTargets, indirectly) that only need to know whether the
  // section is INCLUDED, not what it says — see that function's own comment.
  if (o.metrics) {
    const boxCols = Math.max(40, o.cols || 80);
    const innerCols = Math.max(0, boxCols - BOX_BORDER_PADDING_COLS);
    sections.push({
      title: icons.metrics + ' METRICS',
      group: [],
      statusKey: 'metrics',
      cap: 1,
      unselectable: true,
      linesPerRow: 1,
      kind: 'metrics',
      forceRender: true,
      emptyLines: metricsColumnLines(o.metrics, { cols: innerCols }),
    });
  }
  return sections;
}

// The lines printed before the first section (head) and after the last one
// (tail) — everything renderFleet prints that is NOT one of the sections
// above. Line COUNT here (not the truncated text) is what visibleWindow's
// height budget needs to reason about, so it calls this same function
// rather than re-deriving the count some other way — one implementation,
// used both to print the real header/footer and to size the budget around
// it (design.md Decision 3's shared-implementation mitigation, applied here
// too).
function buildHeadTail(runs, opts) {
  const cols = Math.max(40, (opts && opts.cols) || 80);
  const prompt = (opts && opts.prompt) || null;
  const queueNotice = (opts && opts.queueNotice) || null;
  const restoreNotice = (opts && opts.restoreNotice) || null;
  const queueState = (opts && opts.queueState) || null;
  const quitConfirm = (opts && opts.quitConfirm) || false;
  // CON-39: force-start's own confirmation gate — `{ ticket } | null`. Kept
  // as a distinct field from `quitConfirm` (rather than reusing it) since
  // the two are independent, narrower/broader gates that must never both
  // claim the same keypress — see handleKey's own ordering comment.
  const forceStartConfirm = (opts && opts.forceStartConfirm) || null;
  // Clear Queue's own confirmation gate — a plain boolean (unlike
  // forceStartConfirm's `{ ticket }`, there is nothing to name but "the
  // queue"). Checked ahead of forceStartConfirm/quitConfirm below, mirroring
  // handleKey's own ordering: the newest-opened gate intercepts first.
  const clearQueueConfirm = (opts && opts.clearQueueConfirm) || false;
  const project = (runs[0] && runs[0].project) || '';

  const needsYou = runs.filter((r) => r.status === 'needs-you');
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
    // CON-29: a queue restored from a previous session (queueState.confirmed
    // === false) must never look like an ordinary in-session queue — it is
    // NOT ticking (see watch.js's shouldTick() guard at the queue.tick()
    // call site) and nothing in it launches until the operator explicitly
    // confirms, so this line is the one place that says so. Distinct from
    // the plain "▲ queue: ..." summary line just above, which renders
    // identically for a restored or same-session queue alike — this is the
    // affordance, not a status count. Covers the pending-empty/inFlight-only
    // edge case too (an already-in-flight ticket with nothing left pending —
    // design.md Decision 5a): the section below only ever lists PENDING
    // rows, so without this line an inFlight-only restore would have no
    // visible confirm affordance at all.
    //
    // `confirmed: false` has a second cause now (the launch plan's own
    // "start now: no" toggle — see launchplan.js/queue.js's createQueue) that
    // is NOT a restore — wording that would otherwise claim a session crashed
    // when the operator deliberately held a fresh batch. `restoredFrom` is
    // only ever set by createRestoredQueue() (CON-29's own startup path), so
    // its presence/absence is exactly the distinguishing fact; the confirm
    // key and mechanism (fleet.js's CONFIRM_RESTORED_QUEUE_KEY, watch.js's
    // 'confirm-restored-queue') are identical either way — only the wording
    // differs.
    if (queueState.confirmed === false && (inFlightCount || pendingCount)) {
      const msg = queueState.restoredFrom
        ? `▲ resumed from a previous session — press ${CONFIRM_RESTORED_QUEUE_KEY} to continue`
        : `▲ held — press ${CONFIRM_RESTORED_QUEUE_KEY} to start`;
      tail.push('  ' + f.yellow(msg));
    }
  }
  // CON-37: ticket ids the startup restore reconciliation dropped because
  // their run completed DURING the downtime (see queue.js's
  // reconcileRestored/completedDuringDowntime) — an independent fact from
  // the "resumed from a previous session" affordance just above, so this is
  // gated ONLY on the notice itself, never on `queueState` being present or
  // on `queueState.confirmed` (design.md Decision 4): a queue file whose
  // every pending ticket finished overnight restores nothing at all
  // (queueState stays null), and this is the only place that says so.
  // Truncated the same way queueNotice is, just below — the id list is
  // unbounded in principle.
  if (restoreNotice) {
    tail.push('  ' + f.yellow(f.truncate(`▲ ${restoreNotice}`, cols - 4)));
  }
  // A queued batch launch that failed to spawn (see queue.js — a slot frees
  // itself naturally next tick since there is no run to track) is otherwise
  // invisible: nothing else on the fleet view watches the launch-pad queue.
  if (queueNotice) tail.push('  ' + f.red(f.truncate(queueNotice, cols - 4)));
  // Advertise only what this slice actually binds. `k` is selection-up here, so
  // labelling it "kill" would be worse than omitting it — kill and restart
  // arrive with the control plane in slice 2. `n` is listed only in fleet mode:
  // while the prompt is open it does nothing but type an "n".
  if (clearQueueConfirm) {
    // Names the exact count that would be dropped, same "no vague are-you-
    // sure" discipline as forceStartConfirm just below — checked BEFORE it
    // (and quitConfirm), matching handleKey's own ordering: the newest-
    // opened gate never lets an older one's key steal the keypress.
    const pendingCount = queueState && queueState.pending ? queueState.pending.length : 0;
    tail.push('  ' + f.yellow(
      `▲ this will drop ${pendingCount} queued ticket${pendingCount === 1 ? '' : 's'} — they will never start. proceed?`));
    tail.push(f.dim('  y confirm clear   (any other key) cancel'));
  } else if (forceStartConfirm) {
    // CON-39, design.md Decision 3: the load-bearing warning — force-start
    // is a deliberate break of the maxConcurrent contract the operator
    // configured, so this names the exact resulting count rather than a
    // vague "are you sure?". Checked BEFORE quitConfirm below (matching
    // handleKey's own ordering — the two gates never both claim a keypress).
    const maxConcurrent = queueState ? queueState.maxConcurrent : 1;
    const inFlightCount = queueState && queueState.inFlight ? queueState.inFlight.size : 0;
    const resultingCount = inFlightCount + 1;
    tail.push('  ' + f.yellow(
      `▲ this will run ${resultingCount} concurrently, exceeding your maxConcurrent:${maxConcurrent} setting — proceed?`));
    tail.push(f.dim('  y confirm force-start   (any other key) cancel'));
  } else if (quitConfirm) {
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
    // CON-21: a non-ticket-shaped submit kicks off the headless drafting
    // invocation (design.md's own "drafting…" mitigation for the risk that
    // the LLM round trip can take several seconds) — shown here rather than
    // opening a new screen, since there is no draft to show yet.
    if (prompt.drafting) {
      tail.push(f.dim('  drafting…   esc cancel'));
    } else {
      tail.push(f.dim('  ↵ start   esc cancel'));
    }
  } else {
    // Kill/restart are NOT bound here even though the final design's footer
    // shows them on the fleet: `k` already means "move selection up" (see the
    // comment on the malformed-events line above), so binding it to kill on
    // this screen would be the exact defect this project treats as a wall —
    // a footer hint whose key does something else. They live on the
    // drill-down instead, where `k`/`r` are unclaimed. `l` opens it.
    // CON-39: `1-9 jump` is always advertised (digit-jump binds regardless of
    // which sections are populated — an out-of-range digit is just a no-op).
    // `f force-start` is advertised ONLY when a QUEUED section is actually on
    // screen this frame (same "only advertise a key that currently does
    // something" discipline this comment already names) — outside QUEUED
    // focus `f` is unbound, so hinting it unconditionally would itself be
    // the defect this file's own discipline exists to avoid.
    // `t ticket` and `s settings` are bound below (handleKey) and were
    // previously never advertised — the exact hint/key mismatch this
    // comment block calls a wall, in the other direction. f.hintLines wraps
    // onto additional footer rows instead of truncating: buildHeadTail's
    // callers budget on tail.length (see visibleWindow), so extra rows are
    // accounted for automatically, whereas the old single joined line was
    // clamped to cols downstream and silently lost its tail — on an 80-col
    // terminal everything from `n new run` onward vanished whenever the
    // queue hints were present.
    const hints = ['↵ attach', 'l details', 't ticket', 'j/k move', '1-9 jump'];
    if (queueState && queueState.pending && queueState.pending.length) {
      hints.push('f force-start', CLEAR_QUEUE_KEY + ' clear queue');
    }
    hints.push('n new run', 'N launch pad', 's settings', 'q quit');
    for (const line of f.hintLines(hints, cols)) tail.push(line);
  }

  return { head, tail };
}

// Stage A (design.md Decision 2): scroll-windows every selectable, non-
// pinned section (FAILED/RUNNING/DONE) by opts.scrollOffset, walked in
// render order. NEEDS YOU is pinned — it still consumes its own slice of the
// flat selectable-index space (`selected` can land on one of its rows) but
// never consumes scrollOffset's "remaining rows to skip" budget, and always
// shows in full (design.md Decision 4). QUEUED is unselectable and stays
// out of both accountings entirely (design.md Decision 1), unaffected.
//
// Stage B (design.md Decision 3): the whole-frame height budget, trimming
// from the bottom section upward exactly as today — except a section that
// currently holds `opts.selected` within its shown window is trimmed from
// whichever edge is FARTHER from `selected`, never past the point that
// would evict it (the accepted exception being total collapse, when even
// one row cannot fit — see design.md Decision 3's final paragraph).
//
// Returns { sections: [{ shown, startOffset, hidden }, ...] } — one entry
// per section, same order/length as buildSections' own output (including
// QUEUED's, unaffected) — plus firstVisibleIndex/lastVisibleIndex (the
// selectable-index range actually rendered this frame) and maxScrollOffset
// (a structural property of `runs`/MAX_FINISHED alone, NOT of opts.rows —
// see below — so callers that only need it, e.g. watch.js's every-draw()
// re-clamp, can pass rows: 0 safely and cheaply).
//
// The Stage A/B trim-loop core of visibleWindow (below), extracted so
// grid-mode rendering (visibleWindowGrid, Task 7) can run the identical
// scroll/trim arithmetic over a DIFFERENT, restricted section list (just
// column 1's own sections) and a DIFFERENT row budget (the column area's
// height, not the whole terminal) — without a second, drifting
// implementation of this trim loop. See the Stage A/B paragraphs above for
// what Stage A/B actually do; nothing about that logic changed here, only
// which `sections`/`runs` it's handed and whether it accounts for the page
// header/footer.
//
// A section's own natural rendered height for a given `shown` count — one
// implementation, used both by computeWindow's height-budget trim loop
// (below) and by visibleWindowGrid's banner-height accounting (NEEDS YOU/
// FAILED render as banners outside computeWindow's own trim loop, but still
// need this exact same math to size the column area's height budget), so
// the two can never silently diverge (mirrors this file's existing
// "one implementation, used both to print and to size the budget"
// convention — see buildHeadTail's own header comment, and
// renderStackedSection's "must stay in lockstep with sectionHeight" note).
function sectionNaturalHeight(s, shown, groupLen, cols) {
  // CON-40: a `forceRender`-flagged, zero-eligible QUICK START still costs
  // exactly one hint content line plus its 2-row border (design.md
  // Decision 4, mechanism step 2; tasks.md 2.6) — it stays truthfully
  // accounted for in the height-budget trim loop below rather than being
  // invisible to it. Every other section's `forceRender` is `undefined`
  // (falsy), so this is a no-op change for them: `!groupLen` alone still
  // governs their existing "costs nothing" behaviour exactly as before.
  // The lazygit-layout pass established 3 = one emptyHint content line +
  // 2-row border. Generalized here to N content lines via `emptyLines` —
  // METRICS now uses 5; QUICK START (see its own `sections.push` entry in
  // buildSections, above) still passes a single `emptyHint` string,
  // covered by the `[s.emptyHint]` fallback (additive, not a breaking
  // rename).
  if (!groupLen) return s.forceRender ? (s.emptyLines || [s.emptyHint]).length + 2 : 0;
  if (shown === 0) return 1;
  // CON-53: NEEDS YOU rows can now wrap the escalation question onto
  // multiple lines, so the flat `linesPerRow * shown` estimate can
  // under-count this section's real height and under-trim the sections
  // below it. Sum each run's actual rendered line count instead — reusing
  // renderRun() itself (rather than a second, parallel line-counting
  // formula) guarantees this can never drift from what the real render
  // pass actually emits. `innerCols` must match the real render pass's own
  // derivation exactly (fleet.js's renderRun call site, `{ cols: innerCols
  // }`) — the un-reduced `cols` would estimate against a 4-column-wider
  // budget than what's actually rendered.
  if (s.kind === 'needs-you') {
    const innerCols = Math.max(0, (cols || 80) - BOX_BORDER_PADDING_COLS);
    const lineCount = s.group.reduce(
      (n, run) => n + renderRun(run, { cols: innerCols }, false).length, 0);
    return 2 + lineCount + (groupLen > shown ? 1 : 0);
  }
  return 2 + s.linesPerRow * shown + (groupLen > shown ? 1 : 0);
}

// `opts.includeHeadTail` (default true): when false, skips buildHeadTail's
// row count entirely — used by grid mode, which has already netted out
// the header/footer when it computed the column area's own height budget,
// and would otherwise double-subtract them.
function computeWindow(runs, sections, opts) {
  const rows = (opts && opts.rows) || 0;
  const selected = Math.max(0, (opts && opts.selected) || 0);
  const scrollOffset = Math.max(0, (opts && opts.scrollOffset) || 0);
  const includeHeadTail = !(opts && opts.includeHeadTail === false);
  const cols = Math.max(40, (opts && opts.cols) || 80);

  let remaining = scrollOffset;
  let globalIndex = 0;
  const win = sections.map((s) => {
    const groupLen = s.group.length;
    if (s.unselectable) {
      const shown = Math.min(groupLen, s.cap);
      return { shown, startOffset: 0, hidden: groupLen - shown, sectionStartIndex: null };
    }
    const sectionStartIndex = globalIndex;
    let startOffset = 0;
    let shown;
    if (s.pinned) {
      shown = groupLen; // NEEDS YOU: never capped, never scrolled.
    } else if (remaining >= groupLen) {
      // Entirely scrolled past — nothing of this section renders this frame.
      remaining -= groupLen;
      shown = 0;
      startOffset = groupLen;
    } else if (remaining > 0) {
      // The offset lands inside this section: render from its mid-group
      // startOffset up to `cap` further rows — the shared selectionWindow
      // helper computes this identically (selection pinned at `remaining`,
      // its own local offset), so this is the same arithmetic as the
      // `else` branch just below, not a second implementation.
      const win = layout.selectionWindow(groupLen, remaining, s.cap, remaining);
      startOffset = win.start;
      shown = win.count;
      remaining = 0;
    } else {
      // Reached (remaining already 0): render from its own start, as today.
      const win = layout.selectionWindow(groupLen, 0, s.cap, 0);
      shown = win.count;
    }
    globalIndex += groupLen;
    return { shown, startOffset, hidden: groupLen - shown, sectionStartIndex };
  });

  const headTailRows = includeHeadTail ? (() => {
    const { head, tail } = buildHeadTail(runs, opts);
    return head.length + tail.length;
  })() : 0;
  const sectionHeight = (s, w) => sectionNaturalHeight(s, w.shown, s.group.length, cols);
  const totalHeight = () => headTailRows +
    sections.reduce((h, s, i) => h + sectionHeight(s, win[i]), 0);

  // One row is reserved for the newline the writer appends: filling the last
  // terminal row and then emitting \n scrolls the screen by one, which is the
  // very thing the cap exists to prevent.
  const budget = rows > 0 ? rows - 1 : 0;
  if (budget > 0) {
    for (let i = sections.length - 1; i >= 0 && totalHeight() > budget; i--) {
      // NEEDS YOU is never trimmed. If it alone overflows the terminal we lose
      // the header, which is the right thing to lose.
      if (sections[i].pinned) continue;
      const s = sections[i];
      const w = win[i];
      const containsSelected = !s.unselectable && w.sectionStartIndex !== null &&
        selected >= w.sectionStartIndex + w.startOffset &&
        selected < w.sectionStartIndex + w.startOffset + w.shown;

      while (w.shown > 0 && totalHeight() > budget) {
        if (containsSelected) {
          const localSelected = selected - w.sectionStartIndex;
          const distFromHead = localSelected - w.startOffset;
          const distFromTail = (w.startOffset + w.shown - 1) - localSelected;
          if (distFromTail >= distFromHead) {
            w.shown--;              // selected nearer the head — trim the tail
          } else {
            w.startOffset++;        // selected nearer the tail — trim the head
            w.shown--;
          }
        } else {
          w.shown--;                // no selected row to protect — tail-first, as today
        }
        w.hidden = s.group.length - w.shown;
      }
    }
  }

  // NEEDS YOU is deliberately EXCLUDED here, even though it is selectable
  // and occupies its own slice of the flat index space: it is always fully
  // shown regardless of scrollOffset (Decision 4), so it must never be
  // averaged into the scrollable window's own bounds. Doing so would create
  // a false "visible range" spanning the gap between NEEDS YOU (index 0..)
  // and wherever the scrollable window actually starts — a row scrolled
  // entirely out of view in between (e.g. a short RUNNING section, once
  // scrolled past) would then read as "in range" and never get scrolled
  // back into view. firstVisibleIndex/lastVisibleIndex describe ONLY the
  // scrollable region's own contiguous visible window; a selected row
  // inside NEEDS YOU trivially needs no scroll adjustment regardless of
  // what these two report (moving onto it and clamping toward scrollOffset
  // 0 is harmless either way).
  let firstVisibleIndex = null;
  let lastVisibleIndex = null;
  sections.forEach((s, i) => {
    if (s.unselectable || s.pinned) return;
    const w = win[i];
    if (w.shown > 0) {
      const start = w.sectionStartIndex + w.startOffset;
      const end = w.sectionStartIndex + w.startOffset + w.shown - 1;
      if (firstVisibleIndex === null) firstVisibleIndex = start;
      lastVisibleIndex = end;
    }
  });
  // Nothing in the scrollable region rendered at all this frame (either it
  // is entirely empty, or the height budget collapsed every non-pinned
  // section) — there is nothing to scroll TOWARD or AWAY FROM, so report
  // bounds that can never spuriously trigger a scroll in either direction.
  if (firstVisibleIndex === null) firstVisibleIndex = 0;
  if (lastVisibleIndex === null) lastVisibleIndex = Math.max(0, runs.length - 1);

  // A structural property of `runs`/MAX_FINISHED alone — how far scrollOffset
  // can go before the LAST selectable row is already at the tail of its
  // (capped) window — independent of `rows`/the height budget, which can
  // only ever shrink what is ACTUALLY shown this frame, never how far
  // scrolling itself can reach (design.md Decision 3).
  const scrollable = sections.filter((s) => !s.unselectable && !s.pinned);
  let maxScrollOffset = 0;
  const lastNonEmpty = scrollable.slice().reverse().find((s) => s.group.length > 0);
  if (lastNonEmpty) {
    const totalScrollableRows = scrollable.reduce((n, s) => n + s.group.length, 0);
    const windowAtEnd = Math.min(lastNonEmpty.cap, lastNonEmpty.group.length);
    maxScrollOffset = Math.max(0, totalScrollableRows - windowAtEnd);
  }

  return {
    sections: win.map((w) => ({ shown: w.shown, startOffset: w.startOffset, hidden: w.hidden })),
    firstVisibleIndex,
    lastVisibleIndex,
    maxScrollOffset,
  };
}

// The single source of truth for "which selectable rows render this frame".
// Used internally by renderFleet (to decide what to actually print) AND
// exported for watch.js (to decide whether/how far a `move` action needs to
// scroll) — the same function, not two implementations that could drift
// (design.md Decision 3's risk mitigation). A thin bucketRuns + buildSections
// + computeWindow wrapper; see computeWindow's own header comment (above)
// for the Stage A/B trim-loop logic and return shape this delegates to.
function visibleWindow(runs, opts) {
  const queueState = (opts && opts.queueState) || null;
  const buckets = bucketRuns(runs);
  // CON-40: forwards `opts` — already `visibleWindow`'s own parameter — so
  // this call actually learns `quickStartVisible`/`quickStartTickets` and
  // sizes a QUICK START entry into the height budget below (design.md
  // Decision 4, "none of buildSections' three call sites forward opts",
  // point 1; tasks.md 2.10). Without this, QUICK START's row/height cost
  // would never be accounted for here regardless of whether it is actually
  // visible.
  const sections = buildSections(buckets, queueState, opts);
  return computeWindow(runs, sections, opts);
}

// The grid-mode counterpart to visibleWindow (fleet-metrics-grid design):
// NEEDS YOU and FAILED render as full-width banners above a two-column
// area (column 1: RUNNING/QUICK START/QUEUED/DONE stacked at a fixed
// width; column 2: METRICS filling the rest), so height/scroll accounting
// can no longer be one flat sequential sum the way visibleWindow's is —
// METRICS renders BESIDE column 1, not below it, and FAILED (now a
// banner, not part of column 1's own scrollable stack) is capped but
// never scrolled or trimmed, the same "always shows, never adjusts"
// treatment NEEDS YOU already gets. Same public shape as visibleWindow —
// one entry per buildSections() section, same order — so callers
// (renderFleet's grid branch, watch.js's scroll logic) can use either
// function interchangeably depending on `opts.cols`.
function visibleWindowGrid(runs, opts) {
  const totalRows = (opts && opts.rows) || 0;
  const selected = Math.max(0, (opts && opts.selected) || 0);
  const scrollOffset = Math.max(0, (opts && opts.scrollOffset) || 0);
  const queueState = (opts && opts.queueState) || null;
  const cols = Math.max(40, (opts && opts.cols) || 80);

  const buckets = bucketRuns(runs);
  const allSections = buildSections(buckets, queueState, opts);

  const needsYouSection = allSections.find((s) => s.kind === 'needs-you');
  const failedSection = allSections.find((s) => s.kind === 'failed');
  const columnSections = allSections.filter((s) =>
    s.kind === 'running' || s.kind === 'quickstart' || s.kind === 'queued' || s.kind === 'done');

  const needsYouShown = needsYouSection ? needsYouSection.group.length : 0;
  const failedWindow = failedSection
    ? layout.selectionWindow(failedSection.group.length, 0, failedSection.cap, 0)
    : { start: 0, count: 0 };
  const failedShown = failedWindow.count;
  const failedHidden = failedSection ? failedSection.group.length - failedShown : 0;

  const needsYouHeight = needsYouSection ? sectionNaturalHeight(needsYouSection, needsYouShown, needsYouSection.group.length, cols) : 0;
  const failedHeight = failedSection ? sectionNaturalHeight(failedSection, failedShown, failedSection.group.length, cols) : 0;

  const { head, tail } = buildHeadTail(runs, opts);
  // The "-1" mirrors computeWindow's own `budget = rows > 0 ? rows - 1 : 0`
  // — one row reserved for the trailing newline the writer appends,
  // applied ONCE where raw terminal rows become a usable budget. Applied
  // here (not inside computeWindow's own call below, which already gets a
  // pre-netted `columnAreaHeight` and must not reserve a second row on
  // top of it) so the whole page's height accounting has exactly one
  // place that does this subtraction, matching every other budget
  // computation in this file.
  const pageBudget = totalRows > 0 ? totalRows - 1 : 0;
  const columnAreaHeight = Math.max(0, pageBudget - head.length - tail.length - needsYouHeight - failedHeight);

  // FAILED and NEEDS YOU still occupy the flat row-index space `selected`
  // lives in (the one renderFleet builds, watch.js's `runs[selected]`
  // indexes, and Task 8's renderer reproduces via its own
  // sectionStartIndices walk), but computeWindow re-bases its internal
  // globalIndex at 0 over whatever section list it's handed — so a raw
  // global `selected` handed to a RESTRICTED columnSections list would be
  // off by however many rows NEEDS YOU/FAILED occupy ahead of it,
  // corrupting both the selected-row trim protection and
  // firstVisibleIndex/lastVisibleIndex. Translate in here, and translate
  // computeWindow's returned indices back out below.
  const columnIndexBase = (needsYouSection ? needsYouSection.group.length : 0) +
    (failedSection ? failedSection.group.length : 0);

  const columnWindow = computeWindow(runs, columnSections, {
    rows: columnAreaHeight > 0 ? columnAreaHeight + 1 : 0,
    // computeWindow clamps a negative `selected` to 0, which is correct
    // here too — a selection that's actually inside a banner (NEEDS YOU/
    // FAILED) needs no scroll adjustment in column 1 either way.
    selected: selected - columnIndexBase,
    scrollOffset, includeHeadTail: false,
  });

  // computeWindow's own `rows: 0` contract means "unbounded, don't trim" —
  // exactly what other callers need for a structural, height-independent
  // maxScrollOffset (see computeWindow's own header comment), and exactly
  // what `visibleWindowGrid` must ALSO still honour when the CALLER passed
  // `rows: 0`/omitted `rows` (a deliberate structural-only query — e.g.
  // watch.js's every-draw scrollOffset re-clamp, and this file's own
  // "visibleWindowGrid with rows:0 returns an unbounded (untrimmed) window"
  // test) — but NOT what column 1 should do when a REAL, positive row
  // budget was given and the column area still nets out to genuinely zero
  // rows (banners consuming the whole page). Both cases compute
  // `columnAreaHeight === 0` (pageBudget is 0 either way when totalRows is
  // 0), so `columnAreaHeight` alone cannot tell them apart — `totalRows > 0`
  // is the one fact that distinguishes "the caller gave a real budget and
  // it was consumed entirely by banners" from "the caller asked for an
  // unbounded structural query". Passed straight through in the former
  // case, `rows: 0` renders column 1 at its full, untrimmed natural height
  // instead of collapsing, which can make a SHORTER terminal produce a
  // LONGER frame than a slightly taller one (columnAreaHeight going from 1
  // to 0) — the opposite of what a height budget is for. Force the real
  // collapse only in that case — one shown:0/hidden:full entry per column
  // section, which renderStackedSection already renders as a single "… and
  // N more" line for a section with rows to hide (per its own group.length-
  // first branch: a forceRender-empty section like METRICS renders a FULL
  // BOX instead, and a non-forceRender empty section renders nothing at
  // all) — while still reusing columnWindow's own maxScrollOffset below,
  // unaffected by this either way (a structural property of `runs`/
  // MAX_FINISHED alone, per computeWindow's own contract).
  const columnSectionWindows = (totalRows > 0 && columnAreaHeight === 0)
    ? columnSections.map((s) => ({ shown: 0, startOffset: 0, hidden: s.group.length }))
    : columnWindow.sections;

  // Nothing in column 1 actually rendered this frame — either because we
  // just forced the collapse above, or because computeWindow's own trim
  // loop collapsed every section on its own. There is then no real
  // column-1 window to translate into the global flat-index space via
  // columnIndexBase — doing so anyway (the pre-fix behaviour) reports a
  // bogus "first visible row" (columnIndexBase itself) that corresponds to
  // nothing actually on screen. Report the same "nothing to scroll toward
  // or away from" sentinel computeWindow itself falls back to in this
  // situation (its own header comment, above) instead, left untranslated.
  const columnNothingVisible = columnSectionWindows.every((w) => w.shown === 0);

  let columnCursor = 0;
  const sections = allSections.map((s) => {
    if (s.kind === 'needs-you') return { shown: needsYouShown, startOffset: 0, hidden: 0 };
    if (s.kind === 'failed') return { shown: failedShown, startOffset: failedWindow.start, hidden: failedHidden };
    if (s.kind === 'metrics') return { shown: 0, startOffset: 0, hidden: 0 };
    const w = columnSectionWindows[columnCursor];
    columnCursor++;
    return w;
  });

  return {
    sections,
    // Translated back into the global flat-index space (see
    // columnIndexBase above) — maxScrollOffset does NOT need translation,
    // it's a count/offset, not an absolute index.
    firstVisibleIndex: columnNothingVisible ? 0 : columnWindow.firstVisibleIndex + columnIndexBase,
    lastVisibleIndex: columnNothingVisible ? Math.max(0, runs.length - 1) : columnWindow.lastVisibleIndex + columnIndexBase,
    maxScrollOffset: columnWindow.maxScrollOffset,
    // Exposed so renderFleetGrid (Task 8) sizes METRICS' box against the
    // EXACT SAME value that decided column 1's own trim — never a second,
    // independently-recomputed columnAreaHeight that could drift by even
    // one row and reintroduce the scroll-by-one bug the "-1" above exists
    // to prevent.
    columnAreaHeight,
  };
}

// Final whole-branch review, Finding 1: the single source of truth for
// "will THIS frame actually render in grid mode" — width alone
// (`cols >= GRID_MIN_COLS`) is necessary but not sufficient; the column
// area also needs room for METRICS' compact-tier floor
// (GRID_MIN_COLUMN_AREA_HEIGHT, above). Shared by renderFleet (which
// inlines the equivalent check itself, since it also wants to keep the
// computed `visibleWindowGrid` result to avoid a second call — see its own
// header comment) and watch.js's scroll-accounting call sites, which only
// need the boolean. The two must never disagree about which mode is
// actually on screen this frame, or a `scrollOffset`/`maxScrollOffset`
// computed against grid mode's own (FAILED-excluded, banner-adjusted)
// accounting could be applied to a frame that actually rendered
// single-column (where FAILED IS part of the scrollable flat list) —
// exactly the kind of two-implementations-that-could-drift risk
// design.md's own precedent (e.g. buildHeadTail) warns against.
//
// `opts.rows` must be the REAL row count this frame will actually render
// at — passing `rows: 0` here always reports `false` (columnAreaHeight
// computes to 0 whenever the page budget is 0), which is correct for
// "would a 0-row frame fit grid mode" but not what a caller wants if it
// separately relies on `rows: 0` as a rows-independent structural query
// (visibleWindow's/visibleWindowGrid's own documented `rows: 0` contract,
// used for e.g. a structural `maxScrollOffset`) — such callers must decide
// eligibility against the real row count first, then make that separate
// `rows: 0` call afterward.
function gridModeEligible(runs, opts) {
  const cols = (opts && opts.cols) || 80;
  if (cols < GRID_MIN_COLS) return false;
  return visibleWindowGrid(runs, opts).columnAreaHeight >= GRID_MIN_COLUMN_AREA_HEIGHT;
}

// Grid mode's per-section box renderer (fleet-metrics-grid design) — used
// for NEEDS YOU/FAILED banners and column 1's RUNNING/QUICK START/QUEUED/
// DONE boxes. Deliberately NOT shared with renderFleet's own per-section
// loop below: that loop's last-section grow-to-fill behavior does not
// apply here (only the two-column area as a WHOLE grows, via
// layout.hsplit padding column 1 out to METRICS' height — see the design
// doc) — every section this function draws is always at its own natural
// height. `w`: `{shown, startOffset, hidden}` for this section (from
// computeWindow/visibleWindowGrid). `ctx`: `{ cols, avgDoneMs, selected,
// sectionStartIndex, queuedTitles, queueFocus, quickStartFocus, focus,
// queueLaunchInfo }`.
function renderStackedSection(s, jumpNumber, w, ctx) {
  const cols = ctx.cols;
  const colourTitle = f.STATUS_COLOUR[s.statusKey] || ((x) => x);
  const numberedTitle = `[${jumpNumber}] ${s.title}`;
  const innerCols = Math.max(0, cols - BOX_BORDER_PADDING_COLS);

  if (!s.group.length) {
    if (!s.forceRender) return [];
    const contentLines = (s.emptyLines || [s.emptyHint || '']).map((line) => f.truncate(line, innerCols));
    if (layout.degrade(cols, contentLines.length + 2)) {
      return ['  ' + colourTitle(numberedTitle), ...contentLines, ''];
    }
    return layout.box(contentLines, { width: cols, title: colourTitle(numberedTitle), focused: false });
  }

  if (w.shown === 0) {
    return ['      ' + f.dim(`… and ${w.hidden} more ${s.title.toLowerCase()}`)];
  }

  const contentLines = [];
  for (let k = w.startOffset; k < w.startOffset + w.shown; k++) {
    const rowIndex = ctx.sectionStartIndex + k;
    if (s.kind === 'queued') {
      const ticket = s.group[k];
      const title = ctx.queuedTitles ? ctx.queuedTitles.get(ticket) : null;
      const focused = ctx.focus === 'queue' && ctx.queueFocus === k;
      for (const line of renderQueuedRow(ticket, k + 1, title, innerCols, {
        focused, speed: ctx.queueLaunchInfo && ctx.queueLaunchInfo.speed,
        agentMerge: ctx.queueLaunchInfo ? ctx.queueLaunchInfo.agentMerge : null,
      })) contentLines.push(line);
    } else if (s.kind === 'quickstart') {
      const ticket = s.group[k];
      const focused = ctx.focus === 'quickstart' && ctx.quickStartFocus === k;
      for (const line of renderQuickStartRow(ticket, focused, innerCols)) contentLines.push(line);
    } else if (s.kind === 'failed' || s.kind === 'done') {
      for (const line of renderFinishedRow(s.group[k], { cols: innerCols, avgDoneMs: ctx.avgDoneMs }, rowIndex === ctx.selected)) contentLines.push(line);
    } else {
      for (const line of renderRun(s.group[k], { cols: innerCols, avgDoneMs: ctx.avgDoneMs }, rowIndex === ctx.selected)) contentLines.push(line);
    }
  }
  if (w.hidden) contentLines.push('      ' + f.dim(`… and ${w.hidden} more`));

  if (layout.degrade(cols, contentLines.length + 2)) {
    return ['  ' + colourTitle(numberedTitle), ...contentLines, ''];
  }
  return layout.box(contentLines, { width: cols, title: colourTitle(numberedTitle), focused: false });
}

function renderFleet(runs, opts) {
  const cols = Math.max(40, (opts && opts.cols) || 80);
  const selected = (opts && opts.selected) || 0;
  // A ticket-id -> title lookup built by watch.js's draw() from the on-disk
  // ticket cache (design.md Decision 3). Read directly by the QUEUED-only
  // branch of the per-row render loop below (design.md Decision 5) — closed
  // over here rather than threaded per-call, exactly like queueState/selected.
  const queuedTitles = (opts && opts.queuedTitles) || null;
  const queueState = (opts && opts.queueState) || null;
  // CON-39: the QUEUED-local focus cursor (design.md Decision 1) — `focus`
  // defaults to 'runs' (ordinary run selection, unaffected by any of this)
  // and `queueFocus` is only meaningful while `focus === 'queue'`.
  const focus = (opts && opts.focus) || 'runs';
  const queueFocus = opts && opts.queueFocus;
  // CON-40: the QUICK START-local focus cursor (design.md Decision 3) —
  // meaningful only while `focus === 'quickstart'`, exactly like `queueFocus`
  // just above.
  const quickStartFocus = opts && opts.quickStartFocus;
  // Parsed ONCE per render, not per queued row (design.md Decision 5) — a
  // single regex exec against one shared batch-level string. Skipped
  // entirely when there is no populated QUEUED section to draw at all.
  const queueLaunchInfo = (queueState && queueState.pending && queueState.pending.length)
    ? launchplan.parseLaunchCommand(queueState.launchCommand)
    : null;

  const now = (opts && opts.now) != null ? opts.now : Date.now();
  const buckets = bucketRuns(runs);
  // The DONE section only ever shows MAX_FINISHED rows, but the average this
  // repo's deliveries are judged against must be over every delivered ticket
  // `.concertino/runs/` still has history for (design intent: "get all
  // tickets, avg time to deliver") — metricsFor's own `done` filter walks
  // the FULL `runs` array, unlike what visibleWindow later trims for
  // display. Also feeds the METRICS panel below — one shared computation,
  // not two (this used to be a separate inline avgDoneMs computation here).
  const metrics = metricsFor(runs, now);
  const avgDoneMs = metrics.avgMs;
  // Threaded into every buildSections call site (both visibleWindow's own
  // internal one and the direct one below) so METRICS' row/height cost is
  // accounted for in the height budget wherever sections are enumerated —
  // the same "opts must carry every section-shaping flag" discipline
  // quickStartTickets already established.
  const augmentedOpts = Object.assign({}, opts, { metrics });

  // Final whole-branch review, Finding 1: width alone is not enough to
  // commit to grid mode. `metricsColumnLines`' compact tier always returns
  // exactly 5 lines with no shorter fallback, but `renderFleetGrid` sizes
  // METRICS' box to exactly `columnAreaHeight` via `layout.box(content,
  // { height: columnAreaHeight })`, which renders EXACTLY `height - 2`
  // content rows and silently DROPS anything beyond that — no ellipsis, no
  // signal. A terminal can be wide AND short (a horizontally-split tmux
  // pane, a half-height terminal window), so the width-only
  // `cols >= GRID_MIN_COLS` gate can land `columnAreaHeight` in the 3-6
  // range, where METRICS renders only 1-4 of its 5 compact lines. Compute
  // what `columnAreaHeight` would actually be (visibleWindowGrid is the one
  // place that already does this arithmetic — see its own header comment)
  // and require at least 7 rows (5 content lines + 2-row border) before
  // committing to grid mode; below that, fall back to the single-column
  // path exactly as if `cols < GRID_MIN_COLS` — it already handles short
  // terminals correctly via its own existing degrade/trim logic. The
  // computed window is threaded into `renderFleetGrid` as `win` so it never
  // has to recompute it (one call, one source of truth for the decision AND
  // the render).
  if (cols >= GRID_MIN_COLS) {
    const gridWin = visibleWindowGrid(runs, augmentedOpts);
    if (gridWin.columnAreaHeight >= GRID_MIN_COLUMN_AREA_HEIGHT) {
      return renderFleetGrid(runs, {
        cols, selected, queuedTitles, queueState, focus, queueFocus, quickStartFocus,
        queueLaunchInfo, avgDoneMs, metrics, augmentedOpts, buckets, win: gridWin,
      });
    }
  }

  const { head, tail } = buildHeadTail(runs, opts);
  const win = visibleWindow(runs, augmentedOpts);
  // CON-40: forwards `opts` — the single most load-bearing of the three
  // buildSections call-site fixes (design.md Decision 4, point 2; tasks.md
  // 2.11): skipping this one specifically means QUICK START is never drawn
  // on screen AT ALL, even if digit-jump/focus are all individually correct
  // elsewhere.
  const sections = buildSections(buckets, queueState, augmentedOpts);

  const out = head.slice();
  let index = 0;
  // Lazygit-layout pass: labels each rendered section's title with its own
  // digit-jump number, right in the border — so the `1-9 jump` footer hint
  // is discoverable on screen, not just in the hint text. Incremented once
  // per section that survives BOTH early-returns below (i.e. once per
  // section actually drawn, whether boxed or degraded-flat) — exactly the
  // same population sectionJumpTargets() numbers via its own `s.group.length
  // > 0 || s.forceRender` filter, so the two can never disagree.
  let jumpNumber = 0;
  // Lazygit-layout pass: grow-to-fill. `budget` is the same `rows - 1`
  // convention this file already uses elsewhere (one row reserved for the
  // trailing newline the writer appends) — 0/absent means unbounded, in
  // which case nothing grows (byte-identical to this function's pre-change
  // output). `lastRenderableIndex` is the index (into `sections`) of the
  // LAST section that will actually draw this frame — computed once, up
  // front, via the exact same `s.group.length > 0 || s.forceRender` test
  // sectionJumpTargets() and jumpNumber above already use, so it can never
  // disagree with what the loop below actually renders.
  const budget = (opts && opts.rows) > 0 ? opts.rows - 1 : 0;
  const renderableIndices = sections
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.group.length > 0 || s.forceRender)
    .map(({ i }) => i);
  const lastRenderableIndex = renderableIndices.length ? renderableIndices[renderableIndices.length - 1] : -1;
  sections.forEach((s, i) => {
    const colourTitle = f.STATUS_COLOUR[s.statusKey] || ((x) => x);
    // CON-40, design.md Decision 4, mechanism step 3: a `forceRender`-
    // flagged, zero-eligible section (QUICK START, when explicitly toggled
    // on with nothing eligible; METRICS, always) renders a normal bordered
    // box whose content lines come from `emptyLines` — or, for QUICK
    // START's single-line case, its own `emptyHint` wrapped in an array (see
    // `contentLines` just below) — rather than being skipped outright the
    // way every other empty section still is. An empty QUICK START while
    // explicitly toggled on is itself informative, not silence; METRICS is
    // always informative by design.
    if (!s.group.length) {
      if (!s.forceRender) return;
      jumpNumber += 1;
      const numberedTitle = `[${jumpNumber}] ${s.title}`;
      const innerCols = Math.max(0, cols - BOX_BORDER_PADDING_COLS);
      // METRICS pre-fits its own lines (segment-aware, via layout.fitSegments)
      // against this same innerCols budget when buildSections builds
      // `emptyLines` — this truncate is a no-op safety net for those lines,
      // and the only truncation QUICK START's plain `emptyHint` string ever
      // gets.
      const contentLines = (s.emptyLines || [s.emptyHint || '']).map((line) => f.truncate(line, innerCols));
      const naturalBoxHeight = contentLines.length + 2;
      let boxHeight = naturalBoxHeight;
      if (budget > 0 && i === lastRenderableIndex) {
        const usedSoFar = out.length + tail.length;
        boxHeight = Math.max(naturalBoxHeight, budget - usedSoFar);
      }
      if (layout.degrade(cols, boxHeight)) {
        out.push('  ' + colourTitle(numberedTitle));
        for (const line of contentLines) out.push(line);
        out.push('');
      } else {
        for (const line of layout.box(contentLines, { width: cols, height: boxHeight, title: colourTitle(numberedTitle), focused: false })) {
          out.push(line);
        }
      }
      return;
    }
    jumpNumber += 1;
    const numberedTitle = `[${jumpNumber}] ${s.title}`;
    const w = win.sections[i];
    const hidden = w.hidden;
    const sectionStartIndex = index;
    if (!s.unselectable) index += s.group.length;

    // Fully collapsed: one line, no title and no trailing blank, no border —
    // there is nothing to put a frame around (design.md Decision 3, "a fully-
    // collapsed fleet section stays a single unbordered line"). Must stay in
    // lockstep with visibleWindow's own sectionHeight().
    if (w.shown === 0) {
      out.push('      ' + f.dim(`… and ${hidden} more ${s.title.toLowerCase()}`));
      return;
    }

    // Content is generated against the box's own inner width, not the full
    // section width — otherwise a run row sized to `cols` would overflow the
    // box by exactly the border+padding overhead once framed.
    const innerCols = Math.max(0, cols - BOX_BORDER_PADDING_COLS);
    const contentLines = [];
    for (let k = w.startOffset; k < w.startOffset + w.shown; k++) {
      // CON-40, design.md Decision 4, mechanism step 5: dispatch on `s.kind`,
      // not merely `s.unselectable` — QUEUED's `group` holds ticket-id
      // strings (looked up against `queuedTitles`), QUICK START's holds full
      // ticket OBJECTS (design.md Decision 4's own eligible-list shape).
      // Calling renderQueuedRow on a ticket object would be structurally
      // wrong, not just cosmetically — `queuedTitles.get(ticketObject)`
      // would never match, and the object itself would be passed where an
      // id string is expected.
      if (s.kind === 'queued') {
        // QUEUED rows have no run object and are never selectable — call the
        // 1-line renderer (per linesPerRow: 1) with the ticket's 1-based
        // queue position and its cached title, if any (design.md Decision 5).
        const ticket = s.group[k];
        const title = queuedTitles ? queuedTitles.get(ticket) : null;
        const focused = focus === 'queue' && queueFocus === k;
        for (const line of renderQueuedRow(ticket, k + 1, title, innerCols, {
          focused,
          speed: queueLaunchInfo && queueLaunchInfo.speed,
          agentMerge: queueLaunchInfo ? queueLaunchInfo.agentMerge : null,
        })) contentLines.push(line);
      } else if (s.kind === 'quickstart') {
        const ticket = s.group[k];
        const focused = focus === 'quickstart' && quickStartFocus === k;
        for (const line of renderQuickStartRow(ticket, focused, innerCols)) contentLines.push(line);
      } else if (s.kind === 'failed' || s.kind === 'done') {
        const rowIndex = sectionStartIndex + k;
        for (const line of renderFinishedRow(s.group[k], { cols: innerCols, avgDoneMs }, rowIndex === selected)) contentLines.push(line);
      } else {
        const rowIndex = sectionStartIndex + k;
        for (const line of renderRun(s.group[k], { cols: innerCols, avgDoneMs }, rowIndex === selected)) contentLines.push(line);
      }
    }
    if (hidden) contentLines.push('      ' + f.dim(`… and ${hidden} more`));

    const naturalBoxHeight = contentLines.length + 2;
    // Lazygit-layout pass: only the LAST section actually rendered this
    // frame grows to absorb leftover budget — every earlier section keeps
    // its natural content height exactly as before, so the frame reads
    // top-to-bottom with one box (the last) doing the filling, not every
    // box stretching independently.
    let boxHeight = naturalBoxHeight;
    if (budget > 0 && i === lastRenderableIndex) {
      const usedSoFar = out.length + tail.length;
      boxHeight = Math.max(naturalBoxHeight, budget - usedSoFar);
    }

    // Below layout.degrade()'s threshold, render exactly as this screen did
    // before this change (no frame) rather than drawing a border that would
    // itself have to be truncated into illegibility — design.md Decision 3's
    // degradation order. Per that same decision, the row COUNT is identical
    // either way (2 + 2*shown + moreFlag), so sectionHeight()/height()/budget
    // above never need to know which path a section actually took.
    if (layout.degrade(cols, boxHeight)) {
      out.push('  ' + colourTitle(numberedTitle));
      for (const line of contentLines) out.push(line);
      out.push('');
    } else {
      // All sections use the plain (unfocused) border set — the fleet
      // has one flat selection list and no second pane to contrast a
      // "focused" style against (design.md Decision 2).
      for (const line of layout.box(contentLines, { width: cols, height: boxHeight, title: colourTitle(numberedTitle), focused: false })) {
        out.push(line);
      }
    }
  });

  for (const line of tail) out.push(line);

  return out.map((l) => (f.visibleLength(l) > cols ? f.truncate(l, cols) : l)).join('\n');
}

// The two-column grid renderer (fleet-metrics-grid design): NEEDS YOU and
// FAILED as full-width banners, RUNNING/QUICK START/QUEUED/DONE stacked in
// a fixed-width column 1, METRICS filling a full-height column 2. Composes
// layout.hsplit over two independently-built panes rather than inventing
// new box-composition machinery.
function renderFleetGrid(runs, ctx) {
  const {
    cols, selected, queuedTitles, queueState, focus, queueFocus, quickStartFocus,
    queueLaunchInfo, avgDoneMs, metrics, augmentedOpts, buckets,
  } = ctx;

  const { head, tail } = buildHeadTail(runs, augmentedOpts);
  // Final whole-branch review, Finding 1: `renderFleet`'s grid-mode gate
  // (above) already computed this exact window to decide whether to call
  // this function at all — reuse it (`ctx.win`) rather than recomputing a
  // second time, so the decision and the render can never drift by even one
  // row. Falls back to computing it fresh only for direct callers/tests
  // that invoke `renderFleetGrid` without going through that gate.
  const win = ctx.win || visibleWindowGrid(runs, augmentedOpts);
  const allSections = buildSections(buckets, queueState, augmentedOpts);

  // sectionStartIndex per section, walking the FULL canonical order — the
  // same accumulation renderFleet's single-column loop and
  // sectionJumpTargets both already do, so `selected`'s meaning never
  // disagrees between single-column and grid mode.
  let flatIndex = 0;
  const sectionStartIndices = allSections.map((s) => {
    const start = s.unselectable ? null : flatIndex;
    if (!s.unselectable) flatIndex += s.group.length;
    return start;
  });

  const rowCtx = { avgDoneMs, selected, queuedTitles, queueFocus, quickStartFocus, focus, queueLaunchInfo };
  let jumpNumber = 0;
  const out = head.slice();

  allSections.forEach((s, i) => {
    if (s.kind !== 'needs-you' && s.kind !== 'failed') return;
    if (!(s.group.length > 0 || s.forceRender)) return;
    jumpNumber += 1;
    for (const line of renderStackedSection(s, jumpNumber, win.sections[i],
      Object.assign({}, rowCtx, { cols, sectionStartIndex: sectionStartIndices[i] }))) out.push(line);
  });

  const columnSections = allSections.filter((s) =>
    s.kind === 'running' || s.kind === 'quickstart' || s.kind === 'queued' || s.kind === 'done');
  const metricsSection = allSections.find((s) => s.kind === 'metrics');

  // Read directly off `win` — NEVER recompute this independently. It must
  // be the exact value visibleWindowGrid used to decide column 1's own
  // trim, or METRICS' box height and column 1's actual rendered height can
  // drift by a row and reintroduce the scroll-by-one bug the codebase's
  // "-1 for the trailing newline" convention exists to prevent.
  const columnAreaHeight = win.columnAreaHeight;

  const col1Lines = [];
  columnSections.forEach((s) => {
    const i = allSections.indexOf(s);
    if (!(s.group.length > 0 || s.forceRender)) return;
    jumpNumber += 1;
    for (const line of renderStackedSection(s, jumpNumber, win.sections[i],
      Object.assign({}, rowCtx, { cols: COLUMN_ONE_WIDTH, sectionStartIndex: sectionStartIndices[i] }))) col1Lines.push(line);
  });

  // No Math.max(40, ...) floor here (unlike other width computations in
  // this file): `cols >= GRID_MIN_COLS` (110) is already guaranteed by the
  // branch in renderFleet that calls this function, so this is always
  // `>= 39` — comfortably above layout.MIN_BOX_WIDTH (8), so layout.degrade
  // below still engages correctly whenever the terminal is genuinely too
  // narrow. A floor here was a bug, not a safety net: at cols === 110 (the
  // GRID_MIN_COLS threshold itself — the width a user resizing into grid
  // mode is most likely to land on), flooring to 40 makes the composed
  // hsplit row 70 + 1 + 40 = 111 columns wide against a 110-column budget,
  // so the final `f.truncate(l, cols)` below strips METRICS' own right
  // border and stamps a stray ellipsis on every line.
  const metricsWidth = cols - COLUMN_ONE_WIDTH - 1;
  let metricsLines = [];
  if (metricsSection) {
    jumpNumber += 1;
    const metricsInner = Math.max(0, metricsWidth - BOX_BORDER_PADDING_COLS);
    const metricsContentRows = Math.max(0, columnAreaHeight - 2);
    const content = metricsColumnLines(metrics, { cols: metricsInner, contentRows: metricsContentRows });
    const metricsColour = f.STATUS_COLOUR.metrics || ((x) => x);
    const numberedTitle = `[${jumpNumber}] ${metricsSection.title}`;
    metricsLines = layout.degrade(metricsWidth, columnAreaHeight)
      ? ['  ' + metricsColour(numberedTitle), ...content]
      : layout.box(content, { width: metricsWidth, height: columnAreaHeight, title: metricsColour(numberedTitle), focused: false });
  }

  for (const line of layout.hsplit([
    { lines: col1Lines, width: COLUMN_ONE_WIDTH },
    { lines: metricsLines, width: metricsWidth },
  ])) out.push(line);

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
  // CON-21: while the headless drafting invocation is in flight, the prompt
  // is busy — only the cancel branch above still applies (watch.js's
  // 'cancel-prompt' handler kills the child process); every other key is a
  // no-op rather than mutating a value that has already been sent off as the
  // draft's seed.
  if (prompt.drafting) return null;
  if (key === '\x7f' || key === '\b') return { type: 'prompt-backspace' };
  if (key === '\r' || key === '\n') {
    const value = (prompt.value || '').trim();
    if (!value) return { type: 'cancel-prompt' };        // empty submit = cancel
    // CON-21, design.md Decision 4: ticket-shaped input (including today's
    // "TICKET speed"/"TICKET --agent-merge" forms) keeps the existing launch
    // path unchanged; everything parseTicketInput rejects — free text, and
    // any ticket-adjacent-but-invalid value like "CON-21 nonsense" — opens
    // the ticket-draft flow instead of showing a validation error.
    if (parseTicketInput(value) !== null) return { type: 'submit-prompt', value };
    return { type: 'open-ticket-draft', seed: value };
  }
  if (key >= ' ') return { type: 'prompt-type', char: key };
  return null;
}

// CON-39, design.md Decision 1: the ordered list of sections actually
// rendered THIS frame (buildSections(...) filtered to non-empty groups, in
// existing render order) that digit N resolves against — the exact same
// buildSections()/bucketRuns() call renderFleet/visibleWindow already use,
// so this numbering can never disagree with what is actually on screen. Each
// entry also carries the runs-backed section's first GLOBAL row index (the
// same flat index space `selected` lives in) — `startIndex` is `null` for
// QUEUED, which has its own, separate index space (see 'focus-queue' below)
// and is never a slot in this one.
//
// CON-56: QUICK START is now unconditionally included by buildSections()
// (no visibility flag to thread through), so this function's only remaining
// per-section inclusion parameter is `metricsVisible`.
//
// `metricsVisible` (lazygit-layout pass) — `handleKey`'s own call site always
// passes `true` (METRICS is unconditional, just like QUICK START now is),
// but this function only needs to know whether the section is INCLUDED, not
// what it actually says, so a bare `{}` stand-in is enough; buildSections'
// METRICS branch only checks `o.metrics` for truthiness.
function sectionJumpTargets(runs, queueState, metricsVisible) {
  // CON-40, design.md Decision 4, mechanism step 4: a `forceRender`-flagged,
  // zero-eligible QUICK START is still visibly rendered (renderFleet, above)
  // and must still consume a digit, or digit numbering would disagree with
  // what is actually on screen — the exact defect this whole numbering
  // scheme exists to prevent. METRICS is the same story, always forceRender.
  const sections = buildSections(bucketRuns(runs), queueState, {
    metrics: metricsVisible ? {} : null,
  }).filter((s) => s.group.length > 0 || s.forceRender);
  let index = 0;
  return sections.map((s) => {
    const startIndex = s.unselectable ? null : index;
    if (!s.unselectable) index += s.group.length;
    return { section: s, startIndex };
  });
}

function handleKey(key, state) {
  const runs = (state && state.runs) || [];
  const selected = (state && state.selected) || 0;
  const prompt = state && state.prompt;
  const quitConfirm = state && state.quitConfirm;
  // CON-39: force-start's own y/anything-else confirmation gate — see
  // buildHeadTail's matching comment on why this is intercepted BEFORE
  // quitConfirm, not folded into it. `focus`/`queueFocus` are the QUEUED-
  // local cursor (design.md Decision 1); `queueState` is read directly off
  // state (already read below for the CON-29 confirm key).
  const forceStartConfirm = state && state.forceStartConfirm;
  const focus = (state && state.focus) || 'runs';
  const queueFocus = state && state.queueFocus;
  const queueState = state && state.queueState;
  // CON-40: the QUICK START-local focus cursor (design.md Decision 3) — read
  // straight off `state`, exactly like `queueFocus`/`queueState` just above,
  // since `handleKey` never receives `opts` (only the ticket LIST itself is
  // `opts`-only — see the digit-jump/`a`-key comments below).
  const quickStartFocus = state && state.quickStartFocus;
  // Clear Queue's own y/anything-else confirmation gate — a plain boolean,
  // checked before forceStartConfirm/quitConfirm (the newest-opened gate
  // intercepts first, same discipline as forceStartConfirm's own comment
  // just below).
  const clearQueueConfirm = state && state.clearQueueConfirm;

  if (clearQueueConfirm) {
    if (key === 'y') return { type: 'confirm-clear-queue' };
    return { type: 'cancel-clear-queue' };
  }

  // Checked first, even before quitConfirm: forceStartConfirm is the more
  // recently opened, narrower gate, and the two must never both try to claim
  // the same keypress (design.md Decision 3 / tasks.md 5.3).
  if (forceStartConfirm) {
    if (key === 'y') return { type: 'confirm-force-start', ticket: forceStartConfirm.ticket };
    return { type: 'cancel-force-start' };
  }

  // The quit-confirmation warning intercepts every key while it is up: a
  // repeated q/Ctrl-C confirms, anything else cancels back to the ordinary
  // fleet view rather than being interpreted as its usual action (moving
  // selection, attaching, ...) underneath a warning that is about to vanish.
  if (quitConfirm) {
    if (key === 'q' || key === '\u0003') return { type: 'quit' };
    return { type: 'cancel-quit' };
  }

  if (prompt) return promptKey(key, prompt);

  // CON-29: confirms a queue restored from a previous session — gated on
  // one actually being present and unconfirmed, so this key does nothing
  // (falls through to whatever else 'c' might mean, i.e. nothing today) on
  // an ordinary fleet view with no restored queue on screen.
  if (key === CONFIRM_RESTORED_QUEUE_KEY && queueState && queueState.confirmed === false) {
    return { type: 'confirm-restored-queue' };
  }

  // CON-39, design.md Decision 1: digit-key section jump, resolved
  // positionally over whatever is actually rendered this frame. A runs-
  // backed target emits 'jump' (absolute `selected`); QUEUED emits
  // 'focus-queue' and QUICK START (CON-40) emits 'focus-quickstart' instead,
  // since neither has a slot in that index space at all. Out of range (more
  // digits than sections currently on screen) is a no-op, identical to any
  // other unbound key. Handled uniformly regardless of `focus`, so pressing
  // a different section's digit while focus is 'queue'/'quickstart' exits
  // that focus and jumps as normal (tasks.md 4.3).
  if (key.length === 1 && key >= '1' && key <= '9') {
    // CON-56: QUICK START is unconditionally included (like METRICS), so
    // sectionJumpTargets only needs `metricsVisible` — always `true` here.
    const targets = sectionJumpTargets(runs, queueState, true);
    const n = parseInt(key, 10) - 1;
    if (n < 0 || n >= targets.length) return null;
    const target = targets[n];
    // CON-40, design.md Decision 3: discriminated by `target.section.kind`
    // — the old blanket `if (target.section.unselectable)` collapse was
    // correct only while QUEUED was the sole possible `unselectable`
    // section; with QUICK START (and now METRICS) added, more than one can
    // be on screen at the same time, so `kind` (not `title`, which QUEUED's
    // own is a dynamic string carrying a live pending count) is what
    // disambiguates.
    switch (target.section.kind) {
      case 'queued': return { type: 'focus-queue', index: 0 };
      case 'quickstart': return { type: 'focus-quickstart', index: 0 };
      case 'metrics': return null; // nothing to focus — a plain summary row
      default: return { type: 'jump', index: target.startIndex };
    }
  }

  // CON-39, design.md Decision 1: while focus is on QUEUED, j/k/f/Escape are
  // reinterpreted against the QUEUED-local cursor instead of the ordinary
  // run selection, and Enter/l/n/N are suppressed outright — they would
  // otherwise act on whatever `runs[selected]` was pointing at before queue-
  // focus was entered, which is not what the operator is looking at. q/
  // Ctrl-C deliberately fall through unchanged below, independent of focus.
  if (focus === 'queue') {
    if (key === 'j' || key === '\x1b[B') return { type: 'move-queue-focus', delta: 1 };
    if (key === 'k' || key === '\x1b[A') return { type: 'move-queue-focus', delta: -1 };
    if (key === 'f') {
      const pending = queueState && queueState.pending;
      const ticket = (pending && queueFocus != null) ? pending[queueFocus] : null;
      if (!ticket) return null;
      return { type: 'open-force-start-confirm', ticket };
    }
    // CON-54: opens the ticket detail view for the QUEUED-focused row —
    // resolved the same way `f`'s `open-force-start-confirm` just above
    // resolves its own `ticket`, since `queueState` genuinely lives in
    // `state` (unlike QUICK START's eligible-ticket list, `opts`-only —
    // see the `focus === 'quickstart'` block's `a` comment below).
    if (key === 't') {
      const pending = queueState && queueState.pending;
      const ticket = (pending && queueFocus != null) ? pending[queueFocus] : null;
      if (!ticket) return null;
      return { type: 'view-ticket', ticket };
    }
    if (key === '\x1b') return { type: 'exit-queue-focus' };            // bare Escape only
    if (key === '\r' || key === 'l' || key === '\x1b[C' || key === 'n' || key === 'N') return null;
  }

  // CON-40, design.md Decision 3: while focus is on QUICK START, j/k/a/
  // Escape are reinterpreted against the QUICK START-local cursor instead
  // of the ordinary run selection, and Enter/l/n/N are suppressed outright —
  // sibling to the `focus === 'queue'` block above, not folded into it (a
  // ticket row has no run/no pending-queue position; sharing one block would
  // conflate two different index spaces). `a` is emitted UNCONDITIONALLY —
  // `handleKey` has no access to the eligible ticket list at all (it is
  // `opts`-only, never part of `currentState()` — design.md Decision 3's
  // "handleKey has no ticket data" note), so unlike queue-focus's own `f`
  // branch (which can check `queueState.pending[queueFocus]` because
  // `queueState` genuinely lives in `state`), this cannot refuse `a` when
  // nothing is highlighted. Resolution — and the no-op-if-nothing-resolves
  // check — happens in watch.js's `quickstart-add` handler instead, which
  // re-derives the eligible list fresh at handling time regardless.
  if (focus === 'quickstart') {
    if (key === 'j' || key === '\x1b[B') return { type: 'move-quickstart-focus', delta: 1 };
    if (key === 'k' || key === '\x1b[A') return { type: 'move-quickstart-focus', delta: -1 };
    if (key === 'a') return { type: 'quickstart-add', index: quickStartFocus };
    // CON-54: opens the ticket detail view for the QUICK START-focused row.
    // Emitted UNCONDITIONALLY, exactly like `a`/`quickstart-add` immediately
    // above — `handleKey` has no access to the eligible ticket list (it is
    // `opts`-only), so resolution and the no-op-if-nothing-resolves check
    // both happen in watch.js's `view-ticket-quickstart` handler instead.
    if (key === 't') return { type: 'view-ticket-quickstart', index: quickStartFocus };
    if (key === '\x1b') return { type: 'exit-quickstart-focus' };       // bare Escape only
    if (key === '\r' || key === 'l' || key === '\x1b[C' || key === 'n' || key === 'N') return null;
  }

  // Bound whenever a QUEUED section is actually on screen (pending.length,
  // same gate the footer hint above uses), independent of `focus` — an
  // operator should be able to clear the queue whether or not they have
  // drilled into it. Puts the confirmation warning up; nothing is dropped
  // until the very next keypress confirms it (clearQueueConfirm, above).
  if (key === CLEAR_QUEUE_KEY && queueState && queueState.pending && queueState.pending.length) {
    return { type: 'open-clear-queue-confirm' };
  }

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
  // CON-57: opens the settings screen (view/edit concertino.config.json) —
  // confirmed free in this handleKey before being claimed (ticket.md); bound
  // unconditionally like every other fleet-screen entry point above this
  // point in the function, since every prompt/confirmation gate that would
  // need to intercept it first has already returned above.
  if (key === 's') return { type: 'open-settings' };
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
  // CON-54: additive to `l`'s run-drilldown binding just above — opens the
  // ticket detail view (not the drilldown) for the currently selected
  // RUNNING/DONE row. Only reached when neither the QUEUED nor QUICK START
  // focus block above intercepted `t` first (focus === 'runs').
  if (key === 't' && runs[selected]) {
    return { type: 'view-ticket', ticket: runs[selected].ticket };
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
    scrollOffset: state.scrollOffset,
    prompt: state.prompt,
    queueNotice: state.queueNotice,
    restoreNotice: state.restoreNotice,
    queueState: state.queueState,
    // Built by watch.js's draw() from the on-disk ticket cache and passed in
    // as a plain opt alongside queueState (design.md Decisions 3 and 5) —
    // forwarded explicitly here for the same reason queueState is, even
    // though it already arrives on `opts` unchanged.
    queuedTitles: opts && opts.queuedTitles,
    quitConfirm: state.quitConfirm,
    // CON-39: the QUEUED-local focus cursor and its own force-start
    // confirmation gate — same "read straight off state" pattern as
    // quitConfirm just above.
    focus: state.focus,
    queueFocus: state.queueFocus,
    forceStartConfirm: state.forceStartConfirm,
    // CON-40: `quickStartFocus` is read straight off `state` (currentState()
    // carries it — tasks.md 4.1), same pattern as `focus`/`queueFocus` just
    // above. `quickStartTickets`/`quickStartCold` are built fresh by
    // watch.js's draw() from the on-disk ticket cache (design.md Decision 4)
    // and forwarded explicitly here for the same reason `queuedTitles` is,
    // just above.
    quickStartFocus: state.quickStartFocus,
    quickStartTickets: opts && opts.quickStartTickets,
    quickStartCold: opts && opts.quickStartCold,
    clearQueueConfirm: state.clearQueueConfirm,
  }));
}

module.exports = {
  renderFleet, phaseFraction, handleKey, render, routeHandleKey: handleKey, PHASE_ORDER,
  CONFIRM_RESTORED_QUEUE_KEY, CLEAR_QUEUE_KEY, visibleWindow, visibleWindowGrid, computeWindow,
  sectionJumpTargets, buildSections, QUICK_START_COUNT, metricsFor,
  metricsColumnLines, renderStackedSection, GRID_MIN_COLS, COLUMN_ONE_WIDTH,
  GRID_MIN_COLUMN_AREA_HEIGHT, gridModeEligible,
};
