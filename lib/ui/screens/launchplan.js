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
const docview = require('./docview');

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

// CON-22: the batch's speed, inserted the same way withAgentMergeFlag inserts
// its own flag — immediately after {{TICKET}}, inside the quotes — but at
// whatever position comes right after {{TICKET}} PLUS any agent-merge flag
// already there, so cycling speed never reorders or drops an agent-merge
// flag already applied to this same plan (and vice versa — cycling
// agent-merge via withAgentMergeFlag above leaves a trailing speed token
// alone, since that function's own regex only ever touches the agent-merge
// slot immediately after {{TICKET}}). `default` is the "no token" speed —
// stripping down to bare {{TICKET}}[+agent-merge] with nothing appended,
// exactly like this repo's other "unset" states render as absence, not a
// literal "default" string in the launched command.
function withSpeedFlag(launchCommand, speed) {
  const re = /\{\{TICKET\}\}(?: --(?:no-)?agent-merge)?(?: (?:fast|slow))?/;
  const m = re.exec(launchCommand);
  if (!m) return launchCommand; // no {{TICKET}} placeholder (custom override) — no-op
  const withoutSpeed = m[0].replace(/ (?:fast|slow)$/, '');
  const replacement = (speed && speed !== 'default') ? withoutSpeed + ' ' + speed : withoutSpeed;
  return launchCommand.slice(0, m.index) + replacement + launchCommand.slice(m.index + m[0].length);
}

