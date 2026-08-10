'use strict';

// CON-114, design.md Decision 1: the ONE shared implementation of the
// run-comparison feature's capped-at-2 selection toggle — imported by both
// controllers/archive.js and controllers/fleet.js (the two screens whose
// key handling can dispatch `toggle-compare-select`), so the cap/DONE-only
// rules live in exactly one place rather than being re-derived per
// controller.
//
// toggleCompareSelection(selection, ticket, run) -> new selection array.
// Pure: never mutates `selection`; always returns a (possibly identical)
// array.
//
//   - toggling a ticket already in `selection` removes it — regardless of
//     the current run's status (an already-marked run stays unmarkable-
//     to-remove even if, hypothetically, its status changed after being
//     marked; DONE is a terminal status in practice, so this is a defensive
//     ordering, not a case this codebase expects to hit).
//   - toggling a ticket not in `selection`: a no-op unless the run is DONE
//     and fewer than 2 are already selected.
//   - toggling a third, unmarked ticket while 2 are already selected is a
//     no-op — it does NOT evict either existing selection (spec.md's own
//     "Marking a third run while two are already marked is a no-op"
//     scenario).
//
// `run` may be `null`/`undefined` (a ticket with no resolvable run at
// toggle time) — treated exactly like a non-DONE run: marking is a no-op,
// unmarking (if somehow already marked) still succeeds.
function toggleCompareSelection(selection, ticket, run) {
  const current = selection || [];
  const alreadyMarked = current.indexOf(ticket) !== -1;
  if (alreadyMarked) {
    return current.filter((t) => t !== ticket);
  }
  if (!run || run.status !== 'done') return current;
  if (current.length >= 2) return current;
  return current.concat([ticket]);
}

module.exports = { toggleCompareSelection };
