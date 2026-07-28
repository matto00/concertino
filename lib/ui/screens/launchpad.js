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

// Bounded so an 8-epic, 267-ticket backlog (the real numbers behind CON-9)
// never renders more rows than a terminal has — same motivation as fleet.js's
// MAX_FINISHED, but as a scrolling WINDOW rather than a hard cap, since
// unlike "done" runs you actually need to reach every ticket in a big epic.
const MAX_EPICS_VISIBLE = 10;
const MAX_TICKETS_VISIBLE = 12;
const EPICS_WIDTH = 30;

// Centres `index` inside a window of `max` rows over `total`, clamped to the
// ends. Used identically for the epics pane and the tickets pane so neither
// one's scroll behaviour is a special case of the other.
function windowStart(index, total, max) {
  if (total <= max) return 0;
  const start = index - Math.floor(max / 2);
  return Math.max(0, Math.min(start, total - max));
}

// The tickets belonging to the epic at `epicIndex` — `null` epic id is the
// "unassigned" bucket deriveEpics() always sorts last, so selecting past the
// end of the real epics lands there rather than out of bounds.
function ticketsForEpic(lp) {
  const epics = (lp.cache && lp.cache.epics) || [];
  const epic = epics[lp.epicIndex];
  if (!epic) return [];
  const tickets = (lp.cache && lp.cache.tickets) || [];
  return tickets.filter((t) => (t.epicId || null) === (epic.id || null));
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
  const right = total + ' open · ' + staleness + ' · r refresh';
  const left = f.bold('NEW RUN') + f.dim(project);
  const gap = Math.max(2, cols - f.visibleLength(left) - f.visibleLength(right));
  return f.truncate(left + ' '.repeat(gap) + f.dim(right), cols);
}

// Row budget: ' ' + marker(1) + ' ' + name + count(9) === EPICS_WIDTH exactly,
// so padTo(_, EPICS_WIDTH) in the caller is a no-op rather than a second
// truncation that would clip the count column itself (e.g. "3 open" losing
// its final digit) — that was the first version's bug.
const EPIC_COUNT_WIDTH = 9;
function epicRow(epic, selected, focused) {
  const marker = selected ? '▸' : ' ';
  const name = epic.id === null ? '─ unassigned ─' : (epic.name || '(untitled)');
  const nameWidth = EPICS_WIDTH - 3 - EPIC_COUNT_WIDTH;
  const label = f.padTo(name, nameWidth) + f.padTo(String(epic.openCount) + ' open', EPIC_COUNT_WIDTH);
  const line = ' ' + marker + ' ' + label;
  return focused ? f.bold(line) : line;
}

// Row budget: ' ' + marker(1) + ' ' + box(3) + ' ' + body + ' ' + status ===
// width exactly — the constant below (8) is every fixed-width character in
// that layout, so bodyWidth is whatever's left for the one variable-length
// column. Get this wrong (as the first version did, off by one) and
// f.truncate's own safety net silently eats a character off the STATUS
// column instead — the exact "In Progress" -> "In Progres…" bug this
// project treats as a wall.
const TICKET_ROW_FIXED = 8;
function ticketRow(ticket, checked, focused, runs, width) {
  const marker = focused ? '▸' : ' ';
  const box = checked ? '[x]' : '[ ]';
  const status = inlineStatus(ticket, runs);
  const statusCol = status === '▲ running' ? f.yellow(status) : status;
  const idAndTitle = f.padTo(ticket.identifier || '?', 9) + ' ' + (ticket.title || '');
  const statusWidth = Math.max(f.visibleLength(status), 11);
  const bodyWidth = Math.max(0, width - TICKET_ROW_FIXED - statusWidth);
  const body = f.padTo(f.truncate(idAndTitle, bodyWidth), bodyWidth);
  const line = ' ' + marker + ' ' + box + ' ' + body + ' ' + f.padTo(statusCol, statusWidth);
  return f.truncate(line, width);
}

function renderLaunchPad(lp, runs, opts) {
  const cols = Math.max(50, (opts && opts.cols) || 80);
  const now = (opts && opts.now) != null ? opts.now : Date.now();

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

  const leftLines = ['EPICS'];
  if (epicsStart > 0) leftLines.push(f.dim('  ↑ ' + epicsStart + ' more'));
  for (let i = epicsStart; i < Math.min(epics.length, epicsStart + MAX_EPICS_VISIBLE); i++) {
    leftLines.push(epicRow(epics[i], i === lp.epicIndex, lp.pane === 'epics' && i === lp.epicIndex));
  }
  if (epics.length - epicsStart - MAX_EPICS_VISIBLE > 0) {
    leftLines.push(f.dim('  ↓ ' + (epics.length - epicsStart - MAX_EPICS_VISIBLE) + ' more'));
  }
  if (!epics.length) leftLines.push(f.dim('  (no epics)'));

  const rightWidth = Math.max(20, cols - EPICS_WIDTH - 3);
  const currentEpic = epics[lp.epicIndex];
  const rightLines = [f.truncate((currentEpic && (currentEpic.id === null ? '─ unassigned ─' : currentEpic.name)) || '(no epic selected)', rightWidth)];
  if (ticketsStart > 0) rightLines.push(f.dim('  ↑ ' + ticketsStart + ' more'));
  for (let i = ticketsStart; i < Math.min(tickets.length, ticketsStart + MAX_TICKETS_VISIBLE); i++) {
    const t = tickets[i];
    rightLines.push(ticketRow(t, lp.selected.has(t.identifier), lp.pane === 'tickets' && i === lp.ticketIndex, runs, rightWidth));
  }
  if (tickets.length - ticketsStart - MAX_TICKETS_VISIBLE > 0) {
    rightLines.push(f.dim('  ↓ ' + (tickets.length - ticketsStart - MAX_TICKETS_VISIBLE) + ' more'));
  }
  if (!tickets.length) rightLines.push(f.dim('  (no open tickets in this epic)'));

  const n = Math.max(leftLines.length, rightLines.length);
  for (let i = 0; i < n; i++) {
    const l = f.padTo(leftLines[i] != null ? leftLines[i] : '', EPICS_WIDTH);
    const r = f.truncate(rightLines[i] != null ? rightLines[i] : '', rightWidth);
    out.push(l + ' │ ' + r);
  }
  out.push('');

  const modeLabel = lp.mode + (lp.mode === 'parallel' ? ' ×' + (lp.defaultConcurrency || 2) : '');
  out.push('  ' + f.dim(lp.selected.size + ' selected · ' + modeLabel));

  const hints = ['space select', '↵ read', 'a all', 's sequential', 'p parallel'];
  if (lp.selected.size > 0) hints.push('L launch');
  hints.push('esc back');
  out.push(f.dim('  ' + hints.join('   ')));

  return out.map((l) => f.truncate(l, cols)).join('\n');
}

// --- key handling ------------------------------------------------------

function handleKey(key, state) {
  const lp = state && state.lp;
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
  if (key === 'L' && lp.selected.size > 0) return { type: 'open-launchplan' };

  return null;
}

function render(state, opts) {
  return renderLaunchPad(state.launchPad, state.runs, opts);
}

function routeHandleKey(key, state) {
  return handleKey(key, { lp: state.launchPad, runs: state.runs });
}

module.exports = {
  renderLaunchPad, handleKey, render, routeHandleKey,
  inlineStatus, ticketsForEpic, windowStart, isSelectable, selectableIdentifiers,
  MAX_EPICS_VISIBLE, MAX_TICKETS_VISIBLE,
};
