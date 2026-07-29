'use strict';

// The launch plan — the confirm gate. Pure: (state, opts) -> string. Reached
// from the launch pad with `L` once at least one ticket is selected.
//
// Three things this screen does deliberately (all called out in the design
// doc, and each has its own test):
//
//   1. Ports are shown PRE-FLIGHT. setup-worktree.sh derives them from the
//      ticket number alone (frontendBase + N, backendBase + N — see its own
//      comment), so this screen can compute and display them with no run
//      started and no network call. derivePorts() below is the same one-line
//      arithmetic duplicated deliberately (it is a shell script's job to be
//      the real source of truth for the worktree it creates; this is a
//      read-only preview of what it will do).
//   2. Concurrency is a bounded, EDITABLE number ('c' cycles it), never
//      "parallel = however many you selected". Sequential is exactly
//      concurrency 1 — see queue.js's own comment for why that is one code
//      path, not two.
//   3. The already-active count is the WHOLE FLEET's live runs, not just
//      this batch — `activeCount` is computed by the caller (watch.js) from
//      the full `runs` the reducer produced, this screen never re-derives it
//      from a narrower slice.
const f = require('../format');
const layout = require('../layout');

const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 8;

// Unlike fleet.js/drilldown.js/launchpad.js, this screen's box content
// (ticketRow) is a fixed-column layout that never varies with the box's own
// available inner width — there is no per-box "content width" to derive, so
// (unlike those three screens) there is no BOX_BORDER_PADDING_COLS constant
// to size one against.

// Draws the ticket-list body through layout.box(), or — below
// layout.degrade()'s threshold — falls back to the pre-change flat rendering
// (no frame). See drilldown.js's identical `pane()` helper.
function pane(contentLines, opts) {
  if (layout.degrade(opts.width, opts.height)) {
    return contentLines.map((l) => f.truncate(l, opts.width));
  }
  return layout.box(contentLines, opts);
}

function cycleConcurrency(n) {
  const next = (Math.max(MIN_CONCURRENCY, Math.min(MAX_CONCURRENCY, n || 1)) % MAX_CONCURRENCY) + 1;
  return next;
}

function deriveTicketNum(identifier) {
  const m = /(\d+)$/.exec(String(identifier || ''));
  return m ? parseInt(m[1], 10) : null;
}

// Mirrors setup-worktree.sh's own arithmetic exactly: DEV_PORT = frontendBase
// + ticket number, BACKEND_PORT = backendBase + ticket number. Returns null
// when the ticket has no trailing number — same case setup-worktree.sh itself
// treats as FAIL, so the plan says "?" rather than fabricate a port.
function derivePorts(identifier, portsCfg) {
  const num = deriveTicketNum(identifier);
  if (num == null) return null;
  const cfg = portsCfg || {};
  const frontendBase = typeof cfg.frontendBase === 'number' ? cfg.frontendBase : 5173;
  const backendBase = typeof cfg.backendBase === 'number' ? cfg.backendBase : 8080;
  return { devPort: frontendBase + num, backendPort: backendBase + num };
}

// Inserts/replaces the trailing --agent-merge / --no-agent-merge flag
// immediately after {{TICKET}} — INSIDE the quoted /concertino-deliver
// argument, exactly like the ticket id itself (same inside-the-quotes
// placement lib/ui/prompt.js's submitTicket uses for the `n` prompt's typed
// override — see design.md Decision 6 / tasks.md 5.2/5.3). Never appended
// after launchCommand's own closing quote, or $ARGUMENTS on the Claude Code
// side never sees it. A launchCommand with no literal {{TICKET}} (only
// possible for a custom override, which callers never pass here — see the
// `agentMergeEditable` guard) degrades to a no-op rather than throwing.
function withAgentMergeFlag(launchCommand, enabled) {
  const flag = enabled ? '--agent-merge' : '--no-agent-merge';
  const stripped = launchCommand.replace(/\{\{TICKET\}\}(?: --(?:no-)?agent-merge)?/, '{{TICKET}}');
  return stripped.replace('{{TICKET}}', '{{TICKET}} ' + flag);
}

// Right-aligns `right` against `left` inside `cols` visible columns — same
// helper drilldown.js keeps locally for its own header row; small enough,
// and specific enough to header-line layout, that duplicating it beats
// exporting a private layout helper across screen modules.
function splitLine(left, right, cols) {
  const rightVisible = f.visibleLength(right);
  const leftBudget = Math.max(0, cols - rightVisible - 2);
  const l = f.truncate(left, leftBudget);
  const gap = Math.max(2, cols - f.visibleLength(l) - rightVisible);
  return l + ' '.repeat(gap) + right;
}

