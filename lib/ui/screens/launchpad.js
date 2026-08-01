'use strict';

// The launch pad's epic browser. Pure: (state, opts) -> string, matching every
// other screen's seam. Per the design doc's "Launch pad — epics left,
// tickets right" mockup: epics in a left pane, the selected epic's tickets in
// a right pane carrying an inline status column.
//
// That inline status column is the reason this layout won over the
// alternative the user was shown (a single flat ticket list with a status
// suffix) — a ticket already In Progress in Linear, or already backed by a
// live run in THIS fleet, has to be visible at selection time, not only once
// you reach the confirm screen. See inlineStatus() below.
//
// Reached from the fleet view on 'N' (capital) — see watch.js's routing
// comment for why that key and not one of the three already in use.

const f = require('../format');
const cache = require('../cache');
const layout = require('../layout');
const ticketDetail = require('../ticketDetail');
const icons = require('../icons');

// Every box costs 2 columns to its border characters (one per side) and 2
// more to `box()`'s default horizontal padding — sized once here so the
// pane-width arithmetic below and the content-generation width agree with
// each other exactly (see design.md Decision 1/3, and fleet.js/drilldown.js's
// identical constant).
const BOX_BORDER_PADDING_COLS = 4;

// Bounded so an 8-epic, 267-ticket backlog (the real numbers behind CON-9)
// never renders more rows than a terminal has — same motivation as fleet.js's
// MAX_FINISHED, but as a scrolling WINDOW rather than a hard cap, since
// unlike "done" runs you actually need to reach every ticket in a big epic.
const MAX_EPICS_VISIBLE = 10;
const MAX_TICKETS_VISIBLE = 12;
const EPICS_WIDTH = 30;

// Same value, same "Clear Queue" action as fleet.js's own CLEAR_QUEUE_KEY —
// kept as a separate constant (not a shared import) so each screen's key map
// stays self-contained, matching how fleet.js's CONFIRM_RESTORED_QUEUE_KEY is
// only ever read there. An operator building a new batch here still needs to
// see and clear whatever queue an EARLIER batch left running/pending — the
// queue is fleet-wide, not fleet-screen-local.
const CLEAR_QUEUE_KEY = 'C';

// Centres `index` inside a window of `max` rows over `total`, clamped to the
// ends. Used identically for the epics pane and the tickets pane so neither
// one's scroll behaviour is a special case of the other.
function windowStart(index, total, max) {
  if (total <= max) return 0;
  const start = index - Math.floor(max / 2);
  return Math.max(0, Math.min(start, total - max));
}

// Priority label/rank for values 0..4 (Linear's own encoding: 0 None, 1
// Urgent, 2 High, 3 Medium, 4 Low) plus the unknown (null/undefined) case —
// see design.md Decision 3. PRIORITY_WIDTH is sized to the longest label
// ('High'/'None').
const PRIORITY_WIDTH = 4;
const PRIORITY_LABELS = { 0: 'None', 1: 'Urg', 2: 'High', 3: 'Med', 4: 'Low' };

function priorityLabel(priority) {
  const label = PRIORITY_LABELS[priority];
  return label != null ? label : null; // null covers unknown AND anything not 0..4
}

// Urgent < High < Medium < Low < None < unknown — deliberately NOT a sort on
// Linear's raw integer encoding, where `0` (None) would otherwise rank ahead
// of `1` (Urgent). Unknown (null/undefined) always sorts last.
const PRIORITY_RANK = { 1: 0, 2: 1, 3: 2, 4: 3, 0: 4 };
function priorityRank(priority) {
  const rank = PRIORITY_RANK[priority];
  return rank != null ? rank : 5;
}

function sortByPriority(tickets) {
  return tickets.slice().sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
}

