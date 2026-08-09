'use strict';

// CON-110, design.md Decision 3: the shared match predicate and target-
// resolution helper for the fleet view's `/` search prompt — the ONE place
// "ticket id or title" is defined as a match, so row-highlighting (rows.js)
// and jump-resolution (controllers/fleet.js's 'submit-search') can never
// disagree about what counts as one.

const { bucketRuns, buildSections } = require('./sections');

// Pure, case-insensitive substring match. `text == null` never matches (a
// run with no `changeName`, a QUEUED row with no cached title, ...) — an
// empty/whitespace-only `query` never matches anything either: search open
// with nothing typed highlights nothing, and `enter` on an empty query is a
// no-op, mirroring `promptKey`'s own "empty submit = cancel" treatment
// rather than jumping to whatever row happens to be first.
function matchesQuery(text, query) {
  if (query == null || !String(query).trim()) return false;
  if (text == null) return false;
  return String(text).toLowerCase().includes(String(query).toLowerCase());
}

// The one place "ticket id or title" is defined as a match.
function rowMatches(ticket, title, query) {
  return matchesQuery(ticket, query) || matchesQuery(title, query);
}

// Flat, render-ordered list of { ticket, title, jump } — reusing
// buildSections'/bucketRuns' own section order (NEEDS YOU, FAILED, RUNNING,
// QUICK START, [QUEUED], DONE), the exact same universe sectionJumpTargets
// (keys.js) already walks for digit-jump (design.md Decision 1). No `cols`/
// `metrics` opt is ever passed to buildSections here — METRICS has no
// selectable rows, so this deliberately never builds/includes it (it would
// be excluded from the walk below either way, since it carries no `group`
// entries to iterate).
//
// `jump` is already the exact action shape the corresponding key/digit press
// would have produced for that row: `{ type: 'jump', index }` for a
// NEEDS YOU/FAILED/RUNNING/DONE run (the same flat `selected` index space
// digit-jump's own `startIndex` walks), `{ type: 'focus-queue', index }` for
// a QUEUED row (its own local cursor, an index into `queueState.pending`),
// `{ type: 'focus-quickstart', index }` for a QUICK START row (its own local
// cursor, an index into `quickStartTickets`).
function searchTargets(runs, queueState, quickStartTickets, queuedTitles) {
  const sections = buildSections(bucketRuns(runs || []), queueState, {
    quickStartTickets: quickStartTickets || [],
  }).filter((s) => s.group.length > 0 || s.forceRender);

  const targets = [];
  let index = 0;
  for (const s of sections) {
    if (s.kind === 'queued') {
      s.group.forEach((ticket, k) => {
        targets.push({
          ticket,
          title: queuedTitles ? queuedTitles.get(ticket) : null,
          jump: { type: 'focus-queue', index: k },
        });
      });
    } else if (s.kind === 'quickstart') {
      s.group.forEach((ticket, k) => {
        targets.push({
          ticket: ticket.identifier,
          title: ticket.title,
          jump: { type: 'focus-quickstart', index: k },
        });
      });
    } else if (s.unselectable) {
      // METRICS (or any other future unselectable, rowless section) — no
      // rows to walk.
    } else {
      s.group.forEach((run, k) => {
        targets.push({
          ticket: run.ticket,
          title: run.changeName,
          jump: { type: 'jump', index: index + k },
        });
      });
      index += s.group.length;
    }
  }
  return targets;
}

function firstMatch(targets, query) {
  return targets.find((t) => rowMatches(t.ticket, t.title, query));
}

module.exports = { matchesQuery, rowMatches, searchTargets, firstMatch };