function ticketRow(n, ticket, plan, index) {
  const ports = derivePorts(ticket.identifier, plan.portsCfg);
  const portsText = ports ? ':' + ports.devPort + ' :' + ports.backendPort : f.dim('(ports unknown)');
  const startNow = index < plan.concurrency;
  const label = startNow ? f.green('start now') : f.dim('queued');
  const name = f.truncate(ticket.title || '', 28);
  return '   ' + n + '  ' + f.padTo(ticket.identifier, 9) + ' ' + f.padTo(name, 30) +
    ' ' + f.padTo(portsText, 12) + ' ' + label;
}

function renderLaunchPlan(plan, activeCount, opts) {
  const cols = Math.max(60, (opts && opts.cols) || 80);

  if (!plan || !plan.tickets || !plan.tickets.length) {
    return [f.bold('LAUNCH PLAN'), '', f.dim('  nothing selected'), '', f.dim('  esc cancel')].join('\n');
  }

  const out = [];
  const first = plan.tickets[0].identifier;
  const more = plan.tickets.length > 1 ? ' +' + (plan.tickets.length - 1) : '';
  out.push(splitLine(f.bold('LAUNCH PLAN'), first + more, cols));
  out.push(f.dim('─'.repeat(cols)));

  out.push('  ' + plan.tickets.length + ' ticket' + (plan.tickets.length === 1 ? '' : 's') +
    '  ·  ' + plan.mode + '  ·  max ' + plan.concurrency + ' concurrent');
  const baseText = plan.baseBranch + (plan.commitSha ? ' @ ' + plan.commitSha : '');
  out.push('  ' + f.padTo('harness  ' + plan.harness, 24) + f.padTo('base  ' + baseText, 30));
  // Shown pre-flight, same discipline as ports/harness above — the run's
  // resolved agent-merge setting is visible before anything launches, not
  // discovered afterward. Always shown (mirroring the harness row, which is
  // shown even when 'h' cycling itself is unavailable) — only the 'm' key
  // itself is gated on `agentMergeEditable` below.
  const amText = plan.agentMerge ? f.green('on') : f.dim('off');
  out.push('  ' + f.padTo('agent-merge  ' + amText, 24));
  out.push('');

  // The ticket list is this screen's one interactive surface — wrapped in a
  // single box, plain/unfocused border set, matching design.md Decision 2's
  // single-pane rule (same reasoning as escalation.js/ticketview.js), with
  // the pre-flight ports/mode/concurrency lines above it left untouched.
  const boxWidth = cols;
  const boxContent = plan.tickets.map((t, i) => ticketRow(i + 1, t, plan, i));
  const boxHeight = boxContent.length + 2;
  for (const line of pane(boxContent, { width: boxWidth, height: boxHeight, focused: false })) out.push(line);
  out.push('');

  const exampleCmd = plan.launchCommand.split('{{TICKET}}').join(plan.tickets[0].identifier.replace(/-\d+$/, '-XXX'));
  out.push('  ' + f.dim('each runs:  ' + exampleCmd));
  out.push('  ' + f.dim('worktrees:  ' + plan.worktreeBase + '/' + first.replace(/-\d+$/, '-XXX')));

  // The already-active warning is fleet-wide (see the file header) — omitted
  // entirely when nothing else is running, rather than always printing a
  // "0 already active" line nobody needs to read.
  if (activeCount > 0) {
    out.push('');
    const startingNow = Math.min(plan.concurrency, plan.tickets.length);
    out.push('  ' + f.yellow('▲ ' + activeCount + ' run' + (activeCount === 1 ? '' : 's') +
      ' already active — fleet would be ' + (activeCount + startingNow) + ' concurrent'));
  }

  out.push('');
  const hints = ['↵ confirm & launch', 'c concurrency'];
  if (plan.harnesses && plan.harnesses.length > 1) hints.push('h harness');
  if (plan.agentMergeEditable) hints.push('m agent-merge');
  hints.push('esc cancel');
  out.push(f.dim('  ' + hints.join('   ')));

  return out.map((l) => f.truncate(l, cols)).join('\n');
}

function handleKey(key, state) {
  const plan = state && state.plan;
  if (!plan) {
    if (key === '\x1b') return { type: 'cancel-launchplan' };
    return null;
  }
  if (key === '\x1b') return { type: 'cancel-launchplan' };
  if (key === '\r') return { type: 'confirm-launch' };
  if (key === 'c') return { type: 'cycle-concurrency' };
  if (key === 'h' && plan.harnesses && plan.harnesses.length > 1) return { type: 'cycle-harness' };
  if (key === 'm' && plan.agentMergeEditable) return { type: 'cycle-agent-merge' };
  return null;
}

function render(state, opts) {
  const activeCount = (state.runs || []).filter((r) => r.status !== 'done' && r.status !== 'failed').length;
  return renderLaunchPlan(state.launchPlan, activeCount, opts);
}

function routeHandleKey(key, state) {
  return handleKey(key, { plan: state.launchPlan });
}

module.exports = {
  renderLaunchPlan, handleKey, render, routeHandleKey,
  derivePorts, deriveTicketNum, cycleConcurrency, withAgentMergeFlag,
  MIN_CONCURRENCY, MAX_CONCURRENCY,
};
