'use strict';

// Run-archive screen actions (CON-113): opening the screen (reset to
// defaults), focus cycling, the substring/harness/date filters (live typing,
// harness cycling, the date-field prompt's open/type/backspace/submit/
// cancel cycle), and list-cursor movement. Dispatched from watch.js's
// applyAction — see controllers/index.js for the shared contract.
//
// `open-drilldown` (list `↵`) is emitted directly by screens/archive.js's
// own handleKey and handled entirely by controllers/drilldown.js — this
// controller never touches it (design.md Decision 3: "no separate rendering
// path or data transformation").

const archiveScreen = require('../screens/archive');

// Clamps `S.archiveSelected` back into range of the CURRENTLY filtered list
// — mirrors sessions.js#refreshSessions's own clamp. Called after any action
// that could shrink/grow the filtered list (a filter changing, a date bound
// committing).
function clampArchiveSelected(ctx) {
  const S = ctx.S;
  const len = archiveScreen.filterArchiveRuns(S.runs, S).length;
  if (!len) {
    S.archiveSelected = 0;
    return;
  }
  if (S.archiveSelected == null || S.archiveSelected >= len) S.archiveSelected = len - 1;
  if (S.archiveSelected < 0) S.archiveSelected = 0;
}

// tasks.md 4.1: resets every archive* field to its default and opens the
// screen — mirrors sessions.js#openSessions's own "rebuilt fresh every
// visit" discipline (design.md Decision 3 draws no distinction here: the
// screen has no cross-visit state worth preserving, unlike the launch pad).
function openArchive(ctx) {
  const S = ctx.S;
  S.archiveQuery = null;
  S.archiveHarnessFilter = null;
  S.archiveDateFrom = null;
  S.archiveDateTo = null;
  S.archiveSelected = 0;
  S.archiveFocus = 'query';
  S.archiveDatePrompt = null;
  S.mode = 'archive';
}

function moveFocus(ctx, delta) {
  const S = ctx.S;
  const order = archiveScreen.FOCUS_ORDER;
  const current = order.indexOf(S.archiveFocus || 'query');
  const at = current === -1 ? 0 : current;
  const next = (at + delta + order.length) % order.length;
  S.archiveFocus = order[next];
}

function handle(action, ctx) {
  const S = ctx.S;
  switch (action.type) {
    case 'open-archive':
      openArchive(ctx);
      return true;

    case 'archive-focus-next':
      moveFocus(ctx, 1);
      return true;

    case 'archive-focus-prev':
      moveFocus(ctx, -1);
      return true;

    case 'archive-query-type':
      S.archiveQuery = (S.archiveQuery || '') + action.char;
      clampArchiveSelected(ctx);
      return true;

    case 'archive-query-backspace':
      S.archiveQuery = (S.archiveQuery || '').slice(0, -1);
      clampArchiveSelected(ctx);
      return true;

    // design.md Decision 6: cycles to the next distinct, non-null harness
    // value CURRENTLY present in S.runs (recomputed fresh, per Decision 5 —
    // never fixed at screen-open time), wrapping to "any" from the last one.
    case 'cycle-archive-harness': {
      const observed = archiveScreen.observedHarnesses(S.runs);
      S.archiveHarnessFilter = archiveScreen.nextHarness(S.archiveHarnessFilter, observed);
      clampArchiveSelected(ctx);
      return true;
    }

    // Seeds the prompt from the currently-committed bound, formatted
    // YYYY-MM-DD (empty if unset) — design.md Decision 6.
    case 'open-archive-date-prompt': {
      const bound = action.bound;
      const current = bound === 'dateFrom' ? S.archiveDateFrom : S.archiveDateTo;
      S.archiveDatePrompt = {
        bound,
        value: archiveScreen.formatDateBound(current) || '',
        error: null,
      };
      return true;
    }

    case 'archive-date-prompt-type':
      if (S.archiveDatePrompt) {
        S.archiveDatePrompt.value += action.char;
        S.archiveDatePrompt.error = null;
      }
      return true;

    case 'archive-date-prompt-backspace':
      if (S.archiveDatePrompt) S.archiveDatePrompt.value = S.archiveDatePrompt.value.slice(0, -1);
      return true;

    // design.md Decision 6's three submission scenarios (valid / empty /
    // invalid) — parseDateBoundValue (screens/archive.js) already collapses
    // "valid" and "empty" into one `{ ok: true, ms }` shape (`ms === null`
    // on empty), so both commit through the same branch below; only the
    // reject case needs its own.
    case 'submit-archive-date-prompt': {
      if (!S.archiveDatePrompt) return true;
      const { bound, value } = S.archiveDatePrompt;
      const result = archiveScreen.parseDateBoundValue(value, bound);
      if (!result.ok) {
        S.archiveDatePrompt.error = 'expected YYYY-MM-DD';
        return true;
      }
      if (bound === 'dateFrom') S.archiveDateFrom = result.ms;
      else S.archiveDateTo = result.ms;
      S.archiveDatePrompt = null;
      clampArchiveSelected(ctx);
      return true;
    }

    // Cancels the prompt only — design.md Decision 6: does NOT dispatch
    // `back`, does not touch archiveFocus or any committed filter.
    case 'cancel-archive-date-prompt':
      S.archiveDatePrompt = null;
      return true;

    case 'move-archive-selection': {
      const len = archiveScreen.filterArchiveRuns(S.runs, S).length;
      if (!len) return true;
      const current = S.archiveSelected || 0;
      S.archiveSelected = Math.max(0, Math.min(current + action.delta, len - 1));
      return true;
    }

    default:
      return false;
  }
}

module.exports = { handle, openArchive, clampArchiveSelected, moveFocus };
