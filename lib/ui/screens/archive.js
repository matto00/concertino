'use strict';

// The run-archive screen (CON-113): lists every run currently in `S.runs`
// (every retained run under `.concertino/runs/`, bounded only by
// `dashboard.retentionDays` — not the fleet view's own DONE/FAILED display
// cap), filterable live by ticket id/title substring, harness, and a
// startedAt date range, and opening the existing drill-down for a selected
// row. Reached from the fleet view's `A` key (see fleet/keys.js) — see
// design.md Decisions 1-6 for the full reasoning.
//
// Pure: (state, opts) -> string / (key, state) -> action | null, following
// the same router seam every other screen uses. `state.archive*` (Decision
// 3) is owned by watch.js/controllers/archive.js; this module never mutates
// it.
//
// No target-listing abstraction is shared with the fleet view's own `/`
// search (CON-110) — only the match predicate is (Decision 2). This
// screen's own target list is `state.runs` itself, harness/date-filterable,
// a genuinely wider universe than CON-110's live-fleet-only rows.

const f = require('../format');
const layout = require('../layout');
const { emptyState } = require('../widgets/empty');
const { fmtDate } = require('../ticketDetail');
// CON-110, design.md Decision 2: the ONE shared match predicate — reused
// unmodified (never a second, ad hoc substring check). `search.js` itself is
// not modified by this change.
const { rowMatches } = require('./fleet/search');

// The fixed focus-cycling order (Decision 3) — Tab moves forward through
// this list, Shift-Tab backward, both wrapping at either end.
const FOCUS_ORDER = ['query', 'harness', 'dateFrom', 'dateTo', 'list'];

// --- filtering -----------------------------------------------------------

// design.md Decision 2's own correction (skeptic gate round 1, change
// request 1): `rowMatches`/`matchesQuery`, unmodified, return `false` — no
// match — on an empty/whitespace-only query (the deliberate, existing
// `fleet-search` semantics). This screen's own Goal ("empty filter shows
// everything") is therefore an explicit bypass applied HERE, before ever
// calling `rowMatches` — never inside search.js itself.
function passesSubstringFilter(run, query) {
  if (!query || !String(query).trim()) return true;
  return rowMatches(run.ticket, run.changeName, query);
}

function passesHarnessFilter(run, harnessFilter) {
  if (!harnessFilter) return true;
  return run.harness === harnessFilter;
}

// A run with no `startedAt` (never reached `run.start`) is excluded
// whenever either bound is set, included when neither is (design.md
// Decision 3).
function passesDateFilter(run, dateFrom, dateTo) {
  if (dateFrom == null && dateTo == null) return true;
  if (run.startedAt == null) return false;
  if (dateFrom != null && run.startedAt < dateFrom) return false;
  if (dateTo != null && run.startedAt > dateTo) return false;
  return true;
}

// The filtered list every render/handleKey/controller call computes fresh
// from `state.runs` (or `S.runs`, the same array) — no snapshot is ever
// cached (design.md Decision 3's own "reads S.runs directly at render time,
// every frame" note). Preserves `runs`' own existing order (already
// meaningfully sorted — reducer.js's NEEDS YOU/FAILED/RUNNING/DONE grouping,
// most-recent-activity first within a status) rather than imposing a second,
// independent sort.
function filterArchiveRuns(runs, state) {
  const list = runs || [];
  const s = state || {};
  return list.filter((run) => (
    passesSubstringFilter(run, s.archiveQuery) &&
    passesHarnessFilter(run, s.archiveHarnessFilter) &&
    passesDateFilter(run, s.archiveDateFrom, s.archiveDateTo)
  ));
}

// design.md Decision 5: the distinct, non-null `harness` values currently
// observed in `runs`, in first-seen order — computed fresh every time, never
// a hardcoded list, so a future harness needs no change here.
function observedHarnesses(runs) {
  const seen = [];
  for (const run of (runs || [])) {
    if (run.harness && seen.indexOf(run.harness) === -1) seen.push(run.harness);
  }
  return seen;
}

// design.md Decision 6: cycles to the next observed harness, wrapping from
// the last observed value back to `null` ("any") rather than stopping. A
// currently-selected value no longer present in `observed` (a run pruned
// off disk between cycles) is treated as "before the first" — the next
// press lands on `observed[0]`, same as starting from "any".
function nextHarness(current, observed) {
  const list = observed || [];
  if (!list.length) return null;
  if (current == null) return list[0];
  const idx = list.indexOf(current);
  if (idx === -1 || idx === list.length - 1) return null;
  return list[idx + 1];
}

// --- date-prompt formatting/parsing (task 3.4) ----------------------------