// The tickets belonging to the epic at `epicIndex` — `null` epic id is the
// "unassigned" bucket deriveEpics() always sorts last, so selecting past the
// end of the real epics lands there rather than out of bounds.
//
// `lp.ticketSort` ('identifier' | 'priority', default 'identifier') is
// applied HERE rather than only in renderLaunchPad, so watch.js's
// move-launchpad/toggle-select/select-all/open-ticketview — every one of
// which also calls this function to resolve `lp.ticketIndex` against the
// SAME row order the screen just rendered — never disagree with what the
// user is looking at.
function ticketsForEpic(lp) {
  const epics = (lp.cache && lp.cache.epics) || [];
  const epic = epics[lp.epicIndex];
  if (!epic) return [];
  const tickets = (lp.cache && lp.cache.tickets) || [];
  const filtered = tickets.filter((t) => (t.epicId || null) === (epic.id || null));
  return lp.ticketSort === 'priority' ? sortByPriority(filtered) : filtered;
}

// The tickets pane's current selection resolved to its full ticket object —
// mirrors ticketview.js's findTicket, but resolved by POSITION
// (`lp.ticketIndex` within ticketsForEpic's own order) rather than by
// identifier, since the inline detail pane always tracks "whatever row is
// currently highlighted", identically to what the tickets pane itself
// highlights. `null` when the current epic has no open tickets.
function currentTicket(lp) {
  const tickets = ticketsForEpic(lp);
  return tickets[lp.ticketIndex] || null;
}

// The one property that made the two-pane layout win: a ticket's status is
// derived with the LIVE fleet taking precedence over Linear's own state,
// because the cache can be an hour stale but tmux and the event log cannot
// lie about whether something is running right now.
function inlineStatus(ticket, runs) {
  const run = (runs || []).find((r) => r.ticket === ticket.identifier);
  if (run && run.status !== 'done' && run.status !== 'failed') return '▲ running';
  if (ticket.state && ticket.state.type === 'started') return 'In Progress';
  return (ticket.state && ticket.state.name) || 'Todo';
}

// A ticket the launch pad is ITSELF showing as `▲ running` must never be
// admitted into a new batch — see queue.js's own "dropped, not held" decision
// for the tmux-addressing failure this prevents (two tmux windows sharing one
// name — `capture-pane`/`kill-window` then fail ambiguously on both). This is
// the first of two independent refusals (queue.tick is the second, belt-and-
// braces layer, exactly like control.js's kill/restart double-check): a
// ticket that is already `▲ running` can never even be selected here, so it
// can never reach open-launchplan / confirm-launch in the first place.
function isSelectable(ticket, runs) {
  return inlineStatus(ticket, runs) !== '▲ running';
}

// Selectable tickets only — used by select-all and by open-launchplan (in
// case a ticket was selected earlier and started running by hand since).
function selectableIdentifiers(tickets, runs) {
  return (tickets || []).filter((t) => isSelectable(t, runs)).map((t) => t.identifier);
}

function headerLine(lp, cols, now) {
  const project = lp.project ? ' · ' + lp.project : '';
  const total = (lp.cache && lp.cache.tickets && lp.cache.tickets.length) || 0;
  const ageMs = cache.age(lp.cache, now);
  const staleness = ageMs == null ? 'never fetched' : 'fetched ' + f.dur(ageMs) + ' ago';
  // A silently short list is worse than a visible one (ticket.md's own
  // acceptance criterion) — when MAX_TICKETS cut the fetch short, say so
  // right next to the count it qualifies, rather than leaving a partial
  // backlog looking complete.
  const truncatedMarker = lp.cache && lp.cache.truncated ? ' (truncated — more available)' : '';
  const right = total + ' open' + truncatedMarker + ' · ' + staleness + ' · r refresh';
  const left = f.bold('NEW RUN') + f.dim(project);
  const gap = Math.max(2, cols - f.visibleLength(left) - f.visibleLength(right));
  return f.truncate(left + ' '.repeat(gap) + f.dim(right), cols);
}

