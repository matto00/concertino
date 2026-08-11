'use strict';

// Fleet METRICS: the fleet-wide roll-up (metricsFor) and the METRICS
// panel/column content it renders to (metricsColumnLines).

const f = require('../../format');
const layout = require('../../layout');
// selectable-escalations-list design.md Decision 1: the raised/resolved
// pairing walk below reuses reducer.js's OWN `toOptions()`/`sub_questions`
// normalization exactly — never a second, hand-rolled parser for the same
// raw `escalation.raised` fields reducer.js's live-escalation fold already
// normalizes.
const { toOptions, parseSubQuestions } = require('../../reducer');

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

// Fixed row cap and gate threshold for the expanded tier's multi-row
// throughput chart — see the multi-row-metrics-charts design doc's
// Decisions 2 (fixed row cap) and 3 (gating threshold, and exactly how the
// label/stats text combines with the chart rows) for the reasoning behind
// both numbers.
const MULTI_ROW_THROUGHPUT_ROWS = 3;
const MULTI_ROW_THROUGHPUT_MIN_CONTENT_ROWS = 14;

// `sub_answers` arrives as a JSON-STRING-encoded array (the same generic k=v
// mechanism `sub_questions` itself uses) — parsed defensively, degrading to
// an empty array (never throwing) on anything torn/malformed, mirroring
// reducer.js's own `parseSubQuestions` discipline for the sibling field.
function parseSubAnswers(v) {
  if (v == null) return [];
  try {
    const parsed = typeof v === 'string' ? JSON.parse(v) : v;
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

// selectable-escalations-list design.md Decision 1: walks each run's own
// `events` array ONCE, in order, opening a new history entry on every
// `escalation.raised` and closing the most-recently-opened, still-open entry
// for that run on the next `escalation.answered`/`escalation.timeout` it
// sees. An `escalation.answered`/`.timeout` with no currently-open entry to
// close (e.g. pruned by event-log retention) is simply ignored — never
// invented as a bare decision with no question (spec.md's own requirement).
// A multi-part escalation's `sub_answers` are joined into one `decision`
// string, one place the historical detail view can show "the decision"
// rather than a second, read-only wizard step-through.
function buildEscalationHistory(list) {
  const history = [];
  for (const r of list) {
    let open = null; // this run's currently-open (unresolved) entry, if any
    for (const ev of r.events || []) {
      if (ev.kind === 'escalation.raised') {
        open = {
          ticket: ev.ticket, role: ev.role || null, question: ev.question || '',
          options: toOptions(ev.options), subQuestions: parseSubQuestions(ev.sub_questions),
          raisedAt: ev.t,
          resolved: false, decision: null, resolvedAt: null, timedOut: false,
        };
        history.push(open);
      } else if (ev.kind === 'escalation.answered') {
        if (!open) continue; // orphaned resolution — never surfaced
        open.resolved = true;
        open.resolvedAt = ev.t;
        if (Array.isArray(open.subQuestions) && open.subQuestions.length && ev.sub_answers != null) {
          const subAnswers = parseSubAnswers(ev.sub_answers);
          open.decision = open.subQuestions
            .map((sq, i) => (sq.question || '') + ': ' + (subAnswers[i] == null ? '' : subAnswers[i]))
            .join('; ');
        } else {
          open.decision = ev.answer != null ? ev.answer : null;
        }
        open = null;
      } else if (ev.kind === 'escalation.timeout') {
        if (!open) continue; // orphaned resolution — never surfaced
        open.resolved = true;
        open.resolvedAt = ev.t;
        open.timedOut = true;
        open.decision = null;
        open = null;
      }
    }
  }
  history.sort((a, b) => b.raisedAt - a.raisedAt);
  return history;
}

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

  // track-per-run-cost-spend, specs/fleet-metrics-spend/spec.md: fleet-wide
  // spend for a window is the sum of every `run.cost` EVENT (not run.costUsd
  // totals) whose own `t` falls inside that window — METRICS' today/week
  // windowing needs each event's own timestamp, not just the run's aggregate
  // (design.md Decision 1). Coverage is scoped to the SAME "terminal run
  // ended in this window" set rateFor/deliveredToday/deliveredWeek already
  // use above: `reporting` counts how many of those runs have at least one
  // run.cost event inside the window; `total` is that same terminal-run
  // count. A run contributes 0 to the dollar numerator when it never
  // reported (never silently excluded from the denominator, never treated as
  // a genuine $0 — spec.md's own "never fabricate" requirement) and its
  // cost_usd is parsed the same NaN-tolerant way reducer.js's own run.cost
  // fold already does (design.md Decision 6), since these are raw events,
  // not the reducer's own accumulated run.costUsd.
  const spendFor = (windowStart) => {
    const inWindowTerminal = terminal.filter((r) => r.endedAt >= windowStart);
    const total = inWindowTerminal.length;
    if (!total) return { usd: null, reporting: 0, total: 0 };
    let usd = 0;
    let reporting = 0;
    for (const r of inWindowTerminal) {
      let reportedThisWindow = false;
      for (const ev of r.events || []) {
        if (ev.kind !== 'run.cost' || ev.t < windowStart) continue;
        reportedThisWindow = true;
        const parsed = Number(ev.cost_usd);
        if (!Number.isNaN(parsed)) usd += parsed;
      }
      if (reportedThisWindow) reporting++;
    }
    return { usd, reporting, total };
  };
  const spend = { today: spendFor(todayStart), week: spendFor(weekStart) };

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

  // selectable-escalations-list design.md Decision 1: every escalation.raised
  // event across all history, paired — by event order within that run's own
  // `events` array (neither event carries a correlation id, and a run can
  // only ever have one escalation open at a time — reducer.js's
  // `escalation.raised` case clobbers `run.escalation` unconditionally) —
  // with the `escalation.answered`/`escalation.timeout` that resolved it, if
  // any has occurred yet. Newest first, NOT capped here; the METRICS
  // rendering layer decides how many rows it has room to show (a terminal's
  // available height, not this function's business).
  const recentEscalations = buildEscalationHistory(list);

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

  // Per-harness / per-model breakdown: the exact same "terminal run" and
  // "withElapsed" definitions successRate/avgMs already use above, restricted
  // to each distinct key's own runs and computed over ALL history (like
  // verdictRates/gateRates above, not a today/week window — a per-key
  // breakdown is a smaller sample than the fleet-wide number, and a window
  // would make most buckets n/a on a typical fleet). Runs with no value for
  // the grouping field are excluded entirely — no "unknown" bucket. A key
  // with runs but none yet terminal still gets an entry, with the same
  // n/a-compatible `{ rate: null, done: 0, total: 0 }` shape rateFor already
  // produces above, not a special case.
  const buildBreakdown = (keyField) => {
    const keys = [];
    for (const r of list) {
      const key = r[keyField];
      if (key != null && !keys.includes(key)) keys.push(key);
    }
    return keys.map((key) => {
      const keyTerminal = terminal.filter((r) => r[keyField] === key);
      const total = keyTerminal.length;
      const doneCount = keyTerminal.filter((r) => r.status === 'done').length;
      const rate = total ? { rate: doneCount / total, done: doneCount, total } : { rate: null, done: 0, total: 0 };
      const keyWithElapsed = withElapsed.filter((r) => r[keyField] === key);
      const keyAvgMs = keyWithElapsed.length
        ? keyWithElapsed.reduce((sum, r) => sum + r.elapsedMs, 0) / keyWithElapsed.length
        : null;
      return { [keyField]: key, rate, avgMs: keyAvgMs };
    });
  };
  const harnessBreakdown = buildBreakdown('harness');
  const modelBreakdown = buildBreakdown('model');

  return {
    avgMs, deliveredToday, deliveredWeek, escalationsToday,
    successRate, spend, throughput, throughput30d, verdictRates, gateRates,
    durationBuckets, recentEscalations, harnessBreakdown, modelBreakdown,
  };
}

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
  // selectable-escalations-list design.md Decision 3: the fleet view's
  // `focus === 'metrics'` mode passes these through; unfocused (the default),
  // this changes nothing — the leading-`rowsForList`-entries rendering below
  // stays byte-for-byte what it was before this change.
  const focused = !!o.focused;
  const selectedIndex = Math.max(0, o.selectedIndex || 0);

  // Defensive defaults: sectionJumpTargets() (below) deliberately passes
  // `{}` for `o.metrics` when it only needs to know METRICS is included,
  // not what it says — these nested shapes do not tolerate dereferencing
  // straight into e.g. `m.successRate.today` the way the old single-scalar
  // `avgMs` field did.
  const successRate = m.successRate || {
    today: { rate: null, done: 0, total: 0 },
    week: { rate: null, done: 0, total: 0 },
  };
  const spend = m.spend || {
    today: { usd: null, reporting: 0, total: 0 },
    week: { usd: null, reporting: 0, total: 0 },
  };
  const throughput = m.throughput || [0, 0, 0, 0, 0, 0, 0];
  const throughput30d = m.throughput30d || new Array(30).fill(0);
  const verdictRates = m.verdictRates || {};
  const gateRates = m.gateRates || {};
  const durationBuckets = m.durationBuckets || { under10: 0, from10to30: 0, over30: 0 };
  const recentEscalations = m.recentEscalations || [];
  const harnessBreakdown = m.harnessBreakdown || [];
  const modelBreakdown = m.modelBreakdown || [];

  // `escalations today` lives on line 1, not packed into line 2's
  // fitSegments call — see the fleet-metrics-charts design doc for why
  // (it was the first thing fitSegments dropped at a standard 80-column
  // terminal when tried on line 2).
  const avgText = m.avgMs != null ? f.dur(m.avgMs) : 'n/a';

  // track-per-run-cost-spend, specs/fleet-metrics-spend/spec.md: the spend
  // segments join the rest of line 1 (rather than a dedicated new line,
  // which would grow METRICS' compact tier past its fixed 5-content-row
  // budget — see grid.js's GRID_MIN_COLUMN_AREA_HEIGHT, sized exactly around
  // that count). Unlike the rest of line 1's fields (plain concatenation,
  // never truncated segment-by-segment), the whole line is now built via
  // fitSegments so a narrow terminal drops trailing segments gracefully
  // instead of a hard mid-word cut — spend's own coverage parenthetical can
  // make this line meaningfully longer than before.
  const spendText = (s, coverageStyle) => {
    if (s.total === 0) return 'n/a';
    const dollar = '$' + s.usd.toFixed(2);
    if (s.reporting === s.total) return dollar;
    return coverageStyle === 'short'
      ? `${dollar} (${s.reporting}/${s.total})`
      : `${dollar} (${s.reporting}/${s.total} runs reporting)`;
  };
  const line1Segments = [
    `avg delivery ${avgText}`,
    `delivered today ${m.deliveredToday ?? 0}`,
    `this week ${m.deliveredWeek ?? 0}`,
    `escalations today ${m.escalationsToday ?? 0}`,
    `spend today ${spendText(spend.today, 'long')}`,
    `week ${spendText(spend.week, 'short')}`,
  ];
  const line1 = layout.fitSegments(line1Segments, cols);

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
  const throughputPrefix = `throughput (${throughputWindowLabel})  `;
  const throughputSuffix = `  avg ${throughputAvg}/day · peak ${throughputPeak}`;

  // Expanded tier, sufficiently tall: the throughput chart renders across
  // MULTI_ROW_THROUGHPUT_ROWS stacked rows via multiRowSparkline() instead
  // of a single sparkline() row — see design.md Decision 3 for exactly how
  // the prefix/suffix combine with the chart rows (inlined onto the BOTTOM
  // row only; the other rows are left-padded to keep columns aligned, with
  // no separate label line). Below this threshold, or in the compact tier,
  // line3 stays exactly today's single-row sparkline() — unchanged.
  const useMultiRowThroughput = expanded && contentRows >= MULTI_ROW_THROUGHPUT_MIN_CONTENT_ROWS;
  let throughputLines;
  if (useMultiRowThroughput) {
    const chartRows = f.multiRowSparkline(throughputData, MULTI_ROW_THROUGHPUT_ROWS);
    const pad = ' '.repeat(f.visibleLength(throughputPrefix));
    throughputLines = chartRows.map((row, i) => (
      i === chartRows.length - 1 ? throughputPrefix + row + throughputSuffix : pad + row
    ));
  } else {
    throughputLines = [throughputPrefix + f.sparkline(throughputData) + throughputSuffix];
  }
  const line3 = throughputLines[0];

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

  // Expanded tier: the fixed blocks below cost 8 lines for a given terminal,
  // plus 1 more for each harness/model breakdown line that renders (0-2);
  // whatever's left goes to "recent escalations" — see the design doc for
  // why that specific block is the one that absorbs leftover vertical space
  // (it's the only unbounded-length real data METRICS has).
  const durationTotal = durationBuckets.under10 + durationBuckets.from10to30 + durationBuckets.over30;
  const durationPrefix = 'duration  ';
  const line7 = durationTotal
    ? durationPrefix + layout.fitSegments([
        `<10m ${Math.round(durationBuckets.under10 / durationTotal * 100)}%`,
        `10-30m ${Math.round(durationBuckets.from10to30 / durationTotal * 100)}%`,
        `30m+ ${Math.round(durationBuckets.over30 / durationTotal * 100)}%`,
      ], cols - durationPrefix.length)
    : durationPrefix + 'no data yet';

  // Per-harness / per-model breakdown lines: same visual vocabulary as
  // line2's rateSegment (f.bar + rounded %) plus f.dur for avg duration, so
  // these lines read consistently with the existing success/verdicts lines.
  // Rendered only when there's more than one distinct value — a
  // single-harness/single-model fleet renders neither, matching today's
  // expanded tier exactly (the acceptance criterion for this block).
  const breakdownSegment = (key, entry) => {
    const rateText = entry.rate.rate == null
      ? 'n/a'
      : `${f.bar(entry.rate.rate, 10)} ${Math.round(entry.rate.rate * 100)}% (${entry.rate.done}/${entry.rate.total})`;
    const durText = entry.avgMs != null ? f.dur(entry.avgMs) : 'n/a';
    return `${key} ${rateText} · avg ${durText}`;
  };
  const harnessPrefix = 'by harness  ';
  const line8 = harnessBreakdown.length > 1
    ? harnessPrefix + layout.fitSegments(harnessBreakdown.map((e) => breakdownSegment(e.harness, e)), cols - harnessPrefix.length)
    : null;
  const modelPrefix = 'by model  ';
  const line9 = modelBreakdown.length > 1
    ? modelPrefix + layout.fitSegments(modelBreakdown.map((e) => breakdownSegment(e.model, e)), cols - modelPrefix.length)
    : null;
  const breakdownLines = [line8, line9].filter((l) => l != null);

  const fixedLines = [line1, line2, ...throughputLines, line4, line5, '', line7, ...breakdownLines, ''];
  const remaining = Math.max(0, contentRows - fixedLines.length);
  if (remaining === 0) return fixedLines;

  const escLineText = (esc, isSelected) => {
    const time = new Date(esc.raisedAt).toISOString().slice(11, 16);
    const rolePart = esc.role ? esc.role + '  ' : '';
    const prefix = isSelected ? '▸ ' : '  ';
    const text = `${prefix}${time}  ${esc.ticket}  ${rolePart}"${esc.question}"`;
    return f.truncate(isSelected ? f.bold(text) : text, cols);
  };

  const escalationLines = ['recent escalations'];
  const rowsForList = remaining - 1;
  if (rowsForList > 0) {
    if (!recentEscalations.length) {
      escalationLines.push('  no escalations yet');
    } else if (focused) {
      // selectable-escalations-list design.md Decision 3: windows the FULL
      // history (not just what `rowsForList` alone could show) through the
      // exact same `layout.selectionWindow` call drilldown.js's own
      // `evidenceWindow` makes, `rowsForList` standing in for
      // EVIDENCE_MAX_VISIBLE — the window scrolls to keep `selectedIndex` in
      // view, and the selected row renders `f.bold()` with a `▸ ` marker,
      // matching `evidenceLines()`'s own `isSelected` convention exactly.
      const win = layout.selectionWindow(recentEscalations.length, selectedIndex, rowsForList, selectedIndex);
      for (let i = win.start; i < win.start + win.count; i++) {
        escalationLines.push(escLineText(recentEscalations[i], i === selectedIndex));
      }
    } else {
      for (const esc of recentEscalations.slice(0, rowsForList)) {
        escalationLines.push(escLineText(esc, false));
      }
    }
  }
  return fixedLines.concat(escalationLines);
}

module.exports = { metricsFor, metricsColumnLines };