// The committed bound's own `YYYY-MM-DD` rendering, in LOCAL time (the same
// locality the bound itself is stored in — see parseDateBoundValue below) —
// used both to seed a freshly-opened prompt (controller's
// 'open-archive-date-prompt') and to display a committed bound in the field
// itself while no prompt is open.
function formatDateBound(ms) {
  if (ms == null) return null;
  const d = new Date(ms);
  const y = String(d.getFullYear()).padStart(4, '0');
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

// parseDateBoundValue(value, bound) -> { ok: true, ms } | { ok: false }.
// `ms` is `null` on an empty/whitespace-only value (the "clear this bound"
// case — design.md Decision 6's second scenario), the start of that local
// day for `dateFrom`, or the end of that local day (23:59:59.999) for
// `dateTo`. Any non-empty value that is not strictly `YYYY-MM-DD`, or whose
// digits do not form a real calendar date (rejected via the Date object's
// own field round-trip, catching e.g. `2024-02-30`), is `{ ok: false }` —
// never throws.
function parseDateBoundValue(value, bound) {
  const trimmed = value == null ? '' : String(value).trim();
  if (trimmed === '') return { ok: true, ms: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!m) return { ok: false };
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const isTo = bound === 'dateTo';
  const d = isTo
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return { ok: false };
  return { ok: true, ms: d.getTime() };
}

// --- render ----------------------------------------------------------------

function archiveHeaderRow(width) {
  const line = '   ' + f.padTo('TICKET', 9) + ' ' + f.padTo('TITLE', 28) + ' ' +
    f.padTo('HARNESS', 12) + ' ' + f.padTo('STATUS', 10) + ' STARTED';
  return f.dim(f.truncate(line, width));
}

function archiveRow(run, isSelected, width) {
  const marker = isSelected ? '▸' : ' ';
  const idCol = f.padTo(f.truncate(run.ticket || '', 9), 9);
  const titleText = run.changeName || f.dim('(no branch yet)');
  const titleCol = f.padTo(f.truncate(titleText, 28), 28);
  const harnessCol = f.padTo(f.truncate(run.harness || '?', 12), 12);
  const statusColour = f.STATUS_COLOUR[run.status] || f.dim;
  const statusCol = statusColour(f.padTo(f.truncate(run.status || 'unknown', 10), 10));
  const startedCol = run.startedAt != null ? fmtDate(run.startedAt) : f.dim('—');
  const line = ' ' + marker + ' ' + idCol + ' ' + titleCol + ' ' + harnessCol + ' ' + statusCol + ' ' + startedCol;
  const truncated = f.truncate(line, width);
  return isSelected ? f.bold(truncated) : truncated;
}

function renderArchive(state, opts) {
  const s = state || {};
  const cols = Math.max(50, (opts && opts.cols) || 80);
  const focus = s.archiveFocus || 'query';
  const datePrompt = s.archiveDatePrompt;

  const out = [];
  out.push(f.bold('concertino') + f.dim(' · archive'));
  out.push('');

  // --- the four filter controls, each visually marked as focused (design.md
  // Decision 3 / tasks.md 3.2, following the settings screen's own
  // focused-pane rendering convention) ---------------------------------
  const GAP = 1;
  const BOX_HEIGHT = 3;
  const avail = Math.max(4, cols - 3 * GAP);
  const queryW = Math.max(16, Math.floor(avail * 0.4));
  const harnessW = Math.max(12, Math.floor(avail * 0.2));
  const dateW = Math.max(12, Math.floor((avail - queryW - harnessW) / 2));

  const queryFocused = focus === 'query';
  const harnessFocused = focus === 'harness';
  const fromFocused = focus === 'dateFrom';
  const toFocused = focus === 'dateTo';

  const queryValue = (s.archiveQuery || '') + (queryFocused ? '▏' : '');
  const harnessValue = s.archiveHarnessFilter || f.dim('any');
  const fromValue = (datePrompt && datePrompt.bound === 'dateFrom')
    ? datePrompt.value + '▏'
    : (formatDateBound(s.archiveDateFrom) || f.dim('any'));
  const toValue = (datePrompt && datePrompt.bound === 'dateTo')
    ? datePrompt.value + '▏'
    : (formatDateBound(s.archiveDateTo) || f.dim('any'));

  const queryBox = layout.box([queryValue], { width: queryW, height: BOX_HEIGHT, title: 'QUERY', focused: queryFocused });
  const harnessBox = layout.box([harnessValue], { width: harnessW, height: BOX_HEIGHT, title: 'HARNESS', focused: harnessFocused });
  const fromBox = layout.box([fromValue], { width: dateW, height: BOX_HEIGHT, title: 'FROM', focused: fromFocused });
  const toBox = layout.box([toValue], { width: dateW, height: BOX_HEIGHT, title: 'TO', focused: toFocused });

  for (const line of layout.hsplit([
    { lines: queryBox, width: queryW },
    { lines: harnessBox, width: harnessW },
    { lines: fromBox, width: dateW },
    { lines: toBox, width: dateW },
  ])) out.push(line);

  // The open date prompt's own one-line validation error (design.md Decision
  // 6 / tasks.md 3.2), mirroring settings.js's own `settings.prompt.error`
  // rendering — scoped to the prompt itself, cleared the moment it closes.
  if (datePrompt && datePrompt.error) {
    out.push('  ' + f.red(f.truncate(datePrompt.error, Math.max(0, cols - 4))));
  }
  out.push('');

  // --- the filtered, selectable run list --------------------------------
  const filtered = filterArchiveRuns(s.runs, s);
  const selected = filtered.length ? Math.max(0, Math.min(s.archiveSelected || 0, filtered.length - 1)) : 0;

  if (filtered.length) {
    out.push(archiveHeaderRow(cols));
    for (let i = 0; i < filtered.length; i++) {
      out.push(archiveRow(filtered[i], focus === 'list' && i === selected, cols));
    }
  } else {
    for (const line of emptyState({ message: '  no runs match the current filters' })) out.push(line);
  }
  out.push('');

  const hints = ['Tab/Shift-Tab focus'];
  if (focus === 'query') hints.push('type to filter');
  else if (focus === 'harness') hints.push('↵/space cycle harness');
  else if (focus === 'dateFrom' || focus === 'dateTo') hints.push('↵ set date');
  else if (focus === 'list') hints.push('j/k move', '↵ open drilldown');
  hints.push('esc back');
  for (const line of f.hintLines(hints, cols)) out.push(line);

  return out.map((l) => f.truncate(l, cols)).join('\n');
}

// --- key handling ------------------------------------------------------
// Pure: (key, state) -> action | null. watch.js/controllers/archive.js own
// every `archive*` field and interpret every action this returns.
function handleKey(key, state) {
  const s = state || {};
  const datePrompt = s.archiveDatePrompt;

  // design.md Decision 6, skeptic gate round 2 fix: the open date prompt
  // intercepts every key FIRST — before any archiveFocus-based routing —
  // mirroring settings.js:355-360's own prompt-then-focus ordering exactly.
  if (datePrompt) {
    if (key.length > 1) return null; // arrow keys and friends: ignore outright
    if (key === '\x1b' || key === '') return { type: 'cancel-archive-date-prompt' };
    if (key === '\x7f' || key === '\b') return { type: 'archive-date-prompt-backspace' };
    if (key === '\r' || key === '\n') return { type: 'submit-archive-date-prompt' };
    if (key >= ' ') return { type: 'archive-date-prompt-type', char: key };
    return null;
  }

  // Tab / Shift-Tab cycle focus through FOCUS_ORDER, wrapping at both ends
  // (design.md Decision 3) — the ONLY focus-cycling keys (h/l are
  // deliberately NOT bound here; see design.md Decision 3's own correction).
  if (key === '\t') return { type: 'archive-focus-next' };
  if (key === '\x1b[Z') return { type: 'archive-focus-prev' }; // Shift-Tab

  // esc (any focus, prompt already closed above): the generic 'back' action
  // every other top-level screen's Escape already emits (design.md Decision
  // 4) — checked here, ahead of any focus-specific routing, so it always
  // wins regardless of which zone currently holds focus.
  if (key === '\x1b') return { type: 'back' };

  const focus = s.archiveFocus || 'query';

  if (focus === 'query') {
    if (key.length > 1) return null; // arrow keys etc: no-op in a text field
    if (key === '\x7f' || key === '\b') return { type: 'archive-query-backspace' };
    if (key === '\r' || key === '\n') return null; // filtering is already live — Tab moves on
    if (key >= ' ') return { type: 'archive-query-type', char: key };
    return null;
  }

  if (focus === 'harness') {
    if (key === '\r' || key === '\n' || key === ' ') return { type: 'cycle-archive-harness' };
    return null;
  }

  if (focus === 'dateFrom' || focus === 'dateTo') {
    if (key === '\r' || key === '\n') return { type: 'open-archive-date-prompt', bound: focus };
    return null;
  }

  if (focus === 'list') {
    if (key === 'j' || key === '\x1b[B') return { type: 'move-archive-selection', delta: 1 };
    if (key === 'k' || key === '\x1b[A') return { type: 'move-archive-selection', delta: -1 };
    if (key === '\r' || key === '\n') {
      const filtered = filterArchiveRuns(s.runs, s);
      const selected = filtered.length ? Math.max(0, Math.min(s.archiveSelected || 0, filtered.length - 1)) : 0;
      const run = filtered[selected];
      if (!run) return null;
      // The existing, unmodified action — the drill-down's own lookup
      // (`S.runs.find((r) => r.ticket === S.drillTicket)`) already works for
      // any ticket present in `S.runs`, live or not (design.md Decision 3).
      return { type: 'open-drilldown', ticket: run.ticket };
    }
    return null;
  }

  return null;
}

// Uniform router seam: every screen exposes render(state, opts)/
// routeHandleKey(key, state) — see router.js.
function render(state, opts) {
  return renderArchive(state, opts);
}

function routeHandleKey(key, state) {
  return handleKey(key, state);
}

module.exports = {
  FOCUS_ORDER,
  filterArchiveRuns, observedHarnesses, nextHarness,
  formatDateBound, parseDateBoundValue,
  renderArchive, handleKey, render, routeHandleKey,
  archiveRow, archiveHeaderRow,
};