// Row budget: ' ' + marker(1) + ' ' + name + count(9) === EPICS_WIDTH exactly,
// so padTo(_, EPICS_WIDTH) in the caller is a no-op rather than a second
// truncation that would clip the count column itself (e.g. "3 open" losing
// its final digit) — that was the first version's bug.
//
// Selection vs. pane focus (design.md Decision 2): the marker shows whenever
// this row IS the pane's current index, regardless of which pane currently
// has keyboard focus — a selection never disappears, only its emphasis
// changes. `paneFocused` (true only when `lp.pane === 'epics'`) decides that
// emphasis: fill (background highlight) in the focused pane, dim in the unfocused one, so the two
// panes' selections are never visually confusable as "both active".
const EPIC_COUNT_WIDTH = 9;
function epicRow(epic, selected, paneFocused) {
  const marker = selected ? '▸' : ' ';
  const name = epic.id === null ? '─ unassigned ─' : (epic.name || '(untitled)');
  const nameWidth = EPICS_WIDTH - 3 - EPIC_COUNT_WIDTH;
  const label = f.padTo(name, nameWidth) + f.padTo(String(epic.openCount) + ' open', EPIC_COUNT_WIDTH);
  const line = ' ' + marker + ' ' + label;
  if (!selected) return line;
  return paneFocused ? line : f.dim(line);
}

// Row budget: ' ' + marker(1) + ' ' + box(3) + ' ' + priority(PRIORITY_WIDTH)
// + ' ' + body + ' ' + status === width exactly — the constant below is
// every fixed-width character in that layout (8, as before the priority
// column, plus one separating space plus PRIORITY_WIDTH), so bodyWidth is
// whatever's left for the one variable-length column (identifier+title
// absorbs the priority column's cost — see ticket.md's "Row width" section).
// Get this wrong (as the first version did, off by one, before the priority
// column even existed) and f.truncate's own safety net silently eats a
// character off the STATUS column instead — the exact "In Progress" ->
// "In Progres…" bug this project treats as a wall.
//
// Same selection-vs-focus split as epicRow above: `selected` (this row is
// `lp.ticketIndex`) always shows the marker; `paneFocused` (`lp.pane ===
// 'tickets'`) decides fill vs. dim. Before this change the marker itself was
// gated on the pane, so switching to the epics pane made the ticket
// selection vanish outright rather than recede — the exact "disappear, not
// recede" defect design.md Decision 2 and spec.md's "Selected row recedes in
// an unfocused pane" scenario call out.
const TICKET_ROW_FIXED = 8 + 1 + PRIORITY_WIDTH;
function ticketRow(ticket, checked, selected, paneFocused, runs, width) {
  const marker = selected ? '▸' : ' ';
  const box = checked ? '[x]' : '[ ]';
  const status = inlineStatus(ticket, runs);
  const statusCol = status === '▲ running' ? f.STATUS_COLOUR.running(status) : status;
  // Unknown (null/undefined — a ticket the API returned no priority for, or
  // one read from a stale pre-priority cache) must render as a visibly
  // distinct label from priority 0/None, never blend into it — see
  // linear.js's normaliser comment and ticket.md's "Cache migration matters".
  const priorityText = priorityLabel(ticket.priority);
  const priorityCol = priorityText == null
    ? f.dim(f.padTo('?', PRIORITY_WIDTH))
    : f.padTo(priorityText, PRIORITY_WIDTH);
  const idAndTitle = f.padTo(ticket.identifier || '?', 9) + ' ' + (ticket.title || '');
  const statusWidth = Math.max(f.visibleLength(status), 11);
  const bodyWidth = Math.max(0, width - TICKET_ROW_FIXED - statusWidth);
  const body = f.padTo(f.truncate(idAndTitle, bodyWidth), bodyWidth);
  const line = ' ' + marker + ' ' + box + ' ' + priorityCol + ' ' + body + ' ' + f.padTo(statusCol, statusWidth);
  const truncated = f.truncate(line, width);
  if (!selected) return truncated;
  return paneFocused ? truncated : f.dim(truncated);
}

