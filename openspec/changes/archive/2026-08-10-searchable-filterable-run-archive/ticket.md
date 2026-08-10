# CON-113: Searchable, filterable run archive

## Description

DONE only shows "most recent few, with `… and N more` for the rest"
(`docs/dashboard.md`) — finding a specific past run (a ticket id from three
weeks ago, or "what did we ship last Tuesday") today means grepping
`.concertino/runs/*/events.jsonl` by hand outside the dashboard.

### Proposed

A dedicated run-archive screen (reachable from the fleet view) listing every
retained run under `.concertino/runs/` (bounded by `dashboard.retentionDays`,
same as today), filterable by ticket id/title substring, harness, and date
range — read-only, reusing the drill-down's TICKET/TIMELINE/GATES/EVIDENCE
rendering for whichever run is selected.

## Design decisions to escalate

* New top-level key needed — `keys.js`'s claimed-letter tally (`a c d f h H j
  k l L m n N p P q r s S t y`) is already dense; this may need a capital or
  a two-key sequence.
* Does this screen's filters overlap enough with the fleet-wide search item
  (`/`, a separate ticket, CON-110) that they should share an implementation,
  or are they different enough (archive spans retained-but-off-screen runs;
  `/` is live-fleet-only) to stay separate? Worth resolving before both are
  built independently.

## Acceptance Criteria

* A run-archive screen lists every retained run and supports filtering by
  ticket id/title, harness, and date range.
* Selecting a run opens the same drill-down rendering as a live/recent run,
  reusing existing panels rather than a parallel read path.
* Documented in `docs/dashboard.md`.