// CON-39: the read-side counterpart to withAgentMergeFlag/withSpeedFlag —
// parses a batch's speed and agent-merge setting back out of the
// launchCommand string those two functions write into, against the exact
// same token format/position (an optional --agent-merge/--no-agent-merge
// token immediately after {{TICKET}}, then an optional trailing fast/slow
// token). Owned here, not duplicated as a second regex in fleet.js's QUEUED
// row rendering (design.md Decision 5) — this is the one place that already
// knows that format, and a second implementation reading the same string a
// different way is exactly the kind of drift this project's own "shared
// implementation, not two that could disagree" discipline (see fleet.js's
// visibleWindow/buildSections comments) exists to avoid.
//
// `agentMerge: null` (never `false`) when no flag token is present at all —
// a custom `cfg.launchCommand` override with no `{{TICKET}}` placeholder
// never carries one, and there is no reasonable default to fabricate.
// `speed` is never null — `'default'` IS the "no token" state, mirroring
// withSpeedFlag's own convention that `default` renders as absence in the
// command string, not a literal word.
function parseLaunchCommand(launchCommand) {
  const re = /\{\{TICKET\}\}(?: (--(?:no-)?agent-merge))?(?: (fast|slow))?/;
  const m = re.exec(launchCommand || '');
  if (!m) return { agentMerge: null, speed: 'default' }; // no {{TICKET}} at all (custom override)
  return {
    agentMerge: m[1] ? m[1] === '--agent-merge' : null,
    speed: m[2] || 'default',
  };
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
  // `plan.startNow === false` (the launch plan's own hold toggle) overrides
  // the per-row concurrency split below — NOTHING starts immediately while
  // held, including whichever rows would otherwise be first in line, so
  // every row reads identically rather than keeping a "start now" label that
  // would be a lie the moment Enter is pressed.
  const label = plan.startNow === false
    ? f.yellow('held')
    : (index < plan.concurrency ? f.green('start now') : f.dim('queued'));
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
    '  ·  ' + plan.mode + '  ·  max ' + plan.concurrency + ' concurrent' +
    (plan.startNow === false ? '  ·  ' + f.yellow('held until confirmed') : ''));
  const baseText = plan.baseBranch + (plan.commitSha ? ' @ ' + plan.commitSha : '');
  out.push('  ' + f.padTo('harness  ' + plan.harness, 24) + f.padTo('base  ' + baseText, 30));
  // Shown pre-flight, same discipline as ports/harness above — the run's
  // resolved agent-merge setting is visible before anything launches, not
  // discovered afterward. Always shown (mirroring the harness row, which is
  // shown even when 'h' cycling itself is unavailable) — only the 'm' key
  // itself is gated on `agentMergeEditable` below.
  const amText = plan.agentMerge ? f.green('on') : f.dim('off');
  out.push('  ' + f.padTo('agent-merge  ' + amText, 24));
  // CON-22: the resolved speed + a pre-flight per-role models preview — same
  // "show it before anything launches" discipline as ports/harness/agent-merge
  // above. `s` (below) is always bound, unlike `h`/`m` — every project has at
  // least the one `default` speed to cycle away from, so this row (and its
  // key) is never gated. `plan.resolvedModels` is a point-in-time snapshot
  // watch.js computed via resolve-speed.sh (see its own header comment) —
  // this screen never invokes that or any other child process itself, and
  // renders `null` (missing script, bad harness/tier, or a project predating
  // this feature) as "models unknown" rather than throwing or crashing.
  out.push('  ' + f.padTo('speed  ' + (plan.speed || 'default'), 24));
  const modelsText = (plan.resolvedModels && plan.resolvedModels.models)
    ? Object.entries(plan.resolvedModels.models).map(([role, m]) => role + '=' + m).join(' ')
    : f.dim('models unknown');
  out.push('  ' + f.dim('models  ') + modelsText);
  out.push('');

  // The ticket list is this screen's one interactive surface — wrapped in a
  // single box, plain/unfocused border set, matching design.md Decision 2's
  // single-pane rule (same reasoning as escalation.js/ticketview.js), with
  // the pre-flight ports/mode/concurrency lines above it left untouched.
  // Lazygit-layout pass: previously fully unbounded (a large batch could
  // overflow the terminal outright) — now scrolls (docview.windowBody,
  // using opts.ticketListScroll) when it does not fit the row budget.
  const boxWidth = cols;
  const allTicketLines = plan.tickets.map((t, i) => ticketRow(i + 1, t, plan, i));
  const rows = (opts && opts.rows) || 0;
  let ticketViewportRows = allTicketLines.length;
  if (rows > 0) {
    // Reserve the rows everything ELSE in this render costs: what's already
    // in `out` above this box, the box's OWN top/bottom border (2 — this
    // variable sizes CONTENT rows only, boxHeight below adds the border on
    // top), and the fixed rows below it — blank, "each runs:"/"worktrees:"
    // (2 lines), the optional active-count warning (blank + 1 line), a
    // blank before the footer, and the footer itself.
    const belowBoxRows = 1 + 2 + (plan.startNow !== false && activeCount > 0 ? 2 : 0) + 1 + 1;
    ticketViewportRows = Math.max(3, (rows - 1) - out.length - 2 - belowBoxRows);
  }
  const boxContent = allTicketLines.length <= ticketViewportRows
    ? allTicketLines
    : docview.windowBody(allTicketLines, ticketViewportRows, (opts && opts.ticketListScroll) || 0);
  // Lazygit-layout pass: grow-to-fill (design.md Decision 3). Reuses the SAME
  // `ticketViewportRows` budget just computed above for scrolling — a short
  // batch now grows the box to that budget instead of leaving it unused; a
  // long batch is already clamped to it via `docview.windowBody` above, so
  // `Math.max` is a no-op in that case (`boxContent.length` already equals
  // `ticketViewportRows`). Unbounded (`rows` absent/0) is untouched.
  const boxHeight = rows > 0
    ? Math.max(boxContent.length, ticketViewportRows) + 2
    : boxContent.length + 2;
  for (const line of pane(boxContent, { width: boxWidth, height: boxHeight, focused: false })) out.push(line);
  out.push('');

  const exampleCmd = plan.launchCommand.split('{{TICKET}}').join(plan.tickets[0].identifier.replace(/-\d+$/, '-XXX'));
  out.push('  ' + f.dim('each runs:  ' + exampleCmd));
  out.push('  ' + f.dim('worktrees:  ' + plan.worktreeBase + '/' + first.replace(/-\d+$/, '-XXX')));

  // The already-active warning is fleet-wide (see the file header) — omitted
  // entirely when nothing else is running, rather than always printing a
  // "0 already active" line nobody needs to read. Also omitted while held
  // (plan.startNow === false): the count it warns about is how concurrent
  // the fleet would become the instant Enter is pressed, and a held batch
  // starts nothing until a later, separate confirm — the warning belongs at
  // THAT moment (fleet.js's own tail), not here.
  if (plan.startNow !== false && activeCount > 0) {
    out.push('');
    const startingNow = Math.min(plan.concurrency, plan.tickets.length);
    out.push('  ' + f.yellow('▲ ' + activeCount + ' run' + (activeCount === 1 ? '' : 's') +
      ' already active — fleet would be ' + (activeCount + startingNow) + ' concurrent'));
  }

  out.push('');
  // Named differently while held — Enter still confirms the PLAN (ports,
  // concurrency, harness, ... are locked in either way), but nothing
  // actually launches until the separate fleet-view confirm, and the hint
  // must never claim otherwise.
  const hints = [plan.startNow === false ? '↵ confirm (held)' : '↵ confirm & launch', 'c concurrency'];
  if (plan.harnesses && plan.harnesses.length > 1) hints.push('h harness');
  if (plan.agentMergeEditable) hints.push('m agent-merge');
  hints.push('s speed'); // always available — every project has `default` to cycle away from
  // Always available, unlike h/m above — every batch has a start-now state
  // to toggle away from, regardless of harness/agent-merge configurability.
  hints.push('n ' + (plan.startNow === false ? 'start now' : 'hold'));
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
  if (key === 's') return { type: 'cycle-speed' }; // always available, unlike h/m above
  // Toggles plan.startNow (default true, i.e. unchanged pre-existing
  // behaviour) — see queue.js's createQueue() and its `confirmed` param for
  // what this actually does once 'confirm-launch' reads it.
  if (key === 'n') return { type: 'toggle-start-now' };
  // Lazygit-layout pass: scrolls the ticket list when it overflows its
  // viewport — j/k/page-keys, via the shared docview.scrollDelta (10-line
  // page jump; this screen has no precomputed viewport-rows to size a page
  // exactly, same trade-off drilldown.js's own panels make).
  const scrollKey = docview.scrollDelta(key, 10);
  if (scrollKey) return { type: 'scroll-launchplan-tickets', delta: scrollKey.lines };
  return null;
}

function render(state, opts) {
  const activeCount = (state.runs || []).filter((r) => r.status !== 'done' && r.status !== 'failed').length;
  return renderLaunchPlan(state.launchPlan, activeCount,
    Object.assign({}, opts, { ticketListScroll: state.launchPlanTicketScroll }));
}

function routeHandleKey(key, state) {
  return handleKey(key, { plan: state.launchPlan });
}

module.exports = {
  renderLaunchPlan, handleKey, render, routeHandleKey,
  derivePorts, deriveTicketNum, cycleConcurrency, withAgentMergeFlag, withSpeedFlag, parseLaunchCommand,
  MIN_CONCURRENCY, MAX_CONCURRENCY,
};