function renderLaunchPad(lp, runs, opts) {
  const cols = Math.max(50, (opts && opts.cols) || 80);
  const now = (opts && opts.now) != null ? opts.now : Date.now();
  // The fleet-wide queue (an EARLIER batch's still-pending tail, or the
  // current one) — read the same way fleet.js's own renderFleet reads it,
  // so this screen's Clear Queue affordance and fleet's agree on what is
  // actually there. `clearQueueConfirm` is this screen's own copy of the
  // same y/anything-else gate fleet.js has for the identical action.
  const queueState = (opts && opts.queueState) || null;
  const clearQueueConfirm = (opts && opts.clearQueueConfirm) || false;

  if (!lp) {
    return [f.bold('NEW RUN'), '', f.dim('  launch pad unavailable'), '', f.dim('  esc back')].join('\n');
  }

  // Judgement call: the gate failure is EXPLAINED, not hidden. Reaching for
  // the feature and being told nothing would be worse than being told
  // exactly which of the three conditions failed (see linear.js's
  // launchPadStatus, which returns that reason).
  if (!lp.status || !lp.status.enabled) {
    const msg = (lp.status && lp.status.message) || 'launch pad is unavailable';
    return [
      f.bold('NEW RUN'),
      '',
      '  ' + f.yellow(f.truncate(msg, cols - 4)),
      '',
      f.dim('  esc back'),
    ].join('\n');
  }

  const out = [];
  out.push(headerLine(lp, cols, now));
  out.push('');

  // A cold cache is not an error — it opens with an empty list and a hint,
  // exactly as if the fetch had returned nothing (see cache.js's own header
  // comment). `r` is the only way out of this state; nothing here polls.
  if (cache.isCold(lp.cache) && !lp.refreshing) {
    out.push('  ' + f.dim('no tickets cached yet — press r to fetch'));
    out.push('');
    for (let i = 0; i < 3; i++) out.push('');
    out.push(f.dim('  r fetch   esc back'));
    return out.map((l) => f.truncate(l, cols)).join('\n');
  }

  if (lp.refreshing) {
    out.push('  ' + f.dim('fetching tickets from Linear…'));
  }
  if (lp.error) {
    out.push('  ' + f.red(f.truncate(lp.error, cols - 4)));
  }
  if (lp.refreshing || lp.error) out.push('');

  const epics = (lp.cache && lp.cache.epics) || [];
  const tickets = ticketsForEpic(lp);
  const epicsStart = windowStart(lp.epicIndex, epics.length, MAX_EPICS_VISIBLE);
  const ticketsStart = windowStart(lp.ticketIndex, tickets.length, MAX_TICKETS_VISIBLE);
  const epicsFocused = lp.pane === 'epics';
  const ticketsFocused = lp.pane === 'tickets';

  // Content only — the pane headings ("EPICS", the current epic's name) now
  // live in each box's own title (design.md Decision 1's title-in-border),
  // not as a content row, so they no longer count toward either pane's
  // content-line total.
  const leftContent = [];
  let selectedLeftRow = null;
  if (epicsStart > 0) leftContent.push(f.dim('  ↑ ' + epicsStart + ' more'));
  for (let i = epicsStart; i < Math.min(epics.length, epicsStart + MAX_EPICS_VISIBLE); i++) {
    leftContent.push(epicRow(epics[i], i === lp.epicIndex, epicsFocused));
    if (i === lp.epicIndex) selectedLeftRow = leftContent.length - 1;
  }
  if (epics.length - epicsStart - MAX_EPICS_VISIBLE > 0) {
    leftContent.push(f.dim('  ↓ ' + (epics.length - epicsStart - MAX_EPICS_VISIBLE) + ' more'));
  }
  if (!epics.length) leftContent.push(f.dim('  (no epics)'));

  // GAP is hsplit()'s own one-column gap between panes; each pane's box costs
  // BOX_BORDER_PADDING_COLS on top of its content width — see fleet.js's and
  // drilldown.js's identical accounting.
  const GAP = 1;
  const rightContentW = Math.max(20, cols - EPICS_WIDTH - 2 * BOX_BORDER_PADDING_COLS - GAP);
  const leftPaneWidth = EPICS_WIDTH + BOX_BORDER_PADDING_COLS;
  const rightPaneWidth = rightContentW + BOX_BORDER_PADDING_COLS;

  const epicsTitle = icons.epics + ' EPICS';
  const currentEpic = epics[lp.epicIndex];
  const ticketsTitle = f.truncate(
    (currentEpic && (currentEpic.id === null ? '─ unassigned ─' : currentEpic.name)) || '(no epic selected)',
    rightContentW,
  );
  const rightContent = [];
  let selectedRightRow = null;
  if (ticketsStart > 0) rightContent.push(f.dim('  ↑ ' + ticketsStart + ' more'));
  for (let i = ticketsStart; i < Math.min(tickets.length, ticketsStart + MAX_TICKETS_VISIBLE); i++) {
    const t = tickets[i];
    rightContent.push(ticketRow(t, lp.selected.has(t.identifier), i === lp.ticketIndex, ticketsFocused, runs, rightContentW));
    if (i === lp.ticketIndex) selectedRightRow = rightContent.length - 1;
  }
  if (tickets.length - ticketsStart - MAX_TICKETS_VISIBLE > 0) {
    rightContent.push(f.dim('  ↓ ' + (tickets.length - ticketsStart - MAX_TICKETS_VISIBLE) + ' more'));
  }
  if (!tickets.length) rightContent.push(f.dim('  (no open tickets in this epic)'));

  // Both panes render at the same total height — the taller side's content
  // count, blank-padded by box()'s own `height` option on the shorter side —
  // so the two boxes always end at the same row, matching what the old
  // padTo/Math.max pairing in twoCol()-style code did before boxes existed.
  const paneHeight = Math.max(leftContent.length, rightContent.length) + 2;

  // `lp.pane` drives which side gets the focused/heavier border set (design.md
  // Decision 2) — the launch pad is the ONLY screen with a real pane-switch
  // key (Tab/←/→), so it is the only screen where this distinction applies.
  const leftBoxOpts = { width: leftPaneWidth, height: paneHeight, title: epicsTitle, focused: epicsFocused, fillRow: epicsFocused ? selectedLeftRow : null };
  const rightBoxOpts = { width: rightPaneWidth, height: paneHeight, title: ticketsTitle, focused: ticketsFocused, fillRow: ticketsFocused ? selectedRightRow : null };

  const leftBox = layout.degrade(leftPaneWidth, paneHeight)
    ? [epicsTitle, ...leftContent].map((l) => f.truncate(l, leftPaneWidth))
    : layout.box(leftContent, leftBoxOpts);
  const rightBox = layout.degrade(rightPaneWidth, paneHeight)
    ? [ticketsTitle, ...rightContent].map((l) => f.truncate(l, rightPaneWidth))
    : layout.box(rightContent, rightBoxOpts);

  for (const line of layout.hsplit([
    { lines: leftBox, width: leftPaneWidth },
    { lines: rightBox, width: rightPaneWidth },
  ])) out.push(line);
  out.push('');

  // --- inline detail pane (CON-35, design.md Decision 4) -----------------
  // A third pane spanning the full render width, below the epics/tickets
  // row, showing the currently-selected ticket's title/description/comments
  // through the SAME renderer ticketview.js uses (lib/ui/ticketDetail.js) —
  // see design.md Decision 2.
  const detailWidth = cols;
  const detailInnerWidth = Math.max(0, detailWidth - BOX_BORDER_PADDING_COLS);
  const selectedTicket = currentTicket(lp);
  // "No ticket selected" (spec.md's own scenario name) when the current
  // epic has no open tickets — never a blank or stale pane.
  const detailContent = !tickets.length || !selectedTicket
    ? [f.dim('  no ticket selected')]
    : [f.bold(selectedTicket.identifier || '?') + '  ' + f.truncate(selectedTicket.title || '', detailInnerWidth), '']
        .concat(ticketDetail.buildDetailLines(selectedTicket, detailInnerWidth));
  const desiredDetailHeight = detailContent.length + 2;

  // `rows` (0 = unbounded, matching fleet.js's own convention) bounds how
  // much of the desired content height actually fits. `reservedBelow`
  // accounts for the blank line, the "N selected" summary line and the
  // hints line that always follow this pane (one more when clearQueueConfirm
  // replaces that single hints line with its own two-line warning — see
  // below); one more row is reserved for the trailing newline the writer
  // appends (fleet.js's identical `rows - 1` convention), so a bounded
  // render never scrolls the header off the top.
  const rows = (opts && opts.rows) || 0;
  const reservedBelow = clearQueueConfirm ? 4 : 3;
  const verticalBudget = rows > 0 ? rows - 1 : 0;
  const availableForDetail = rows > 0 ? verticalBudget - out.length - reservedBelow : Infinity;

  // Below layout.MIN_BOX_HEIGHT the pane is omitted ENTIRELY, not squeezed —
  // a 1-2 row fragment of a description is worse than no description, and
  // MAX_EPICS_VISIBLE/MAX_TICKETS_VISIBLE above are never reduced to make
  // room for it (design.md Decision 4 / spec.md's "degrades before the list
  // does").
  if (!(rows > 0) || availableForDetail >= layout.MIN_BOX_HEIGHT) {
    // Lazygit-layout pass: previously capped at `desiredDetailHeight` (never
    // grew beyond its own content), leaving any leftover terminal height as
    // dead space below the footer. Using `availableForDetail` directly still
    // shrinks (via layout.box()'s own height-truncation) when the budget is
    // TIGHTER than the content needs — unchanged from before — but now also
    // GROWS (blank-padded) to consume any slack, pinning the footer to the
    // last row exactly like fleet.js's own last-section growth.
    const detailHeight = rows > 0 ? availableForDetail : desiredDetailHeight;
    const detailBox = layout.degrade(detailWidth, detailHeight)
      ? detailContent.map((l) => f.truncate(l, detailWidth))
      : layout.box(detailContent, { width: detailWidth, height: detailHeight, focused: false });
    for (const line of detailBox) out.push(line);
    out.push('');
  }

  const modeLabel = lp.mode + (lp.mode === 'parallel' ? ' ×' + (lp.defaultConcurrency || 2) : '');
  out.push('  ' + f.dim(lp.selected.size + ' selected · ' + modeLabel));

  const queuePendingCount = queueState && queueState.pending ? queueState.pending.length : 0;
  if (clearQueueConfirm) {
    // Mirrors fleet.js's own clearQueueConfirm warning — same wording, same
    // y/anything-else contract, since it is the identical action reached
    // from a second entry point.
    out.push('  ' + f.yellow(
      `▲ this will drop ${queuePendingCount} queued ticket${queuePendingCount === 1 ? '' : 's'} — they will never start. proceed?`));
    out.push(f.dim('  y confirm clear   (any other key) cancel'));
  } else {
    const hints = ['space select', '↵ read', 'a all', 's sequential', 'p parallel'];
    if (lp.selected.size > 0) hints.push('L launch');
    // Advertised only when there is an actual queue to clear (same "only
    // hint a key that currently does something" discipline as fleet.js's
    // own f/C hints) — a batch confirmed from a PRIOR visit to this screen,
    // or from fleet's own launch plan, both leave `queueState` populated
    // here exactly as they do on the fleet view.
    if (queuePendingCount > 0) hints.push(CLEAR_QUEUE_KEY + ' clear queue');
    hints.push('esc back');
    out.push(f.dim('  ' + hints.join('   ')));
  }

  return out.map((l) => f.truncate(l, cols)).join('\n');
}

