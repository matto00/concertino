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
const layout = require('../layout');
const markdown = require('../markdown');
const textwrap = require('../textwrap');
const docview = require('./docview');
const icons = require('../icons');
const { PHASE_ORDER } = require('./fleet');
const { confirmLines } = require('../widgets/confirm');
const footer = require('../widgets/footer');
const { sectionHeader } = require('../widgets/header');

// Lazygit-layout pass: the drill-down's own panel order — index 0-3 maps to
// digit keys 1-4 and is what \t cycles through. Distinct from PHASE_ORDER
// above; this is a fixed 4-entry list, never derived from run data. Replaces
// the old binary drillFocus (null | 'evidence') — every render now has a
// real focus value, defaulting to 'ticket' (the first panel), never null.
const DRILL_PANELS = ['ticket', 'timeline', 'gates', 'evidence'];

// Every box costs 2 columns to its border characters (one per side) and 2
// more to `box()`'s default horizontal padding — sized once here so the
// pane-width arithmetic below and the content-generation width passed to
// timelineLines/gatesLines/evidenceLines agree with each other exactly (see
// design.md Decision 1/3, and fleet.js's identical constant).
const BOX_BORDER_PADDING_COLS = 4;

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

// One line of human-readable meaning per event kind. Every kind the schema
// defines is covered so the timeline never has to fall back to printing raw
// JSON — but an unrecognised future kind still renders (as its own name)
// rather than being silently dropped, which would be its own small case of
// absent data reading as nothing-to-see-here.
function describeEvent(ev) {
  switch (ev.kind) {
    case 'run.start':
      return { label: 'run started', detail: ev.harness ? ev.harness + (ev.model ? ' · ' + ev.model : '') + (ev.speed ? ' · ' + ev.speed : '') : '' };
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
    case 'pr':
      return { label: 'PR opened', detail: ev.url || '' };
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

// Lazygit-layout pass: TIMELINE no longer hard-caps at a trailing window
// with older events silently unreachable — it now returns every event,
// windowed (scrolled) at the render call site via docview.windowBody, using
// drillTimelineScroll (watch.js). `TICKET_VIEWPORT_ROWS`/`TIMELINE`'s own
// viewport sizing (renderDrillDown, below) governs how much shows at once;
// this function's own job is only "wrap/format the full history."
function timelineLines(run, width) {
  const events = run.events || [];
  if (!events.length) {
    return [f.yellow('no events recorded — this run cannot be seen into')];
  }
  const lines = [];
  for (const ev of events) {
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

// The TICKET panel's description body is windowed (scrolled) to a fixed
// viewport-row budget, independent of terminal height or TIMELINE/GATES/
// EVIDENCE's own content length (design.md Decision 7) — a much smaller,
// safer change than teaching those panels' existing height-reconciliation
// math about a new panel above them. Lazygit-layout pass: the hard cap-with-
// a-count-row this used to have is now real scroll (docview.windowBody, at
// the render call site, using drillTicketScroll) — this constant is the
// viewport size that scroll windows against, not a hard ceiling on how much
// of the description is reachable.
const TICKET_VIEWPORT_ROWS = 5;

// Renders the TICKET panel's full content: markdown.toPlainText(description),
// wrapped to `width` — no cap, no windowing (that is the render call site's
// job now, via docview.windowBody). `ticketText` is `{ title, description }
// | null` — the same resolved value the header row reads (see headerLines
// below). A missing or blank description degrades to the same `ticket text
// unavailable` fallback the header uses, rather than an empty panel.
function ticketPanelLines(ticketText, width) {
  const description = ticketText && typeof ticketText.description === 'string' ? ticketText.description.trim() : '';
  if (!description) {
    return [f.yellow('ticket text unavailable')];
  }
  return textwrap.wrap(markdown.toPlainText(description), width);
}

function gateLine(gate, width) {
  // Reads from the shared STATUS_COLOUR vocabulary (design.md Decision 4)
  // rather than picking f.green/f.red ad hoc — "pass means green" and "fail
  // means red" now hold everywhere a gate status is rendered, not just here.
  const icon = gate.status === 'pass' ? f.STATUS_COLOUR.pass('✓')
    : gate.status === 'fail' ? f.STATUS_COLOUR.fail('✗') : f.dim('○');
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

// GATES/EVIDENCE content is bounded and known at render time — gate names,
// statuses and durations are short, and the degraded fallback strings are
// fixed text — unlike TIMELINE, whose event log carries arbitrarily long
// harness/model names, verdict refs and evidence labels. A fixed 45% split
// therefore either pads short gate names out with wasted whitespace (the
// common case) or, at a narrow enough terminal, truncates real timeline
// content it never needed to. Size the right column to what it actually
// needs — capped, so a pathological run (many long gate names or a long
// first_error) cannot crush the timeline down to nothing — and give
// whatever's left to TIMELINE.
const RIGHT_MIN = 20;
const RIGHT_MAX = 34;
const NO_GATES_WIDTH = 'no gate results recorded'.length;
const NO_EVIDENCE_WIDTH = 'no evidence recorded'.length;

function rightContentWidth(run) {
  const gates = run.gates || [];
  let w = gates.length ? 0 : NO_GATES_WIDTH;
  for (const g of gates) {
    const durStr = fmtGateDuration(g.durationMs);
    // icon(1) + space(1) + name + space(1) + duration
    w = Math.max(w, 3 + f.visibleLength(g.name || '?') + f.visibleLength(durStr));
    if (g.firstError) {
      // '  └ ' (4 cols) + the error text itself.
      w = Math.max(w, 4 + f.visibleLength(g.firstError));
    }
  }
  // EVIDENCE shares this column, and "no evidence recorded" is the common
  // case today (nothing emits that kind yet) — never size so tight that the
  // fallback message itself would need truncating.
  w = Math.max(w, NO_EVIDENCE_WIDTH);
  return Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, w));
}

// The evidence panel's own entries (evidence/verdict events), independent of
// width/rendering — shared by evidenceLines() below and by watch.js (to
// clamp `drillEvidenceIndex`'s bounds and to resolve the selected entry's
// ref/label when `↵` opens it — see handleKey below and design.md Decision
// 3b/task 3.6).
//
// CON-55: also includes `pr`-kind events (design.md Decision 1/2) — a run's
// PR, once created, is surfaced in this same list, in event order, alongside
// file-based evidence. A `pr` event has no `ref` (see evidence-telemetry's
// spec) so nothing here or downstream may assume every item in this list
// resolves to a readable file.
function evidenceItems(run) {
  return (run.events || []).filter((ev) => ev.kind === 'evidence' || ev.kind === 'pr');
}

// Same fixed-row-cap shape as timelineLines's MAX_TIMELINE (design.md
// Decision 3b) — before this change the EVIDENCE panel was unbounded-but-
// harmless (names only, nothing to select); real keyboard navigation over
// this same list now makes an unbounded panel on a busy, much-reviewed
// ticket grow taller than the terminal, leaving entries below the fold
// selectable-in-theory but unreachable.
const EVIDENCE_MAX_VISIBLE = 8;

// Resolves which entries are visible right now. Unfocused: the leading
// entries up to the cap (identical to timelineLines's own "trailing/leading
// N, with a count of the rest" shape). Focused: the window follows
// `selectedIndex` so the current selection is always inside it — the same
// "selection never scrolls out of view" property CON-6 established for
// fleet.js's own scrolling, adapted here to a flat (non-sectioned) list with
// no separately persisted scroll position of its own (this is a pure
// function of the current selection alone, recomputed fresh every render,
// not an incremental/stateful scroll — the required property, "the
// selection is always inside the visible window", holds either way).
function evidenceWindow(total, selectedIndex, focused) {
  if (!focused) {
    return { start: 0, count: Math.min(total, EVIDENCE_MAX_VISIBLE) };
  }
  // Lazygit-layout pass: delegates to the shared selectionWindow helper
  // (layout.js) — the same "keep the selection visible, scroll the minimum
  // amount" property fleet.js's own run-list scrolling and launchpad.js's
  // epics/tickets panes already use, rather than a fourth hand-rolled copy
  // of it. The unfocused branch above is preserved exactly as-is —
  // selectionWindow is only used for the focused, selection-tracking case.
  const win = layout.selectionWindow(total, selectedIndex, EVIDENCE_MAX_VISIBLE, selectedIndex);
  return { start: win.start, count: win.count };
}

function evidenceLines(run, width, opts) {
  const o = opts || {};
  const focused = !!o.focused;
  const selectedIndex = Math.max(0, o.selectedIndex || 0);
  const items = evidenceItems(run);
  if (!items.length) {
    return [f.yellow('no evidence recorded')];
  }

  const { start, count } = evidenceWindow(items.length, selectedIndex, focused);
  const lines = [];
  for (let i = start; i < start + count; i++) {
    const ev = items[i];
    const isSelected = focused && i === selectedIndex;
    // CON-55 (design.md Decision 5): a `pr`-kind entry gets the distinguishing
    // icon prefix INSTEAD OF the plain selection-marker prefix (`▸ `/`  `) —
    // file-entry rendering (the prefix, the selection marker) is unchanged.
    // Selection is still visible on a PR entry via the same f.bold() below.
    const prefix = ev.kind === 'pr' ? icons.pr + ' ' : (isSelected ? '▸ ' : '  ');
    const text = prefix + (ev.label || ev.ref || ev.url || '(untitled)');
    lines.push(f.truncate(isSelected ? f.bold(text) : text, width));
  }
  const hidden = items.length - (start + count);
  // Unfocused: the same "… N more" convention timelineLines already uses.
  // Focused: the window has already scrolled to keep the selection visible
  // (evidenceWindow, above) — hidden entries are still reachable by moving
  // the selection further, so no separate count row is needed here.
  if (!focused && hidden > 0) {
    lines.push(f.dim('  … ' + hidden + ' more'));
  }
  return lines;
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

// CON-22: the run's resolved speed + per-role models — auditable after the
// fact, per the ticket's own stated risk ("fast becomes the default in
// practice" unless it's visible). Absent (a run predating this feature, or
// one whose run.start simply never carried them) renders the same
// "(... unknown)" dim fallback harnessText() above already uses for the
// identical situation — never treated as malformed.
function speedModelsText(run) {
  if (!run.speed && !run.models) return f.dim('(speed unknown)');
  const speedPart = run.speed || f.dim('?');
  const modelsPart = run.models
    ? Object.entries(run.models).map(([role, m]) => role + '=' + m).join(' ')
    : f.dim('(models unknown)');
  return speedPart + '  ' + modelsPart;
}

// Reads the run's overall status colour from the shared STATUS_COLOUR
// vocabulary (design.md Decision 4; spec.md's "Status colour is consistent
// across screens" — "the fleet view's FAILED section heading and the
// drill-down's header both render that status with the same colour"), so a
// failed run's `endStatus`/"window exited" word carries the exact same red
// fleet.js's FAILED section title does, not a screen-local pick. `f.dim` is
// the fallback for a status this table has no entry for (e.g. `unknown`).
function elapsedText(run) {
  const statusColour = f.STATUS_COLOUR[run.status] || f.dim;
  if (run.endStatus) return statusColour(run.endStatus) + ' · ' + f.dur(run.elapsedMs);
  if (run.status === 'failed' && run.endedAt == null) {
    // CON-77: same "failed to start" vs "window exited" split as rows.js —
    // see design.md Decision 5.
    return statusColour(run.telemetry === 'none' ? 'failed to start' : 'window exited');
  }
  // CON-77: a live, pre-run.start window shows elapsed time since spawn
  // rather than falling all the way through to the bare `f.dur(elapsedMs)`
  // tail (elapsedMs is null here, since startedAt is still null too).
  if (run.telemetry === 'none' && run.spawnedAt != null) {
    return 'starting · ' + f.dur(run.startingMs);
  }
  const started = hhmm(run.startedAt);
  return (started ? 'started ' + started + ' · ' : '') + f.dur(run.elapsedMs);
}

// Draws a single panel through layout.box(), or — below layout.degrade()'s
// threshold — falls back to exactly the pre-change flat rendering (a plain
// title line followed by its content, no frame) rather than a border that
// would itself have to be truncated into illegibility (design.md Decision 3;
// spec.md's "Narrow or short terminals drop borders before content"). In
// practice this screen's own width floor (50 cols, above) and every panel
// having at least one content row (its own degradation fallback string, e.g.
// "no gate results recorded") keep every real render above both thresholds —
// this exists for the same defensive reason fleet.js's identical check does.
function pane(contentLines, opts) {
  if (layout.degrade(opts.width, opts.height)) {
    const out = [];
    if (opts.title) out.push(f.truncate(opts.title, opts.width));
    for (const line of contentLines) out.push(f.truncate(line, opts.width));
    return out;
  }
  return layout.box(contentLines, opts);
}

// The resolved ticket title as its own header row, directly under the
// ticket+changeName/phase row (design.md Decision 8). No natural
// right-aligned counterpart, so — unlike the other three rows — this one is
// not forced into splitLine's two-column shape. Falls back to the same
// `ticket text unavailable` (f.yellow) styling this screen's other
// degradation strings (`no evidence recorded`, `no gate results recorded`)
// already use, rather than an empty row.
function titleLine(ticketText, cols) {
  const title = ticketText && typeof ticketText.title === 'string' ? ticketText.title.trim() : '';
  if (!title) return f.yellow('ticket text unavailable');
  return f.truncate(f.bold(title), cols);
}

function headerLines(run, cols, ticketText) {
  const name = run.changeName || f.dim('(no branch yet)');
  const phaseRight = run.telemetry === 'none'
    ? f.yellow(run.spawnedAt != null && run.window && run.window.alive ? 'starting…' : 'no telemetry')
    : (run.phase
      ? run.phase + (run.cycle != null ? ' · c' + run.cycle : '')
      : f.dim('phase unknown'));

  const row1 = splitLine(f.bold(run.ticket) + '  ' + name, phaseRight, cols);
  const titleRow = titleLine(ticketText, cols);
  const row2 = splitLine(icons.branch + ' ' + (run.branch || f.dim('(no branch yet)')), harnessText(run), cols);
  const worktree = run.worktree || f.dim('(no worktree yet)');
  const row3 = splitLine(worktree + '   ' + portsText(run), elapsedText(run), cols);
  // CON-22: a fourth row for the run's resolved rigour — speed + per-role
  // models — truncated like every other header row rather than wrapped;
  // narrow terminals lose the tail of the models list before losing anything
  // else on screen.
  const row4 = f.truncate(speedModelsText(run), cols);

  return [row1, titleRow, row2, row3, row4];
}

function renderDrillDown(run, opts) {
  const cols = Math.max(50, (opts && opts.cols) || 80);
  const confirm = (opts && opts.confirm) || null;
  const notice = (opts && opts.notice) || null;
  const ticketText = (opts && opts.ticketText) || null;
  // Lazygit-layout pass: drillFocus is now always one of DRILL_PANELS,
  // defaulting to 'ticket' (the first panel) rather than the old binary
  // null | 'evidence' — `evidenceFocused` decides both EVIDENCE's own border
  // style and which entry (if any) the selection highlights, same as before.
  const drillFocus = (opts && opts.drillFocus) || 'ticket';
  const evidenceFocused = drillFocus === 'evidence';
  const drillEvidenceIndex = Math.max(0, (opts && opts.drillEvidenceIndex) || 0);

  // The run vanished between opening this screen and drawing it (the run's
  // log/window disappeared entirely) — render safely rather than throw.
  if (!run) {
    return [f.bold('concertino'), '', f.dim('  run no longer available'), '',
      f.dim('  esc back')].join('\n');
  }

  const out = [];
  for (const line of headerLines(run, cols, ticketText)) out.push(line);
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

  // The TICKET panel: full-width, between the phase pipeline and the
  // TIMELINE/GATES/EVIDENCE row (design.md Decision 8) — so a narrow-terminal
  // degrade (layout.degrade()) drops its border in the same top-to-bottom
  // pass as the other three panels, rather than sitting visually disconnected
  // from them. Its own height is a fixed viewport-row budget
  // (TICKET_VIEWPORT_ROWS, see ticketPanelLines), independent of and never
  // affecting the TIMELINE/GATES/EVIDENCE sizing math below (design.md
  // Decision 7) — a long description scrolls WITHIN that fixed budget
  // (docview.windowBody, using drillTicketScroll) rather than growing the
  // panel to fit it.
  const ticketInnerWidth = Math.max(0, cols - BOX_BORDER_PADDING_COLS);
  const ticketLines = ticketPanelLines(ticketText, ticketInnerWidth);
  const ticketFocused = drillFocus === 'ticket';
  const ticketContent = ticketLines.length <= TICKET_VIEWPORT_ROWS
    ? ticketLines
    : docview.windowBody(ticketLines, TICKET_VIEWPORT_ROWS, (opts && opts.ticketScroll) || 0);
  for (const line of pane(ticketContent,
    { width: cols, height: ticketContent.length + 2, title: sectionHeader({ icon: icons.ticket, label: '[1] TICKET' }), focused: ticketFocused })) out.push(line);
  out.push('');

  // GATES/EVIDENCE (per design.md Decision 2) are kept as two separate
  // stacked boxes, not merged into one — so each can independently lose its
  // border under layout.degrade() and so the ticket's own "timeline/gates/
  // evidence panels", plural, are three legible panels, not two. Lazygit-
  // layout pass: all four panels (TICKET/TIMELINE/GATES/EVIDENCE) are now
  // individually focusable (digit keys 1-4, or \t to cycle) and render with
  // the heavy border set exactly when they hold focus — see layout.js's
  // BORDERS.focused, already used identically by launchpad.js's own
  // epics/tickets pane switch.
  const GAP = 1; // hsplit()'s own one-column gap between panes
  const minLeftContent = 24;
  // Total non-content overhead: two boxes' worth of border+padding (one per
  // column) plus the gap between them.
  const totalOverhead = 2 * BOX_BORDER_PADDING_COLS + GAP;
  // Never let the gates column's content-driven width push TIMELINE (and
  // the role gutter within it, which keeps its own full, untruncated width
  // regardless) below its own floor.
  const rightContentW = Math.max(RIGHT_MIN,
    Math.min(rightContentWidth(run), cols - totalOverhead - minLeftContent));
  const leftContentW = Math.max(minLeftContent, cols - totalOverhead - rightContentW);
  const leftPaneWidth = leftContentW + BOX_BORDER_PADDING_COLS;
  const rightPaneWidth = rightContentW + BOX_BORDER_PADDING_COLS;

  // reducer.js already counts, per run, a `malformed` total that now covers
  // two distinct things (see CON-3): a crashed emitter's half-written line
  // that never became an event at all, and an event that WAS recorded but
  // carried a field the reducer rejected (e.g. an unrecognised `phase.enter`
  // value) — that second kind is still sitting in the timeline below, with
  // its literal (bad) value visible. fleet.js sums the total fleet-wide but
  // attributes it to no single run. This screen's entire job is explaining
  // ONE run, so its own corrupted/rejected-event count belongs here, next
  // to the timeline it undermines: without it, a run with gaps or rejected
  // fields in its own log renders as a clean, merely-short history — absent
  // data reading as healthy data, on the one screen whose job is to say
  // otherwise. It is now woven into TIMELINE's own box title rather than a
  // plain content line, using the same truncation contract box() already
  // gives every title (f.truncate, ANSI-aware).
  const timelineTitle = sectionHeader({ icon: icons.timeline, label: '[2] TIMELINE' }) + (run.malformed
    ? '  ' + f.yellow('▲ ' + run.malformed + ' malformed')
    : '');
  const gatesTitle = sectionHeader({ icon: icons.gates, label: '[3] GATES' }) + (run.cycle != null ? ' · cycle ' + run.cycle : '');
  const evidenceTitle = sectionHeader({ icon: icons.evidence, label: '[4] EVIDENCE' });
  const timelineFocused = drillFocus === 'timeline';
  const gatesFocused = drillFocus === 'gates';

  // TIMELINE now holds the FULL event history (timelineLines' own hard cap
  // was removed) — windowed here to a fixed viewport (matching the old
  // MAX_TIMELINE's visual size) with real scroll (docview.windowBody, using
  // drillTimelineScroll) instead of a silent, unreachable "only the last 14"
  // cutoff. `leftNaturalHeight` below still reasons about this WINDOWED
  // length, preserving the existing left/right reconciliation shape.
  //
  // Unlike TICKET/GATES (top-anchored: offset 0 = the beginning, scrolling
  // "down" moves toward the end), TIMELINE is a log-tail: `timelineScroll`
  // is "how many entries scrolled BACK from the tail" — 0 means "show the
  // most recent entries" (matching the old trailing-window default), and
  // increasing it reveals progressively older history. watch.js's own
  // 'drill-panel-scroll' handler inverts the raw up/down delta for exactly
  // this panel to make that mapping hold — see its own comment.
  const TIMELINE_VIEWPORT_ROWS = 14;
  const timelineAllLines = timelineLines(run, leftContentW);
  const timelineViewportRows = Math.min(timelineAllLines.length, TIMELINE_VIEWPORT_ROWS);
  const timelineContentRows = Math.max(0, timelineViewportRows - 1); // windowBody's own reserved indicator row
  const timelineMaxStart = Math.max(0, timelineAllLines.length - timelineContentRows);
  const timelineScrollBack = (opts && opts.timelineScroll) || 0;
  const timelineContent = timelineAllLines.length <= timelineViewportRows
    ? timelineAllLines
    : docview.windowBody(timelineAllLines, timelineViewportRows, Math.max(0, timelineMaxStart - timelineScrollBack));
  // GATES gains the same defensive scroll TICKET/TIMELINE already have —
  // gate counts are small in practice (this is real-world overkill for
  // almost every run), but no longer silently unbounded for a pathological
  // one. Top-anchored (offset 0 = first gate), like TICKET — not a log-tail
  // the way TIMELINE is, so no delta inversion needed.
  const GATES_VIEWPORT_ROWS = 10;
  const gatesAllLines = gatesLines(run, rightContentW);
  const gatesViewportRows = Math.min(gatesAllLines.length, GATES_VIEWPORT_ROWS);
  const gatesContent = gatesAllLines.length <= gatesViewportRows
    ? gatesAllLines
    : docview.windowBody(gatesAllLines, gatesViewportRows, (opts && opts.gatesScroll) || 0);
  const evidenceContent = evidenceLines(run, rightContentW, { focused: evidenceFocused, selectedIndex: drillEvidenceIndex });

  const gatesBoxHeight = gatesContent.length + 2;
  const evidenceBoxHeightNatural = evidenceContent.length + 2;
  const rightTotalHeight = gatesBoxHeight + evidenceBoxHeightNatural;
  const leftNaturalHeight = timelineContent.length + 2;
  // Height reconciliation across hsplit()'s panes is the caller's job
  // (design.md Decision 3): the right column is two boxes whose combined
  // border overhead (4 rows) exceeds the left column's single box (2 rows),
  // so whichever side is naturally shorter gets padded — via box()'s own
  // `height` option, which blank-pads any content rows beyond what the
  // content itself provides — up to the taller side's total. In the common
  // case (TIMELINE and GATES+EVIDENCE already carry roughly the same amount
  // of raw content), this is exactly "pad TIMELINE's content by 2 extra
  // blank rows to absorb the right column's extra border overhead".
  let targetHeight = Math.max(leftNaturalHeight, rightTotalHeight);
  // Lazygit-layout pass: TIMELINE is also the FLEX panel against the outer
  // terminal height, not just against its own column — grows to consume any
  // leftover budget below this row, pinning the footer to the last row
  // exactly like fleet.js's own last-section growth (Task 8). `rows`
  // 0/absent (unbounded) leaves `targetHeight` untouched, byte-identical to
  // this function's pre-change output.
  // Footer hints, built HERE — ahead of the height budget below — so
  // f.hintLines' wrapped row count (and the notice/confirm blocks) is
  // reserved rather than pushing the frame past `rows`. `isLive(run)` is
  // cheap and pure, so computing it here for the hint list (and reusing the
  // result at the render site below) costs nothing.
  const live = isLive(run);
  // `footerLines` is only ever set (and only ever rendered) for the
  // evidenceFocused/default branches — the confirm branch has no `hints`
  // array and is not a footer computation at all (design-gate round 2): its
  // row count instead comes straight from confirmLines()'s own always-2-line
  // contract (Decision 1, task 1.4), never from footer(). Both branches that
  // DO build a real footer read `rows` off footer()'s own return value
  // (task 3.3) rather than re-deriving `.length` a second time.
  let footerLines = null;
  let footerRowCount;
  if (confirm) {
    footerRowCount = 2; // confirmLines() always returns exactly 2 lines — see widgets/confirm.js
  } else if (evidenceFocused) {
    const f1 = footer.footer({ hints: ['1-4 jump', 'tab cycle', 'j/k select', '↵ open', 'esc back'], cols });
    footerLines = f1.lines;
    footerRowCount = f1.rows;
  } else {
    // Lazygit-layout pass: TICKET/TIMELINE/GATES scroll via arrow/page keys
    // ONLY — never bare j/k — so `k kill`/`r restart` stay reachable exactly
    // as they already are today, regardless of which of these three panels
    // currently holds focus (only EVIDENCE focus, above, blocks them).
    const hints = ['1-4 jump', 'tab cycle', '↑/↓ scroll', '↵ attach'];
    if (live) hints.push('k kill', 'r restart');
    hints.push('esc back');
    const f2 = footer.footer({ hints, cols });
    footerLines = f2.lines;
    footerRowCount = f2.rows;
  }

  const rows = (opts && opts.rows) || 0;
  if (rows > 0) {
    const budget = rows - 1;
    // Rows this frame will cost BELOW the TIMELINE/GATES/EVIDENCE row: the
    // blank line after it, the notice block (its line plus its own trailing
    // blank) when present, and the confirm/footer block — `out` already
    // holds every header row, the phase pipeline, and the TICKET panel by
    // this point in the function.
    const belowRow = 1 + (notice ? 2 : 0) + footerRowCount;
    const outerBudget = budget - out.length - belowRow;
    targetHeight = Math.max(targetHeight, outerBudget);
  }
  const evidenceBoxHeight = evidenceBoxHeightNatural + Math.max(0, targetHeight - rightTotalHeight);

  const timelineBox = pane(timelineContent,
    { width: leftPaneWidth, height: targetHeight, title: timelineTitle, focused: timelineFocused });
  const gatesBox = pane(gatesContent,
    { width: rightPaneWidth, height: gatesBoxHeight, title: gatesTitle, focused: gatesFocused });
  const evidenceBox = pane(evidenceContent,
    { width: rightPaneWidth, height: evidenceBoxHeight, title: evidenceTitle, focused: evidenceFocused });

  const rightColumn = gatesBox.concat(evidenceBox);
  for (const line of layout.hsplit([
    { lines: timelineBox, width: leftPaneWidth },
    { lines: rightColumn, width: rightPaneWidth },
  ])) out.push(line);
  out.push('');

  if (notice) {
    out.push('  ' + f.red(f.truncate(notice, cols - 4)));
    out.push('');
  }

  if (confirm) {
    const verb = confirm === 'kill' ? 'kill' : 'restart';
    const warning = confirm === 'kill'
      ? 'ends the agent mid-run — it cannot resume'
      : 'kills the current run mid-progress and starts over — it cannot resume the old one';
    for (const line of confirmLines({
      warning: f.red(f.bold(verb + ' ' + run.ticket + '?') + ' ' + warning),
      confirmHint: 'y confirm   (any other key) cancel',
    })) out.push(line);
  } else {
    // While EVIDENCE holds focus, ↵ attach / k kill / r restart are neither
    // bound (handleKey below) nor advertised — the whole point of the focus
    // gate (design.md Decision 3; spec.md's "Evidence focus exposes
    // selection and open, not attach/kill/restart"). Which hint set applies
    // was decided above, ahead of the height budget — see `footerLines`.
    for (const line of footerLines) out.push(line);
  }

  return out.map((l) => f.truncate(l, cols)).join('\n');
}

// Given a keypress and the local screen state ({ run, confirm, drillFocus,
// drillEvidenceIndex }), returns an action for watch.js to carry out, or
// null for "no-op, no redraw". Never mutates, same seam as escalation.js.
function handleKey(key, state) {
  const run = state && state.run;
  const confirm = state && state.confirm;
  const drillFocus = (state && state.drillFocus) || 'ticket';
  const drillEvidenceIndex = Math.max(0, (state && state.drillEvidenceIndex) || 0);

  if (!run) {
    if (key === '\x1b') return { type: 'back' };
    return null;
  }

  // A destructive action needs a deliberate 'y'; anything else — including
  // esc — backs out of the confirmation without acting, so there is no key
  // that both cancels AND does something else by accident.
  //
  // The confirmation can sit on screen across many one-second poll cycles
  // while a human reads the warning, and `run` here is always the freshest
  // one the router could find (routeHandleKey re-derives it from state.runs
  // on every keypress, never a snapshot taken when the screen opened) — so
  // re-checking isLive here, not only when the confirmation was opened, is
  // what catches a run that finished in that window. A stale 'y' is treated
  // exactly like any other key: it cancels rather than silently no-opping,
  // so the confirmation never lingers on screen looking actionable. This is
  // the first of two independent checks — watch.js's applyAction (via
  // control.js) re-derives the same thing again before it touches tmux, the
  // same belt-and-braces property escalation.js has for a stale escalation.
  if (confirm) {
    if (key === 'y' && isLive(run)) {
      return { type: confirm === 'kill' ? 'kill-confirmed' : 'restart-confirmed', ticket: run.ticket };
    }
    return { type: 'cancel-confirm' };
  }

  if (key === '\x1b') return { type: 'back' };

  const items = evidenceItems(run);

  // Lazygit-layout pass: digit 1-4 jumps directly to a panel; \t cycles
  // through all four in DRILL_PANELS order. Both are unconditional — unlike
  // the old EVIDENCE-only toggle, every panel (including an empty EVIDENCE)
  // is a legitimate focus target now, since TICKET/TIMELINE/GATES also
  // scroll their own content.
  if (key.length === 1 && key >= '1' && key <= '4') {
    return { type: 'switch-drill-focus', focus: DRILL_PANELS[parseInt(key, 10) - 1] };
  }
  if (key === '\t') {
    const idx = DRILL_PANELS.indexOf(drillFocus);
    return { type: 'switch-drill-focus', focus: DRILL_PANELS[(idx + 1) % DRILL_PANELS.length] };
  }

  if (drillFocus === 'evidence') {
    // ↵ attach / k kill / r restart are inert while EVIDENCE holds focus —
    // not merely unadvertised (the footer above already omits their hints);
    // this is the second half of that same refusal (design.md Decision 3).
    if (key === 'j' || key === '\x1b[B') return { type: 'move-drill-evidence', delta: 1 };
    if (key === 'k' || key === '\x1b[A') return { type: 'move-drill-evidence', delta: -1 };
    if (key === '\r') {
      const ev = items[drillEvidenceIndex];
      if (!ev) return null;
      // CON-55 (design.md Decision 3): a `pr`-kind entry opens externally
      // (the OS browser) instead of the in-TUI doc reader — a distinct
      // action, `open-external-url`, carrying a `url` rather than a `ref`.
      // An `evidence`-kind entry's action is byte-for-byte unchanged.
      if (ev.kind === 'pr') {
        return { type: 'open-external-url', ticket: run.ticket, url: ev.url, label: ev.label };
      }
      // Never reads the file itself — the renderer stays pure (task 3.6).
      // watch.js's 'open-evidence-doc' handler does the actual read.
      return { type: 'open-evidence-doc', ticket: run.ticket, ref: ev.ref, label: ev.label };
    }
    return null;
  }

  // TICKET/TIMELINE/GATES scroll via arrow/page keys ONLY — deliberately
  // never bare j/k, which stay free for k kill/r restart below exactly as
  // they already are today (see the footer's own matching comment for why
  // this screen cannot give j/k a second meaning the way EVIDENCE does).
  if (drillFocus === 'ticket' || drillFocus === 'timeline' || drillFocus === 'gates') {
    if (key === '\x1b[B') return { type: 'drill-panel-scroll', panel: drillFocus, delta: 1 };
    if (key === '\x1b[A') return { type: 'drill-panel-scroll', panel: drillFocus, delta: -1 };
    // Page up/down use a fixed 5-line jump rather than a viewport-relative
    // one — docview.js's own page-jump is viewport-sized, but that requires
    // a precomputed viewport-rows value threaded through state per panel
    // (docview.js's own `docViewportRows` precedent); a fixed size avoids
    // that plumbing for a v1 pass and is still a clear improvement over no
    // page key at all.
    if (key === '\x1b[5~') return { type: 'drill-panel-scroll', panel: drillFocus, delta: -5 };
    if (key === '\x1b[6~') return { type: 'drill-panel-scroll', panel: drillFocus, delta: 5 };
  }

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
    ticketText: (opts && opts.ticketText) || null,
    drillFocus: state.drillFocus,
    drillEvidenceIndex: state.drillEvidenceIndex,
    ticketScroll: state.drillTicketScroll,
    timelineScroll: state.drillTimelineScroll,
    gatesScroll: state.drillGatesScroll,
  }));
}

function routeHandleKey(key, state) {
  const run = (state.runs || []).find((r) => r.ticket === state.drillTicket) || null;
  return handleKey(key, {
    run, confirm: state.drillConfirm,
    drillFocus: state.drillFocus, drillEvidenceIndex: state.drillEvidenceIndex,
  });
}

module.exports = {
  renderDrillDown, handleKey, render, routeHandleKey,
  isLive, fmtGateDuration, describeEvent, phasePipeline,
  ticketPanelLines, TICKET_VIEWPORT_ROWS,
  evidenceItems, evidenceLines, EVIDENCE_MAX_VISIBLE,
  DRILL_PANELS,
};
