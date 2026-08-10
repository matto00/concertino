# CON-109: Bulk row actions (multi-select) on FAILED and QUEUED

## Description

Every FAILED-row action (`a` address, `d` done — CON-98) and QUEUED's
force-start apply to exactly one selected row at a time. A fleet with
several FAILED runs after a bad batch has to be addressed/marked-done one
row at a time.

## Proposed

`space` to multi-select rows within a section (FAILED and QUEUED, at
minimum — the two sections that already have row-level actions), then apply
the section's existing action key (`a`/`d`/`f`) across the whole selection,
behind the same `y` confirmation pattern already used for each of those
actions individually (naming how many rows, not just one ticket).

## Design decisions to escalate

* Does multi-select need its own visual marker distinct from the existing
  single-row `▸` cursor (a lazygit-style `✓`/highlighted-row list), and does
  it persist across a `j`/`k` move or only mark-as-you-go?
* Mixed-outcome handling — if a bulk `a` (address) partially fails to launch
  for some rows (tmux window creation error), what does the
  confirmation/result summary look like? The single-row path today just
  leaves the prompt open with an error; a bulk equivalent needs a per-row
  result list.

## Acceptance Criteria

* `space` multi-selects rows within FAILED and QUEUED; the section's
  existing action key applies to the full selection behind one `y`
  confirmation naming the count.
* A partial failure mid-batch is reported per-row, never silently swallowed.
* Documented in `docs/dashboard.md`'s key tables.