// --- key handling ------------------------------------------------------

function handleKey(key, state) {
  const lp = state && state.lp;
  const queueState = state && state.queueState;
  // Checked before everything else, including the `!lp` bail-out just below
  // — the queue is fleet-wide state, independent of whether the launch pad's
  // OWN lp sub-state exists yet, and every key must be swallowed by this
  // gate while it is up (mirrors fleet.js's identical clearQueueConfirm
  // gate, checked first there for the same reason).
  if (state && state.clearQueueConfirm) {
    if (key === 'y') return { type: 'confirm-clear-queue' };
    return { type: 'cancel-clear-queue' };
  }

  if (!lp) {
    if (key === '\x1b') return { type: 'back' };
    return null;
  }

  if (key === '\x1b') return { type: 'back' };

  if (!lp.status || !lp.status.enabled) return null; // nothing else is bound while gated off

  if (cache.isCold(lp.cache) && !lp.refreshing) {
    if (key === 'r') return { type: 'refresh-launchpad' };
    return null;
  }

  if (key === 'r' && !lp.refreshing) return { type: 'refresh-launchpad' };
  if (lp.refreshing) return null; // avoid racing a second fetch onto the first

  // Arrow keys double for j/k, matching the convention set by fleet.js.
  if (key === '\x1b[D') return { type: 'switch-pane', pane: 'epics' };
  if (key === '\x1b[C') return { type: 'switch-pane', pane: 'tickets' };
  if (key === '\t') return { type: 'switch-pane', pane: lp.pane === 'epics' ? 'tickets' : 'epics' };

  if (key === 'j' || key === '\x1b[B') return { type: 'move-launchpad', delta: 1 };
  if (key === 'k' || key === '\x1b[A') return { type: 'move-launchpad', delta: -1 };

  if (lp.pane === 'tickets') {
    if (key === ' ') return { type: 'toggle-select' };
    if (key === '\r') return { type: 'open-ticketview' };
  }

  if (key === 'a') return { type: 'select-all' };
  if (key === 's') return { type: 'set-mode', mode: 'sequential' };
  if (key === 'p') return { type: 'set-mode', mode: 'parallel' };
  // Capital P — deliberately distinct from lowercase p (parallel mode,
  // already bound). handleKey only ever returns an action; watch.js's
  // applyAction is what actually flips lp.ticketSort (design.md Decision 3).
  if (key === 'P') return { type: 'toggle-ticket-sort' };
  if (key === 'L' && lp.selected.size > 0) return { type: 'open-launchplan' };
  // Same action, same gate (a populated QUEUED section) as fleet.js's own
  // CLEAR_QUEUE_KEY binding — see this file's own CLEAR_QUEUE_KEY comment
  // for why the queue is visible/clearable from here at all.
  if (key === CLEAR_QUEUE_KEY && queueState && queueState.pending && queueState.pending.length) {
    return { type: 'open-clear-queue-confirm' };
  }

  return null;
}

function render(state, opts) {
  return renderLaunchPad(state.launchPad, state.runs, Object.assign({}, opts, {
    queueState: state.queueState,
    clearQueueConfirm: state.clearQueueConfirm,
  }));
}

function routeHandleKey(key, state) {
  return handleKey(key, {
    lp: state.launchPad,
    runs: state.runs,
    queueState: state.queueState,
    clearQueueConfirm: state.clearQueueConfirm,
  });
}

module.exports = {
  renderLaunchPad, handleKey, render, routeHandleKey,
  inlineStatus, ticketsForEpic, windowStart, isSelectable, selectableIdentifiers,
  currentTicket, priorityLabel, priorityRank, sortByPriority,
  epicRow, ticketRow,
  MAX_EPICS_VISIBLE, MAX_TICKETS_VISIBLE, PRIORITY_WIDTH, TICKET_ROW_FIXED,
  CLEAR_QUEUE_KEY,
};
